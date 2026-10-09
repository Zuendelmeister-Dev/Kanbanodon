package main

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

func authTestLogin(t *testing.T, s *server, username, password string) *http.Cookie {
	t.Helper()
	rec := httptest.NewRecorder()
	s.login(rec, httptest.NewRequest(http.MethodPost, "/api/login", strings.NewReader(fmt.Sprintf(`{"Login":%q,"Password":%q}`, username, password))))
	if rec.Code != http.StatusOK || len(rec.Result().Cookies()) != 1 {
		t.Fatalf("login: %d %s", rec.Code, rec.Body.String())
	}
	return rec.Result().Cookies()[0]
}

func authTestRequest(path, body string, cookie *http.Cookie) *http.Request {
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	if cookie != nil {
		req.AddCookie(cookie)
	}
	return req
}

func authTestActor(t *testing.T, s *server, cookie *http.Cookie) user {
	t.Helper()
	u, err := s.currentUser(authTestRequest("/api/password", "{}", cookie))
	if err != nil {
		t.Fatal(err)
	}
	return u
}

func authTestSetup(t *testing.T) (*server, user, *http.Cookie) {
	t.Helper()
	s := newTestServer(t)
	s.authMode = "local"
	if _, err := s.db.Exec("update users set must_change_password=0 where id=1"); err != nil {
		t.Fatal(err)
	}
	account, err := s.createUserAccount(accountInput{Username: "authvictim", Password: "old-password"}, false, false)
	if err != nil {
		t.Fatal(err)
	}
	return s, account, authTestLogin(t, s, defaultAdminUsername, defaultAdminPassword)
}

func authTestPassword(t *testing.T, s *server, uid int64, want string, forced bool) {
	t.Helper()
	var hash string
	var mustChange bool
	if err := s.db.QueryRow("select password_hash,must_change_password from users where id=?", uid).Scan(&hash, &mustChange); err != nil {
		t.Fatal(err)
	}
	if !checkPassword(hash, want) || mustChange != forced {
		t.Fatalf("unexpected password or forced-change flag for user %d", uid)
	}
}

func TestAuthSessionWriteFailuresDoNotPublishCookiesOrLeaveSignupAccount(t *testing.T) {
	s := newTestServer(t)
	if _, err := s.db.Exec(`create trigger reject_session before insert on sessions begin select raise(abort,'session write failed'); end`); err != nil {
		t.Fatal(err)
	}
	direct := httptest.NewRecorder()
	if err := s.setSession(direct, 1); err == nil || len(direct.Result().Cookies()) != 0 {
		t.Fatalf("setSession must report persistence failure without cookie: %v", err)
	}
	for _, endpoint := range []string{"login", "signup"} {
		rec := httptest.NewRecorder()
		if endpoint == "login" {
			s.login(rec, authTestRequest("/api/login", `{"Login":"kanbanoadmin","Password":"kanbanopw"}`, nil))
		} else {
			s.signup(rec, authTestRequest("/api/signup", `{"Username":"retryable","Password":"secret"}`, nil))
		}
		if rec.Code != http.StatusInternalServerError || len(rec.Result().Cookies()) != 0 {
			t.Fatalf("%s must fail without a cookie: %d %s", endpoint, rec.Code, rec.Body.String())
		}
	}
	var count int
	if err := s.db.QueryRow("select count(*) from users where username='retryable'").Scan(&count); err != nil || count != 0 {
		t.Fatalf("failed signup must roll back its account: count=%d err=%v", count, err)
	}
	if _, err := s.db.Exec("drop trigger reject_session"); err != nil {
		t.Fatal(err)
	}
	retry := httptest.NewRecorder()
	s.signup(retry, authTestRequest("/api/signup", `{"Username":"retryable","Password":"secret"}`, nil))
	if retry.Code != http.StatusOK || len(retry.Result().Cookies()) != 1 {
		t.Fatalf("signup retry: %d %s", retry.Code, retry.Body.String())
	}
	if got := authTestActor(t, s, retry.Result().Cookies()[0]); got.Username != "retryable" {
		t.Fatalf("signup cookie belongs to %q", got.Username)
	}
}

