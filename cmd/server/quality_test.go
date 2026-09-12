package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestDecodeJSONRejectsUnknownTrailingAndOversizedInput(t *testing.T) {
	tests := []struct {
		name string
		body string
	}{
		{name: "unknown field", body: `{"Name":"ok","Unexpected":true}`},
		{name: "trailing value", body: `{"Name":"ok"}{"Name":"again"}`},
		{name: "malformed", body: `{"Name":`},
		{name: "oversized", body: `{"Name":"` + strings.Repeat("x", 1<<20) + `"}`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(tt.body))
			var target struct{ Name string }
			if decodeJSON(rec, req, &target) {
				t.Fatal("expected invalid JSON input to be rejected")
			}
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("expected status 400, got %d", rec.Code)
			}
		})
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"Name":"  board  "}`))
	var target struct{ Name string }
	if !decodeJSON(rec, req, &target) || target.Name != "  board  " {
		t.Fatalf("expected one valid JSON object, got %#v and status %d", target, rec.Code)
	}
}

func TestSecureAddsBrowserSecurityHeaders(t *testing.T) {
	handler := secure(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))

	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected wrapped handler status, got %d", rec.Code)
	}
	for header, want := range map[string]string{
		"X-Content-Type-Options": "nosniff",
		"X-Frame-Options":        "DENY",
		"Referrer-Policy":        "no-referrer",
	} {
		if got := rec.Header().Get(header); got != want {
			t.Errorf("%s = %q, want %q", header, got, want)
		}
	}
	if csp := rec.Header().Get("Content-Security-Policy"); !strings.Contains(csp, "frame-ancestors 'none'") {
		t.Fatalf("expected restrictive CSP, got %q", csp)
	}
}

func TestEndpointMethodContracts(t *testing.T) {
	s := newTestServer(t)
	tests := []struct {
		name    string
		method  string
		path    string
		handler func(http.ResponseWriter, *http.Request, user)
	}{
		{name: "state", method: http.MethodPost, path: "/api/state", handler: s.state},
		{name: "export", method: http.MethodPost, path: "/api/export", handler: s.export},
		{name: "import", method: http.MethodGet, path: "/api/import", handler: s.importData},
		{name: "boards", method: http.MethodPatch, path: "/api/boards", handler: s.boards},
		{name: "tickets", method: http.MethodGet, path: "/api/tickets", handler: s.createTicket},
		{name: "users", method: http.MethodGet, path: "/api/users", handler: s.users},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			tt.handler(rec, httptest.NewRequest(tt.method, tt.path, nil), user{ID: 1, IsAdmin: true})
			if rec.Code != http.StatusMethodNotAllowed {
				t.Fatalf("expected status 405, got %d with body %q", rec.Code, rec.Body.String())
			}
		})
	}

	for _, tt := range []struct {
		name    string
		handler http.HandlerFunc
	}{
		{name: "signup", handler: s.signup},
		{name: "logout", handler: s.logout},
	} {
		t.Run(tt.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			tt.handler(rec, httptest.NewRequest(http.MethodGet, "/api/"+tt.name, nil))
			if rec.Code != http.StatusMethodNotAllowed {
				t.Fatalf("expected status 405, got %d with body %q", rec.Code, rec.Body.String())
			}
		})
	}
}

func TestUtilityAndAccountNormalization(t *testing.T) {
	if got := def("  value  ", "fallback"); got != "value" {
		t.Fatalf("def trimmed value = %q", got)
	}
	if got := def(" \t ", "fallback"); got != "fallback" {
		t.Fatalf("def blank value = %q", got)
	}
	if got := cleanUsername("  Ada+LOVELACE@example! "); got != "adalovelaceexample" {
		t.Fatalf("unexpected normalized username %q", got)
	}
	if got := camel("must_change_password"); got != "mustChangePassword" {
		t.Fatalf("unexpected camel-case result %q", got)
	}
	username, name, email := normalizeAccount(accountInput{Email: "Grace.Hopper@example.test", Name: "  Grace  "})
	if username != "grace.hopper" || name != "Grace" || email != "grace.hopper@users.kanbanodon.local" {
		t.Fatalf("unexpected normalized account: %q %q %q", username, name, email)
	}
	if checkPassword("v2$00$00", "secret") {
		t.Fatal("unsupported password hash versions must be rejected")
	}
}

func TestEnsureUsernamesNormalizesAndDeduplicatesLegacyValues(t *testing.T) {
	s := newTestServer(t)
	for _, account := range []struct {
		username string
		name     string
		email    string
	}{
		{username: "Ada", name: "Ada", email: "ada@example.test"},
		{username: "ada", name: "Other", email: "other@example.test"},
		{username: "+++", name: "", email: "@example.test"},
	} {
		if _, err := s.db.Exec("insert into users(username,name,email,password_hash,avatar,created_at) values(?,?,?,?,?,?)", account.username, account.name, account.email, "unused", "raptor", now()); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.ensureUsernames(); err != nil {
		t.Fatal(err)
	}
	got := strs(s.db, "select username from users where id>1 order by id")
	want := []string{"ada", "other", "user"}
	if len(got) != len(want) {
		t.Fatalf("got usernames %#v, want %#v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("got usernames %#v, want %#v", got, want)
		}
	}
}

func TestNewHandlerRoutesAPIAndAddsSecurityHeaders(t *testing.T) {
	s := newTestServer(t)
	handler := newHandler(s)

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/state", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("state route failed with %d: %q", rec.Code, rec.Body.String())
	}
	if rec.Header().Get("X-Frame-Options") != "DENY" || rec.Header().Get("Content-Type") != "application/json" {
		t.Fatalf("expected middleware and JSON headers, got %#v", rec.Header())
	}

	notFound := httptest.NewRecorder()
	handler.ServeHTTP(notFound, httptest.NewRequest(http.MethodGet, "/missing", nil))
	if notFound.Code != http.StatusNotFound {
		t.Fatalf("expected unknown SPA path to return 404, got %d", notFound.Code)
	}
}

func TestExpiredAndMalformedSessionsAreRemoved(t *testing.T) {
	s := newTestServer(t)
	s.authMode = "local"
	for _, expiresAt := range []string{time.Now().Add(-time.Hour).UTC().Format(time.RFC3339), "not-a-time"} {
		rawToken := "session-" + expiresAt
		hash := tokenHash(rawToken, s.secret)
		if _, err := s.db.Exec("insert into sessions(token_hash,user_id,expires_at) values(?,?,?)", hash, 1, expiresAt); err != nil {
			t.Fatal(err)
		}
		req := httptest.NewRequest(http.MethodGet, "/api/state", nil)
		req.AddCookie(&http.Cookie{Name: "kanbanodon_session", Value: rawToken})
		if _, err := s.currentUser(req); err == nil {
			t.Fatalf("expected session with expiry %q to be rejected", expiresAt)
		}
		var count int
		if err := s.db.QueryRow("select count(*) from sessions where token_hash=?", hash).Scan(&count); err != nil {
			t.Fatal(err)
		}
		if count != 0 {
			t.Fatal("expected rejected session to be removed")
		}
	}
}

func TestAuthenticationFailurePathsAndLogout(t *testing.T) {
	s := newTestServer(t)
	s.authMode = "local"

	for _, tt := range []struct {
		name   string
		method string
		body   string
		want   int
	}{
		{name: "login method", method: http.MethodGet, want: http.StatusMethodNotAllowed},
		{name: "login JSON", method: http.MethodPost, body: `{`, want: http.StatusBadRequest},
		{name: "login credentials", method: http.MethodPost, body: `{"Login":"missing","Password":"wrong"}`, want: http.StatusUnauthorized},
	} {
		t.Run(tt.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			s.login(rec, httptest.NewRequest(tt.method, "/api/login", strings.NewReader(tt.body)))
			if rec.Code != tt.want {
				t.Fatalf("expected status %d, got %d: %q", tt.want, rec.Code, rec.Body.String())
			}
		})
	}

	s.allowSignup = false
	signupRec := httptest.NewRecorder()
	s.signup(signupRec, httptest.NewRequest(http.MethodPost, "/api/signup", strings.NewReader(`{"Username":"new","Password":"secret"}`)))
	if signupRec.Code != http.StatusForbidden {
		t.Fatalf("expected disabled signup status 403, got %d", signupRec.Code)
	}

	blocked := httptest.NewRecorder()
	s.withUser(func(w http.ResponseWriter, _ *http.Request, _ user) { w.WriteHeader(http.StatusNoContent) }).ServeHTTP(blocked, httptest.NewRequest(http.MethodPost, "/api/tickets", nil))
	if blocked.Code != http.StatusUnauthorized {
		t.Fatalf("expected unauthenticated request to return 401, got %d", blocked.Code)
	}

	rawToken := "logout-token"
	hash := tokenHash(rawToken, s.secret)
	if _, err := s.db.Exec("insert into sessions(token_hash,user_id,expires_at) values(?,?,?)", hash, 1, time.Now().Add(time.Hour).UTC().Format(time.RFC3339)); err != nil {
		t.Fatal(err)
	}
	logoutReq := httptest.NewRequest(http.MethodPost, "/api/logout", nil)
	logoutReq.AddCookie(&http.Cookie{Name: "kanbanodon_session", Value: rawToken})
	logoutRec := httptest.NewRecorder()
	s.logout(logoutRec, logoutReq)
	if logoutRec.Code != http.StatusOK || len(logoutRec.Result().Cookies()) != 1 || logoutRec.Result().Cookies()[0].MaxAge != -1 {
		t.Fatalf("unexpected logout response: status=%d cookies=%#v", logoutRec.Code, logoutRec.Result().Cookies())
	}
	var count int
	if err := s.db.QueryRow("select count(*) from sessions where token_hash=?", hash).Scan(&count); err != nil || count != 0 {
		t.Fatalf("expected logout session deletion, count=%d err=%v", count, err)
	}
}

func TestBoardDefaultsSelectionAndAccessValidation(t *testing.T) {
	s := newTestServer(t)
	ownerID := insertTestUser(t, s, "boardowner", "Board Owner", "boardowner@example.test")
	boardID, err := s.createBoard("   ", ownerID)
	if err != nil {
		t.Fatal(err)
	}
	if !s.canAccessBoard(user{ID: ownerID}, boardID) {
		t.Fatal("board creator should receive access atomically")
	}
	board := one(s.db, "select name from boards where id=?", boardID)
	if board["name"] != "New Board" {
		t.Fatalf("expected default board name, got %#v", board)
	}
	if len(rows(s.db, "select id from columns where board_id=?", boardID)) != 5 || len(rows(s.db, "select id from labels where board_id=?", boardID)) != 4 {
		t.Fatal("expected default workflow columns and labels")
	}

	req := httptest.NewRequest(http.MethodGet, "/api/state?boardId=999999", nil)
	if got := s.boardID(req, user{ID: ownerID}); got != boardID {
		t.Fatalf("expected inaccessible selection to fall back to %d, got %d", boardID, got)
	}

	missingBoard := httptest.NewRecorder()
	s.boardAccess(missingBoard, httptest.NewRequest(http.MethodPost, "/api/board-access", strings.NewReader(`{"BoardID":999999,"UserID":1,"FullAccess":true}`)), user{ID: 1, IsAdmin: true})
	if missingBoard.Code != http.StatusNotFound {
		t.Fatalf("expected missing board status 404, got %d: %q", missingBoard.Code, missingBoard.Body.String())
	}
	missingUser := httptest.NewRecorder()
	s.boardAccess(missingUser, httptest.NewRequest(http.MethodPost, "/api/board-access", strings.NewReader(`{"BoardID":1,"UserID":999999,"FullAccess":true}`)), user{ID: 1, IsAdmin: true})
	if missingUser.Code != http.StatusNotFound {
		t.Fatalf("expected missing user status 404, got %d: %q", missingUser.Code, missingUser.Body.String())
	}
}

func TestTicketRelationsMustStayValidAndBoardLocal(t *testing.T) {
	s := newTestServer(t)
	foreignBoardID, err := s.createBoard("Foreign", 1)
	if err != nil {
		t.Fatal(err)
	}
	foreignReq := httptest.NewRequest(http.MethodPost, "/api/tickets?boardId="+strconv.FormatInt(foreignBoardID, 10), strings.NewReader(`{"Title":"Foreign dependency"}`))
	foreignRec := httptest.NewRecorder()
	s.withUser(s.createTicket).ServeHTTP(foreignRec, foreignReq)
	if foreignRec.Code != http.StatusOK {
		t.Fatalf("creating foreign ticket failed: %d %q", foreignRec.Code, foreignRec.Body.String())
	}
	var foreign struct {
		ID int64 `json:"id"`
	}
	if err := json.NewDecoder(foreignRec.Body).Decode(&foreign); err != nil {
		t.Fatal(err)
	}
	var foreignMilestoneID int64
	if err := s.db.QueryRow("select id from milestones where board_id=?", foreignBoardID).Scan(&foreignMilestoneID); err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		name string
		body string
	}{
		{name: "foreign dependency", body: `{"Title":"Bad link","Links":[` + strconv.FormatInt(foreign.ID, 10) + `]}`},
		{name: "foreign milestone", body: `{"Title":"Bad milestone","MilestoneID":` + strconv.FormatInt(foreignMilestoneID, 10) + `}`},
		{name: "missing assignee", body: `{"Title":"Bad assignee","AssigneeID":999999}`},
		{name: "negative milestone", body: `{"Title":"Bad milestone","MilestoneID":-1}`},
		{name: "negative assignee", body: `{"Title":"Bad assignee","AssigneeID":-1}`},
		{name: "negative board", body: `{"Title":"Bad board","BoardID":-1}`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/api/tickets?boardId=1", strings.NewReader(tt.body))
			s.withUser(s.createTicket).ServeHTTP(rec, req)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("expected status 400, got %d with body %q", rec.Code, rec.Body.String())
			}
		})
	}

	id := createTestTicket(t, s, `{"Title":"Keep","Type":"task"}`)
	columnID := testColumnID(t, s, "Backlog")
	for _, tt := range []struct {
		name string
		body string
	}{
		{name: "missing column", body: `{"Title":"Keep","Type":"task","ColumnID":0}`},
		{name: "self dependency", body: `{"Title":"Keep","Type":"task","ColumnID":` + strconv.FormatInt(columnID, 10) + `,"Links":[` + strconv.FormatInt(id, 10) + `]}`},
		{name: "foreign board body", body: `{"Title":"Keep","Type":"task","BoardID":` + strconv.FormatInt(foreignBoardID, 10) + `,"ColumnID":` + strconv.FormatInt(columnID, 10) + `}`},
	} {
		t.Run(tt.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPut, "/api/tickets/"+strconv.FormatInt(id, 10), strings.NewReader(tt.body))
			s.withUser(s.ticketAction).ServeHTTP(rec, req)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("expected status 400, got %d with body %q", rec.Code, rec.Body.String())
			}
		})
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodDelete, "/api/tickets/"+strconv.FormatInt(id, 10)+"/unknown", nil)
	s.withUser(s.ticketAction).ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("unknown ticket subpath should return 404, got %d", rec.Code)
	}
	if !ticketBelongsToBoard(s.db, id, 1) {
		t.Fatal("unknown ticket subpath must not delete the ticket")
	}
}

func TestExplicitInvalidBoardDoesNotFallBackForDataOperations(t *testing.T) {
	s := newTestServer(t)
	admin := user{ID: 1, IsAdmin: true}

	createRec := httptest.NewRecorder()
	s.createTicket(createRec, httptest.NewRequest(http.MethodPost, "/api/tickets?boardId=999999", strings.NewReader(`{"Title":"Wrong board"}`)), admin)
	if createRec.Code != http.StatusForbidden || len(s.loadTickets(1)) != 0 {
		t.Fatalf("invalid board create must not fall back, status=%d tickets=%#v", createRec.Code, s.loadTickets(1))
	}

	importRec := httptest.NewRecorder()
	s.importData(importRec, httptest.NewRequest(http.MethodPost, "/api/import?boardId=999999", strings.NewReader(`{"state":{"tickets":[{"Title":"Wrong board"}]}}`)), admin)
	if importRec.Code != http.StatusForbidden || len(s.loadTickets(1)) != 0 {
		t.Fatalf("invalid board import must not fall back, status=%d tickets=%#v", importRec.Code, s.loadTickets(1))
	}

	exportRec := httptest.NewRecorder()
	s.export(exportRec, httptest.NewRequest(http.MethodGet, "/api/export?boardId=999999", nil), admin)
	if exportRec.Code != http.StatusForbidden {
		t.Fatalf("invalid board export must not fall back, status=%d body=%q", exportRec.Code, exportRec.Body.String())
	}
}

func TestTicketMetadataAndDeleteAreConsistent(t *testing.T) {
	s := newTestServer(t)
	dependencyID := createTestTicket(t, s, `{"Title":"Dependency"}`)
	parentID := createTestTicket(t, s, `{"Title":"Parent","Type":"epic","Labels":["new label"],"Links":[`+strconv.FormatInt(dependencyID, 10)+`]}`)
	childID := createTestTicket(t, s, `{"Title":"Child","Type":"story","ParentID":`+strconv.FormatInt(parentID, 10)+`}`)
	if _, err := s.db.Exec("insert into comments(ticket_id,user_id,body,created_at) values(?,?,?,?)", parentID, 1, "note", now()); err != nil {
		t.Fatal(err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodDelete, "/api/tickets/"+strconv.FormatInt(parentID, 10), nil)
	s.withUser(s.ticketAction).ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("delete failed with %d: %q", rec.Code, rec.Body.String())
	}
	for name, query := range map[string]string{
		"labels":       "select count(*) from ticket_labels where ticket_id=?",
		"dependencies": "select count(*) from ticket_links where from_ticket_id=? or to_ticket_id=?",
		"comments":     "select count(*) from comments where ticket_id=?",
	} {
		var count int
		args := []any{parentID}
		if name == "dependencies" {
			args = append(args, parentID)
		}
		if err := s.db.QueryRow(query, args...).Scan(&count); err != nil {
			t.Fatal(err)
		}
		if count != 0 {
			t.Fatalf("expected %s to be removed, got %d rows", name, count)
		}
	}
	var childParentID int64
	if err := s.db.QueryRow("select parent_id from tickets where id=?", childID).Scan(&childParentID); err != nil {
		t.Fatal(err)
	}
	if childParentID != 0 {
		t.Fatalf("expected child to be detached, got parent %d", childParentID)
	}
}

func TestTicketCommentsCompletionAndErrorPaths(t *testing.T) {
	s := newTestServer(t)
	id := createTestTicket(t, s, `{"Title":"Lifecycle"}`)

	commentRec := httptest.NewRecorder()
	commentReq := httptest.NewRequest(http.MethodPost, "/api/tickets/"+strconv.FormatInt(id, 10)+"/comments", strings.NewReader(`{"Body":"  useful note  "}`))
	s.withUser(s.ticketAction).ServeHTTP(commentRec, commentReq)
	if commentRec.Code != http.StatusOK {
		t.Fatalf("comment failed with %d: %q", commentRec.Code, commentRec.Body.String())
	}
	var body string
	if err := s.db.QueryRow("select body from comments where ticket_id=?", id).Scan(&body); err != nil || body != "useful note" {
		t.Fatalf("expected trimmed comment, body=%q err=%v", body, err)
	}

	commentMethod := httptest.NewRecorder()
	s.withUser(s.ticketAction).ServeHTTP(commentMethod, httptest.NewRequest(http.MethodGet, "/api/tickets/"+strconv.FormatInt(id, 10)+"/comments", nil))
	if commentMethod.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected comment GET to return 405, got %d", commentMethod.Code)
	}

	doneID := testColumnID(t, s, "Done")
	backlogID := testColumnID(t, s, "Backlog")
	move := func(columnID int64) *httptest.ResponseRecorder {
		t.Helper()
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPut, "/api/tickets/"+strconv.FormatInt(id, 10), strings.NewReader(`{"Title":"Lifecycle","Type":"task","ColumnID":`+strconv.FormatInt(columnID, 10)+`}`))
		s.withUser(s.ticketAction).ServeHTTP(rec, req)
		return rec
	}
	if rec := move(doneID); rec.Code != http.StatusOK {
		t.Fatalf("move to done failed with %d: %q", rec.Code, rec.Body.String())
	}
	var firstCompletion string
	if err := s.db.QueryRow("select completed_at from tickets where id=?", id).Scan(&firstCompletion); err != nil || firstCompletion == "" {
		t.Fatalf("expected completion timestamp, value=%q err=%v", firstCompletion, err)
	}
	if rec := move(doneID); rec.Code != http.StatusOK {
		t.Fatalf("second done update failed with %d: %q", rec.Code, rec.Body.String())
	}
	var secondCompletion string
	if err := s.db.QueryRow("select completed_at from tickets where id=?", id).Scan(&secondCompletion); err != nil || secondCompletion != firstCompletion {
		t.Fatalf("expected stable completion timestamp, first=%q second=%q err=%v", firstCompletion, secondCompletion, err)
	}
	if rec := move(backlogID); rec.Code != http.StatusOK {
		t.Fatalf("move out of done failed with %d: %q", rec.Code, rec.Body.String())
	}
	var cleared string
	if err := s.db.QueryRow("select completed_at from tickets where id=?", id).Scan(&cleared); err != nil || cleared != "" {
		t.Fatalf("expected completion timestamp to clear, value=%q err=%v", cleared, err)
	}

	for _, tt := range []struct {
		name string
		path string
		want int
	}{
		{name: "bad id", path: "/api/tickets/nope", want: http.StatusBadRequest},
		{name: "negative id", path: "/api/tickets/-1", want: http.StatusBadRequest},
		{name: "missing ticket", path: "/api/tickets/999999", want: http.StatusNotFound},
	} {
		t.Run(tt.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			s.withUser(s.ticketAction).ServeHTTP(rec, httptest.NewRequest(http.MethodDelete, tt.path, nil))
			if rec.Code != tt.want {
				t.Fatalf("expected %d, got %d: %q", tt.want, rec.Code, rec.Body.String())
			}
		})
	}

	regularID := insertTestUser(t, s, "outsider", "Outsider", "outsider@example.test")
	accessDenied := httptest.NewRecorder()
	s.ticketAction(accessDenied, httptest.NewRequest(http.MethodDelete, "/api/tickets/"+strconv.FormatInt(id, 10), nil), user{ID: regularID})
	if accessDenied.Code != http.StatusForbidden {
		t.Fatalf("expected board access status 403, got %d", accessDenied.Code)
	}
}

func TestIncomingDependenciesBlockCreateAndCombinedMove(t *testing.T) {
	s := newTestServer(t)
	dependencyID := createTestTicket(t, s, `{"Title":"Unfinished dependency"}`)
	inProgressID := testColumnID(t, s, "In Progress")

	createRec := httptest.NewRecorder()
	createReq := httptest.NewRequest(http.MethodPost, "/api/tickets", strings.NewReader(`{"Title":"Cannot start","ColumnID":`+strconv.FormatInt(inProgressID, 10)+`,"Links":[`+strconv.FormatInt(dependencyID, 10)+`]}`))
	s.withUser(s.createTicket).ServeHTTP(createRec, createReq)
	if createRec.Code != http.StatusConflict {
		t.Fatalf("expected blocked create status 409, got %d: %q", createRec.Code, createRec.Body.String())
	}

	ticketID := createTestTicket(t, s, `{"Title":"Initially unlinked"}`)
	moveRec := httptest.NewRecorder()
	moveReq := httptest.NewRequest(http.MethodPut, "/api/tickets/"+strconv.FormatInt(ticketID, 10), strings.NewReader(`{"Title":"Initially unlinked","Type":"task","ColumnID":`+strconv.FormatInt(inProgressID, 10)+`,"Links":[`+strconv.FormatInt(dependencyID, 10)+`]}`))
	s.withUser(s.ticketAction).ServeHTTP(moveRec, moveReq)
	if moveRec.Code != http.StatusConflict {
		t.Fatalf("expected combined link and move status 409, got %d: %q", moveRec.Code, moveRec.Body.String())
	}
	stored := s.loadTickets(1)
	for _, item := range stored {
		if item.ID == ticketID && (item.ColumnID == inProgressID || len(item.Links) != 0) {
			t.Fatalf("blocked update must not partially persist, got %#v", item)
		}
	}
}

func TestImportRejectsOversizedPayload(t *testing.T) {
	s := newTestServer(t)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/import", strings.NewReader(strings.Repeat(" ", (5<<20)+1)))
	s.withUser(s.importData).ServeHTTP(rec, req)
	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("expected status 413, got %d: %q", rec.Code, rec.Body.String())
	}
}

func TestUserManagementValidationAndPasswordChecks(t *testing.T) {
	s := newTestServer(t)
	regularID := insertTestUser(t, s, "regular", "Regular", "regular@example.test")
	regular := user{ID: regularID}
	admin := user{ID: 1, IsAdmin: true}

	for _, tt := range []struct {
		name    string
		method  string
		handler func(http.ResponseWriter, *http.Request, user)
	}{
		{name: "create", method: http.MethodPost, handler: s.userCreate},
		{name: "admin", method: http.MethodPost, handler: s.userAdmin},
		{name: "password", method: http.MethodPost, handler: s.userPassword},
		{name: "delete", method: http.MethodDelete, handler: s.userDelete},
	} {
		t.Run("regular user cannot "+tt.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			tt.handler(rec, httptest.NewRequest(tt.method, "/api/users", strings.NewReader(`{}`)), regular)
			if rec.Code != http.StatusForbidden {
				t.Fatalf("expected status 403, got %d: %q", rec.Code, rec.Body.String())
			}
		})
	}

	for _, tt := range []struct {
		name    string
		boardID int64
		want    int
	}{
		{name: "missing", boardID: 999999, want: http.StatusNotFound},
		{name: "negative", boardID: -1, want: http.StatusBadRequest},
	} {
		t.Run(tt.name+" board does not create user", func(t *testing.T) {
			rec := httptest.NewRecorder()
			body := `{"Username":"orphan","Password":"secret","BoardID":` + strconv.FormatInt(tt.boardID, 10) + `,"FullAccess":true}`
			s.userCreate(rec, httptest.NewRequest(http.MethodPost, "/api/users", strings.NewReader(body)), admin)
			if rec.Code != tt.want {
				t.Fatalf("expected invalid board status %d, got %d: %q", tt.want, rec.Code, rec.Body.String())
			}
		})
	}
	var orphanCount int
	if err := s.db.QueryRow("select count(*) from users where username='orphan'").Scan(&orphanCount); err != nil || orphanCount != 0 {
		t.Fatalf("invalid board must not leave a user behind, count=%d err=%v", orphanCount, err)
	}

	invalidAdmin := httptest.NewRecorder()
	s.userAdmin(invalidAdmin, httptest.NewRequest(http.MethodPost, "/api/users/admin", strings.NewReader(`{"UserID":0,"IsAdmin":true}`)), admin)
	if invalidAdmin.Code != http.StatusBadRequest {
		t.Fatalf("expected missing user id status 400, got %d", invalidAdmin.Code)
	}
	missingAdmin := httptest.NewRecorder()
	s.userAdmin(missingAdmin, httptest.NewRequest(http.MethodPost, "/api/users/admin", strings.NewReader(`{"UserID":999999,"IsAdmin":true}`)), admin)
	if missingAdmin.Code != http.StatusNotFound {
		t.Fatalf("expected missing user status 404, got %d", missingAdmin.Code)
	}
	selfDemotion := httptest.NewRecorder()
	s.userAdmin(selfDemotion, httptest.NewRequest(http.MethodPost, "/api/users/admin", strings.NewReader(`{"UserID":1,"IsAdmin":false}`)), admin)
	if selfDemotion.Code != http.StatusBadRequest {
		t.Fatalf("expected self-demotion status 400, got %d", selfDemotion.Code)
	}

	blankReset := httptest.NewRecorder()
	s.userPassword(blankReset, httptest.NewRequest(http.MethodPost, "/api/users/password", strings.NewReader(`{"UserID":`+strconv.FormatInt(regularID, 10)+`,"Password":"   "}`)), admin)
	if blankReset.Code != http.StatusBadRequest {
		t.Fatalf("expected blank reset password status 400, got %d", blankReset.Code)
	}
	missingReset := httptest.NewRecorder()
	s.userPassword(missingReset, httptest.NewRequest(http.MethodPost, "/api/users/password", strings.NewReader(`{"UserID":999999,"Password":"new"}`)), admin)
	if missingReset.Code != http.StatusNotFound {
		t.Fatalf("expected missing reset user status 404, got %d", missingReset.Code)
	}

	blankPassword := httptest.NewRecorder()
	s.password(blankPassword, httptest.NewRequest(http.MethodPost, "/api/password", strings.NewReader(`{"NewPassword":"   "}`)), regular)
	if blankPassword.Code != http.StatusBadRequest {
		t.Fatalf("expected blank password status 400, got %d", blankPassword.Code)
	}
	invalidCurrent := httptest.NewRecorder()
	s.password(invalidCurrent, httptest.NewRequest(http.MethodPost, "/api/password", strings.NewReader(`{"CurrentPassword":"wrong","NewPassword":"new"}`)), regular)
	if invalidCurrent.Code != http.StatusUnauthorized {
		t.Fatalf("expected invalid current password status 401, got %d", invalidCurrent.Code)
	}

	missingDelete := httptest.NewRecorder()
	s.userDelete(missingDelete, httptest.NewRequest(http.MethodDelete, "/api/users", strings.NewReader(`{"UserID":999999}`)), admin)
	if missingDelete.Code != http.StatusNotFound {
		t.Fatalf("expected missing delete user status 404, got %d", missingDelete.Code)
	}
}

func TestImportMapsColumnsHierarchyDependenciesAndCountsAcceptedTickets(t *testing.T) {
	s := newTestServer(t)
	destinationMilestoneID := one(s.db, "select id from milestones where board_id=1 and name='First flight'")["id"].(int64)
	payload := map[string]any{"state": map[string]any{
		"columns":    []map[string]any{{"id": 900, "name": "Done"}},
		"milestones": []map[string]any{{"id": 901, "name": "First flight"}},
		"tickets": []ticket{
			{ID: 100, ColumnID: 900, Title: "Imported epic", Type: "epic", Labels: []string{"portable"}},
			{ID: 101, ColumnID: 900, ParentID: 100, Title: "Imported task", Type: "task", Links: []int64{100}, AssigneeID: 1, MilestoneID: 901},
			{ID: 102, ColumnID: 900, Title: "   ", Type: "task"},
		},
	}}
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/import?boardId=1", bytes.NewReader(body))
	s.withUser(s.importData).ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("import failed with %d: %q", rec.Code, rec.Body.String())
	}
	var result struct {
		Imported int `json:"imported"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
		t.Fatal(err)
	}
	if result.Imported != 2 {
		t.Fatalf("expected two accepted tickets, got %d", result.Imported)
	}
	tickets := s.loadTickets(1)
	if len(tickets) != 2 {
		t.Fatalf("expected two stored tickets, got %#v", tickets)
	}
	byTitle := map[string]ticket{}
	for _, item := range tickets {
		byTitle[item.Title] = item
	}
	epic := byTitle["Imported epic"]
	task := byTitle["Imported task"]
	if task.ParentID != epic.ID || len(task.Links) != 1 || task.Links[0] != epic.ID {
		t.Fatalf("expected mapped hierarchy and dependency, epic=%#v task=%#v", epic, task)
	}
	if task.AssigneeID != 0 || task.MilestoneID != destinationMilestoneID {
		t.Fatalf("expected assignee to clear and milestone to map by name, got %#v", task)
	}
	doneID := testColumnID(t, s, "Done")
	if epic.ColumnID != doneID || task.ColumnID != doneID {
		t.Fatalf("expected source Done column to map to destination %d, got %d and %d", doneID, epic.ColumnID, task.ColumnID)
	}
	if epic.CompletedAt == "" || task.CompletedAt == "" {
		t.Fatalf("expected imported Done tickets to receive completion timestamps, epic=%#v task=%#v", epic, task)
	}
}

