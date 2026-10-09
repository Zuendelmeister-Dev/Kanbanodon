package main

import (
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// Completion snapshots are separate from current ticket state. Reopening,
// rescheduling or renaming a ticket must not rewrite what actually happened.
func (s *server) migrateWorkHistory() error {
	if err := ensureColumn(s.db, "tickets", "started_at", "text not null default ''"); err != nil {
		return err
	}
	for _, query := range []string{
		`create table if not exists work_history(id integer primary key,ticket_id integer not null,board_id integer not null,parent_id integer not null,parent_ref text not null,parent_title text not null,epic_id integer not null,epic_ref text not null,epic_title text not null,ref text not null,title text not null,type text not null,started_at text not null,completed_at text not null,planned_start_date text not null,planned_due_date text not null,duration integer not null,source text not null,unique(ticket_id,completed_at))`,
		`create index if not exists work_history_board on work_history(board_id,completed_at,id)`,
	} {
		if _, err := s.db.Exec(query); err != nil {
			return err
		}
	}
	// Old databases have a genuine completion timestamp but no immutable
	// snapshots. Preserve it once, without inventing an actual start date.
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	ids, err := ints(tx, `select t.id from tickets t where t.completed_at<>'' and not exists(select 1 from work_history h where h.ticket_id=t.id and h.completed_at=t.completed_at)`)
	if err != nil {
		return err
	}
	for _, id := range ids {
		if err := recordCompletionHistory(tx, id, "legacy"); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// workflowHistory updates an observed start and records a newly completed
// episode inside the same writer transaction as status and repeat effects.
func workflowHistory(tx *sql.Tx, id, previousColumnID int64, previousCompleted, completed, source string) error {
	var started, columnName string
	var columnID int64
	if err := tx.QueryRow(`select t.started_at,c.name,c.id from tickets t join columns c on c.id=t.column_id where t.id=?`, id).Scan(&started, &columnName, &columnID); err != nil {
		return err
	}
	if previousCompleted != "" && completed == "" {
		started = "" // A reopened ticket begins a fresh work episode.
	}
	if completed == "" && started == "" && previousColumnID != columnID && strings.EqualFold(strings.TrimSpace(columnName), "In Progress") {
		started = time.Now().UTC().Format(time.RFC3339Nano)
	}
	if _, err := tx.Exec("update tickets set started_at=? where id=?", started, id); err != nil {
		return err
	}
	if completed != "" {
		return recordCompletionHistory(tx, id, source)
	}
	return nil
}

func recordCompletionHistory(tx *sql.Tx, id int64, source string) error {
	var t ticket
	if err := tx.QueryRow(`select id,board_id,parent_id,ref,title,type,started_at,completed_at,start_date,due_date,duration,is_backlog from tickets where id=?`, id).Scan(&t.ID, &t.BoardID, &t.ParentID, &t.Ref, &t.Title, &t.Type, &t.StartedAt, &t.CompletedAt, &t.StartDate, &t.DueDate, &t.Duration, &t.IsBacklog); err != nil {
		return err
	}
	// Invalid legacy/import timestamps cannot support a factual history bar.
	completed, err := time.Parse(time.RFC3339Nano, t.CompletedAt)
	if err != nil || t.IsBacklog || t.Type == "idea" {
		return nil
	}
	if started, err := time.Parse(time.RFC3339Nano, t.StartedAt); err != nil || started.After(completed) {
		t.StartedAt = ""
	}
	ref := t.Ref
	if ref == "" {
		ref = strconv.FormatInt(t.ID, 10)
	}
	var parentRef, parentTitle, epicRef, epicTitle string
	var epicID int64
	seen := map[int64]bool{t.ID: true}
	for parentID := t.ParentID; parentID > 0 && !seen[parentID]; {
		seen[parentID] = true
		var nextID int64
		var candidateRef, title, kind string
		err := tx.QueryRow("select parent_id,ref,title,type from tickets where id=? and board_id=?", parentID, t.BoardID).Scan(&nextID, &candidateRef, &title, &kind)
		if errors.Is(err, sql.ErrNoRows) {
			break
		}
		if err != nil {
			return err
		}
		if candidateRef == "" {
			candidateRef = strconv.FormatInt(parentID, 10)
		}
		if parentID == t.ParentID {
			parentRef, parentTitle = candidateRef, title
		}
		if kind == "epic" {
			epicID, epicRef, epicTitle = parentID, candidateRef, title
			break
		}
		parentID = nextID
	}
	_, err = tx.Exec(`insert or ignore into work_history(ticket_id,board_id,parent_id,parent_ref,parent_title,epic_id,epic_ref,epic_title,ref,title,type,started_at,completed_at,planned_start_date,planned_due_date,duration,source) values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, t.ID, t.BoardID, t.ParentID, parentRef, parentTitle, epicID, epicRef, epicTitle, ref, t.Title, t.Type, t.StartedAt, t.CompletedAt, t.StartDate, t.DueDate, t.Duration, source)
	return err
}

// Read only the requested accessible board, including archived completed work.
// Trash is hidden; permanent deletion also removes that ticket's snapshots.
func (s *server) history(w http.ResponseWriter, r *http.Request, u user) {
	if r.Method != http.MethodGet {
		http.Error(w, "method", http.StatusMethodNotAllowed)
		return
	}
	bid := s.dataBoardID(r, u)
	if bid == 0 {
		http.Error(w, "board access required", http.StatusForbidden)
		return
	}
	items, err := rows(s.db, `select h.*,t.archived_at from work_history h join tickets t on t.id=h.ticket_id and t.board_id=h.board_id where h.board_id=? and t.deleted_at='' order by julianday(h.completed_at) desc,h.id desc`, bid)
	if err != nil {
		stateReadError(w, err)
		return
	}
	jsonOut(w, map[string]any{"items": items})
}

var errEpicCompletion = errors.New("epic has unfinished work")

func writeWorkflowError(w http.ResponseWriter, err error) {
	if errors.Is(err, errEpicCompletion) {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	stateReadError(w, err)
}

// Only affected Epics are checked so unrelated inconsistent legacy work does
// not prevent repairs. Backlog, archive and trash remain outside active scope.
func validateEpicCompletion(tx *sql.Tx, boardID, changedID int64) error {
	type work struct {
		id, parent               int64
		ref, title, kind, column string
		active                   bool
	}
	items, err := rows(tx, `select t.id,t.parent_id,t.ref,t.title,t.type,c.name column_name,(t.is_backlog=0 and t.type<>'idea' and t.archived_at='' and t.deleted_at='') active from tickets t join columns c on c.id=t.column_id where t.board_id=? order by t.id`, boardID)
	if err != nil {
		return err
	}
	works := map[int64]work{}
	for _, item := range items {
		id := item["id"].(int64)
		works[id] = work{id: id, parent: item["parentId"].(int64), ref: item["ref"].(string), title: item["title"].(string), kind: item["type"].(string), column: item["columnName"].(string), active: item["active"].(int64) != 0}
	}
	affected := map[int64]bool{}
	seen := map[int64]bool{}
	for current := changedID; current != 0 && !seen[current]; {
		seen[current] = true
		item, found := works[current]
		if !found {
			break
		}
		if item.kind == "epic" && item.active && strings.EqualFold(strings.TrimSpace(item.column), "Done") {
			affected[current] = true
		}
		current = item.parent
	}
	for epicID := range affected {
		var blocked []string
		for _, raw := range items {
			item := works[raw["id"].(int64)]
			if !item.active || item.id == epicID || strings.EqualFold(strings.TrimSpace(item.column), "Done") {
				continue
			}
			seen := map[int64]bool{item.id: true}
			for parent := item.parent; parent != 0 && !seen[parent]; {
				seen[parent] = true
				if parent == epicID {
					ref := item.ref
					if ref == "" {
						ref = strconv.FormatInt(item.id, 10)
					}
					blocked = append(blocked, "#"+ref+" "+item.title)
					break
				}
				parent = works[parent].parent
			}
		}
		if len(blocked) > 0 {
			ref := works[epicID].ref
			if ref == "" {
				ref = strconv.FormatInt(epicID, 10)
			}
			return fmt.Errorf("%w: finish these tasks before completing #%s %s (or reopen the Epic): %s", errEpicCompletion, ref, works[epicID].title, strings.Join(blocked, ", "))
		}
	}
	return nil
}
