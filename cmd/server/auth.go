package main

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"log"
	"net/http"
	"strings"
	"time"

	"modernc.org/sqlite"
	sqlite3 "modernc.org/sqlite/lib"
)

var errInvalidAccount = errors.New("username and password required")
var errSessionPersistence = errors.New("could not open session")
var errUsernameTaken = errors.New("username is already taken")

// withUser authenticates requests and passes the current user to API handlers.
func (s *server) withUser(next func(http.ResponseWriter, *http.Request, user)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if s.authMode == "test" {
			u, err := s.bootstrapAdmin()
			if err != nil {
				http.Error(w, err.Error(), 500)
				return
			}
			next(w, r, u)
			return
		}
		u, err := s.currentUser(r)
		if err != nil {
			http.Error(w, "login required", 401)
			return
		}
		if u.MustChangePassword && r.URL.Path != "/api/state" && r.URL.Path != "/api/password" && r.URL.Path != "/api/logout" {
			http.Error(w, "password change required", http.StatusForbidden)
			return
		}
		next(w, r, u)
	}
}

// currentUser resolves the session cookie into the persisted user record.
func (s *server) currentUser(r *http.Request) (user, error) {
	c, err := r.Cookie("kanbanodon_session")
	if err != nil {
		return user{}, err
	}
	var uid int64
	var exp string
	if err := s.db.QueryRow("select user_id,expires_at from sessions where token_hash=?", tokenHash(c.Value, s.secret)).Scan(&uid, &exp); err != nil {
		return user{}, err
	}
	expiresAt, err := time.Parse(time.RFC3339, exp)
	if err != nil || !expiresAt.After(time.Now().UTC()) {
		_, _ = s.db.Exec("delete from sessions where token_hash=?", tokenHash(c.Value, s.secret))
		return user{}, errors.New("expired")
	}
	var u user
	err = scanUser(s.db.QueryRow("select id,username,name,email,avatar,is_admin,must_change_password from users where id=?", uid), &u)
	return u, err
}

// insertSession persists a session within the caller's account/credential transaction.
func (s *server) insertSession(tx *sql.Tx, uid int64) (*http.Cookie, error) {
	var random [32]byte
	if _, err := rand.Read(random[:]); err != nil {
		return nil, err
	}
	t := base64.RawURLEncoding.EncodeToString(random[:])
	exp := time.Now().Add(30 * 24 * time.Hour).UTC()
	if _, err := tx.Exec("insert into sessions(token_hash,user_id,expires_at) values(?,?,?)", tokenHash(t, s.secret), uid, exp.Format(time.RFC3339)); err != nil {
		return nil, err
	}
	return &http.Cookie{Name: "kanbanodon_session", Value: t, Path: "/", Expires: exp, HttpOnly: true, SameSite: http.SameSiteLaxMode}, nil
}

// setSession publishes the cookie only after successful session persistence.
func (s *server) setSession(w http.ResponseWriter, uid int64) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	cookie, err := s.insertSession(tx, uid)
	if err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	http.SetCookie(w, cookie)
	return nil
}

// login validates username or legacy email credentials and opens a session.
func (s *server) login(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "method", 405)
		return
	}
	var in struct{ Login, Email, Password string }
	if !decodeJSON(w, r, &in) {
		return
	}
	login := strings.ToLower(strings.TrimSpace(in.Login))
	if login == "" {
		login = strings.ToLower(strings.TrimSpace(in.Email))
	}
	var id int64
	var h string
	// Keep credential validation and session insertion together: a password reset
	// cannot revoke existing sessions and then have an old login insert a new one.
	tx, err := s.db.Begin()
	if err != nil {
		http.Error(w, "could not open session", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()
	err = tx.QueryRow("select id,password_hash from users where lower(username)=? or lower(email)=?", login, login).Scan(&id, &h)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		http.Error(w, "could not open session", http.StatusInternalServerError)
		return
	}
	if err != nil || !checkPassword(h, in.Password) {
		http.Error(w, "invalid login", 401)
		return
	}
	cookie, err := s.insertSession(tx, id)
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		http.Error(w, "could not open session", http.StatusInternalServerError)
		return
	}
	http.SetCookie(w, cookie)
	jsonOut(w, map[string]any{"ok": true})
}