func TestImportRejectsDuplicateSourceIDsWithoutPartialWrites(t *testing.T) {
	s := newTestServer(t)
	payload := `{"state":{"tickets":[{"ID":7,"Title":"First"},{"ID":7,"Title":"Second"}]}}`
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/import?boardId=1", strings.NewReader(payload))
	s.withUser(s.importData).ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest || len(s.loadTickets(1)) != 0 {
		t.Fatalf("duplicate source IDs must fail atomically, status=%d body=%q tickets=%#v", rec.Code, rec.Body.String(), s.loadTickets(1))
	}
}

func TestCreateTicketDerivesCompletionFromColumn(t *testing.T) {
	s := newTestServer(t)
	doneID := testColumnID(t, s, "Done")
	id := createTestTicket(t, s, `{"Title":"Already done","ColumnID":`+strconv.FormatInt(doneID, 10)+`,"CompletedAt":"1999-01-01T00:00:00Z"}`)
	var completedAt string
	if err := s.db.QueryRow("select completed_at from tickets where id=?", id).Scan(&completedAt); err != nil {
		t.Fatal(err)
	}
	if completedAt == "" || completedAt == "1999-01-01T00:00:00Z" {
		t.Fatalf("server must derive completion time for a new Done ticket, got %q", completedAt)
	}
}

