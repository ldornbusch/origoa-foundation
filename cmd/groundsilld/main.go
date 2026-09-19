// Command groundsilld serves Groundsill: a bare Git repository as
// the source of truth, a PostgreSQL projection for queries, the REST and
// WebSocket APIs, and (optionally) the built web client.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/thomdehoog/groundsill/internal/foundation"
	"github.com/thomdehoog/groundsill/internal/httpapi"
)

func main() {
	var (
		repo   = flag.String("repo", envOr("GROUNDSILL_REPO", "data/groundsill.git"), "path of the bare Git repository (created if missing)")
		branch = flag.String("branch", envOr("GROUNDSILL_BRANCH", "main"), "branch the Foundation owns")
		dsn    = flag.String("db", os.Getenv("GROUNDSILL_DB"), "PostgreSQL connection string (required), e.g. postgres://user:pass@localhost/groundsill?sslmode=disable")
		addr   = flag.String("addr", envOr("GROUNDSILL_ADDR", "127.0.0.1:8080"), "listen address")
		web    = flag.String("web", envOr("GROUNDSILL_WEB", "web/dist"), "directory with the built web client (empty to disable)")
		watch  = flag.Duration("watch", 3*time.Second, "how often to check for direct Git pushes")
	)
	flag.Parse()
	if *dsn == "" {
		fmt.Fprintln(os.Stderr, "groundsilld: -db (or GROUNDSILL_DB) is required: the PostgreSQL projection database")
		os.Exit(2)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	f, err := foundation.Open(ctx, *repo, *branch, *dsn)
	if err != nil {
		log.Fatalf("groundsilld: %v", err)
	}
	defer f.Close()
	if *watch > 0 {
		go f.Watch(ctx, *watch)
	}

	api := httpapi.New(f)
	mux := http.NewServeMux()
	mux.Handle("/api/", api)
	if *web != "" {
		if st, err := os.Stat(filepath.Join(*web, "index.html")); err == nil && !st.IsDir() {
			mux.Handle("/", spa(*web))
			log.Printf("groundsilld: serving web client from %s", *web)
		} else {
			log.Printf("groundsilld: no web client at %s (API only)", *web)
			mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
				http.Error(w, "Groundsill API: see /api/repository", http.StatusNotFound)
			})
		}
	}
	srv := &http.Server{
		Addr:              *addr,
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       60 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdown)
	}()
	log.Printf("groundsilld: repository %s (branch %s), listening on http://%s", *repo, *branch, *addr)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("groundsilld: %v", err)
	}
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// spa serves static files and falls back to index.html for client routes.
func spa(dir string) http.Handler {
	fs := http.FileServer(http.Dir(dir))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := filepath.Join(dir, filepath.Clean("/"+r.URL.Path))
		if st, err := os.Stat(p); err == nil && !st.IsDir() {
			if strings.HasSuffix(p, ".js") || strings.HasSuffix(p, ".css") {
				w.Header().Set("Cache-Control", "no-cache")
			}
			fs.ServeHTTP(w, r)
			return
		}
		w.Header().Set("Cache-Control", "no-cache")
		http.ServeFile(w, r, filepath.Join(dir, "index.html"))
	})
}
