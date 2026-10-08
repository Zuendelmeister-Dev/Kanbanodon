package main

import (
	"context"
	"database/sql"
	"flag"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Run main in a separate process so the real one-shot exit path is exercised.
func TestDemoPreparationCLIHelperProcess(t *testing.T) {
	if os.Getenv("KANBANODON_DEMO_CLI_TEST_HELPER") != "1" {
		return
	}
	flag.CommandLine = flag.NewFlagSet("kanbanodon", flag.ExitOnError)
	os.Args = []string{"kanbanodon", "-prepare-demo-data"}
	main()
	os.Exit(0)
}

func TestDemoPreparationCLIExitsAndKeepsClearSeparateFromSeed(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("KANBANODON_DEMO_CLI_TEST_HELPER", "1")
	t.Setenv("KANBANODON_DATA_DIR", dir)
	t.Setenv("KANBANODON_RESET_DEMO_DATA", "false")
	// Accidentally starting HTTP would fail, rather than silently pass this test.
	t.Setenv("KANBANODON_ADDR", "not-an-address")
	run := func(clear, seed string) {
		t.Helper()
		t.Setenv("KANBANODON_CLEAR_TASK_DATA", clear)
		t.Setenv("KANBANODON_SEED_DEMO_DATA", seed)
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestDemoPreparationCLIHelperProcess$")
		output, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("one-shot clear=%s seed=%s failed: %v\n%s", clear, seed, err, output)
		}
		if !strings.Contains(string(output), "HTTP server was not started") {
			t.Fatalf("one-shot command did not report its completed exit: %s", output)
		}
	}
	checkCounts := func(tickets, backlog, sprintNames int) {
		t.Helper()
		db, err := sql.Open("sqlite", filepath.Join(dir, "app.db"))
		if err != nil {
			t.Fatal(err)
		}
		defer db.Close()
		for _, check := range []struct {
			query string
			want  int
		}{
			{"select count(*) from tickets", tickets},
			{"select count(*) from tickets where is_backlog=1", backlog},
			{"select count(*) from sprint_names", sprintNames},
			{"select count(*) from boards", 1},
			{"select count(*) from users where is_admin=1", 1},
		} {
			var got int
			if err := db.QueryRow(check.query).Scan(&got); err != nil || got != check.want {
				t.Fatalf("%s = %d, want %d: %v", check.query, got, check.want, err)
			}
		}
	}
	run("false", "true")
	checkCounts(27, 6, 7)
	run("false", "true")
	checkCounts(27, 6, 7)
	run("true", "false")
	checkCounts(0, 0, 0)
}
