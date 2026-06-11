package main

import (
	"context"
	"errors"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"adminpanel/internal/audit"
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
		browser.NewSchema(pool),
		browser.NewRepo(pool),
		audit.NewLogger(pool),
	)
	if err != nil {
		return err
	}
	srv.SetCookieSecure(cfg.CookieSecure)

	httpServer := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	stopCtx, stop := signal.NotifyContext(ctx, syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	serverErr := make(chan error, 1)
	go func() {
		log.Printf("admin-panel listening on :%s (base path %q)", cfg.Port, cfg.BasePath)
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serverErr <- err
			return
		}
		serverErr <- nil
	}()

	select {
	case err := <-serverErr:
		return err
	case <-stopCtx.Done():
		log.Printf("shutdown signal received, draining (20s deadline)")
		srv.SetReadiness(false)
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		if err := httpServer.Shutdown(shutdownCtx); err != nil {
			return err
		}
		return nil
	}
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
	resp, err := client.Get("http://" + net.JoinHostPort("localhost", port) + base + "/healthz") // #nosec G107 -- localhost healthcheck from container PORT env
	if err != nil {
		return 1
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return 1
	}
	return 0
}
