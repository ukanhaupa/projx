// Package ratelimit is per-user / per-tenant in-process token-bucket limiting.
// IP-keyed limits live at the nginx edge; this package is opt-in per route.
package ratelimit

import (
	"context"
	"math"
	"net/http"
	"strconv"
	"sync"
	"time"

	"projx.local/go/internal/httputil"
	"projx.local/go/internal/requestid"
)

type ctxKey struct{}

func WithUserID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, ctxKey{}, id)
}

func UserIDFromContext(ctx context.Context) string {
	if v, ok := ctx.Value(ctxKey{}).(string); ok {
		return v
	}
	return ""
}

// KeyFunc returning "" skips limiting for that request.
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

func (l *limiter) allow(key string) (bool, float64, time.Duration) {
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
		retry := time.Duration((1-b.tokens)/l.refillPerSec*1000) * time.Millisecond
		return false, 0, retry
	}
	b.tokens--
	return true, b.tokens, 0
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
	limitStr := strconv.Itoa(opts.Capacity)

	return wrap(lim, opts.KeyFunc, onLimit, limitStr)
}

func wrap(lim *limiter, keyFunc func(r *http.Request) string, onLimit http.HandlerFunc, limitStr string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			lim.startCleanup()
			key := keyFunc(r)
			if key == "" {
				next.ServeHTTP(w, r)
				return
			}
			ok, remaining, retry := lim.allow(key)
			h := w.Header()
			h.Set("X-RateLimit-Limit", limitStr)
			h.Set("X-RateLimit-Remaining", strconv.Itoa(int(math.Floor(remaining))))
			if !ok {
				h.Set("Retry-After", strconv.Itoa(int(math.Ceil(retry.Seconds()))))
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

// PerUser keys on the user ID stored via WithUserID; chains after auth middleware.
// Defaults: 120 burst, 1 token/sec (60 req/min sustained).
func PerUser() func(http.Handler) http.Handler {
	return Middleware(Options{
		KeyFunc:      func(r *http.Request) string { return UserIDFromContext(r.Context()) },
		Capacity:     120,
		RefillPerSec: 1.0,
	})
}
