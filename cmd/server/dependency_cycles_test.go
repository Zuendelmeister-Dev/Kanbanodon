package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"testing"
)

func TestSharedPrerequisitesAndTransitiveBranchesRemainValid(t *testing.T) {
	s := newTestServer(t)
	a := createTestTicket(t, s, `{"Title":"First"}`)
	b := createTestTicket(t, s, `{"Title":"Second"}`)
	c := createTestTicket(t, s, `{"Title":"Third"}`)
	// Sharing a prerequisite, including through another task, is not a cycle.
	for _, change := range []struct {
		id    int64
		links []int64
	}{{a, []int64{b}}, {c, []int64{b}}, {a, []int64{b, c}}} {
		if rec := setTestDependencies(s, change.id, change.links...); rec.Code != http.StatusOK {
			t.Fatalf("valid branch rejected: %d %s", rec.Code, rec.Body.String())
		}
	}
	links, err := ints(s.db, "select to_ticket_id from ticket_links where from_ticket_id=? order by to_ticket_id", a)
	if err != nil || !reflect.DeepEqual(links, []int64{b, c}) {
		t.Fatalf("valid branch not retained: links=%v err=%v", links, err)
	}
	// A newly created dependent can safely depend on more than one branch.
	d := createTestTicket(t, s, fmt.Sprintf(`{"Title":"Fourth","Links":[%d,%d]}`, a, c))
	if rec := setTestDependencies(s, b, d); rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "cycle") {
		t.Fatalf("branch back-edge accepted: %d %s", rec.Code, rec.Body.String())
	}
}

func TestLongDependencyCycleRejectsWholeTaskUpdate(t *testing.T) {
	s := newTestServer(t)
	ids := make([]int64, 6)
	for i := range ids {
		ids[i] = createTestTicket(t, s, fmt.Sprintf(`{"Title":"Step %d","Labels":["existing"],"Extras":{"Checklist":[{"Text":"Keep this step","Done":false}]}}`, i+1))
		if i > 0 {
			if rec := setTestDependencies(s, ids[i], ids[i-1]); rec.Code != http.StatusOK {
				t.Fatalf("chain setup failed: %d %s", rec.Code, rec.Body.String())
			}
		}
	}
	before := mustLoadTickets(t, s, 1)
	var activityBefore int
	if err := s.db.QueryRow("select count(*) from ticket_activity").Scan(&activityBefore); err != nil {
		t.Fatal(err)
	}
	column, err := firstCol(s.db, 1)
	if err != nil {
		t.Fatal(err)
	}
	body, err := json.Marshal(ticket{
		Title: "Should not replace the title", ColumnID: column, Links: []int64{ids[5]},
		Labels: []string{"should not create this label"},
		Extras: &ticketExtras{Checklist: []checklistItem{{Text: "Should not replace the checklist", Done: true}}},
	})
	if err != nil {
		t.Fatal(err)
	}
	rec := featureRequest(s, ids[0], "", http.MethodPut, string(body), user{ID: 1, IsAdmin: true})
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "cycle") {
		t.Fatalf("six-task cycle accepted: %d %s", rec.Code, rec.Body.String())
	}
	if after := mustLoadTickets(t, s, 1); !reflect.DeepEqual(before, after) {
		t.Fatalf("rejected cycle partially changed tasks: before=%#v after=%#v", before, after)
	}
	var activityAfter, addedLabels int
	if err := s.db.QueryRow("select count(*) from ticket_activity").Scan(&activityAfter); err != nil {
		t.Fatal(err)
	}
	if err := s.db.QueryRow("select count(*) from labels where name='should not create this label'").Scan(&addedLabels); err != nil {
		t.Fatal(err)
	}
	if activityAfter != activityBefore || addedLabels != 0 {
		t.Fatalf("rejected cycle leaked metadata: activity=%d/%d labels=%d", activityBefore, activityAfter, addedLabels)
	}
}

