package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
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
	if t.BoardID < 0 {
		http.Error(w, "board id must not be negative", http.StatusBadRequest)
		return
	}
	bid := s.dataBoardID(r, u)
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
	if err := s.validateTicketRelations(t, bid, 0); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if blocked, err := s.blockedDependenciesForLinks(bid, t.Links, t.ColumnID); err != nil {
		http.Error(w, err.Error(), 500)
		return
	} else if len(blocked) > 0 {
		http.Error(w, "blocked by unfinished dependencies: "+strings.Join(blocked, ", "), http.StatusConflict)
		return
	}
	completedAt, err := completionTimestamp(s.db, t.ColumnID, "")
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	t.CompletedAt = completedAt
	ts := now()
	tx, err := s.db.Begin()
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	defer tx.Rollback()
	res, err := tx.Exec("insert into tickets(board_id,column_id,parent_id,ref,title,body,type,points,duration,start_date,due_date,completed_at,milestone_id,assignee_id,position,is_backlog,created_at,updated_at) values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", bid, t.ColumnID, t.ParentID, t.Ref, t.Title, t.Body, t.Type, t.Points, t.Duration, t.StartDate, t.DueDate, t.CompletedAt, t.MilestoneID, t.AssigneeID, t.Position, t.IsBacklog, ts, ts)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	id, _ := res.LastInsertId()
	if err := replaceTicketMeta(tx, id, bid, t.Labels, t.Links); err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	if err := tx.Commit(); err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	jsonOut(w, map[string]any{"ok": true, "id": id})
}