func TestDeletingBoardOwnerTransfersOwnershipToActingAdmin(t *testing.T) {
	s := newTestServer(t)
	ownerID := insertTestUser(t, s, "owner2", "Owner Two", "owner2@example.test")
	boardID, err := s.createBoard("Owned", ownerID)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.setBoardAccess(boardID, ownerID, true); err != nil {
		t.Fatal(err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodDelete, "/api/users", strings.NewReader(`{"UserID":`+strconv.FormatInt(ownerID, 10)+`}`))
	s.userDelete(rec, req, user{ID: 1, IsAdmin: true})
	if rec.Code != http.StatusOK {
		t.Fatalf("delete failed with %d: %q", rec.Code, rec.Body.String())
	}
	var newOwnerID int64
	if err := s.db.QueryRow("select owner_id from boards where id=?", boardID).Scan(&newOwnerID); err != nil {
		t.Fatal(err)
	}
	if newOwnerID != 1 || !s.canAccessBoard(user{ID: 1}, boardID) {
		t.Fatalf("expected board ownership and explicit access to transfer to admin, owner=%d", newOwnerID)
	}
}

func TestExportIsBoardScoped(t *testing.T) {
	s := newTestServer(t)
	createTestTicket(t, s, `{"Title":"Visible"}`)
	otherBoardID, err := s.createBoard("Other", 1)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/tickets?boardId="+strconv.FormatInt(otherBoardID, 10), strings.NewReader(`{"Title":"Hidden"}`))
	rec := httptest.NewRecorder()
	s.withUser(s.createTicket).ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("creating other ticket failed: %d %q", rec.Code, rec.Body.String())
	}

	exportRec := httptest.NewRecorder()
	s.export(exportRec, httptest.NewRequest(http.MethodGet, "/api/export?boardId=1", nil), user{ID: 1, IsAdmin: true})
	if exportRec.Code != http.StatusOK {
		t.Fatalf("export failed with %d: %q", exportRec.Code, exportRec.Body.String())
	}
	if disposition := exportRec.Header().Get("Content-Disposition"); !strings.Contains(disposition, "kanbanodon-export.json") {
		t.Fatalf("unexpected content disposition %q", disposition)
	}
	if strings.Contains(exportRec.Body.String(), "Hidden") || !strings.Contains(exportRec.Body.String(), "Visible") {
		t.Fatalf("expected board-scoped export, got %s", exportRec.Body.String())
	}
}