func TestHiddenTasksCannotBypassDependencyCycleProtection(t *testing.T) {
	for _, action := range []string{"/archive", "/trash"} {
		t.Run(action[1:], func(t *testing.T) {
			s := newTestServer(t)
			a := createTestTicket(t, s, `{"Title":"A"}`)
			b := createTestTicket(t, s, `{"Title":"B"}`)
			c := createTestTicket(t, s, `{"Title":"C"}`)
			for _, edge := range [][2]int64{{a, b}, {b, c}} {
				if rec := setTestDependencies(s, edge[0], edge[1]); rec.Code != http.StatusOK {
					t.Fatal(rec.Code, rec.Body.String())
				}
			}
			actor := user{ID: 1, IsAdmin: true}
			if rec := featureRequest(s, b, action, http.MethodPost, "{}", actor); rec.Code != http.StatusOK {
				t.Fatal(rec.Code, rec.Body.String())
			}
			if rec := setTestDependencies(s, c, a); rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "cycle") {
				t.Fatalf("cycle through hidden task accepted: %d %s", rec.Code, rec.Body.String())
			}
			if rec := featureRequest(s, b, "/restore", http.MethodPost, "{}", actor); rec.Code != http.StatusOK {
				t.Fatal(rec.Code, rec.Body.String())
			}
			links, err := ints(s.db, "select to_ticket_id from ticket_links where from_ticket_id=?", b)
			if err != nil || !reflect.DeepEqual(links, []int64{c}) {
				t.Fatalf("restore lost dependency: %v %v", links, err)
			}
			if links, err := ints(s.db, "select to_ticket_id from ticket_links where from_ticket_id=?", c); err != nil || len(links) != 0 {
				t.Fatalf("rejected hidden cycle changed links: %v %v", links, err)
			}
			// Removing an edge repairs the chain; the previously rejected edge is then valid.
			if rec := setTestDependencies(s, a); rec.Code != http.StatusOK {
				t.Fatal(rec.Code, rec.Body.String())
			}
			if rec := setTestDependencies(s, c, a); rec.Code != http.StatusOK {
				t.Fatalf("valid repaired chain rejected: %d %s", rec.Code, rec.Body.String())
			}
		})
	}
}

func TestLongImportedDependencyCyclesRollBackExistingBoard(t *testing.T) {
	for _, count := range []int{3, 8} {
		t.Run(fmt.Sprintf("%d tasks", count), func(t *testing.T) {
			s := newTestServer(t)
			createTestTicket(t, s, `{"Title":"Keep the existing task","Labels":["keep"]}`)
			before := mustLoadTickets(t, s, 1)
			items := make([]ticket, count)
			for i := range items {
				items[i] = ticket{ID: int64(100 + i), Title: fmt.Sprintf("Imported %d", i), Links: []int64{int64(100 + (i+1)%count)}, Labels: []string{"roll back cyclic import"}}
			}
			body, err := json.Marshal(map[string]any{"state": map[string]any{"tickets": items}})
			if err != nil {
				t.Fatal(err)
			}
			rec := httptest.NewRecorder()
			s.importData(rec, httptest.NewRequest(http.MethodPost, "/api/import?boardId=1", bytes.NewReader(body)), user{ID: 1, IsAdmin: true})
			if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "cycle") {
				t.Fatalf("cyclic import accepted: %d %s", rec.Code, rec.Body.String())
			}
			if after := mustLoadTickets(t, s, 1); !reflect.DeepEqual(before, after) {
				t.Fatalf("cyclic import changed existing board: before=%#v after=%#v", before, after)
			}
			var addedLabels, links int
			if err := s.db.QueryRow("select count(*) from labels where name='roll back cyclic import'").Scan(&addedLabels); err != nil {
				t.Fatal(err)
			}
			if err := s.db.QueryRow("select count(*) from ticket_links").Scan(&links); err != nil {
				t.Fatal(err)
			}
			if addedLabels != 0 || links != 0 {
				t.Fatalf("cyclic import leaked metadata: labels=%d links=%d", addedLabels, links)
			}
		})
	}
}

func TestConcurrentThreeWayDependencyChangesCannotIntroduceCycle(t *testing.T) {
	s := newTestServer(t)
	a := createTestTicket(t, s, `{"Title":"A"}`)
	b := createTestTicket(t, s, `{"Title":"B"}`)
	c := createTestTicket(t, s, `{"Title":"C"}`)
	var wg sync.WaitGroup
	start := make(chan struct{})
	results := make(chan int, 3)
	for _, edge := range [][2]int64{{a, b}, {b, c}, {c, a}} {
		wg.Add(1)
		go func(edge [2]int64) {
			defer wg.Done()
			<-start
			results <- setTestDependencies(s, edge[0], edge[1]).Code
		}(edge)
	}
	close(start)
	wg.Wait()
	close(results)
	counts := map[int]int{}
	for code := range results {
		counts[code]++
	}
	if counts[http.StatusOK] != 2 || counts[http.StatusBadRequest] != 1 {
		t.Fatalf("expected two committed edges and one rejected cycle: %v", counts)
	}
	var storedEdges int
	if err := s.db.QueryRow("select count(*) from ticket_links").Scan(&storedEdges); err != nil || storedEdges != 2 {
		t.Fatalf("unexpected graph after simultaneous changes: edges=%d err=%v", storedEdges, err)
	}
}
