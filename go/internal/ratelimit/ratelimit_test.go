package ratelimit

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"projx.local/go/internal/requestid"
)

func nextHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
}

func newTestLimiter(capacity int, refillPerSec float64, now func() time.Time) *limiter {
	l := newLimiter(capacity, refillPerSec)
	l.now = now
	return l
}

func allowOK(l *limiter, key string) bool {
	ok, _, _ := l.allow(key)
	return ok
}

func TestAllowConsumesUntilEmpty(t *testing.T) {
	t.Parallel()
	clock := time.Unix(0, 0)
	l := newTestLimiter(3, 1, func() time.Time { return clock })

	require.True(t, allowOK(l, "u"))
	require.True(t, allowOK(l, "u"))
	require.True(t, allowOK(l, "u"))
	require.False(t, allowOK(l, "u"))
}

func TestRefillRestoresCapacity(t *testing.T) {
	t.Parallel()
	clock := time.Unix(0, 0)
	l := newTestLimiter(2, 1, func() time.Time { return clock })

	require.True(t, allowOK(l, "u"))
	require.True(t, allowOK(l, "u"))
	require.False(t, allowOK(l, "u"))

	clock = clock.Add(1100 * time.Millisecond)
	require.True(t, allowOK(l, "u"))
	require.False(t, allowOK(l, "u"))
}

func TestRefillDoesNotExceedCapacity(t *testing.T) {
	t.Parallel()
	clock := time.Unix(0, 0)
	l := newTestLimiter(2, 10, func() time.Time { return clock })

	require.True(t, allowOK(l, "u"))
	require.True(t, allowOK(l, "u"))
	require.False(t, allowOK(l, "u"))

	clock = clock.Add(10 * time.Second)
	require.True(t, allowOK(l, "u"))
	require.True(t, allowOK(l, "u"))
	require.False(t, allowOK(l, "u"))
}

func TestPerKeyIsolation(t *testing.T) {
	t.Parallel()
	clock := time.Unix(0, 0)
	l := newTestLimiter(1, 1, func() time.Time { return clock })

	require.True(t, allowOK(l, "alice"))
	require.False(t, allowOK(l, "alice"))
	require.True(t, allowOK(l, "bob"))
	require.False(t, allowOK(l, "bob"))
}

func TestMiddlewareSkipsEmptyKey(t *testing.T) {
	t.Parallel()
	calls := 0
	mw := Middleware(Options{
		KeyFunc:      func(*http.Request) string { return "" },
		Capacity:     1,
		RefillPerSec: 1,
	})
	h := mw(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls++
		w.WriteHeader(http.StatusOK)
	}))

	for i := 0; i < 5; i++ {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/", nil))
		require.Equal(t, http.StatusOK, w.Code)
	}
	require.Equal(t, 5, calls)
}

func TestMiddleware429EnvelopeOnLimit(t *testing.T) {
	t.Parallel()
	mw := Middleware(Options{
		KeyFunc:      func(*http.Request) string { return "u" },
		Capacity:     1,
		RefillPerSec: 0.001,
	})
	h := requestid.Middleware(mw(nextHandler()))

	w1 := httptest.NewRecorder()
	h.ServeHTTP(w1, httptest.NewRequest(http.MethodGet, "/", nil))
	require.Equal(t, http.StatusOK, w1.Code)
	require.Equal(t, "1", w1.Header().Get("X-RateLimit-Limit"))
	require.Equal(t, "0", w1.Header().Get("X-RateLimit-Remaining"))
	require.Equal(t, "", w1.Header().Get("Retry-After"))

	w2 := httptest.NewRecorder()
	req2 := httptest.NewRequest(http.MethodGet, "/", nil)
	req2.Header.Set(requestid.HeaderName, "rid-abc")
	h.ServeHTTP(w2, req2)
	require.Equal(t, http.StatusTooManyRequests, w2.Code)
	require.Equal(t, "application/json", w2.Header().Get("Content-Type"))
	require.Equal(t, "1", w2.Header().Get("X-RateLimit-Limit"))
	require.Equal(t, "0", w2.Header().Get("X-RateLimit-Remaining"))
	require.NotEmpty(t, w2.Header().Get("Retry-After"))

	var body map[string]string
	require.NoError(t, json.Unmarshal(w2.Body.Bytes(), &body))
	require.Equal(t, "rate limit exceeded", body["detail"])
	require.Equal(t, "rid-abc", body["request_id"])
}