func TestAuthAdminResetRevokesSessionsAndRejectsAlreadyAuthenticatedPasswordRequest(t *testing.T) {
	s, account, adminCookie := authTestSetup(t)
	first := authTestLogin(t, s, account.Username, "old-password")
	second := authTestLogin(t, s, account.Username, "old-password")
	stale := authTestActor(t, s, first)
	reset := httptest.NewRecorder()
	s.withUser(s.userPassword).ServeHTTP(reset, authTestRequest("/api/users/password", fmt.Sprintf(`{"UserID":%d,"Password":"reset-secret"}`, account.ID), adminCookie))
	if reset.Code != http.StatusOK {
		t.Fatal(reset.Code, reset.Body.String())
	}
	for _, cookie := range []*http.Cookie{first, second} {
		if _, err := s.currentUser(authTestRequest("/api/state", "{}", cookie)); err == nil {
			t.Fatal("pre-reset session remains valid")
		}
	}
	// Simulate middleware having authenticated this request before the reset.
	change := httptest.NewRecorder()
	s.password(change, authTestRequest("/api/password", `{"NewPassword":"takeover"}`, first), stale)
	if change.Code != http.StatusUnauthorized {
		t.Fatal("stale authenticated request overwrote reset", change.Code, change.Body.String())
	}
	authTestPassword(t, s, account.ID, "reset-secret", true)

	// A newly authenticated reset-password session can perform the forced change.
	fresh := authTestLogin(t, s, account.Username, "reset-secret")
	other := authTestLogin(t, s, account.Username, "reset-secret")
	forcedActor := authTestActor(t, s, fresh)
	change = httptest.NewRecorder()
	s.withUser(s.password).ServeHTTP(change, authTestRequest("/api/password", `{"NewPassword":"chosen-password"}`, fresh))
	if change.Code != http.StatusOK {
		t.Fatal(change.Code, change.Body.String())
	}
	if authTestActor(t, s, fresh).MustChangePassword {
		t.Fatal("current session did not retain access after forced change")
	}
	if _, err := s.currentUser(authTestRequest("/api/state", "{}", other)); err == nil {
		t.Fatal("password change retained another device's session")
	}
	// The same session must not reuse a stale forced-change flag to skip verification.
	staleForced := httptest.NewRecorder()
	s.password(staleForced, authTestRequest("/api/password", `{"NewPassword":"skip-verification"}`, fresh), forcedActor)
	if staleForced.Code != http.StatusUnauthorized {
		t.Fatal("stale forced-change flag bypassed current password", staleForced.Code)
	}
	authTestPassword(t, s, account.ID, "chosen-password", false)
}

func TestAuthPasswordChangeKeepsOnlyRequestingSession(t *testing.T) {
	s, account, _ := authTestSetup(t)
	current := authTestLogin(t, s, account.Username, "old-password")
	other := authTestLogin(t, s, account.Username, "old-password")
	rec := httptest.NewRecorder()
	s.withUser(s.password).ServeHTTP(rec, authTestRequest("/api/password", `{"CurrentPassword":"old-password","NewPassword":"new-password"}`, current))
	if rec.Code != http.StatusOK {
		t.Fatal(rec.Code, rec.Body.String())
	}
	authTestActor(t, s, current)
	if _, err := s.currentUser(authTestRequest("/api/state", "{}", other)); err == nil {
		t.Fatal("other session survived password change")
	}
	authTestPassword(t, s, account.ID, "new-password", false)
}

func TestAuthPasswordWritesRollBackIfSessionRevocationFails(t *testing.T) {
	for _, action := range []string{"reset", "change"} {
		t.Run(action, func(t *testing.T) {
			s, account, adminCookie := authTestSetup(t)
			current := authTestLogin(t, s, account.Username, "old-password")
			other := authTestLogin(t, s, account.Username, "old-password")
			if _, err := s.db.Exec(`create trigger reject_revocation before delete on sessions begin select raise(abort,'revocation failed'); end`); err != nil {
				t.Fatal(err)
			}
			rec := httptest.NewRecorder()
			if action == "reset" {
				s.withUser(s.userPassword).ServeHTTP(rec, authTestRequest("/api/users/password", fmt.Sprintf(`{"UserID":%d,"Password":"new-password"}`, account.ID), adminCookie))
			} else {
				s.withUser(s.password).ServeHTTP(rec, authTestRequest("/api/password", `{"CurrentPassword":"old-password","NewPassword":"new-password"}`, current))
			}
			if rec.Code != http.StatusInternalServerError {
				t.Fatalf("revocation failure: %d %s", rec.Code, rec.Body.String())
			}
			authTestPassword(t, s, account.ID, "old-password", false)
			authTestActor(t, s, current)
			authTestActor(t, s, other)
		})
	}
}

func TestAuthConcurrentResetCannotBeOverwrittenByOldSession(t *testing.T) {
	s, account, adminCookie := authTestSetup(t)
	old := authTestLogin(t, s, account.Username, "old-password")
	actor := authTestActor(t, s, old)
	start := make(chan struct{})
	var wg sync.WaitGroup
	reset, change := httptest.NewRecorder(), httptest.NewRecorder()
	wg.Add(2)
	go func() {
		defer wg.Done()
		<-start
		s.withUser(s.userPassword).ServeHTTP(reset, authTestRequest("/api/users/password", fmt.Sprintf(`{"UserID":%d,"Password":"reset-wins"}`, account.ID), adminCookie))
	}()
	go func() {
		defer wg.Done()
		<-start
		s.password(change, authTestRequest("/api/password", `{"CurrentPassword":"old-password","NewPassword":"old-session-choice"}`, old), actor)
	}()
	close(start)
	wg.Wait()
	if reset.Code != http.StatusOK || (change.Code != http.StatusOK && change.Code != http.StatusUnauthorized) {
		t.Fatalf("reset=%d %s change=%d %s", reset.Code, reset.Body.String(), change.Code, change.Body.String())
	}
	authTestPassword(t, s, account.ID, "reset-wins", true)
	if _, err := s.currentUser(authTestRequest("/api/state", "{}", old)); err == nil {
		t.Fatal("old session survived concurrent reset")
	}
}

