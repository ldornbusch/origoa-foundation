// Package testutil holds helpers shared by integration tests.
package testutil

import (
	"database/sql"
	"fmt"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	_ "github.com/lib/pq" // driver
)

var seq atomic.Int64

// DSN returns a connection string to a throwaway PostgreSQL schema, or
// skips the test when ORIGOA_TEST_DSN is not set.
func DSN(t testing.TB) string {
	t.Helper()
	dsn := os.Getenv("ORIGOA_TEST_DSN")
	if dsn == "" {
		t.Skip("ORIGOA_TEST_DSN not set; skipping PostgreSQL-backed test")
	}
	name := fmt.Sprintf("t_%d_%d_%d", time.Now().UnixNano(), os.Getpid(), seq.Add(1))
	admin, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := admin.Exec(`CREATE SCHEMA ` + name); err != nil {
		t.Fatalf("create test schema: %v", err)
	}
	t.Cleanup(func() {
		admin.Exec(`DROP SCHEMA ` + name + ` CASCADE`)
		admin.Close()
	})
	sep := "?"
	if strings.Contains(dsn, "?") {
		sep = "&"
	}
	return dsn + sep + "search_path=" + name + ",public"
}
