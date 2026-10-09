package main

import (
	"database/sql"
	"errors"
	"net/http"
	"strings"
)

// users routes user-management requests by HTTP method.
func (s *server) users(w http.ResponseWriter, r *http.Request, u user) {
	switch r.Method {
	case http.MethodPost:
		s.userCreate(w, r, u)
	case http.MethodDelete:
		s.userDelete(w, r, u)
	default:
		http.Error(w, "method", 405)
	}
}

// userCreate lets admins create regular users or admins.
func (s *server) userCreate(w http.ResponseWriter, r *http.Request, u user) {
	if !u.IsAdmin {
		http.Error(w, "admin required", http.StatusForbidden)
		return
	}
	var in struct {
		Username   string
		Name       string
		Email      string
		Password   string
		Avatar     string
		BoardID    int64
		FullAccess bool
		IsAdmin    bool
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	if !in.IsAdmin && in.FullAccess {
		if in.BoardID < 0 {
			http.Error(w, "board id must not be negative", http.StatusBadRequest)
			return
		}
		if in.BoardID == 0 {
			in.BoardID = s.boardID(r, u)
		}
		if in.BoardID > 0 && !s.canAccessBoard(u, in.BoardID) {
			http.Error(w, "board not found", http.StatusNotFound)
			return
		}
	}
	created, err := s.createUserAccount(accountInput{
		Username: in.Username,
		Name:     in.Name,
		Email:    in.Email,
		Password: in.Password,
		Avatar:   in.Avatar,
	}, in.IsAdmin, true)
	if err != nil {
		accountCreationError(w, err)
		return
	}
	if in.IsAdmin {
		if err := s.grantUserAllBoards(created.ID); err != nil {
			accountCreationError(w, err)
			return
		}
	} else if in.FullAccess {
		if err := s.setBoardAccess(in.BoardID, created.ID, true); err != nil {
			accountCreationError(w, err)
			return
		}
	}
	jsonOut(w, map[string]any{"ok": true, "id": created.ID})
}

// userDelete removes a regular user and cleans related assignments.
func (s *server) userDelete(w http.ResponseWriter, r *http.Request, u user) {
	if r.Method != http.MethodDelete {
		http.Error(w, "method", 405)
		return
	}
	if !u.IsAdmin {
		http.Error(w, "admin required", http.StatusForbidden)
		return
	}
	var in struct{ UserID int64 }
	if !decodeJSON(w, r, &in) {
		return
	}
	if in.UserID <= 0 {
		http.Error(w, "user required", 400)
		return
	}
	if in.UserID == u.ID {
		http.Error(w, "you cannot delete your own account", 400)
		return
	}

	tx, err := s.db.Begin()
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	defer tx.Rollback()

	var target user
	err = scanUser(tx.QueryRow("select id,username,name,email,avatar,is_admin,must_change_password from users where id=?", in.UserID), &target)
	if errors.Is(err, sql.ErrNoRows) {
		http.Error(w, "user not found", 404)
		return
	}
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	if target.IsAdmin {
		var admins int
		if err := tx.QueryRow("select count(*) from users where is_admin=1").Scan(&admins); err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		if admins <= 1 {
			http.Error(w, "at least one admin is required", 400)
			return
		}
	}
	if _, err := tx.Exec(`insert into board_users(board_id,user_id,full_access)
		select id,?,1 from boards where owner_id=?
		on conflict(board_id,user_id) do update set full_access=1`, u.ID, in.UserID); err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	if _, err := tx.Exec("update boards set owner_id=? where owner_id=?", u.ID, in.UserID); err != nil {
		http.Error(w, err.Error(), 500)
		return
	}

	for _, stmt := range []string{
		"update tickets set assignee_id=0 where assignee_id=?",
		"delete from sessions where user_id=?",
		"delete from board_users where user_id=?",
		"delete from comments where user_id=?",
		"delete from notifications where user_id=?",
		"delete from ticket_activity where user_id=?",
		"delete from users where id=?",
	} {
		if _, err := tx.Exec(stmt, in.UserID); err != nil {
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

// userAdmin changes another user's global admin flag.
func (s *server) userAdmin(w http.ResponseWriter, r *http.Request, u user) {
	if r.Method != http.MethodPost {
		http.Error(w, "method", 405)
		return
	}
	if !u.IsAdmin {
		http.Error(w, "admin required", http.StatusForbidden)
		return
	}
	var in struct {
		UserID  int64
		IsAdmin bool
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	if in.UserID <= 0 {
		http.Error(w, "user required", 400)
		return
	}
	if in.UserID == u.ID && !in.IsAdmin {
		http.Error(w, "you cannot remove your own admin role", 400)
		return
	}
	if !in.IsAdmin {
		var admins int
		_ = s.db.QueryRow("select count(*) from users where is_admin=1").Scan(&admins)
		if admins <= 1 {
			http.Error(w, "at least one admin is required", 400)
			return
		}
	}
	admin := 0
	if in.IsAdmin {
		admin = 1
	}
	res, err := s.db.Exec("update users set is_admin=? where id=?", admin, in.UserID)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	if affected, _ := res.RowsAffected(); affected == 0 {
		http.Error(w, "user not found", 404)
		return
	}
	jsonOut(w, map[string]any{"ok": true})
}

// userPassword lets admins reset a user's password and force a change.
func (s *server) userPassword(w http.ResponseWriter, r *http.Request, u user) {
	if r.Method != http.MethodPost {
		http.Error(w, "method", 405)
		return
	}
	if !u.IsAdmin {
		http.Error(w, "admin required", http.StatusForbidden)
		return
	}
	var in struct {
		UserID   int64
		Password string
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	if in.UserID <= 0 || strings.TrimSpace(in.Password) == "" {
		http.Error(w, "user and password required", 400)
		return
	}
	h, err := hashPassword(in.Password)
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
	if _, err := s.passwordSession(tx, r, u.ID); err != nil {
		http.Error(w, "login required", http.StatusUnauthorized)
		return
	}
	var admin, mustChange int
	if err := tx.QueryRow("select is_admin,must_change_password from users where id=?", u.ID).Scan(&admin, &mustChange); err != nil || admin == 0 || (s.authMode != "test" && mustChange != 0) {
		http.Error(w, "admin required", http.StatusForbidden)
		return
	}
	res, err := tx.Exec("update users set password_hash=?,must_change_password=1 where id=?", h, in.UserID)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	if affected, _ := res.RowsAffected(); affected == 0 {
		http.Error(w, "user not found", 404)
		return
	}
	if _, err := tx.Exec("delete from sessions where user_id=?", in.UserID); err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	if err := tx.Commit(); err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	jsonOut(w, map[string]any{"ok": true})
}

// password lets the current user change their own password.
func (s *server) password(w http.ResponseWriter, r *http.Request, u user) {
	if r.Method != http.MethodPost {
		http.Error(w, "method", 405)
		return
	}
	var in struct {
		CurrentPassword string
		NewPassword     string
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	if strings.TrimSpace(in.NewPassword) == "" {
		http.Error(w, "new password required", 400)
		return
	}
	h, err := hashPassword(in.NewPassword)
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
	currentSession, err := s.passwordSession(tx, r, u.ID)
	if err != nil {
		http.Error(w, "login required", http.StatusUnauthorized)
		return
	}
	var currentHash string
	var mustChange int
	err = tx.QueryRow("select password_hash,must_change_password from users where id=?", u.ID).Scan(&currentHash, &mustChange)
	if errors.Is(err, sql.ErrNoRows) {
		http.Error(w, "login required", http.StatusUnauthorized)
		return
	}
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	if mustChange == 0 && !checkPassword(currentHash, in.CurrentPassword) {
		http.Error(w, "current password is invalid", http.StatusUnauthorized)
		return
	}
	_, err = tx.Exec("update users set password_hash=?,must_change_password=0 where id=?", h, u.ID)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	// Keep the requesting session for the frontend's immediate state reload;
	// invalidate every other device/session atomically with the password change.
	if _, err := tx.Exec("delete from sessions where user_id=? and token_hash<>?", u.ID, currentSession); err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	if err := tx.Commit(); err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	jsonOut(w, map[string]any{"ok": true})
}
