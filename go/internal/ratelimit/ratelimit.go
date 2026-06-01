// Package ratelimit provides an in-process token-bucket rate limiter keyed by
// an extractable identity (typically AuthUser.ID) — never by IP.
//
// IP-keyed rate limits belong at the edge proxy (nginx). This package exists
// only for per-user / per-tenant business limits that require JWT/body
// inspection the proxy cannot do. Mount per-route (opt-in) on sensitive
// endpoints (e.g., login, signup, password reset); never globally.
package ratelimit

import (
	"context"
	"net/http"
	"sync"
	"time"

	"projx.local/go/internal/httputil"
	"projx.local/go/internal/requestid"
)

type ctxKey struct{}

// WithUserID returns a new context carrying the user ID for PerUser keying.
// The auth feature middleware is expected to call this after JWT verification.
func WithUserID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, ctxKey{}, id)
}

// UserIDFromContext returns the user ID previously stored via WithUserID,
// or "" if absent.
func UserIDFromContext(ctx context.Context) string {
	if v, ok := ctx.Value(ctxKey{}).(string); ok {
		return v
	}
	return ""
}

// Options configures a Middleware.
//
// KeyFunc returns the identity to key the bucket on; returning "" skips
// limiting for that request. Capacity is the max burst; RefillPerSec is the
// steady-state rate. OnLimit overrides the 429 response if set.
type Options struct {
	KeyFunc      func(r *http.Request) string
	Capacity     int
	RefillPerSec float64
	OnLimit      http.HandlerFunc
}

type bucket struct {
	mu       sync.Mutex
	tokens   float64
	lastSeen time.Time
}

type limiter struct {
	capacity     float64
	refillPerSec float64
	now          func() time.Time

	mu      sync.RWMutex
	buckets map[string]*bucket

	cleanupOnce  sync.Once
	cleanupStop  chan struct{}
	cleanupEvery time.Duration
	cleanupTTL   time.Duration
}

func newLimiter(capacity int, refillPerSec float64) *limiter {
	return &limiter{
		capacity:     float64(capacity),
		refillPerSec: refillPerSec,
		now:          time.Now,
		buckets:      make(map[string]*bucket),
		cleanupStop:  make(chan struct{}),
		cleanupEvery: 5 * time.Minute,
		cleanupTTL:   5 * time.Minute,
	}
}

func (l *limiter) allow(key string) bool {
	l.mu.RLock()
	b, ok := l.buckets[key]
	l.mu.RUnlock()
	if !ok {
		l.mu.Lock()
		if b, ok = l.buckets[key]; !ok {
			b = &bucket{tokens: l.capacity, lastSeen: l.now()}
			l.buckets[key] = b
		}
		l.mu.Unlock()
	}

	b.mu.Lock()
	defer b.mu.Unlock()

	now := l.now()
	elapsed := now.Sub(b.lastSeen).Seconds()
	if elapsed > 0 {
		b.tokens += elapsed * l.refillPerSec
		if b.tokens > l.capacity {
			b.tokens = l.capacity
		}
	}
	b.lastSeen = now

	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}

func (l *limiter) sweep() {
	cutoff := l.now().Add(-l.cleanupTTL)
	l.mu.Lock()
	defer l.mu.Unlock()
	for k, b := range l.buckets {
		b.mu.Lock()
		stale := b.lastSeen.Before(cutoff)
		b.mu.Unlock()
		if stale {
			delete(l.buckets, k)
		}
	}
}

func (l *limiter) startCleanup() {
	l.cleanupOnce.Do(func() {
		go func() {
			t := time.NewTicker(l.cleanupEvery)
			defer t.Stop()
			for {
				select {
				case <-l.cleanupStop:
					return
				case <-t.C:
					l.sweep()
				}
			}
		}()
	})
}

// Middleware returns an http middleware that enforces the token-bucket policy
// described by opts. Cleanup of stale buckets runs lazily on first use.
func Middleware(opts Options) func(http.Handler) http.Handler {
	if opts.KeyFunc == nil {
		panic("ratelimit: KeyFunc is required")
	}
	if opts.Capacity <= 0 {
		panic("ratelimit: Capacity must be > 0")
	}
	if opts.RefillPerSec <= 0 {
		panic("ratelimit: RefillPerSec must be > 0")
	}

	lim := newLimiter(opts.Capacity, opts.RefillPerSec)
	onLimit := opts.OnLimit
	if onLimit == nil {
		onLimit = defaultOnLimit
	}

	return wrap(lim, opts.KeyFunc, onLimit)
}

func wrap(lim *limiter, keyFunc func(r *http.Request) string, onLimit http.HandlerFunc) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			lim.startCleanup()
			key := keyFunc(r)
			if key == "" {
				next.ServeHTTP(w, r)
				return
			}
			if !lim.allow(key) {
				onLimit(w, r)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func defaultOnLimit(w http.ResponseWriter, r *http.Request) {
	rid := requestid.FromContext(r.Context())
	_ = httputil.WriteJSON(w, http.StatusTooManyRequests, map[string]string{
		"detail":     "rate limit exceeded",
		"request_id": rid,
	})
}

// PerUser returns a middleware keyed by the user ID stored in the request
// context via WithUserID. Requests without a user ID skip the limit — the
// caller is expected to chain this after the auth middleware, which is what
// makes it useful only on authenticated routes.
//
// Defaults: 120 burst capacity, 1 token/sec refill (60 req/min sustained).
// Construct via Middleware directly to override.
func PerUser() func(http.Handler) http.Handler {
	return Middleware(Options{
		KeyFunc:      func(r *http.Request) string { return UserIDFromContext(r.Context()) },
		Capacity:     120,
		RefillPerSec: 1.0,
	})
}
