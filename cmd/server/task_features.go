package main

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"
)

func (s *server) migrateTaskFeatures() error {
	for _, query := range []string{
		`create table if not exists ticket_activity(id integer primary key,ticket_id integer not null,user_id integer not null,body text not null,created_at text not null)`,
		`create index if not exists activity_ticket on ticket_activity(ticket_id,id)`,
		`create table if not exists notifications(id integer primary key,user_id integer not null,ticket_id integer not null,body text not null,created_at text not null,read_at text not null default '')`,
		`create index if not exists notifications_user on notifications(user_id,read_at,id)`,
		`create table if not exists ticket_repetitions(ticket_id integer not null,completed_at text not null,next_ticket_id integer not null,primary key(ticket_id,completed_at))`,
	} {
		if _, err := s.db.Exec(query); err != nil {
			return err
		}
	}
	return nil
}

func validateTaskExtras(extras *ticketExtras) error {
	if extras == nil {
		return nil
	}
	if extras.RepeatDays < 0 || extras.RepeatDays > 365 {
		return errors.New("repeat interval must be between 0 and 365 days")
	}
	if len(extras.Checklist) > 100 {
		return errors.New("checklists support at most 100 items")
	}
	for i := range extras.Checklist {
		extras.Checklist[i].Text = strings.TrimSpace(extras.Checklist[i].Text)
		if extras.Checklist[i].Text == "" || len(extras.Checklist[i].Text) > 500 {
			return errors.New("checklist items need text of at most 500 bytes")
		}
	}
	return nil
}

func saveTaskExtras(tx *sql.Tx, id int64, extras *ticketExtras) error {
	if extras == nil {
		return nil
	} // Older clients leave optional features intact.
	data, err := json.Marshal(extras)
	if err != nil {
		return err
	}
	_, err = tx.Exec("update tickets set extras=? where id=?", string(data), id)
	return err
}

func recordActivity(tx *sql.Tx, id, actor int64, message string) error {
	_, err := tx.Exec("insert into ticket_activity(ticket_id,user_id,body,created_at) values(?,?,?,?)", id, actor, message, now())
	return err
}

func assignmentNotification(tx *sql.Tx, id, actor, assignee int64) error {
	if assignee == 0 || assignee == actor {
		return nil
	}
	_, err := tx.Exec("insert into notifications(user_id,ticket_id,body,created_at) values(?,?,?,?)", assignee, id, "Assigned to you", now())
	return err
}

var mentionPattern = regexp.MustCompile(`(?:^|\s)@([a-zA-Z0-9_.-]+)`)

func (s *server) mentionRecipients(body string, boardID, actor int64) ([]int64, error) {
	seen := map[int64]bool{}
	var recipients []int64
	for _, match := range mentionPattern.FindAllStringSubmatch(body, -1) {
		var recipient user
		err := scanUser(s.db.QueryRow("select id,username,name,email,avatar,is_admin,must_change_password from users where username=?", strings.ToLower(match[1])), &recipient)
		if errors.Is(err, sql.ErrNoRows) {
			continue
		}
		if err != nil {
			return nil, err
		}
		if recipient.ID != actor && !seen[recipient.ID] && s.canAccessBoard(recipient, boardID) {
			seen[recipient.ID] = true
			recipients = append(recipients, recipient.ID)
		}
	}
	return recipients, nil
}

func (s *server) notificationRows(u user) ([]map[string]any, error) {
	// Scope access before LIMIT, and let permission-query failures reach the HTTP
	// handler instead of turning them into an apparently empty notification list.
	return rows(s.db, `select n.id,n.ticket_id,n.body,n.created_at,n.read_at,t.board_id,t.title
		from notifications n join tickets t on t.id=n.ticket_id join boards b on b.id=t.board_id
		where n.user_id=? and t.deleted_at='' and (? or exists(
			select 1 from board_users bu where bu.board_id=t.board_id and bu.user_id=? and bu.full_access=1))
		order by n.id desc limit 100`, u.ID, u.IsAdmin, u.ID)
}

func (s *server) readNotifications(w http.ResponseWriter, r *http.Request, u user) {
	if r.Method != http.MethodPost {
		http.Error(w, "method", 405)
		return
	}
	var in struct{ ID int64 }
	if !decodeJSON(w, r, &in) {
		return
	}
	if in.ID < 0 {
		http.Error(w, "invalid notification", 400)
		return
	}
	_, err := s.db.Exec("update notifications set read_at=? where user_id=? and read_at='' and (?=0 or id=?)", now(), u.ID, in.ID, in.ID)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	jsonOut(w, map[string]any{"ok": true})
}

