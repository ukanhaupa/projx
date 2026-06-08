package main

import (
	"context"
	"errors"
	"log"
	"net"
	"net/http"
	"os"
	"time"

	"adminpanel/internal/auth"
	"adminpanel/internal/browser"
	"adminpanel/internal/config"
	"adminpanel/internal/db"
	"adminpanel/internal/web"
)

func main() {
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		os.Exit(healthcheck())
	}
	if err := run(); err != nil {
		log.Fatalf("admin-panel: %v", err)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	ctx := context.Background()
	pool, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()

	if err := db.Migrate(ctx, pool); err != nil {
		return err
	}

	store := auth.NewStore(pool)
	if err := store.EnsureBootstrap(ctx, cfg.BootstrapEmail, cfg.BootstrapPass); err != nil {
		return err
	}

	srv, err := web.NewServer(
		cfg.BasePath,
		store,
		browser.NewSchema(pool, cfg.BrowseSchema),
		browser.NewRepo(pool),
		browser.NewPerms(cfg.WriteTables),
	)
	if err != nil {
		return err
	}

	httpServer := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
	}
	log.Printf("admin-panel listening on :%s (base path %q)", cfg.Port, cfg.BasePath)
	if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

func healthcheck() int {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8055"
	}
	base := os.Getenv("BASE_PATH")
	if base == "" {
		base = "/admin"
	}
	if base == "/" {
		base = ""
	}
	client := http.Client{Timeout: 3 * time.Second}
	resp, err := client.Get("http://" + net.JoinHostPort("localhost", port) + base + "/healthz")
	if err != nil {
		return 1
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return 1
	}
	return 0
}
