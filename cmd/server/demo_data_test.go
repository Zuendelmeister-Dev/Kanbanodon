package main

import (
	"fmt"
	"reflect"
	"testing"
	"time"
)

func demoTestTime() time.Time {
	return time.Date(2026, time.October, 8, 16, 30, 45, 0, time.FixedZone("test", 2*60*60))
}

func TestDemoResetIsExplicitlyOptIn(t *testing.T) {
	s := newTestServer(t)
	id := createTestTicket(t, s, `{"Title":"Keep real work"}`)
	for _, setting := range []string{"false", "0", "not-a-boolean"} {
		err := s.resetDemoDataIfEnabled(setting, demoTestTime())
		if setting == "not-a-boolean" && err == nil {
			t.Fatal("an invalid reset option should stop startup")
		}
		if setting != "not-a-boolean" && err != nil {
			t.Fatal(err)
		}
		var title string
		if err := s.db.QueryRow("select title from tickets where id=?", id).Scan(&title); err != nil || title != "Keep real work" {
			t.Fatalf("setting %q changed existing work: %q, %v", setting, title, err)
		}
	}
	t.Setenv("KANBANODON_RESET_DEMO_DATA", "")
	if err := s.resetDemoDataIfEnabled(env("KANBANODON_RESET_DEMO_DATA", "false"), demoTestTime()); err != nil {
		t.Fatal(err)
	}
	if got := len(mustLoadTickets(t, s, 1)); got != 1 {
		t.Fatalf("an unset environment option seeded demo tickets: %d", got)
	}
}

func TestDemoResetPreservesAccountsAccessAndCleansTaskData(t *testing.T) {
	s := newTestServer(t)
	if _, err := s.db.Exec("insert into users(username,name,email,password_hash,avatar,created_at) values('reader','Read Only','reader@example.test','unchanged-secret','unchanged-avatar',?)", now()); err != nil {
		t.Fatal(err)
	}
	if err := s.setBoardAccess(1, 2, false); err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec("insert into sessions(token_hash,user_id,expires_at) values('keep-session',2,'2099-01-01T00:00:00Z')"); err != nil {
		t.Fatal(err)
	}
	secondBoard, err := s.createBoard("Private board", 2)
	if err != nil {
		t.Fatal(err)
	}
	old := createTestTicket(t, s, `{"Title":"Old archived epic","Type":"epic","Labels":["existing"]}`)
	child := createTestTicket(t, s, fmt.Sprintf(`{"Title":"Old child","ParentID":%d,"Links":[%d],"Extras":{"Checklist":[{"Text":"Old check","Done":true}],"RepeatDays":7}}`, old, old))
	createTestTicket(t, s, fmt.Sprintf(`{"BoardID":%d,"Title":"Old backlog","IsBacklog":true}`, secondBoard))
	for _, query := range []string{
		fmt.Sprintf("update tickets set archived_at='2020-01-01',deleted_at='2020-01-02' where id=%d", old),
		fmt.Sprintf("insert into comments(ticket_id,user_id,body,created_at) values(%d,1,'old comment','2020-01-01')", child),
		fmt.Sprintf("insert into ticket_activity(ticket_id,user_id,body,created_at) values(%d,1,'old activity','2020-01-01')", child),
		fmt.Sprintf("insert into notifications(ticket_id,user_id,body,created_at) values(%d,2,'old notification','2020-01-01')", child),
		fmt.Sprintf("insert into ticket_repetitions(ticket_id,completed_at,next_ticket_id) values(%d,'2020-01-01',%d)", old, child),
		"update boards set sprint_start_date='2020-01-01',sprint_weeks=3",
		"insert into sprint_names(board_id,sprint_number,name,updated_at) values(1,99,'obsolete','2020-01-01')",
	} {
		if _, err := s.db.Exec(query); err != nil {
			t.Fatal(err)
		}
	}
	preserved := map[string][]map[string]any{}
	for _, table := range []string{"users", "sessions", "board_users", "columns", "labels", "milestones"} {
		preserved[table], err = rows(s.db, "select * from "+table+" order by 1,2")
		if err != nil {
			t.Fatal(err)
		}
	}
	if err := s.resetDemoDataIfEnabled("true", demoTestTime()); err != nil {
		t.Fatal(err)
	}
	for table, before := range preserved {
		after, err := rows(s.db, "select * from "+table+" order by 1,2")
		if err != nil {
			t.Fatal(err)
		}
		if table == "labels" {
			// A demo label is added per board, while all previous definitions remain.
			after, err = rows(s.db, "select * from labels where name!='demo' order by 1,2")
			if err != nil {
				t.Fatal(err)
			}
		}
		if !reflect.DeepEqual(before, after) {
			t.Fatalf("reset changed preserved %s: before %#v; after %#v", table, before, after)
		}
	}
	for _, table := range []string{"comments", "ticket_activity", "notifications", "ticket_repetitions"} {
		var count int
		if err := s.db.QueryRow("select count(*) from " + table).Scan(&count); err != nil || count != 0 {
			t.Fatalf("old %s survived: count %d, error %v", table, count, err)
		}
	}
	var invalid int
	for _, query := range []string{
		"select count(*) from tickets where title like 'Old %' or archived_at!='' or deleted_at!='' or is_backlog!=0",
		"select count(*) from ticket_links l left join tickets f on f.id=l.from_ticket_id left join tickets t on t.id=l.to_ticket_id where f.id is null or t.id is null or f.board_id!=t.board_id",
		"select count(*) from ticket_labels l left join tickets t on t.id=l.ticket_id left join labels b on b.id=l.label_id where t.id is null or b.id is null or t.board_id!=b.board_id or b.name!='demo'",
	} {
		if err := s.db.QueryRow(query).Scan(&invalid); err != nil || invalid != 0 {
			t.Fatalf("invalid task metadata after reset: %d, %v", invalid, err)
		}
	}
	for _, boardID := range []int64{1, secondBoard} {
		assertDemoBoard(t, s, boardID, demoTestTime())
	}
	var name string
	var owner int64
	if err := s.db.QueryRow("select name,owner_id from boards where id=?", secondBoard).Scan(&name, &owner); err != nil || name != "Private board" || owner != 2 {
		t.Fatalf("existing board identity changed: %q owner %d, %v", name, owner, err)
	}
}

