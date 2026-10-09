package main

import (
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"regexp"
	"strings"
)

var avatarPattern = regexp.MustCompile(`^dino-v2:(pterosaur|trex|raptor|triceratops|stegosaurus|brachiosaurus|ankylosaurus|spinosaurus|parasaurolophus|pachycephalosaurus|carnotaurus|dilophosaurus|allosaurus|iguanodon|therizinosaurus|oviraptor|gallimimus|protoceratops|styracosaurus|kentrosaurus):[0-9a-f]{8}$`)
var errInvalidAvatar = errors.New("invalid dinosaur avatar")
var avatarSpecies = [...]string{"pterosaur", "trex", "raptor", "triceratops", "stegosaurus", "brachiosaurus", "ankylosaurus", "spinosaurus", "parasaurolophus", "pachycephalosaurus", "carnotaurus", "dilophosaurus", "allosaurus", "iguanodon", "therizinosaurus", "oviraptor", "gallimimus", "protoceratops", "styracosaurus", "kentrosaurus"}

// avatar creates a stable creator avatar for bootstrap and migration seeds.
func avatar(seed string) string {
	sum := sha256.Sum256([]byte(strings.ToLower(seed)))
	return "dino-v2:" + avatarSpecies[int(sum[0])%len(avatarSpecies)] + ":" + hex.EncodeToString(sum[1:5])
}

// ensureCreatorAvatars replaces obsolete identifiers while preserving valid choices.
func (s *server) ensureCreatorAvatars() error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	rs, err := tx.Query("select id,username,avatar from users")
	if err != nil {
		return err
	}
	type change struct {
		id    int64
		value string
	}
	var changes []change
	for rs.Next() {
		var id int64
		var username, value string
		if err := rs.Scan(&id, &username, &value); err != nil {
			rs.Close()
			return err
		}
		if !avatarPattern.MatchString(value) {
			changes = append(changes, change{id, avatar(username + ":" + value)})
		}
	}
	err = rs.Err()
	if closeErr := rs.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}
	for _, item := range changes {
		if _, err := tx.Exec("update users set avatar=? where id=?", item.value, item.id); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// accountAvatar accepts only generator parameters, never markup or remote URLs.
func accountAvatar(value string) (string, error) {
	if value != "" {
		if !avatarPattern.MatchString(value) {
			return "", errInvalidAvatar
		}
		return value, nil
	}
	var seed [5]byte
	if _, err := rand.Read(seed[:]); err != nil {
		return "", err
	}
	return "dino-v2:" + avatarSpecies[int(seed[0])%len(avatarSpecies)] + ":" + hex.EncodeToString(seed[1:]), nil
}

// availableAccountAvatar reserves motifs by species, regardless of framing seed.
// The caller inserts the account in the same transaction. The server's single
// database connection serializes concurrent registrations through commit.
func availableAccountAvatar(tx *sql.Tx, requested string) (string, error) {
	rs, err := tx.Query("select avatar from users")
	if err != nil {
		return "", err
	}
	used := make(map[string]bool, len(avatarSpecies))
	for rs.Next() {
		var value string
		if err := rs.Scan(&value); err != nil {
			rs.Close()
			return "", err
		}
		if avatarPattern.MatchString(value) {
			used[strings.Split(value, ":")[1]] = true
		}
	}
	err = rs.Err()
	if closeErr := rs.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return "", err
	}
	parts := strings.Split(requested, ":")
	if !used[parts[1]] || len(used) == len(avatarSpecies) {
		return requested, nil
	}
	available := make([]string, 0, len(avatarSpecies)-len(used))
	for _, species := range avatarSpecies {
		if !used[species] {
			available = append(available, species)
		}
	}
	var random [1]byte
	if _, err := rand.Read(random[:]); err != nil {
		return "", err
	}
	return "dino-v2:" + available[int(random[0])%len(available)] + ":" + parts[2], nil
}
