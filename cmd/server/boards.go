package main

import (
	"net/http"
	"strconv"
	"strings"
	"time"
)

// createBoard inserts a board with the default workflow columns and metadata.
func (s *server) createBoard(name string, ownerID int64) (int64, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		name = "New Board"
	}
	ts := now()
	tx, err := s.db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	res, err := tx.Exec("insert into boards(name,owner_id,created_at) values(?,?,?)", name, ownerID, ts)
	if err != nil {
		return 0, err
	}
	bid, _ := res.LastInsertId()
	for i, c := range []string{"Backlog", "Ready", "In Progress", "Review", "Done"} {
		if _, err := tx.Exec("insert into columns(board_id,name,position) values(?,?,?)", bid, c, i); err != nil {
			return 0, err
		}
	}
	for _, l := range []struct{ n, c string }{{"bug", "#ef4444"}, {"idea", "#f59e0b"}, {"feature", "#2dd4bf"}, {"research", "#8b5cf6"}} {
		if _, err := tx.Exec("insert into labels(board_id,name,color) values(?,?,?)", bid, l.n, l.c); err != nil {
			return 0, err
		}
	}
	if _, err = tx.Exec("insert into milestones(board_id,name,due_date) values(?,'First flight',?)", bid, time.Now().AddDate(0, 0, 14).Format("2006-01-02")); err != nil {
		return 0, err
	}
	if ownerID > 0 {
		if _, err := tx.Exec("insert into board_users(board_id,user_id,full_access) values(?,?,1)", bid, ownerID); err != nil {
			return 0, err
		}
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return bid, nil
}

// grantUserAllBoards gives a user full access to every existing board.
func (s *server) grantUserAllBoards(userID int64) error {
	if userID <= 0 {
		return nil
	}
	_, err := s.db.Exec("insert or ignore into board_users(board_id,user_id,full_access) select id,?,1 from boards", userID)
	if err != nil {
		return err
	}
	_, err = s.db.Exec("update board_users set full_access=1 where user_id=?", userID)
	return err
}

// setBoardAccess upserts one user's full-access flag for one board.
func (s *server) setBoardAccess(boardID, userID int64, fullAccess bool) error {
	if boardID <= 0 || userID <= 0 {
		return nil
	}
	full := 0
	if fullAccess {
		full = 1
	}
	_, err := s.db.Exec("insert into board_users(board_id,user_id,full_access) values(?,?,?) on conflict(board_id,user_id) do update set full_access=excluded.full_access", boardID, userID, full)
	return err
}

// accessibleBoards returns the boards visible to a user.
func (s *server) accessibleBoards(u user) []map[string]any {
	if u.IsAdmin {
		return rows(s.db, "select id,name,owner_id,created_at from boards order by id")
	}
	return rows(s.db, `select b.id,b.name,b.owner_id,b.created_at
		from boards b
		join board_users bu on bu.board_id=b.id
		where bu.user_id=? and bu.full_access=1
		order by b.id`, u.ID)
}

// canAccessBoard checks whether a user may read and work on a board.
func (s *server) canAccessBoard(u user, boardID int64) bool {
	if boardID <= 0 {
		return false
	}
	var n int
	if u.IsAdmin {
		return s.db.QueryRow("select count(*) from boards where id=?", boardID).Scan(&n) == nil && n > 0
	}
	return s.db.QueryRow("select count(*) from board_users where board_id=? and user_id=? and full_access=1", boardID, u.ID).Scan(&n) == nil && n > 0
}

// boardOwnerID returns the owner user id for a board.
func (s *server) boardOwnerID(boardID int64) (int64, error) {
	var ownerID int64
	err := s.db.QueryRow("select owner_id from boards where id=?", boardID).Scan(&ownerID)
	return ownerID, err
}

// boardID chooses the requested board or falls back to the first accessible one.
func (s *server) boardID(r *http.Request, u user) int64 {
	if raw := r.URL.Query().Get("boardId"); raw != "" {
		if id, err := strconv.ParseInt(raw, 10, 64); err == nil && id > 0 {
			if s.canAccessBoard(u, id) {
				return id
			}
		}
	}
	var id int64
	if u.IsAdmin {
		if s.db.QueryRow("select id from boards order by id limit 1").Scan(&id) == nil && id > 0 {
			return id
		}
		return 0
	}
	if s.db.QueryRow(`select b.id
		from boards b
		join board_users bu on bu.board_id=b.id
		where bu.user_id=? and bu.full_access=1
		order by b.id limit 1`, u.ID).Scan(&id) == nil && id > 0 {
		return id
	}
	return 0
}

