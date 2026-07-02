package main

import (
	"database/sql"
	"strings"
)

type rowScanner interface {
	Scan(dest ...any) error
}

// scanUser maps a database row into the API user model.
func scanUser(row rowScanner, u *user) error {
	var admin, mustChange int
	if err := row.Scan(&u.ID, &u.Username, &u.Name, &u.Email, &u.Avatar, &admin, &mustChange); err != nil {
		return err
	}
	u.IsAdmin = admin != 0
	u.MustChangePassword = mustChange != 0
	return nil
}

// rows runs a query and returns camel-cased column maps for JSON payloads.
func rows(db *sql.DB, q string, args ...any) []map[string]any {
	rs, err := db.Query(q, args...)
	if err != nil {
		return []map[string]any{}
	}
	defer rs.Close()
	cols, _ := rs.Columns()
	out := []map[string]any{}
	for rs.Next() {
		vals := make([]any, len(cols))
		ptr := make([]any, len(cols))
		for i := range vals {
			ptr[i] = &vals[i]
		}
		_ = rs.Scan(ptr...)
		m := map[string]any{}
		for i, c := range cols {
			if b, ok := vals[i].([]byte); ok {
				m[camel(c)] = string(b)
			} else {
				m[camel(c)] = vals[i]
			}
		}
		out = append(out, m)
	}
	return out
}

// one returns the first row from a query or an empty map.
func one(db *sql.DB, q string, args ...any) map[string]any {
	r := rows(db, q, args...)
	if len(r) == 0 {
		return map[string]any{}
	}
	return r[0]
}

// strs returns the first column of a query as strings.
func strs(db *sql.DB, q string, args ...any) []string {
	rs, err := db.Query(q, args...)
	if err != nil {
		return []string{}
	}
	defer rs.Close()
	var out []string
	for rs.Next() {
		var s string
		_ = rs.Scan(&s)
		out = append(out, s)
	}
	return out
}

// ints returns the first column of a query as int64 values.
func ints(db *sql.DB, q string, args ...any) []int64 {
	rs, err := db.Query(q, args...)
	if err != nil {
		return []int64{}
	}
	defer rs.Close()
	var out []int64
	for rs.Next() {
		var n int64
		_ = rs.Scan(&n)
		out = append(out, n)
	}
	return out
}

// firstCol returns the first workflow column for a board.
func firstCol(db *sql.DB, boardID int64) int64 {
	var id int64
	_ = db.QueryRow("select id from columns where board_id=? order by position limit 1", boardID).Scan(&id)
	return id
}

// columnBelongsToBoard checks that a column is scoped to the requested board.
func columnBelongsToBoard(db *sql.DB, columnID, boardID int64) bool {
	var n int
	return db.QueryRow("select count(*) from columns where id=? and board_id=?", columnID, boardID).Scan(&n) == nil && n > 0
}

// ticketBelongsToBoard checks that a ticket is scoped to the requested board.
func ticketBelongsToBoard(db *sql.DB, ticketID, boardID int64) bool {
	var n int
	return db.QueryRow("select count(*) from tickets where id=? and board_id=?", ticketID, boardID).Scan(&n) == nil && n > 0
}

// ticketCanBeParent verifies that a ticket may parent the requested child type.
func ticketCanBeParent(db *sql.DB, ticketID, boardID int64, childType string) bool {
	var parentType string
	if db.QueryRow("select type from tickets where id=? and board_id=?", ticketID, boardID).Scan(&parentType) != nil {
		return false
	}
	return parentTypeAllowed(parentType, childType)
}

// parentTypeAllowed keeps hierarchy choices to work item types that make product sense.
func parentTypeAllowed(parentType, childType string) bool {
	switch ticketType(childType) {
	case "story":
		return ticketType(parentType) == "epic"
	case "task", "bug":
		parent := ticketType(parentType)
		return parent == "epic" || parent == "story"
	default:
		return false
	}
}

// parentWouldCreateCycle checks whether a parent assignment would loop.
func parentWouldCreateCycle(db *sql.DB, ticketID, parentID int64) (bool, error) {
	if parentID == 0 {
		return false, nil
	}
	// ParentID is a single edge; walking upward catches loops before they poison timelines.
	seen := map[int64]bool{ticketID: true}
	for current := parentID; current != 0; {
		if seen[current] {
			return true, nil
		}
		seen[current] = true
		var next int64
		if err := db.QueryRow("select parent_id from tickets where id=?", current).Scan(&next); err != nil {
			return false, err
		}
		current = next
	}
	return false, nil
}

// camel converts snake_case database names into lower camelCase JSON keys.
func camel(s string) string {
	p := strings.Split(s, "_")
	for i := 1; i < len(p); i++ {
		if p[i] != "" {
			p[i] = strings.ToUpper(p[i][:1]) + p[i][1:]
		}
	}
	return strings.Join(p, "")
}
