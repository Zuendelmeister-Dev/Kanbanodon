package main

import (
	"encoding/json"
	"net/http"
	"sort"
	"strconv"
	"strings"
)

// moveTicket changes only a task's workflow column and manual Board order. The
// neighboring ticket anchor also works when filters hide intervening tickets.
// Reindexing the affected lane columns and completion effects are one commit.
func (s *server) moveTicket(w http.ResponseWriter, r *http.Request, u user, id, bid int64) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var in struct{ ColumnID, BeforeID, AfterID int64 }
	if !decodeJSON(w, r, &in) {
		return
	}
	if in.ColumnID <= 0 || in.BeforeID < 0 || in.AfterID < 0 || (in.BeforeID != 0 && in.AfterID != 0) || in.BeforeID == id || in.AfterID == id {
		http.Error(w, "invalid move destination", http.StatusBadRequest)
		return
	}
	tx, err := s.db.Begin()
	if err != nil {
		stateReadError(w, err)
		return
	}
	defer tx.Rollback()
	var targetBoard int64
	if err := tx.QueryRow("select board_id from columns where id=?", in.ColumnID).Scan(&targetBoard); err != nil || targetBoard != bid {
		http.Error(w, "column does not belong to board", http.StatusBadRequest)
		return
	}
	items := map[int64]ticket{}
	rs, err := tx.Query(`select id,parent_id,column_id,type,position,ref,is_backlog,archived_at,deleted_at,completed_at,extras from tickets where board_id=?`, bid)
	if err != nil {
		stateReadError(w, err)
		return
	}
	for rs.Next() {
		var item ticket
		var extras string
		if err := rs.Scan(&item.ID, &item.ParentID, &item.ColumnID, &item.Type, &item.Position, &item.Ref, &item.IsBacklog, &item.ArchivedAt, &item.DeletedAt, &item.CompletedAt, &extras); err != nil {
			rs.Close()
			stateReadError(w, err)
			return
		}
		if err := json.Unmarshal([]byte(extras), &item.Extras); err != nil {
			rs.Close()
			stateReadError(w, err)
			return
		}
		items[item.ID] = item
	}
	err = rs.Err()
	rs.Close()
	if err != nil {
		stateReadError(w, err)
		return
	}
	moved, found := items[id]
	if !found || !boardMoveEligible(moved) {
		http.Error(w, "only active Board tasks can be moved", http.StatusConflict)
		return
	}
	lane := boardMoveEpic(moved, items)
	anchorID := in.BeforeID
	if anchorID == 0 {
		anchorID = in.AfterID
	}
	if anchorID != 0 {
		anchor, ok := items[anchorID]
		if !ok || !boardMoveEligible(anchor) || anchor.ColumnID != in.ColumnID || boardMoveEpic(anchor, items) != lane {
			http.Error(w, "destination task is no longer in this lane and column", http.StatusConflict)
			return
		}
	}
	columnChanged := moved.ColumnID != in.ColumnID
	if columnChanged {
		linkRows, err := tx.Query("select to_ticket_id from ticket_links where from_ticket_id=?", id)
		if err != nil {
			stateReadError(w, err)
			return
		}
		var links []int64
		for linkRows.Next() {
			var link int64
			if err := linkRows.Scan(&link); err != nil {
				linkRows.Close()
				stateReadError(w, err)
				return
			}
			links = append(links, link)
		}
		err = linkRows.Err()
		linkRows.Close()
		if err != nil {
			stateReadError(w, err)
			return
		}
		blocked, err := blockedDependenciesForLinks(tx, bid, links, in.ColumnID)
		if err != nil {
			stateReadError(w, err)
			return
		}
		if len(blocked) > 0 {
			http.Error(w, "blocked by unfinished dependencies: "+strings.Join(blocked, ", "), http.StatusConflict)
			return
		}
	}
	target := []ticket{}
	source := []ticket{}
	for _, item := range items {
		if item.ID == id || !boardMoveEligible(item) || boardMoveEpic(item, items) != lane {
			continue
		}
		if item.ColumnID == in.ColumnID {
			target = append(target, item)
		} else if item.ColumnID == moved.ColumnID {
			source = append(source, item)
		}
	}
	sort.Slice(target, func(i, j int) bool { return boardMoveLess(target[i], target[j]) })
	sort.Slice(source, func(i, j int) bool { return boardMoveLess(source[i], source[j]) })
	insert := len(target)
	for index, item := range target {
		if item.ID == anchorID {
			insert = index
			if in.AfterID != 0 {
				insert++
			}
			break
		}
	}
	target = append(target, ticket{})
	copy(target[insert+1:], target[insert:])
	target[insert] = moved
	changed := columnChanged
	for index, item := range target {
		changed = changed || item.Position != index+1
	}
	if !changed {
		jsonOut(w, map[string]any{"ok": true})
		return
	}
	completedAt := moved.CompletedAt
	if columnChanged {
		completedAt, err = completionTimestamp(tx, in.ColumnID, moved.CompletedAt)
		if err != nil {
			stateReadError(w, err)
			return
		}
	}
	if _, err = tx.Exec("update tickets set column_id=?,completed_at=?,updated_at=? where id=?", in.ColumnID, completedAt, now(), id); err != nil {
		stateReadError(w, err)
		return
	}
	if err := validateEpicCompletion(tx, bid, id); err != nil {
		writeWorkflowError(w, err)
		return
	}
	if columnChanged {
		if err := workflowHistory(tx, id, moved.ColumnID, moved.CompletedAt, completedAt, "recorded"); err != nil {
			stateReadError(w, err)
			return
		}
	}
	for _, group := range [][]ticket{source, target} {
		for index, item := range group {
			if _, err = tx.Exec("update tickets set position=? where id=?", index+1, item.ID); err != nil {
				stateReadError(w, err)
				return
			}
		}
	}
	message := "Changed Board order"
	if columnChanged {
		message = "Changed status and Board order"
	}
	if err := recordActivity(tx, id, u.ID, message); err != nil {
		stateReadError(w, err)
		return
	}
	if columnChanged && moved.CompletedAt == "" {
		if err := repeatCompletedTask(tx, id, bid, u.ID, completedAt, moved.Extras); err != nil {
			stateReadError(w, err)
			return
		}
	}
	if err := tx.Commit(); err != nil {
		stateReadError(w, err)
		return
	}
	jsonOut(w, map[string]any{"ok": true})
}

