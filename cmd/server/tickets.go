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
	"time"
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
	if err := validateTaskExtras(t.Extras); err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
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
		column, err := firstCol(s.db, bid)
		if err != nil {
			stateReadError(w, err)
			return
		}
		t.ColumnID = column
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
	if err := validateEpicCompletion(tx, bid, id); err != nil {
		writeWorkflowError(w, err)
		return
	}
	if err := workflowHistory(tx, id, 0, "", t.CompletedAt, "recorded"); err != nil {
		stateReadError(w, err)
		return
	}
	if err := replaceTicketMeta(tx, id, bid, t.Labels, t.Links); err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	if err := saveTaskExtras(tx, id, t.Extras); err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	if err := recordActivity(tx, id, u.ID, "Created task"); err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	if err := assignmentNotification(tx, id, u.ID, t.AssigneeID); err != nil {
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
	isMove := len(parts) == 2 && parts[1] == "move"
	isFeature := len(parts) == 2 && (parts[1] == "duplicate" || parts[1] == "archive" || parts[1] == "trash" || parts[1] == "restore")
	if len(parts) > 2 || (len(parts) == 2 && !isComments && !isFeature && !isMove) {
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
	if isMove {
		s.moveTicket(w, r, u, id, bid)
		return
	}
	if isFeature {
		s.taskFeatureAction(w, r, u, id, bid, parts[1])
		return
	}
	var deleted string
	if err := s.db.QueryRow("select deleted_at from tickets where id=?", id).Scan(&deleted); err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	if deleted != "" && r.Method != http.MethodDelete {
		http.Error(w, "restore task before editing", 409)
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
		recipients, err := s.mentionRecipients(body, bid, u.ID)
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		tx, err := s.db.Begin()
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		defer tx.Rollback()
		_, err = tx.Exec("insert into comments(ticket_id,user_id,body,created_at) values(?,?,?,?)", id, u.ID, body, now())
		if err == nil {
			err = recordActivity(tx, id, u.ID, "Added comment")
		}
		for _, recipient := range recipients {
			if err == nil {
				_, err = tx.Exec("insert into notifications(user_id,ticket_id,body,created_at) values(?,?,?,?)", recipient, id, "Mentioned you in a comment", now())
			}
		}
		if err == nil {
			err = tx.Commit()
		}
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
			"delete from work_history where ticket_id=?",
			"delete from ticket_labels where ticket_id=?",
			"delete from ticket_links where from_ticket_id=? or to_ticket_id=?",
			"delete from comments where ticket_id=?",
			"delete from ticket_activity where ticket_id=?",
			"delete from notifications where ticket_id=?",
			"delete from ticket_repetitions where ticket_id=? or next_ticket_id=?",
			"update tickets set parent_id=0 where parent_id=?",
		} {
			args := []any{id}
			if strings.Contains(statement, "or to_ticket_id") || strings.Contains(statement, "or next_ticket_id") {
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
	if err := validateTaskExtras(t.Extras); err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
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
	var previous ticket
	items, err := s.loadTickets(bid)
	if err != nil {
		stateReadError(w, err)
		return
	}
	for _, item := range items {
		if item.ID == id {
			previous = item
			break
		}
	}
	if t.Extras == nil {
		t.Extras = previous.Extras
	}
	tx, err := s.db.Begin()
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	defer tx.Rollback()
	if err := validateDependencyGraph(tx, bid, map[int64][]int64{id: t.Links}); err != nil {
		if errors.Is(err, errDependencyCycle) {
			http.Error(w, err.Error(), http.StatusBadRequest)
		} else {
			stateReadError(w, err)
		}
		return
	}
	// Read completion again inside the writer transaction so concurrent moves
	// cannot create two next occurrences for the same completion.
	if err = tx.QueryRow("select column_id,completed_at from tickets where id=?", id).Scan(&previous.ColumnID, &previous.CompletedAt); err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	completedAt, err = completionTimestamp(tx, t.ColumnID, previous.CompletedAt)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	_, err = tx.Exec("update tickets set column_id=?,parent_id=?,ref=?,title=?,body=?,type=?,points=?,duration=?,start_date=?,due_date=?,completed_at=?,milestone_id=?,assignee_id=?,position=?,is_backlog=?,updated_at=? where id=?", t.ColumnID, t.ParentID, t.Ref, t.Title, t.Body, t.Type, t.Points, t.Duration, t.StartDate, t.DueDate, completedAt, t.MilestoneID, t.AssigneeID, t.Position, t.IsBacklog, now(), id)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	if err := replaceTicketMeta(tx, id, bid, t.Labels, t.Links); err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	if err := saveTaskExtras(tx, id, t.Extras); err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	if err := validateEpicCompletion(tx, bid, id); err != nil {
		writeWorkflowError(w, err)
		return
	}
	if err := workflowHistory(tx, id, previous.ColumnID, previous.CompletedAt, completedAt, "recorded"); err != nil {
		stateReadError(w, err)
		return
	}
	changes := []string{}
	if t.ColumnID != previous.ColumnID {
		changes = append(changes, "status")
	}
	if t.AssigneeID != previous.AssigneeID {
		changes = append(changes, "assignee")
	}
	if t.Title != previous.Title {
		changes = append(changes, "title")
	}
	if t.Body != previous.Body {
		changes = append(changes, "description")
	}
	if t.DueDate != previous.DueDate {
		changes = append(changes, "due date")
	}
	oldExtras, _ := json.Marshal(previous.Extras)
	newExtras, _ := json.Marshal(t.Extras)
	if string(oldExtras) != string(newExtras) {
		changes = append(changes, "checklist or repeat settings")
	}
	message := "Updated task"
	if len(changes) > 0 {
		message = "Changed " + strings.Join(changes, ", ")
	}
	if err := recordActivity(tx, id, u.ID, message); err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	if t.AssigneeID != previous.AssigneeID {
		if err := assignmentNotification(tx, id, u.ID, t.AssigneeID); err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
	}
	if previous.CompletedAt == "" {
		if err := repeatCompletedTask(tx, id, bid, u.ID, completedAt, t.Extras); err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
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
	return blockedDependenciesForLinks(s.db, boardID, links, targetColumnID)
}

// A move checks workflow constraints inside the same transaction as the reorder.
func blockedDependenciesForLinks(store rowQuerier, boardID int64, links []int64, targetColumnID int64) ([]string, error) {
	if targetColumnID == 0 {
		return nil, nil
	}
	var targetPosition int
	var targetName string
	var targetBoardID int64
	if err := store.QueryRow("select board_id,position,name from columns where id=?", targetColumnID).Scan(&targetBoardID, &targetPosition, &targetName); err != nil {
		return nil, err
	}
	if targetBoardID != boardID {
		return nil, errors.New("target column does not belong to board")
	}
	// Work may start while prerequisites are open; validation starts at Review.
	name := strings.ToLower(strings.TrimSpace(targetName))
	if name == "to do" || name == "backlog" || name == "ready" || name == "in progress" {
		return nil, nil
	}
	if name != "review" && name != "done" {
		gatePosition := 3
		if err := store.QueryRow("select position from columns where board_id=? and lower(trim(name))='review' order by position,id limit 1", boardID).Scan(&gatePosition); err != nil {
			if !errors.Is(err, sql.ErrNoRows) {
				return nil, err
			}
			var inProgressPosition int
			if err := store.QueryRow("select position from columns where board_id=? and lower(trim(name))='in progress' order by position,id limit 1", boardID).Scan(&inProgressPosition); err == nil {
				gatePosition = inProgressPosition + 1
			} else if !errors.Is(err, sql.ErrNoRows) {
				return nil, err
			}
		}
		if targetPosition < gatePosition {
			return nil, nil
		}
	}

	var blocked []string
	seen := map[int64]bool{}
	for _, id := range links {
		if seen[id] {
			continue
		}
		seen[id] = true
		var title, columnName string
		if err := store.QueryRow(`select dep.title,c.name
			from tickets dep join columns c on c.id=dep.column_id
			where dep.id=? and dep.board_id=? and dep.deleted_at=''`, id, boardID).Scan(&title, &columnName); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				continue
			}
			return nil, err
		}
		if !strings.EqualFold(strings.TrimSpace(columnName), "Done") {
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
	if !strings.EqualFold(strings.TrimSpace(targetName), "Done") {
		return "", nil
	}
	if current != "" {
		return current, nil
	}
	return time.Now().UTC().Format(time.RFC3339Nano), nil
}

// Export authors as text; account IDs are never trusted across installations.
const boardCommentsQuery = `select c.id,c.ticket_id,c.user_id,c.body,c.created_at,
	coalesce(nullif(c.author_name,''),u.name,'Former colleague') author_name
	from comments c join tickets t on t.id=c.ticket_id
	left join users u on u.id=c.user_id where t.board_id=? order by c.created_at,c.id`

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
	board, err := one(s.db, "select * from boards where id=?", bid)
	if err != nil {
		stateReadError(w, err)
		return
	}
	items, err := s.loadTickets(bid)
	if err != nil {
		stateReadError(w, err)
		return
	}
	payload := map[string]any{"board": board, "tickets": items}
	for _, query := range []struct{ key, query string }{
		{"columns", "select * from columns where board_id=?"},
		{"labels", "select * from labels where board_id=?"},
		{"milestones", "select * from milestones where board_id=?"},
		{"comments", boardCommentsQuery},
	} {
		items, err := rows(s.db, query.query, bid)
		if err != nil {
			stateReadError(w, err)
			return
		}
		payload[query.key] = items
	}
	w.Header().Set("content-disposition", "attachment; filename=kanbanodon-export.json")
	jsonOut(w, map[string]any{"version": 1, "exportedAt": now(), "state": payload})
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
			Tickets  []ticket `json:"tickets"`
			Comments []struct {
				TicketID   int64  `json:"ticketId"`
				Body       string `json:"body"`
				CreatedAt  string `json:"createdAt"`
				AuthorName string `json:"authorName"`
			} `json:"comments"`
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
	columns, err := rows(s.db, "select id,name from columns where board_id=?", bid)
	if err != nil {
		stateReadError(w, err)
		return
	}
	for _, column := range columns {
		id, _ := column["id"].(int64)
		name, _ := column["name"].(string)
		destinationColumns[strings.ToLower(strings.TrimSpace(name))] = id
	}
	destinationMilestones := map[string]int64{}
	milestones, err := rows(s.db, "select id,name from milestones where board_id=?", bid)
	if err != nil {
		stateReadError(w, err)
		return
	}
	for _, milestone := range milestones {
		id, _ := milestone["id"].(int64)
		name, _ := milestone["name"].(string)
		destinationMilestones[strings.ToLower(strings.TrimSpace(name))] = id
	}
	var fallbackColumnID int64
	if err := s.db.QueryRow("select id from columns where board_id=? order by position,id limit 1", bid).Scan(&fallbackColumnID); err != nil {
		stateReadError(w, err)
		return
	}
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
		if err := validateTaskExtras(t.Extras); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
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
			if _, parseErr := time.Parse(time.RFC3339Nano, t.CompletedAt); parseErr != nil {
				t.CompletedAt = ""
			}
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
			if err := saveTaskExtras(tx, id, t.Extras); err != nil {
				http.Error(w, err.Error(), 500)
				return
			}
			if _, err := tx.Exec("update tickets set archived_at=?,deleted_at=? where id=?", t.ArchivedAt, t.DeletedAt, id); err != nil {
				http.Error(w, err.Error(), 500)
				return
			}
			imported = append(imported, importedTicket{old: t, id: id})
			if t.ID > 0 {
				idMap[t.ID] = id
			}
		}
	}
	importedGraph := map[int64][]int64{}
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
			if oldLinkID == item.old.ID && oldLinkID > 0 {
				http.Error(w, "bad import: ticket cannot depend on itself", http.StatusBadRequest)
				return
			}
			if linkID := idMap[oldLinkID]; linkID > 0 && linkID != item.id {
				links = append(links, linkID)
			}
		}
		importedGraph[item.id] = links
		if err := replaceTicketMeta(tx, item.id, bid, item.old.Labels, links); err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
	}
	if err := validateDependencyGraph(tx, bid, importedGraph); err != nil {
		if errors.Is(err, errDependencyCycle) {
			http.Error(w, "bad import: "+err.Error(), http.StatusBadRequest)
		} else {
			stateReadError(w, err)
		}
		return
	}
	for _, item := range imported {
		if err := validateEpicCompletion(tx, bid, item.id); err != nil {
			writeWorkflowError(w, err)
			return
		}
		if err := recordCompletionHistory(tx, item.id, "import"); err != nil {
			stateReadError(w, err)
			return
		}
	}
	for _, comment := range p.State.Comments {
		id := idMap[comment.TicketID]
		if id == 0 {
			http.Error(w, "bad import: comment refers to an unknown ticket", http.StatusBadRequest)
			return
		}
		createdAt := comment.CreatedAt
		if _, err := time.Parse(time.RFC3339Nano, createdAt); err != nil {
			createdAt = now()
		}
		author := strings.TrimSpace(comment.AuthorName)
		if author == "" {
			author = "Imported colleague"
		}
		if _, err := tx.Exec("insert into comments(ticket_id,user_id,body,created_at,author_name) values(?,0,?,?,?)", id, comment.Body, createdAt, author); err != nil {
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
func (s *server) loadTickets(boardID int64) ([]ticket, error) {
	out := []ticket{}
	rs, err := s.db.Query("select id,board_id,column_id,parent_id,ref,title,body,type,points,duration,start_date,due_date,started_at,completed_at,milestone_id,assignee_id,position,is_backlog,created_at,updated_at,extras,archived_at,deleted_at from tickets where board_id=? order by position,id", boardID)
	if err != nil {
		return nil, err
	}
	defer rs.Close()
	for rs.Next() {
		var t ticket
		var extras string
		if err := rs.Scan(&t.ID, &t.BoardID, &t.ColumnID, &t.ParentID, &t.Ref, &t.Title, &t.Body, &t.Type, &t.Points, &t.Duration, &t.StartDate, &t.DueDate, &t.StartedAt, &t.CompletedAt, &t.MilestoneID, &t.AssigneeID, &t.Position, &t.IsBacklog, &t.CreatedAt, &t.UpdatedAt, &extras, &t.ArchivedAt, &t.DeletedAt); err != nil {
			return nil, err
		}
		t.Extras = &ticketExtras{Checklist: []checklistItem{}}
		if err := json.Unmarshal([]byte(extras), t.Extras); err != nil {
			return nil, fmt.Errorf("invalid task extras for ticket %d: %w", t.ID, err)
		}
		out = append(out, t)
	}
	if err := rs.Err(); err != nil {
		return nil, err
	}
	if err := rs.Close(); err != nil {
		return nil, err
	}
	for i := range out {
		out[i].Labels, err = strs(s.db, "select l.name from labels l join ticket_labels tl on tl.label_id=l.id where tl.ticket_id=?", out[i].ID)
		if err != nil {
			return nil, err
		}
		out[i].Links, err = ints(s.db, "select to_ticket_id from ticket_links where from_ticket_id=?", out[i].ID)
		if err != nil {
			return nil, err
		}
	}
	return out, nil
}

// Validate inside the writer transaction, so simultaneous edge changes cannot
// each pass against an outdated graph and introduce a cycle when committed.
var errDependencyCycle = errors.New("dependencies would create a cycle")

func validateDependencyGraph(store rowsQuerier, boardID int64, changes map[int64][]int64) error {
	items, err := rows(store, `select l.from_ticket_id,l.to_ticket_id from ticket_links l join tickets t on t.id=l.from_ticket_id where t.board_id=?`, boardID)
	if err != nil {
		return err
	}
	graph := map[int64][]int64{}
	for _, item := range items {
		from, _ := item["fromTicketId"].(int64)
		to, _ := item["toTicketId"].(int64)
		graph[from] = append(graph[from], to)
	}
	for id, links := range changes {
		graph[id] = links
	}
	// Check the affected roots. Unrelated legacy cycles must not prevent users
	// from editing other tasks or breaking old cycles one edge at a time.
	for root := range changes {
		seen := map[int64]bool{}
		var reachesRoot func(int64) bool
		reachesRoot = func(id int64) bool {
			if id == root {
				return true
			}
			if seen[id] {
				return false
			}
			seen[id] = true
			for _, next := range graph[id] {
				if reachesRoot(next) {
					return true
				}
			}
			return false
		}
		for _, dependency := range graph[root] {
			if reachesRoot(dependency) {
				return errDependencyCycle
			}
		}
	}
	return nil
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