func TestAuthConcurrentLoginWithOldPasswordCannotSurviveReset(t *testing.T) {
	s, account, adminCookie := authTestSetup(t)
	start := make(chan struct{})
	var wg sync.WaitGroup
	reset, login := httptest.NewRecorder(), httptest.NewRecorder()
	wg.Add(2)
	go func() {
		defer wg.Done()
		<-start
		s.withUser(s.userPassword).ServeHTTP(reset, authTestRequest("/api/users/password", fmt.Sprintf(`{"UserID":%d,"Password":"reset-wins"}`, account.ID), adminCookie))
	}()
	go func() {
		defer wg.Done()
		<-start
		s.login(login, authTestRequest("/api/login", `{"Login":"authvictim","Password":"old-password"}`, nil))
	}()
	close(start)
	wg.Wait()
	if reset.Code != http.StatusOK || (login.Code != http.StatusOK && login.Code != http.StatusUnauthorized) {
		t.Fatalf("reset=%d %s login=%d %s", reset.Code, reset.Body.String(), login.Code, login.Body.String())
	}
	for _, cookie := range login.Result().Cookies() {
		if _, err := s.currentUser(authTestRequest("/api/state", "{}", cookie)); err == nil {
			t.Fatal("login with pre-reset credentials created a surviving session")
		}
	}
	authTestPassword(t, s, account.ID, "reset-wins", true)
}

func TestAuthBootstrapDeletionAndDemotionSurviveStartup(t *testing.T) {
	for _, action := range []string{"delete", "demote"} {
		t.Run(action, func(t *testing.T) {
			s := newTestServer(t)
			second, err := s.createUserAccount(accountInput{Username: "remainingadmin", Password: "private-password"}, true, false)
			if err != nil {
				t.Fatal(err)
			}
			rec := httptest.NewRecorder()
			if action == "delete" {
				s.userDelete(rec, httptest.NewRequest(http.MethodDelete, "/api/users", strings.NewReader(`{"UserID":1}`)), second)
			} else {
				s.userAdmin(rec, authTestRequest("/api/users/admin", `{"UserID":1,"IsAdmin":false}`, nil), second)
			}
			if rec.Code != http.StatusOK {
				t.Fatal(rec.Code, rec.Body.String())
			}
			for i := 0; i < 2; i++ {
				if err := s.seed(); err != nil {
					t.Fatal(err)
				}
				admin, err := s.bootstrapAdmin()
				if err != nil || admin.ID != second.ID || !admin.IsAdmin {
					t.Fatalf("remaining administrator not selected: %#v err=%v", admin, err)
				}
			}
			var bootstrapAdmins int
			if err := s.db.QueryRow("select count(*) from users where username=? and is_admin=1", defaultAdminUsername).Scan(&bootstrapAdmins); err != nil || bootstrapAdmins != 0 {
				t.Fatalf("startup restored bootstrap role/account: count=%d err=%v", bootstrapAdmins, err)
			}
			// Explicit test mode continues to use a real remaining administrator.
			state := httptest.NewRecorder()
			s.withUser(func(w http.ResponseWriter, _ *http.Request, u user) { jsonOut(w, u) }).ServeHTTP(state, httptest.NewRequest(http.MethodGet, "/api/state", nil))
			if state.Code != http.StatusOK || !strings.Contains(state.Body.String(), "remainingadmin") {
				t.Fatal(state.Code, state.Body.String())
			}
		})
	}
}

func TestAuthEstablishedInstallationWithoutAdminFailsClosed(t *testing.T) {
	s := newBareTestServer(t)
	if _, err := s.db.Exec("delete from users"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.bootstrapAdmin(); err == nil {
		t.Fatal("initialized empty database regained default credentials")
	}
	var count int
	if err := s.db.QueryRow("select count(*) from users").Scan(&count); err != nil || count != 0 {
		t.Fatalf("default account recreated: count=%d err=%v", count, err)
	}
}

func TestAuthLegacyExistingAdminDoesNotGainBootstrapAccount(t *testing.T) {
	s := newBareTestServer(t)
	other, err := s.createUserAccount(accountInput{Username: "legacyadmin", Password: "private-password"}, true, false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec("delete from users where id=1"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.cfg.Exec("delete from config where key='bootstrap_initialized'"); err != nil {
		t.Fatal(err)
	}
	admin, err := s.bootstrapAdmin()
	if err != nil || admin.ID != other.ID {
		t.Fatalf("legacy administrator: %#v err=%v", admin, err)
	}
	var count int
	if err := s.db.QueryRow("select count(*) from users").Scan(&count); err != nil || count != 1 {
		t.Fatalf("unexpected default account: count=%d err=%v", count, err)
	}
}
