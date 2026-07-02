package main

import (
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
)

// createTicket validates and inserts a new ticket for the selected board.
func (s *server) createTicket(w http.ResponseWriter, r *http.Request, u user) {
	if r.Method != "POST" {
		http.Error(w, "method", 405)
		return
	}
	var t ticket
	if !decodeJSON(w, r, &t) {
		return
	}
	normalizeTicketInput(&t)
	if strings.TrimSpace(t.Title) == "" {
		http.Error(w, "title required", 400)
		return
	}
	bid := s.boardID(r, u)
	if t.BoardID > 0 {
		if !s.canAccessBoard(u, t.BoardID) {
			http.Error(w, "board access required", 403)
			return
		}
		bid = t.BoardID
	}
	if bid == 0 {
		http.Error(w, "board access required", 403)
		return
	}
	if t.ColumnID == 0 {
		t.ColumnID = firstCol(s.db, bid)
	} else if !columnBelongsToBoard(s.db, t.ColumnID, bid) {
		http.Error(w, "column does not belong to board", 400)
		return
	}
	// Parent links are board-local; otherwise a shared board could leak another board's work tree.
	if t.ParentID != 0 && !ticketBelongsToBoard(s.db, t.ParentID, bid) {
		http.Error(w, "parent does not belong to board", 400)
		return
	}
	if t.ParentID != 0 && !ticketCanBeParent(s.db, t.ParentID, bid, t.Type) {
		http.Error(w, "parent type is not valid for this ticket type", 400)
		return
	}
	ts := now()
	res, err := s.db.Exec("insert into tickets(board_id,column_id,parent_id,ref,title,body,type,points,duration,start_date,due_date,completed_at,milestone_id,assignee_id,position,created_at,updated_at) values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", bid, t.ColumnID, t.ParentID, t.Ref, t.Title, t.Body, t.Type, t.Points, t.Duration, t.StartDate, t.DueDate, t.CompletedAt, t.MilestoneID, t.AssigneeID, t.Position, ts, ts)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	id, _ := res.LastInsertId()
	s.meta(id, bid, t.Labels, t.Links)
	jsonOut(w, map[string]any{"ok": true, "id": id})
}

// ticketAction handles ticket updates, deletes, and comment creation.
func (s *server) ticketAction(w http.ResponseWriter, r *http.Request, u user) {
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/tickets/"), "/")
	id, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil {
		http.Error(w, "bad id", 400)
		return
	}
	bid, err := s.ticketBoardID(id)
	if err != nil {
		http.Error(w, "ticket not found", 404)
		return
	}
	if !s.canAccessBoard(u, bid) {
		http.Error(w, "board access required", 403)
		return
	}
	if len(parts) > 1 && parts[1] == "comments" {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", 405)
			return
		}
		var in struct{ Body string }
		if !decodeJSON(w, r, &in) {
			return
		}
		body := strings.TrimSpace(in.Body)
		if body == "" {
			http.Error(w, "comment body required", 400)
			return
		}
		_, err = s.db.Exec("insert into comments(ticket_id,user_id,body,created_at) values(?,?,?,?)", id, u.ID, body, now())
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		jsonOut(w, map[string]any{"ok": true})
		return
	}
	if r.Method == http.MethodDelete {
		_, _ = s.db.Exec("delete from ticket_labels where ticket_id=?", id)
		_, _ = s.db.Exec("delete from ticket_links where from_ticket_id=? or to_ticket_id=?", id, id)
		_, _ = s.db.Exec("delete from comments where ticket_id=?", id)
		_, _ = s.db.Exec("update tickets set parent_id=0 where parent_id=?", id)
		res, err := s.db.Exec("delete from tickets where id=?", id)
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		affected, _ := res.RowsAffected()
		if affected == 0 {
			http.Error(w, "ticket not found", 404)
			return
		}
		jsonOut(w, map[string]any{"ok": true})
		return
	}
	if r.Method != http.MethodPut {
		http.Error(w, "method not allowed", 405)
		return
	}
	var t ticket
	if !decodeJSON(w, r, &t) {
		return
	}
	normalizeTicketInput(&t)
	if strings.TrimSpace(t.Title) == "" {
		http.Error(w, "title required", 400)
		return
	}
	if t.ColumnID != 0 && !columnBelongsToBoard(s.db, t.ColumnID, bid) {
		http.Error(w, "column does not belong to board", 400)
		return
	}
	if t.ParentID == id {
		http.Error(w, "ticket cannot be its own parent", 400)
		return
	}
	if t.ParentID != 0 && !ticketBelongsToBoard(s.db, t.ParentID, bid) {
		http.Error(w, "parent does not belong to board", 400)
		return
	}
	if t.ParentID != 0 && !ticketCanBeParent(s.db, t.ParentID, bid, t.Type) {
		http.Error(w, "parent type is not valid for this ticket type", 400)
		return
	}
	if cycle, err := parentWouldCreateCycle(s.db, id, t.ParentID); err != nil {
		http.Error(w, err.Error(), 500)
		return
	} else if cycle {
		http.Error(w, "parent would create a cycle", 400)
		return
	}
	completedAt, err := s.completedAtForMove(id, t.ColumnID)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	if blocked, err := s.blockedDependencies(id, t.ColumnID); err != nil {
		http.Error(w, err.Error(), 500)
		return
	} else if len(blocked) > 0 {
		http.Error(w, "blocked by unfinished dependencies: "+strings.Join(blocked, ", "), http.StatusConflict)
		return
	}
	_, err = s.db.Exec("update tickets set column_id=?,parent_id=?,ref=?,title=?,body=?,type=?,points=?,duration=?,start_date=?,due_date=?,completed_at=?,milestone_id=?,assignee_id=?,position=?,updated_at=? where id=?", t.ColumnID, t.ParentID, t.Ref, t.Title, t.Body, t.Type, t.Points, t.Duration, t.StartDate, t.DueDate, completedAt, t.MilestoneID, t.AssigneeID, t.Position, now(), id)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	s.meta(id, bid, t.Labels, t.Links)
	jsonOut(w, map[string]any{"ok": true})
}

