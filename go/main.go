package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/joho/godotenv"

	"projx.local/go/internal/apperr"
	"projx.local/go/internal/audit"
	"projx.local/go/internal/auth"
	"projx.local/go/internal/cors"
	"projx.local/go/internal/db"
	"projx.local/go/internal/entities"
	"projx.local/go/internal/envutil"
	"projx.local/go/internal/health"
	"projx.local/go/internal/logging"
	"projx.local/go/internal/requestid"
	"projx.local/go/internal/serviceconfig"
	syncmeta "projx.local/go/internal/sync"

	// projx-anchor: imports

	"projx.local/go/internal/posts"
	// projx-anchor: entity-imports
)

const defaultPort = "8080"

func main() {
	if _, err := os.Stat(".env"); err == nil {
		if err := godotenv.Load(); err != nil {
			slog.Error(".env present but failed to load", "error", err)
			os.Exit(1)
		}
	}

	logger := logging.New()
	slog.SetDefault(logger)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	gdb := db.MustOpen(ctx)
	if err := gdb.AutoMigrate(&posts.Post{}, &serviceconfig.ServiceConfig{}, &audit.AuditLog{}); err != nil {
		logger.Error("automigrate failed", "error", err)
		os.Exit(1)
	}

	configSvc, err := serviceconfig.NewService(gdb)
	if err != nil {
		logger.Error("service_config init failed", "error", err)
		os.Exit(1)
	}
	_ = configSvc

	var jwtVerifier *auth.Verifier
	if os.Getenv("JWT_PROVIDER") != "" || os.Getenv("JWT_SECRET") != "" || os.Getenv("JWT_JWKS_URL") != "" {
		v, err := auth.NewVerifierFromEnv()
		if err != nil {
			logger.Error("jwt verifier init failed", "error", err)
			os.Exit(1)
		}
		jwtVerifier = v
	}
	_ = jwtVerifier

	entities.Register(posts.Config())
	// projx-anchor: entity-registrations

	r := chi.NewRouter()
	r.Use(requestid.Middleware)
	r.Use(logging.Middleware(logger))
	r.Use(cors.DefaultMiddleware())
	r.Use(apperr.Recoverer)
	// projx-anchor: plugins

	r.Mount("/", health.Routes(gdb))
	r.Mount("/api/v1/_meta", syncmeta.Routes(gdb))
	for _, cfg := range entities.All() {
		entities.MountEntity(r, gdb, cfg)
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = defaultPort
	}
	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      r,
		ReadTimeout:  time.Duration(envutil.Int("READ_TIMEOUT_SEC", 15)) * time.Second,
		WriteTimeout: time.Duration(envutil.Int("WRITE_TIMEOUT_SEC", 30)) * time.Second,
		IdleTimeout:  time.Duration(envutil.Int("IDLE_TIMEOUT_SEC", 60)) * time.Second,
	}

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		logger.Info("server listening", "port", port)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("server crashed", "error", err)
			os.Exit(1)
		}
	}()

	<-stop
	logger.Info("shutting down")
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), time.Duration(envutil.Int("SHUTDOWN_TIMEOUT_SEC", 30))*time.Second)
	defer shutdownCancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		logger.Error("graceful shutdown failed", "error", err)
		os.Exit(1)
	}
}