// signup creates a regular user account when open registration is enabled.
func (s *server) signup(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method", http.StatusMethodNotAllowed)
		return
	}
	if !s.allowSignup {
		http.Error(w, "signup disabled", 403)
		return
	}
	var in accountInput
	if !decodeJSON(w, r, &in) {
		return
	}
	_, cookie, err := s.createAccount(in, false, false, true)
	if err != nil {
		accountCreationError(w, err)
		return
	}
	http.SetCookie(w, cookie)
	jsonOut(w, map[string]any{"ok": true})
}

// Account forms receive useful validation feedback, never database diagnostics.
func accountCreationError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, errInvalidAccount):
		http.Error(w, "Enter a username and password.", http.StatusBadRequest)
	case errors.Is(err, errInvalidAvatar):
		http.Error(w, "Avatar is not valid.", http.StatusBadRequest)
	case errors.Is(err, errUsernameTaken):
		log.Printf("Kanbanodon account creation rejected: %v", err)
		http.Error(w, "Username is already taken.", http.StatusBadRequest)
	default:
		log.Printf("Kanbanodon account creation failed: %v", err)
		http.Error(w, "Account could not be created. Please try again.", http.StatusInternalServerError)
	}
}

// createUserAccount normalizes input, hashes the password, and inserts a user.
func (s *server) createUserAccount(in accountInput, isAdmin, mustChangePassword bool) (user, error) {
	created, _, err := s.createAccount(in, isAdmin, mustChangePassword, false)
	return created, err
}

// createAccount optionally commits the signup session with the account itself.
// No cookie is published until both writes have committed successfully.
func (s *server) createAccount(in accountInput, isAdmin, mustChangePassword, withSession bool) (user, *http.Cookie, error) {
	username, name, email := normalizeAccount(in)
	if strings.TrimSpace(in.Password) == "" || username == "" || username == defaultAdminUsername {
		return user{}, nil, errInvalidAccount
	}
	selectedAvatar, err := accountAvatar(in.Avatar)
	if err != nil {
		return user{}, nil, err
	}
	h, err := hashPassword(in.Password)
	if err != nil {
		return user{}, nil, err
	}
	admin := 0
	if isAdmin {
		admin = 1
	}
	must := 0
	if mustChangePassword {
		must = 1
	}
	tx, err := s.db.Begin()
	if err != nil {
		return user{}, nil, err
	}
	defer tx.Rollback()
	selectedAvatar, err = availableAccountAvatar(tx, selectedAvatar)
	if err != nil {
		return user{}, nil, err
	}
	res, err := tx.Exec("insert into users(username,name,email,password_hash,avatar,is_admin,must_change_password,created_at) values(?,?,?,?,?,?,?,?)", username, name, email, h, selectedAvatar, admin, must, now())
	if err != nil {
		var sqliteErr *sqlite.Error
		if errors.As(err, &sqliteErr) && sqliteErr.Code() == sqlite3.SQLITE_CONSTRAINT_UNIQUE {
			// Both username and internal email are unique. Identify the actual
			// username collision from stored data rather than parsing SQL text.
			var count int
			if lookupErr := tx.QueryRow("select count(*) from users where username=?", username).Scan(&count); lookupErr != nil {
				return user{}, nil, errors.Join(err, lookupErr)
			}
			if count > 0 {
				return user{}, nil, errors.Join(errUsernameTaken, err)
			}
		}
		return user{}, nil, err
	}
	id, _ := res.LastInsertId()
	var cookie *http.Cookie
	if withSession {
		cookie, err = s.insertSession(tx, id)
		if err != nil {
			return user{}, nil, errors.Join(errSessionPersistence, err)
		}
	}
	if err := tx.Commit(); err != nil {
		if withSession {
			return user{}, nil, errors.Join(errSessionPersistence, err)
		}
		return user{}, nil, err
	}
	return user{ID: id, Username: username, Name: name, Email: email, Avatar: selectedAvatar, IsAdmin: isAdmin, MustChangePassword: mustChangePassword}, cookie, nil
}