func (s *server) notifications(w http.ResponseWriter, r *http.Request, u user) {
	if r.Method != http.MethodGet {
		http.Error(w, "method", 405)
		return
	}
	items, err := s.notificationRows(u)
	if err != nil {
		stateReadError(w, err)
		return
	}
	jsonOut(w, map[string]any{"notifications": items})
}

// taskFeatureAction uses the board authorization checked by ticketAction.
func (s *server) taskFeatureAction(w http.ResponseWriter, r *http.Request, u user, id, bid int64, action string) {
	if r.Method != http.MethodPost {
		http.Error(w, "method", 405)
		return
	}
	if action == "duplicate" {
		items, err := s.loadTickets(bid)
		if err != nil {
			stateReadError(w, err)
			return
		}
		for _, original := range items {
			if original.ID != id {
				continue
			}
			if original.DeletedAt != "" {
				http.Error(w, "restore task before duplicating", 409)
				return
			}
			column, err := firstCol(s.db, bid)
			if err != nil {
				stateReadError(w, err)
				return
			}
			original.ID, original.ParentID, original.ColumnID, original.AssigneeID = 0, 0, column, 0
			original.Ref, original.CompletedAt, original.StartDate, original.DueDate = "", "", "", ""
			original.ArchivedAt, original.DeletedAt = "", ""
			original.Title += " (copy)"
			original.Links = nil
			if original.Extras != nil {
				original.Extras.RepeatDays = 0
				for i := range original.Extras.Checklist {
					original.Extras.Checklist[i].Done = false
				}
			}
			data, _ := json.Marshal(original)
			request, _ := http.NewRequest(http.MethodPost, "/api/tickets", bytes.NewReader(data))
			s.createTicket(w, request, u)
			return
		}
		http.NotFound(w, r)
		return
	}
	var query, message string
	switch action {
	case "archive":
		query = "update tickets set archived_at=?,updated_at=? where id=? and deleted_at=''"
		message = "Archived task"
	case "trash":
		query = "update tickets set deleted_at=?,updated_at=? where id=?"
		message = "Moved task to trash"
	case "restore":
		query = "update tickets set archived_at='',deleted_at='',updated_at=? where id=?"
		message = "Restored task"
	default:
		http.NotFound(w, r)
		return
	}
	tx, err := s.db.Begin()
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	defer tx.Rollback()
	if action == "restore" {
		_, err = tx.Exec(query, now(), id)
		if err == nil {
			err = validateEpicCompletion(tx, bid, id)
		}
	} else {
		_, err = tx.Exec(query, now(), now(), id)
	}
	if err == nil {
		err = recordActivity(tx, id, u.ID, message)
	}
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		writeWorkflowError(w, err)
		return
	}
	jsonOut(w, map[string]any{"ok": true})
}

// Completing a repeating task creates its next occurrence once, atomically.
// This deliberately uses completion-based intervals, with no background scheduler.
func repeatCompletedTask(tx *sql.Tx, id, bid, actor int64, completedAt string, extras *ticketExtras) error {
	if extras == nil || extras.RepeatDays == 0 || completedAt == "" {
		return nil
	}
	var count int
	if err := tx.QueryRow("select count(*) from ticket_repetitions where ticket_id=? and completed_at=?", id, completedAt).Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	copyExtras := *extras
	copyExtras.Checklist = append([]checklistItem(nil), extras.Checklist...)
	for i := range copyExtras.Checklist {
		copyExtras.Checklist[i].Done = false
	}
	data, err := json.Marshal(copyExtras)
	if err != nil {
		return err
	}
	due := time.Now().UTC().AddDate(0, 0, extras.RepeatDays).Format("2006-01-02")
	var column int64
	if err := tx.QueryRow("select id from columns where board_id=? order by position,id limit 1", bid).Scan(&column); err != nil {
		return err
	}
	res, err := tx.Exec(`insert into tickets(board_id,column_id,parent_id,ref,title,body,type,points,duration,start_date,due_date,completed_at,milestone_id,assignee_id,position,is_backlog,created_at,updated_at,extras)
	select board_id,?,parent_id,'',title,body,type,points,duration,'',?,'',milestone_id,assignee_id,position,0,?,?,? from tickets where id=?`, column, due, now(), now(), string(data), id)
	if err != nil {
		return err
	}
	next, err := res.LastInsertId()
	if err != nil {
		return err
	}
	if _, err = tx.Exec("insert into ticket_labels(ticket_id,label_id) select ?,label_id from ticket_labels where ticket_id=?", next, id); err != nil {
		return err
	}
	if _, err = tx.Exec("insert into ticket_repetitions(ticket_id,completed_at,next_ticket_id) values(?,?,?)", id, completedAt, next); err != nil {
		return err
	}
	return recordActivity(tx, next, actor, "Created next occurrence")
}