func TestMiddlewareCustomOnLimit(t *testing.T) {
	t.Parallel()
	called := false
	mw := Middleware(Options{
		KeyFunc:      func(*http.Request) string { return "u" },
		Capacity:     1,
		RefillPerSec: 0.001,
		OnLimit: func(w http.ResponseWriter, _ *http.Request) {
			called = true
			w.WriteHeader(http.StatusServiceUnavailable)
		},
	})
	h := mw(nextHandler())

	w1 := httptest.NewRecorder()
	h.ServeHTTP(w1, httptest.NewRequest(http.MethodGet, "/", nil))
	require.Equal(t, http.StatusOK, w1.Code)

	w2 := httptest.NewRecorder()
	h.ServeHTTP(w2, httptest.NewRequest(http.MethodGet, "/", nil))
	require.True(t, called)
	require.Equal(t, http.StatusServiceUnavailable, w2.Code)
}

func TestMiddlewarePanicsOnBadOptions(t *testing.T) {
	t.Parallel()
	require.Panics(t, func() {
		Middleware(Options{Capacity: 1, RefillPerSec: 1})
	})
	require.Panics(t, func() {
		Middleware(Options{KeyFunc: func(*http.Request) string { return "x" }, Capacity: 0, RefillPerSec: 1})
	})
	require.Panics(t, func() {
		Middleware(Options{KeyFunc: func(*http.Request) string { return "x" }, Capacity: 1, RefillPerSec: 0})
	})
}

func TestPerUserKeysOnContextUserID(t *testing.T) {
	t.Parallel()
	mw := PerUser()

	hit := 0
	h := mw(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		hit++
		w.WriteHeader(http.StatusOK)
	}))

	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/", nil))
	require.Equal(t, http.StatusOK, w.Code)
	require.Equal(t, 1, hit)

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req = req.WithContext(WithUserID(req.Context(), "alice"))
	w2 := httptest.NewRecorder()
	h.ServeHTTP(w2, req)
	require.Equal(t, http.StatusOK, w2.Code)
}

func TestPerUserIsolatesUsersAndLimits(t *testing.T) {
	t.Parallel()
	mw := Middleware(Options{
		KeyFunc:      func(r *http.Request) string { return UserIDFromContext(r.Context()) },
		Capacity:     2,
		RefillPerSec: 0.001,
	})
	h := mw(nextHandler())

	send := func(uid string) int {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req = req.WithContext(WithUserID(req.Context(), uid))
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		return w.Code
	}

	require.Equal(t, http.StatusOK, send("alice"))
	require.Equal(t, http.StatusOK, send("alice"))
	require.Equal(t, http.StatusTooManyRequests, send("alice"))
	require.Equal(t, http.StatusOK, send("bob"))
	require.Equal(t, http.StatusOK, send("bob"))
	require.Equal(t, http.StatusTooManyRequests, send("bob"))
}

func TestUserIDFromContextMissing(t *testing.T) {
	t.Parallel()
	require.Equal(t, "", UserIDFromContext(t.Context()))
}

func TestSweepRemovesStaleBuckets(t *testing.T) {
	t.Parallel()
	clock := time.Unix(0, 0)
	l := newTestLimiter(1, 1, func() time.Time { return clock })
	l.cleanupTTL = 100 * time.Millisecond

	require.True(t, allowOK(l, "alice"))
	require.True(t, allowOK(l, "bob"))
	require.Len(t, l.buckets, 2)

	clock = clock.Add(200 * time.Millisecond)
	l.sweep()
	require.Len(t, l.buckets, 0)
}

func TestSweepKeepsFreshBuckets(t *testing.T) {
	t.Parallel()
	clock := time.Unix(0, 0)
	l := newTestLimiter(1, 1, func() time.Time { return clock })
	l.cleanupTTL = 1 * time.Second

	require.True(t, allowOK(l, "alice"))
	clock = clock.Add(500 * time.Millisecond)
	l.sweep()
	require.Len(t, l.buckets, 1)
}

func TestCleanupGoroutineStartsOnce(t *testing.T) {
	t.Parallel()
	l := newLimiter(1, 1)
	l.cleanupEvery = 10 * time.Millisecond
	l.cleanupTTL = 5 * time.Millisecond
	defer close(l.cleanupStop)

	l.startCleanup()
	l.startCleanup()
	_, _, _ = l.allow("alice")
	time.Sleep(50 * time.Millisecond)

	l.mu.RLock()
	n := len(l.buckets)
	l.mu.RUnlock()
	require.Equal(t, 0, n)
}

func TestConcurrentAllowSafe(t *testing.T) {
	t.Parallel()
	clock := time.Unix(0, 0)
	var mu sync.Mutex
	l := newTestLimiter(1000, 1, func() time.Time {
		mu.Lock()
		defer mu.Unlock()
		return clock
	})

	var wg sync.WaitGroup
	for i := 0; i < 200; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, _, _ = l.allow("shared")
		}()
	}
	wg.Wait()

	l.mu.RLock()
	b := l.buckets["shared"]
	l.mu.RUnlock()
	b.mu.Lock()
	defer b.mu.Unlock()
	require.InDelta(t, 800, b.tokens, 0.001)
}