// passwordSession checks the session again within a password writer transaction.
// Middleware authentication alone can be stale after a concurrent reset.
func (s *server) passwordSession(tx *sql.Tx, r *http.Request, uid int64) (string, error) {
	if s.authMode == "test" {
		return "", nil
	}
	cookie, err := r.Cookie("kanbanodon_session")
	if err != nil {
		return "", err
	}
	hash := tokenHash(cookie.Value, s.secret)
	var storedID int64
	var expires string
	if err := tx.QueryRow("select user_id,expires_at from sessions where token_hash=?", hash).Scan(&storedID, &expires); err != nil {
		return "", err
	}
	expiresAt, err := time.Parse(time.RFC3339, expires)
	if err != nil || storedID != uid || !expiresAt.After(time.Now().UTC()) {
		return "", errors.New("invalid session")
	}
	return hash, nil
}

// normalizeAccount derives the stored username, display name, and internal email.
func normalizeAccount(in accountInput) (username, name, email string) {
	username = cleanUsername(in.Username)
	legacyEmail := strings.ToLower(strings.TrimSpace(in.Email))
	if username == "" && legacyEmail != "" {
		username = cleanUsername(strings.Split(legacyEmail, "@")[0])
	}
	name = def(in.Name, username)
	email = internalUserEmail(username)
	return username, name, email
}

// internalUserEmail creates a placeholder email because Kanbanodon does not send mail.
func internalUserEmail(username string) string {
	return cleanUsername(username) + "@users.kanbanodon.local"
}

// logout removes the current session and clears the login cookie.
func (s *server) logout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method", http.StatusMethodNotAllowed)
		return
	}
	if c, err := r.Cookie("kanbanodon_session"); err == nil {
		_, _ = s.db.Exec("delete from sessions where token_hash=?", tokenHash(c.Value, s.secret))
	}
	http.SetCookie(w, &http.Cookie{Name: "kanbanodon_session", Value: "", Path: "/", MaxAge: -1, HttpOnly: true})
	jsonOut(w, map[string]any{"ok": true})
}

// token returns a URL-safe random token string.
func token(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

// tokenHash signs a session token so only hashes are stored in the database.
func tokenHash(t string, sec []byte) string {
	mac := hmac.New(sha256.New, sec)
	mac.Write([]byte(t))
	return hex.EncodeToString(mac.Sum(nil))
}

// hashPassword stores passwords as salted, versioned hashes.
func hashPassword(pw string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	sum := kdf(pw, salt)
	return "v1$" + hex.EncodeToString(salt) + "$" + hex.EncodeToString(sum), nil
}

// checkPassword compares a plaintext password with a stored password hash.
func checkPassword(enc, pw string) bool {
	p := strings.Split(enc, "$")
	if len(p) != 3 || p[0] != "v1" {
		return false
	}
	salt, err := hex.DecodeString(p[1])
	if err != nil {
		return false
	}
	want, err := hex.DecodeString(p[2])
	if err != nil {
		return false
	}
	got := kdf(pw, salt)
	return subtle.ConstantTimeCompare(got, want) == 1
}

// kdf stretches a password and salt with repeated HMAC-SHA256 rounds.
func kdf(pw string, salt []byte) []byte {
	key := []byte(pw)
	for i := 0; i < 120000; i++ {
		mac := hmac.New(sha256.New, key)
		mac.Write(salt)
		mac.Write([]byte(pw))
		key = mac.Sum(nil)
	}
	return key
}
