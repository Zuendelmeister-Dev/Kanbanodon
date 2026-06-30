package main

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"net/http"
	"strings"
	"time"
)

var errInvalidAccount = errors.New("username and password required")

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
	if exp < now() {
		return user{}, errors.New("expired")
	}
	var u user
	err = scanUser(s.db.QueryRow("select id,username,name,email,avatar,is_admin,must_change_password from users where id=?", uid), &u)
	return u, err
}

// setSession creates and stores a long-lived login cookie for a user.
func (s *server) setSession(w http.ResponseWriter, uid int64) {
	t := token(32)
	exp := time.Now().Add(30 * 24 * time.Hour).UTC()
	_, _ = s.db.Exec("insert into sessions(token_hash,user_id,expires_at) values(?,?,?)", tokenHash(t, s.secret), uid, exp.Format(time.RFC3339))
	http.SetCookie(w, &http.Cookie{Name: "kanbanodon_session", Value: t, Path: "/", Expires: exp, HttpOnly: true, SameSite: http.SameSiteLaxMode})
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
	if s.db.QueryRow("select id,password_hash from users where lower(username)=? or lower(email)=?", login, login).Scan(&id, &h) != nil || !checkPassword(h, in.Password) {
		http.Error(w, "invalid login", 401)
		return
	}
	s.setSession(w, id)
	jsonOut(w, map[string]any{"ok": true})
}

// signup creates a regular user account when open registration is enabled.
func (s *server) signup(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" || !s.allowSignup {
		http.Error(w, "signup disabled", 403)
		return
	}
	var in accountInput
	if !decodeJSON(w, r, &in) {
		return
	}
	created, err := s.createUserAccount(in, false, false)
	if err != nil {
		if errors.Is(err, errInvalidAccount) {
			http.Error(w, err.Error(), 400)
			return
		}
		http.Error(w, err.Error(), 400)
		return
	}
	s.setSession(w, created.ID)
	jsonOut(w, map[string]any{"ok": true})
}

// createUserAccount normalizes input, hashes the password, and inserts a user.
func (s *server) createUserAccount(in accountInput, isAdmin, mustChangePassword bool) (user, error) {
	username, name, email := normalizeAccount(in)
	if strings.TrimSpace(in.Password) == "" || username == "" || username == defaultAdminUsername {
		return user{}, errInvalidAccount
	}
	h, err := hashPassword(in.Password)
	if err != nil {
		return user{}, err
	}
	admin := 0
	if isAdmin {
		admin = 1
	}
	must := 0
	if mustChangePassword {
		must = 1
	}
	res, err := s.db.Exec("insert into users(username,name,email,password_hash,avatar,is_admin,must_change_password,created_at) values(?,?,?,?,?,?,?,?)", username, name, email, h, avatar(username), admin, must, now())
	if err != nil {
		return user{}, err
	}
	id, _ := res.LastInsertId()
	return user{ID: id, Username: username, Name: name, Email: email, Avatar: avatar(username), IsAdmin: isAdmin, MustChangePassword: mustChangePassword}, nil
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

// avatar deterministically assigns one dinosaur avatar template to a seed.
func avatar(seed string) string {
	templates := []string{
		"trex-stride", "trex-roar", "raptor", "allosaurus", "triceratops",
		"triceratops-heavy", "styracosaurus", "stegosaurus", "kentrosaurus", "ankylosaurus",
		"brontosaurus", "brachiosaurus", "spinosaurus", "parasaurolophus", "iguanodon",
		"pachycephalosaurus", "gallimimus", "pterosaur-wide", "pterosaur-dive", "dimetrodon",
	}
	sum := sha256.Sum256([]byte(strings.ToLower(seed)))
	return templates[int(sum[0])%len(templates)]
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
	if len(p) != 3 {
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