func assertDemoBoard(t *testing.T, s *server, boardID int64, at time.Time) {
	t.Helper()
	tickets := mustLoadTickets(t, s, boardID)
	var epics int
	stamp := at.UTC().Format(time.RFC3339)
	graph := map[int64][]int64{}
	var past, current, future bool
	week := demoWeekStart(at)
	for _, work := range tickets {
		if work.CreatedAt != stamp || work.UpdatedAt != stamp {
			t.Fatalf("demo timestamp is stale: %#v", work)
		}
		if work.CompletedAt > stamp {
			t.Fatalf("demo work completed in the future: %#v", work)
		}
		if work.Type == "epic" {
			epics++
		} else if work.ParentID == 0 {
			t.Fatalf("demo task lacks its epic: %#v", work)
		}
		start, err := time.Parse("2006-01-02", work.StartDate)
		if err != nil {
			t.Fatal(err)
		}
		due, err := time.Parse("2006-01-02", work.DueDate)
		if err != nil || due.Before(start) {
			t.Fatalf("invalid planned interval: %#v, %v", work, err)
		}
		if work.Type != "epic" {
			past = past || due.Before(week)
			current = current || (!start.Before(week) && start.Before(week.AddDate(0, 0, 14)))
			future = future || !start.Before(week.AddDate(0, 0, 14))
		}
		graph[work.ID] = work.Links
	}
	if len(tickets) != 21 || epics != 3 || !past || !current || !future {
		t.Fatalf("expected 3 epics + 18 tasks over past/current/future: tickets %d epics %d periods %v/%v/%v", len(tickets), epics, past, current, future)
	}
	if err := validateDependencyGraph(s.db, boardID, graph); err != nil {
		t.Fatalf("demo dependency graph is cyclic: %v", err)
	}
	var start string
	var weeks int
	if err := s.db.QueryRow("select sprint_start_date,sprint_weeks from boards where id=?", boardID).Scan(&start, &weeks); err != nil {
		t.Fatal(err)
	}
	if start != week.AddDate(0, 0, -28).Format("2006-01-02") || weeks != 2 {
		t.Fatalf("demo cadence does not put today in Sprint 3: %s, %d", start, weeks)
	}
	var names int
	if err := s.db.QueryRow("select count(*) from sprint_names where board_id=?", boardID).Scan(&names); err != nil || names != 7 {
		t.Fatalf("expected seven fresh sprint names: %d, %v", names, err)
	}
}