// ticketBoardID returns the board that owns a ticket.
func (s *server) ticketBoardID(ticketID int64) (int64, error) {
	var bid int64
	err := s.db.QueryRow("select board_id from tickets where id=?", ticketID).Scan(&bid)
	return bid, err
}

// blockedDependencies lists unfinished dependencies that block a move into work columns.
func (s *server) blockedDependencies(ticketID, targetColumnID int64) ([]string, error) {
	if targetColumnID == 0 {
		return nil, nil
	}
	var boardID int64
	var targetPosition int
	var targetName string
	if err := s.db.QueryRow("select board_id,position,name from columns where id=?", targetColumnID).Scan(&boardID, &targetPosition, &targetName); err != nil {
		return nil, err
	}
	var startPosition int
	if err := s.db.QueryRow("select position from columns where board_id=? and lower(name)='in progress' order by position limit 1", boardID).Scan(&startPosition); err != nil {
		startPosition = 2
	}
	if targetPosition < startPosition || strings.EqualFold(targetName, "Backlog") || strings.EqualFold(targetName, "Ready") {
		return nil, nil
	}

	rs, err := s.db.Query(`
		select dep.id, dep.title
		from ticket_links l
		join tickets dep on dep.id=l.to_ticket_id
		join columns c on c.id=dep.column_id
		where l.from_ticket_id=? and dep.board_id=? and lower(c.name)<>'done'
		order by dep.id`, ticketID, boardID)
	if err != nil {
		return nil, err
	}
	defer rs.Close()
	var blocked []string
	for rs.Next() {
		var id int64
		var title string
		if err := rs.Scan(&id, &title); err != nil {
			return nil, err
		}
		blocked = append(blocked, "#"+strconv.FormatInt(id, 10)+" "+title)
	}
	return blocked, rs.Err()
}

// completedAtForMove returns the completion timestamp when a ticket enters Done.
func (s *server) completedAtForMove(ticketID, targetColumnID int64) (string, error) {
	if targetColumnID == 0 {
		return "", nil
	}
	var targetName string
	if err := s.db.QueryRow("select name from columns where id=?", targetColumnID).Scan(&targetName); err != nil {
		return "", err
	}
	if !strings.EqualFold(targetName, "Done") {
		return "", nil
	}
	var completedAt string
	if err := s.db.QueryRow("select completed_at from tickets where id=?", ticketID).Scan(&completedAt); err != nil {
		return "", err
	}
	if completedAt != "" {
		return completedAt, nil
	}
	return now(), nil
}

// export writes the selected board as a portable JSON snapshot.
func (s *server) export(w http.ResponseWriter, r *http.Request, u user) {
	bid := s.boardID(r, u)
	if bid == 0 {
		http.Error(w, "board access required", 403)
		return
	}
	w.Header().Set("content-disposition", "attachment; filename=kanbanodon-export.json")
	jsonOut(w, map[string]any{"version": 1, "exportedAt": now(), "state": map[string]any{"board": one(s.db, "select * from boards where id=?", bid), "tickets": s.loadTickets(bid), "columns": rows(s.db, "select * from columns where board_id=?", bid), "labels": rows(s.db, "select * from labels where board_id=?", bid), "milestones": rows(s.db, "select * from milestones where board_id=?", bid), "comments": rows(s.db, "select c.* from comments c join tickets t on t.id=c.ticket_id where t.board_id=?", bid)}})
}