// dataBoardID rejects an explicitly invalid board instead of silently writing to a fallback.
func (s *server) dataBoardID(r *http.Request, u user) int64 {
	raw := r.URL.Query().Get("boardId")
	if raw == "" {
		return s.boardID(r, u)
	}
	id, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || id <= 0 || !s.canAccessBoard(u, id) {
		return 0
	}
	return id
}

// boards serves board listing and board creation requests.
func (s *server) boards(w http.ResponseWriter, r *http.Request, u user) {
	if r.Method == http.MethodGet {
		jsonOut(w, map[string]any{"boards": s.accessibleBoards(u)})
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method", 405)
		return
	}
	var in struct{ Name string }
	if !decodeJSON(w, r, &in) {
		return
	}
	id, err := s.createBoard(in.Name, u.ID)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	jsonOut(w, map[string]any{"ok": true, "id": id})
}

// state returns the complete frontend state for the selected board.
func (s *server) state(w http.ResponseWriter, r *http.Request, u user) {
	if r.Method != http.MethodGet {
		http.Error(w, "method", http.StatusMethodNotAllowed)
		return
	}
	bid := s.boardID(r, u)
	boards := s.accessibleBoards(u)
	payload := map[string]any{
		"me":             u,
		"authMode":       s.authMode,
		"boards":         boards,
		"board":          map[string]any{},
		"columns":        []map[string]any{},
		"tickets":        []ticket{},
		"labels":         []map[string]any{},
		"milestones":     []map[string]any{},
		"users":          rows(s.db, "select id,username,name,avatar,is_admin,must_change_password from users order by name"),
		"boardAccess":    []map[string]any{},
		"allBoardAccess": s.allBoardAccess(u),
		"comments":       []map[string]any{},
	}
	if bid > 0 {
		payload["board"] = one(s.db, "select id,name,owner_id from boards where id=?", bid)
		payload["columns"] = rows(s.db, "select id,name,position from columns where board_id=? order by position", bid)
		payload["tickets"] = s.loadTickets(bid)
		payload["labels"] = rows(s.db, "select id,name,color from labels where board_id=? order by name", bid)
		payload["milestones"] = rows(s.db, "select id,name,due_date from milestones where board_id=? order by due_date", bid)
		payload["boardAccess"] = rows(s.db, `select u.id user_id,coalesce(bu.full_access,0) full_access
			from users u
			left join board_users bu on bu.user_id=u.id and bu.board_id=?
			order by u.name`, bid)
		payload["comments"] = rows(s.db, "select c.id,c.ticket_id,c.user_id,c.body,c.created_at from comments c join tickets t on t.id=c.ticket_id where t.board_id=? order by c.created_at", bid)
	}
	jsonOut(w, payload)
}

// allBoardAccess returns board-sharing rows for every board the user can manage.
func (s *server) allBoardAccess(u user) []map[string]any {
	if u.IsAdmin {
		return rows(s.db, `select b.id board_id,b.name board_name,b.owner_id,u.id user_id,coalesce(bu.full_access,0) full_access
			from boards b
			cross join users u
			left join board_users bu on bu.board_id=b.id and bu.user_id=u.id
			order by b.id,u.name`)
	}
	return rows(s.db, `select b.id board_id,b.name board_name,b.owner_id,u.id user_id,coalesce(bu.full_access,0) full_access
		from boards b
		cross join users u
		left join board_users bu on bu.board_id=b.id and bu.user_id=u.id
		where b.owner_id=?
		order by b.id,u.name`, u.ID)
}

// boardAccess updates one user's sharing flag for one board.
func (s *server) boardAccess(w http.ResponseWriter, r *http.Request, u user) {
	if r.Method != http.MethodPost {
		http.Error(w, "method", 405)
		return
	}
	var in struct {
		BoardID    int64
		UserID     int64
		FullAccess bool
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	if in.BoardID == 0 {
		in.BoardID = s.boardID(r, u)
	}
	if in.UserID <= 0 || in.BoardID <= 0 {
		http.Error(w, "board and user required", 400)
		return
	}
	ownerID, err := s.boardOwnerID(in.BoardID)
	if err != nil {
		http.Error(w, "board not found", 404)
		return
	}
	if !u.IsAdmin && ownerID != u.ID {
		http.Error(w, "board owner or admin required", http.StatusForbidden)
		return
	}
	if in.UserID == ownerID && !in.FullAccess {
		http.Error(w, "board owner keeps access", 400)
		return
	}
	var userCount int
	if err := s.db.QueryRow("select count(*) from users where id=?", in.UserID).Scan(&userCount); err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	if userCount == 0 {
		http.Error(w, "user not found", 404)
		return
	}
	if err := s.setBoardAccess(in.BoardID, in.UserID, in.FullAccess); err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	jsonOut(w, map[string]any{"ok": true})
}