// ticketAction handles ticket updates, deletes, and comment creation.
func (s *server) ticketAction(w http.ResponseWriter, r *http.Request, u user) {
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/tickets/"), "/")
	id, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil || id <= 0 {
		http.Error(w, "bad id", 400)
		return
	}
	isComments := len(parts) == 2 && parts[1] == "comments"
	if len(parts) > 2 || (len(parts) == 2 && !isComments) {
		http.NotFound(w, r)
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
	if isComments {
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
		tx, err := s.db.Begin()
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		defer tx.Rollback()
		for _, statement := range []string{
			"delete from ticket_labels where ticket_id=?",
			"delete from ticket_links where from_ticket_id=? or to_ticket_id=?",
			"delete from comments where ticket_id=?",
			"update tickets set parent_id=0 where parent_id=?",
		} {
			args := []any{id}
			if strings.Contains(statement, "or to_ticket_id") {
				args = append(args, id)
			}
			if _, err := tx.Exec(statement, args...); err != nil {
				http.Error(w, err.Error(), 500)
				return
			}
		}
		res, err := tx.Exec("delete from tickets where id=?", id)
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		affected, _ := res.RowsAffected()
		if affected == 0 {
			http.Error(w, "ticket not found", 404)
			return
		}
		if err := tx.Commit(); err != nil {
			http.Error(w, err.Error(), 500)
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
	if t.BoardID < 0 || (t.BoardID > 0 && t.BoardID != bid) {
		http.Error(w, "ticket does not belong to requested board", http.StatusBadRequest)
		return
	}
	if t.ColumnID == 0 || !columnBelongsToBoard(s.db, t.ColumnID, bid) {
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
	if err := s.validateTicketRelations(t, bid, id); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	completedAt, err := s.completedAtForMove(id, t.ColumnID)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	if blocked, err := s.blockedDependenciesForLinks(bid, t.Links, t.ColumnID); err != nil {
		http.Error(w, err.Error(), 500)
		return
	} else if len(blocked) > 0 {
		http.Error(w, "blocked by unfinished dependencies: "+strings.Join(blocked, ", "), http.StatusConflict)
		return
	}
	tx, err := s.db.Begin()
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	defer tx.Rollback()
	_, err = tx.Exec("update tickets set column_id=?,parent_id=?,ref=?,title=?,body=?,type=?,points=?,duration=?,start_date=?,due_date=?,completed_at=?,milestone_id=?,assignee_id=?,position=?,is_backlog=?,updated_at=? where id=?", t.ColumnID, t.ParentID, t.Ref, t.Title, t.Body, t.Type, t.Points, t.Duration, t.StartDate, t.DueDate, completedAt, t.MilestoneID, t.AssigneeID, t.Position, t.IsBacklog, now(), id)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	if err := replaceTicketMeta(tx, id, bid, t.Labels, t.Links); err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	if err := tx.Commit(); err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	jsonOut(w, map[string]any{"ok": true})
}

// ticketBoardID returns the board that owns a ticket.
func (s *server) ticketBoardID(ticketID int64) (int64, error) {
	var bid int64
	err := s.db.QueryRow("select board_id from tickets where id=?", ticketID).Scan(&bid)
	return bid, err
}

// blockedDependenciesForLinks checks the incoming dependency set for a workflow move.
func (s *server) blockedDependenciesForLinks(boardID int64, links []int64, targetColumnID int64) ([]string, error) {
	if targetColumnID == 0 {
		return nil, nil
	}
	var targetPosition int
	var targetName string
	var targetBoardID int64
	if err := s.db.QueryRow("select board_id,position,name from columns where id=?", targetColumnID).Scan(&targetBoardID, &targetPosition, &targetName); err != nil {
		return nil, err
	}
	if targetBoardID != boardID {
		return nil, errors.New("target column does not belong to board")
	}
	var startPosition int
	if err := s.db.QueryRow("select position from columns where board_id=? and lower(name)='in progress' order by position limit 1", boardID).Scan(&startPosition); err != nil {
		startPosition = 2
	}
	if targetPosition < startPosition || strings.EqualFold(targetName, "To Do") || strings.EqualFold(targetName, "Backlog") || strings.EqualFold(targetName, "Ready") {
		return nil, nil
	}

	var blocked []string
	seen := map[int64]bool{}
	for _, id := range links {
		if seen[id] {
			continue
		}
		seen[id] = true
		var title, columnName string
		if err := s.db.QueryRow(`select dep.title,c.name
			from tickets dep join columns c on c.id=dep.column_id
			where dep.id=? and dep.board_id=?`, id, boardID).Scan(&title, &columnName); err != nil {
			return nil, err
		}
		if !strings.EqualFold(columnName, "Done") {
			blocked = append(blocked, "#"+strconv.FormatInt(id, 10)+" "+title)
		}
	}
	return blocked, nil
}

// completedAtForMove returns the completion timestamp when a ticket enters Done.
func (s *server) completedAtForMove(ticketID, targetColumnID int64) (string, error) {
	var completedAt string
	if err := s.db.QueryRow("select completed_at from tickets where id=?", ticketID).Scan(&completedAt); err != nil {
		return "", err
	}
	return completionTimestamp(s.db, targetColumnID, completedAt)
}

// completionTimestamp derives completion state from the destination workflow column.
func completionTimestamp(store rowQuerier, targetColumnID int64, current string) (string, error) {
	if targetColumnID == 0 {
		return "", nil
	}
	var targetName string
	if err := store.QueryRow("select name from columns where id=?", targetColumnID).Scan(&targetName); err != nil {
		return "", err
	}
	if !strings.EqualFold(targetName, "Done") {
		return "", nil
	}
	if current != "" {
		return current, nil
	}
	return now(), nil
}

// export writes the selected board as a portable JSON snapshot.
func (s *server) export(w http.ResponseWriter, r *http.Request, u user) {
	if r.Method != http.MethodGet {
		http.Error(w, "method", http.StatusMethodNotAllowed)
		return
	}
	bid := s.dataBoardID(r, u)
	if bid == 0 {
		http.Error(w, "board access required", 403)
		return
	}
	w.Header().Set("content-disposition", "attachment; filename=kanbanodon-export.json")
	jsonOut(w, map[string]any{"version": 1, "exportedAt": now(), "state": map[string]any{"board": one(s.db, "select * from boards where id=?", bid), "tickets": s.loadTickets(bid), "columns": rows(s.db, "select * from columns where board_id=?", bid), "labels": rows(s.db, "select * from labels where board_id=?", bid), "milestones": rows(s.db, "select * from milestones where board_id=?", bid), "comments": rows(s.db, "select c.* from comments c join tickets t on t.id=c.ticket_id where t.board_id=?", bid)}})
}

// importData imports tickets from a JSON snapshot into the selected board.
func (s *server) importData(w http.ResponseWriter, r *http.Request, u user) {
	if r.Method != http.MethodPost {
		http.Error(w, "method", http.StatusMethodNotAllowed)
		return
	}
	bid := s.dataBoardID(r, u)
	if bid == 0 {
		http.Error(w, "board access required", 403)
		return
	}
	const maxImportSize = 5 << 20
	b, err := io.ReadAll(io.LimitReader(r.Body, maxImportSize+1))
	if err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	if len(b) > maxImportSize {
		http.Error(w, "import too large", http.StatusRequestEntityTooLarge)
		return
	}
	var p struct {
		State struct {
			Tickets []ticket `json:"tickets"`
			Columns []struct {
				ID   int64  `json:"id"`
				Name string `json:"name"`
			} `json:"columns"`
			Milestones []struct {
				ID   int64  `json:"id"`
				Name string `json:"name"`
			} `json:"milestones"`
		} `json:"state"`
	}
	if json.Unmarshal(b, &p) != nil {
		http.Error(w, "bad import", 400)
		return
	}
	columnNames := map[int64]string{}
	for _, column := range p.State.Columns {
		columnNames[column.ID] = strings.ToLower(strings.TrimSpace(column.Name))
	}
	milestoneNames := map[int64]string{}
	for _, milestone := range p.State.Milestones {
		milestoneNames[milestone.ID] = strings.ToLower(strings.TrimSpace(milestone.Name))
	}
	destinationColumns := map[string]int64{}
	for _, column := range rows(s.db, "select id,name from columns where board_id=?", bid) {
		id, _ := column["id"].(int64)
		name, _ := column["name"].(string)
		destinationColumns[strings.ToLower(strings.TrimSpace(name))] = id
	}
	destinationMilestones := map[string]int64{}
	for _, milestone := range rows(s.db, "select id,name from milestones where board_id=?", bid) {
		id, _ := milestone["id"].(int64)
		name, _ := milestone["name"].(string)
		destinationMilestones[strings.ToLower(strings.TrimSpace(name))] = id
	}
	fallbackColumnID := firstCol(s.db, bid)
	seenTicketIDs := map[int64]bool{}
	for _, item := range p.State.Tickets {
		if strings.TrimSpace(item.Title) == "" || item.ID <= 0 {
			continue
		}
		if seenTicketIDs[item.ID] {
			http.Error(w, "bad import: duplicate ticket id", http.StatusBadRequest)
			return
		}
		seenTicketIDs[item.ID] = true
	}
	tx, err := s.db.Begin()
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	defer tx.Rollback()
	type importedTicket struct {
		old ticket
		id  int64
	}
	imported := make([]importedTicket, 0, len(p.State.Tickets))
	idMap := map[int64]int64{}
	for _, t := range p.State.Tickets {
		normalizeTicketInput(&t)
		if strings.TrimSpace(t.Title) != "" {
			t.Position += 1000
			t.ColumnID = destinationColumns[columnNames[t.ColumnID]]
			if t.ColumnID == 0 {
				t.ColumnID = fallbackColumnID
			}
			t.MilestoneID = destinationMilestones[milestoneNames[t.MilestoneID]]
			// Exports deliberately contain no account data, so numeric assignee IDs
			// cannot be mapped safely between installations.
			t.AssigneeID = 0
			t.CompletedAt, err = completionTimestamp(tx, t.ColumnID, t.CompletedAt)
			if err != nil {
				http.Error(w, err.Error(), 500)
				return
			}
			res, err := tx.Exec("insert into tickets(board_id,column_id,parent_id,ref,title,body,type,points,duration,start_date,due_date,completed_at,milestone_id,assignee_id,position,is_backlog,created_at,updated_at) values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", bid, t.ColumnID, 0, t.Ref, t.Title, t.Body, t.Type, t.Points, t.Duration, t.StartDate, t.DueDate, t.CompletedAt, t.MilestoneID, t.AssigneeID, t.Position, t.IsBacklog, now(), now())
			if err != nil {
				http.Error(w, err.Error(), 500)
				return
			}
			id, _ := res.LastInsertId()
			imported = append(imported, importedTicket{old: t, id: id})
			if t.ID > 0 {
				idMap[t.ID] = id
			}
		}
	}
	for _, item := range imported {
		parentID := idMap[item.old.ParentID]
		if parentID != 0 {
			var parentType string
			if err := tx.QueryRow("select type from tickets where id=?", parentID).Scan(&parentType); err != nil || !parentTypeAllowed(parentType, item.old.Type) {
				parentID = 0
			}
		}
		if _, err := tx.Exec("update tickets set parent_id=? where id=?", parentID, item.id); err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		links := make([]int64, 0, len(item.old.Links))
		for _, oldLinkID := range item.old.Links {
			if linkID := idMap[oldLinkID]; linkID > 0 && linkID != item.id {
				links = append(links, linkID)
			}
		}
		if err := replaceTicketMeta(tx, item.id, bid, item.old.Labels, links); err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
	}
	if err := tx.Commit(); err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	jsonOut(w, map[string]any{"ok": true, "imported": len(imported)})
}

// loadTickets reads tickets and attaches their labels and dependency links.
func (s *server) loadTickets(boardID int64) []ticket {
	out := []ticket{}
	rs, err := s.db.Query("select id,board_id,column_id,parent_id,ref,title,body,type,points,duration,start_date,due_date,completed_at,milestone_id,assignee_id,position,is_backlog,created_at,updated_at from tickets where board_id=? order by position,id", boardID)
	if err != nil {
		return out
	}
	for rs.Next() {
		var t ticket
		_ = rs.Scan(&t.ID, &t.BoardID, &t.ColumnID, &t.ParentID, &t.Ref, &t.Title, &t.Body, &t.Type, &t.Points, &t.Duration, &t.StartDate, &t.DueDate, &t.CompletedAt, &t.MilestoneID, &t.AssigneeID, &t.Position, &t.IsBacklog, &t.CreatedAt, &t.UpdatedAt)
		out = append(out, t)
	}
	_ = rs.Close()
	for i := range out {
		out[i].Labels = strs(s.db, "select l.name from labels l join ticket_labels tl on tl.label_id=l.id where tl.ticket_id=?", out[i].ID)
		out[i].Links = ints(s.db, "select to_ticket_id from ticket_links where from_ticket_id=?", out[i].ID)
	}
	return out
}

type ticketMetaStore interface {
	Exec(query string, args ...any) (sql.Result, error)
	QueryRow(query string, args ...any) *sql.Row
}

// replaceTicketMeta atomically replaces labels and dependency links for a ticket.
func replaceTicketMeta(store ticketMetaStore, id, boardID int64, labels []string, links []int64) error {
	if _, err := store.Exec("delete from ticket_labels where ticket_id=?", id); err != nil {
		return err
	}
	for _, name := range labels {
		name = strings.TrimSpace(name)
		if name == "" {
			continue
		}
		var lid int64
		err := store.QueryRow("select id from labels where board_id=? and name=?", boardID, name).Scan(&lid)
		if errors.Is(err, sql.ErrNoRows) {
			res, err := store.Exec("insert into labels(board_id,name,color) values(?,?,?)", boardID, name, "#37c7ad")
			if err != nil {
				return err
			}
			lid, _ = res.LastInsertId()
		} else if err != nil {
			return err
		}
		if _, err := store.Exec("insert or ignore into ticket_labels(ticket_id,label_id) values(?,?)", id, lid); err != nil {
			return err
		}
	}
	if _, err := store.Exec("delete from ticket_links where from_ticket_id=?", id); err != nil {
		return err
	}
	for _, to := range links {
		if to > 0 && to != id {
			if _, err := store.Exec("insert or ignore into ticket_links(from_ticket_id,to_ticket_id) values(?,?)", id, to); err != nil {
				return err
			}
		}
	}
	return nil
}

// validateTicketRelations rejects dangling or cross-board ticket metadata.
func (s *server) validateTicketRelations(t ticket, boardID, ticketID int64) error {
	if t.MilestoneID < 0 {
		return errors.New("milestone id must not be negative")
	}
	if t.AssigneeID < 0 {
		return errors.New("assignee id must not be negative")
	}
	if t.MilestoneID > 0 && !milestoneBelongsToBoard(s.db, t.MilestoneID, boardID) {
		return errors.New("milestone does not belong to board")
	}
	if t.AssigneeID > 0 && !userExists(s.db, t.AssigneeID) {
		return errors.New("assignee does not exist")
	}
	for _, linkID := range t.Links {
		if linkID == ticketID && ticketID > 0 {
			return errors.New("ticket cannot depend on itself")
		}
		if !ticketBelongsToBoard(s.db, linkID, boardID) {
			return fmt.Errorf("dependency %d does not belong to board", linkID)
		}
	}
	return nil
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
		// Legacy ideas are preserved as backlog notes until they are promoted as work.
		t.IsBacklog = true
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