// importData imports tickets from a JSON snapshot into the selected board.
func (s *server) importData(w http.ResponseWriter, r *http.Request, u user) {
	bid := s.boardID(r, u)
	if bid == 0 {
		http.Error(w, "board access required", 403)
		return
	}
	b, err := io.ReadAll(io.LimitReader(r.Body, 5<<20))
	if err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	var p struct{ State struct{ Tickets []ticket } }
	if json.Unmarshal(b, &p) != nil {
		http.Error(w, "bad import", 400)
		return
	}
	for _, t := range p.State.Tickets {
		normalizeTicketInput(&t)
		if strings.TrimSpace(t.Title) != "" {
			t.Position += 1000
			if t.ColumnID == 0 {
				t.ColumnID = firstCol(s.db, bid)
			} else if !columnBelongsToBoard(s.db, t.ColumnID, bid) {
				t.ColumnID = firstCol(s.db, bid)
			}
			res, err := s.db.Exec("insert into tickets(board_id,column_id,parent_id,ref,title,body,type,points,duration,start_date,due_date,completed_at,milestone_id,assignee_id,position,created_at,updated_at) values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", bid, t.ColumnID, 0, t.Ref, t.Title, t.Body, t.Type, t.Points, t.Duration, t.StartDate, t.DueDate, t.CompletedAt, t.MilestoneID, t.AssigneeID, t.Position, now(), now())
			if err == nil {
				id, _ := res.LastInsertId()
				s.meta(id, bid, t.Labels, t.Links)
			}
		}
	}
	jsonOut(w, map[string]any{"ok": true, "imported": len(p.State.Tickets)})
}

// loadTickets reads tickets and attaches their labels and dependency links.
func (s *server) loadTickets(boardID int64) []ticket {
	out := []ticket{}
	rs, err := s.db.Query("select id,board_id,column_id,parent_id,ref,title,body,type,points,duration,start_date,due_date,completed_at,milestone_id,assignee_id,position,created_at,updated_at from tickets where board_id=? order by position,id", boardID)
	if err != nil {
		return out
	}
	for rs.Next() {
		var t ticket
		_ = rs.Scan(&t.ID, &t.BoardID, &t.ColumnID, &t.ParentID, &t.Ref, &t.Title, &t.Body, &t.Type, &t.Points, &t.Duration, &t.StartDate, &t.DueDate, &t.CompletedAt, &t.MilestoneID, &t.AssigneeID, &t.Position, &t.CreatedAt, &t.UpdatedAt)
		out = append(out, t)
	}
	_ = rs.Close()
	for i := range out {
		out[i].Labels = strs(s.db, "select l.name from labels l join ticket_labels tl on tl.label_id=l.id where tl.ticket_id=?", out[i].ID)
		out[i].Links = ints(s.db, "select to_ticket_id from ticket_links where from_ticket_id=?", out[i].ID)
	}
	return out
}

// meta replaces labels and dependency links for a ticket.
func (s *server) meta(id, boardID int64, labels []string, links []int64) {
	_, _ = s.db.Exec("delete from ticket_labels where ticket_id=?", id)
	for _, name := range labels {
		name = strings.TrimSpace(name)
		if name == "" {
			continue
		}
		var lid int64
		if s.db.QueryRow("select id from labels where board_id=? and name=?", boardID, name).Scan(&lid) != nil {
			res, err := s.db.Exec("insert into labels(board_id,name,color) values(?,?,?)", boardID, name, "#37c7ad")
			if err != nil {
				continue
			}
			lid, _ = res.LastInsertId()
		}
		_, _ = s.db.Exec("insert or ignore into ticket_labels(ticket_id,label_id) values(?,?)", id, lid)
	}
	_, _ = s.db.Exec("delete from ticket_links where from_ticket_id=?", id)
	for _, to := range links {
		if to > 0 && to != id {
			_, _ = s.db.Exec("insert or ignore into ticket_links(from_ticket_id,to_ticket_id) values(?,?)", id, to)
		}
	}
}

// ticketType normalizes legacy and supported ticket type values.
func ticketType(v string) string {
	v = strings.ToLower(strings.TrimSpace(v))
	if v == "problem" {
		return "bug"
	}
	switch v {
	case "epic", "story", "task", "bug", "idea":
		return v
	default:
		return "task"
	}
}

// normalizeTicketInput applies backend invariants before tickets are saved.
func normalizeTicketInput(t *ticket) {
	t.Ref = strings.TrimSpace(t.Ref)
	t.Type = ticketType(t.Type)
	normalizeDuration(t)
	if t.Type == "idea" {
		// Ideas live in their own backlog and deliberately stay out of date-based planning.
		t.Points = 0
		t.Duration = 0
		t.StartDate = ""
		t.DueDate = ""
		t.CompletedAt = ""
		t.MilestoneID = 0
		t.ParentID = 0
		t.Links = nil
	}
}

// normalizeDuration keeps duration non-negative and migrates old point values.
func normalizeDuration(t *ticket) {
	if t.Duration < 0 {
		t.Duration = 0
	}
	if t.Duration == 0 && t.Points > 0 {
		t.Duration = t.Points
	}
}