func TestDemoResetCanRepeatWithFreshDatesWithoutDuplicates(t *testing.T) {
	s := newTestServer(t)
	if _, err := s.resetDemoData(demoTestTime()); err != nil {
		t.Fatal(err)
	}
	later := demoTestTime().AddDate(0, 0, 21)
	if _, err := s.resetDemoData(later); err != nil {
		t.Fatal(err)
	}
	assertDemoBoard(t, s, 1, later)
	var labels int
	if err := s.db.QueryRow("select count(*) from labels where name='demo'").Scan(&labels); err != nil || labels != 1 {
		t.Fatalf("repeat reset duplicated demo label definitions: %d, %v", labels, err)
	}
}

func TestDemoResetCreatesUsableBoardOnlyWhenNoneExist(t *testing.T) {
	s := newBareTestServer(t)
	mondayMorning := demoWeekStart(demoTestTime()).Add(8 * time.Hour)
	boards, err := s.resetDemoData(mondayMorning)
	if err != nil || boards != 1 {
		t.Fatalf("fresh reset: boards %d, error %v", boards, err)
	}
	assertDemoBoard(t, s, 1, mondayMorning)
	var columns, access int
	if err := s.db.QueryRow("select count(*) from columns where board_id=1").Scan(&columns); err != nil {
		t.Fatal(err)
	}
	if err := s.db.QueryRow("select count(*) from board_users where board_id=1 and user_id=1 and full_access=1").Scan(&access); err != nil {
		t.Fatal(err)
	}
	if columns != 5 || access != 1 {
		t.Fatalf("fresh demo board unusable: columns %d access %d", columns, access)
	}
}

func TestDemoResetRollsBackAllBoardsWhenSeedingFails(t *testing.T) {
	s := newTestServer(t)
	createTestTicket(t, s, `{"Title":"Keep real work","Labels":["keep"]}`)
	secondBoard, err := s.createBoard("Keep second board", 1)
	if err != nil {
		t.Fatal(err)
	}
	createTestTicket(t, s, fmt.Sprintf(`{"BoardID":%d,"Title":"Keep second board's work"}`, secondBoard))
	if _, err := s.db.Exec("update boards set sprint_start_date='2020-01-01',sprint_weeks=3"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec("insert into sprint_names(board_id,sprint_number,name,updated_at) values(1,1,'Keep sprint','2020-01-01')"); err != nil {
		t.Fatal(err)
	}
	before := map[string][]map[string]any{}
	for _, table := range []string{"tickets", "ticket_labels", "ticket_links", "ticket_activity", "boards", "sprint_names", "labels"} {
		var err error
		before[table], err = rows(s.db, "select * from "+table+" order by 1")
		if err != nil {
			t.Fatal(err)
		}
	}
	// Fail on the second board, after the first board was fully reseeded.
	if _, err := s.db.Exec(fmt.Sprintf("create trigger reject_demo before insert on tickets when new.board_id=%d and new.title='Open the Cretaceous Coffee Bar' begin select raise(abort,'injected demo failure'); end", secondBoard)); err != nil {
		t.Fatal(err)
	}
	if _, err := s.resetDemoData(demoTestTime()); err == nil {
		t.Fatal("expected the injected reset failure")
	}
	for table, old := range before {
		current, err := rows(s.db, "select * from "+table+" order by 1")
		if err != nil || !reflect.DeepEqual(old, current) {
			t.Fatalf("failed reset did not roll back %s: %#v, %v", table, current, err)
		}
	}
}

func TestDemoWeekStartUsesUTCAtWeekBoundary(t *testing.T) {
	sundayInNewYork := time.Date(2026, time.October, 4, 23, 30, 0, 0, time.FixedZone("NY", -4*60*60))
	if got := demoWeekStart(sundayInNewYork).Format("2006-01-02"); got != "2026-10-05" {
		t.Fatalf("UTC Monday should start the demo week, got %s", got)
	}
}