func boardMoveEligible(item ticket) bool {
	return !item.IsBacklog && item.Type != "idea" && item.Type != "epic" && item.ArchivedAt == "" && item.DeletedAt == ""
}

// Match the Board's Epic grouping without changing the actual task hierarchy.
func boardMoveEpic(item ticket, items map[int64]ticket) int64 {
	seen := map[int64]bool{}
	for item.ParentID != 0 && !seen[item.ID] {
		seen[item.ID] = true
		parent, ok := items[item.ParentID]
		if !ok || parent.IsBacklog || parent.Type == "idea" || parent.ArchivedAt != "" || parent.DeletedAt != "" {
			return 0
		}
		if parent.Type == "epic" {
			return parent.ID
		}
		item = parent
	}
	return 0
}

// Position is the manual order; numeric references break old equal positions.
func boardMoveLess(a, b ticket) bool {
	if a.Position != b.Position {
		return a.Position < b.Position
	}
	refA, refB := a.Ref, b.Ref
	if refA == "" {
		refA = strconv.FormatInt(a.ID, 10)
	}
	if refB == "" {
		refB = strconv.FormatInt(b.ID, 10)
	}
	if comparison := boardRefCompare(refA, refB); comparison != 0 {
		return comparison < 0
	}
	return a.ID < b.ID
}

// Match boardRefCompare in app.js for arbitrary imported natural references.
// Numeric runs compare without integer conversion, so long refs cannot overflow.
func boardRefCompare(first, second string) int {
	fold := func(value string) string {
		return strings.Map(func(char rune) rune {
			if char >= 'A' && char <= 'Z' {
				return char + ('a' - 'A')
			}
			return char
		}, value)
	}
	a, b := boardRefChunks(fold(first)), boardRefChunks(fold(second))
	for i := 0; i < len(a) && i < len(b); i++ {
		left, right := a[i], b[i]
		if boardRefDigit(left[0]) && boardRefDigit(right[0]) {
			left, right = strings.TrimLeft(left, "0"), strings.TrimLeft(right, "0")
			if left == "" {
				left = "0"
			}
			if right == "" {
				right = "0"
			}
			if len(left) != len(right) {
				return len(left) - len(right)
			}
		}
		if comparison := strings.Compare(left, right); comparison != 0 {
			return comparison
		}
	}
	return len(a) - len(b)
}

func boardRefChunks(ref string) []string {
	var chunks []string
	start := 0
	for i := 1; i < len(ref); i++ {
		if boardRefDigit(ref[i]) != boardRefDigit(ref[i-1]) {
			chunks = append(chunks, ref[start:i])
			start = i
		}
	}
	if ref != "" {
		chunks = append(chunks, ref[start:])
	}
	return chunks
}

func boardRefDigit(value byte) bool { return value >= '0' && value <= '9' }
