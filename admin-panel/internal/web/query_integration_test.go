package web

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

func queryPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	pool := testPool(t)
	ctx := context.Background()
	for _, stmt := range []string{
		`DROP TABLE IF EXISTS public.orders`,
		`DROP TABLE IF EXISTS public.customers`,
		`CREATE TABLE public.customers (
			id   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
			name TEXT NOT NULL,
			tier TEXT NOT NULL
		)`,
		`CREATE TABLE public.orders (
			id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
			customer_id BIGINT NOT NULL REFERENCES public.customers(id),
			amount      NUMERIC NOT NULL,
			created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`,
		`INSERT INTO public.customers (name, tier) VALUES
		  ('Alpha Industries','gold'),
		  ('Beta Co','silver'),
		  ('Gamma Ltd','gold'),
		  ('Delta Inc','bronze')`,
		`INSERT INTO public.orders (customer_id, amount) VALUES (1, 100), (1, 200), (2, 50), (3, 9999)`,
	} {
		if _, err := pool.Exec(ctx, stmt); err != nil {
			t.Fatalf("seed %q: %v", stmt, err)
		}
	}
	t.Cleanup(func() {
		c := context.Background()
		_, _ = pool.Exec(c, `DROP TABLE IF EXISTS public.orders`)
		_, _ = pool.Exec(c, `DROP TABLE IF EXISTS public.customers`)
	})
	return pool
}

func TestSearchFiltersTextColumns(t *testing.T) {
	pool := queryPool(t)
	h := newTestServer(t, pool).Handler()
	token := login(t, h, "admin@example.com", "s3cret-pass")

	body := authedGet(h, "/admin/tables/customers?q=alpha", token).Body.String()
	if !strings.Contains(body, "Alpha Industries") {
		t.Error("search for 'alpha' should return Alpha Industries")
	}
	if strings.Contains(body, "Beta Co") {
		t.Error("search for 'alpha' should not return Beta Co")
	}
}

func TestFilterEqualOperator(t *testing.T) {
	pool := queryPool(t)
	h := newTestServer(t, pool).Handler()
	token := login(t, h, "admin@example.com", "s3cret-pass")

	body := authedGet(h, "/admin/tables/customers?f.tier.eq=gold", token).Body.String()
	if !strings.Contains(body, "Alpha Industries") || !strings.Contains(body, "Gamma Ltd") {
		t.Error("expected both gold-tier customers")
	}
	if strings.Contains(body, "Beta Co") || strings.Contains(body, "Delta Inc") {
		t.Error("non-gold customers should be filtered out")
	}
}

func TestFilterGreaterThan(t *testing.T) {
	pool := queryPool(t)
	h := newTestServer(t, pool).Handler()
	token := login(t, h, "admin@example.com", "s3cret-pass")

	body := authedGet(h, "/admin/tables/orders?f.amount.gt=500", token).Body.String()
	if !strings.Contains(body, "9999") {
		t.Error("expected the 9999 order in amount > 500 results")
	}
	if strings.Contains(body, "100") {
		t.Error("100 should not match amount > 500")
	}
}

func TestFilterIsNull(t *testing.T) {
	pool := queryPool(t)
	h := newTestServer(t, pool).Handler()
	token := login(t, h, "admin@example.com", "s3cret-pass")

	body := authedGet(h, "/admin/tables/customers?f.tier.is_null=1", token).Body.String()
	if !strings.Contains(body, "No rows") {
		t.Error("is_null on non-null column should yield 0 rows")
	}
}

func TestSortDescendingByColumn(t *testing.T) {
	pool := queryPool(t)
	h := newTestServer(t, pool).Handler()
	token := login(t, h, "admin@example.com", "s3cret-pass")

	body := authedGet(h, "/admin/tables/customers?sort=-name", token).Body.String()
	gIdx := strings.Index(body, "Gamma Ltd")
	aIdx := strings.Index(body, "Alpha Industries")
	if gIdx < 0 || aIdx < 0 || gIdx > aIdx {
		t.Errorf("expected Gamma to appear before Alpha when sorted desc by name; gamma_idx=%d alpha_idx=%d", gIdx, aIdx)
	}
}

func TestUnknownSortColumnRejected(t *testing.T) {
	pool := queryPool(t)
	h := newTestServer(t, pool).Handler()
	token := login(t, h, "admin@example.com", "s3cret-pass")

	rec := authedGet(h, "/admin/tables/customers?sort=injected_col", token)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("unknown sort column should be 400, got %d", rec.Code)
	}
}

func TestUnknownFilterColumnRejected(t *testing.T) {
	pool := queryPool(t)
	h := newTestServer(t, pool).Handler()
	token := login(t, h, "admin@example.com", "s3cret-pass")

	rec := authedGet(h, "/admin/tables/customers?f.bogus.eq=value", token)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("unknown filter column should be 400, got %d", rec.Code)
	}
}

func TestTotalCountReflectsFilters(t *testing.T) {
	pool := queryPool(t)
	h := newTestServer(t, pool).Handler()
	token := login(t, h, "admin@example.com", "s3cret-pass")

	body := authedGet(h, "/admin/tables/customers", token).Body.String()
	if !strings.Contains(body, "4 rows") {
		t.Error("expected '4 rows' total for unfiltered customers")
	}
	body = authedGet(h, "/admin/tables/customers?f.tier.eq=gold", token).Body.String()
	if !strings.Contains(body, "2 rows") {
		t.Error("expected '2 rows' total for tier=gold")
	}
}

func TestForeignKeyRendersAsLink(t *testing.T) {
	pool := queryPool(t)
	h := newTestServer(t, pool).Handler()
	token := login(t, h, "admin@example.com", "s3cret-pass")

	body := authedGet(h, "/admin/tables/orders", token).Body.String()
	if !strings.Contains(body, `class="fk-link"`) {
		t.Error("expected FK link styling on customer_id values")
	}
	if !strings.Contains(body, `/admin/tables/customers/1`) {
		t.Error("expected FK href pointing to customers/1")
	}
}

func TestCSVExport(t *testing.T) {
	pool := queryPool(t)
	h := newTestServer(t, pool).Handler()
	token := login(t, h, "admin@example.com", "s3cret-pass")

	rec := authedGet(h, "/admin/tables/customers.csv?f.tier.eq=gold", token)
	if rec.Code != http.StatusOK {
		t.Fatalf("CSV export should be 200, got %d", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/csv") {
		t.Errorf("expected text/csv content-type, got %q", ct)
	}
	body := rec.Body.String()
	if !strings.HasPrefix(body, "id,name,tier") {
		t.Errorf("expected header row, got %q", body[:min(40, len(body))])
	}
	if !strings.Contains(body, "Alpha Industries") || !strings.Contains(body, "Gamma Ltd") {
		t.Error("CSV should include the two gold customers")
	}
	if strings.Contains(body, "Beta Co") {
		t.Error("CSV should not include non-gold customers when filter is applied")
	}
}

func TestAuditLogRecordsWrites(t *testing.T) {
	pool := queryPool(t)
	h := newTestServer(t, pool).Handler()
	token := login(t, h, "admin@example.com", "s3cret-pass")
	enableWriteMode(t, pool, token)

	create := authedPost(h, "/admin/tables/customers/new", token,
		url.Values{"name": {"Epsilon"}, "tier": {"gold"}})
	if create.Code != http.StatusSeeOther {
		t.Fatalf("insert should redirect, got %d", create.Code)
	}

	var count int
	if err := pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM admin_panel.write_audit_log WHERE table_name = 'customers' AND action = 'insert'`,
	).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("expected 1 insert audit row, got %d", count)
	}
}

func TestAuditLogChainsHashes(t *testing.T) {
	pool := queryPool(t)
	h := newTestServer(t, pool).Handler()
	token := login(t, h, "admin@example.com", "s3cret-pass")
	enableWriteMode(t, pool, token)

	for i := 0; i < 3; i++ {
		rec := authedPost(h, "/admin/tables/customers/new", token,
			url.Values{"name": {"chain"}, "tier": {"gold"}})
		if rec.Code != http.StatusSeeOther {
			t.Fatalf("insert %d failed: %d", i, rec.Code)
		}
	}

	rows, err := pool.Query(context.Background(),
		`SELECT prev_hash, row_hash FROM admin_panel.write_audit_log WHERE table_name = 'customers' ORDER BY id`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var prevExpected *string
	idx := 0
	for rows.Next() {
		var prev *string
		var row string
		if err := rows.Scan(&prev, &row); err != nil {
			t.Fatal(err)
		}
		if idx == 0 {
			if prev != nil {
				t.Errorf("first row prev_hash should be NULL, got %q", *prev)
			}
		} else {
			if prev == nil || prevExpected == nil || *prev != *prevExpected {
				t.Errorf("row %d prev_hash mismatch: prev=%v expected=%v", idx, prev, prevExpected)
			}
		}
		rowCopy := row
		prevExpected = &rowCopy
		idx++
	}
}

func TestAuditLogStripsRoleOnSelf(t *testing.T) {
	pool := queryPool(t)
	h := newTestServer(t, pool).Handler()
	token := login(t, h, "admin@example.com", "s3cret-pass")
	enableWriteMode(t, pool, token)

	var selfID int64
	_ = pool.QueryRow(context.Background(),
		`SELECT id FROM admin_panel.admin_users WHERE email = 'admin@example.com'`).Scan(&selfID)

	req := httptest.NewRequest(http.MethodPost,
		"/admin/tables/admin_users/1",
		strings.NewReader(url.Values{
			"email": {"admin@example.com"},
			"role":  {"read_only"},
		}.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.AddCookie(&http.Cookie{Name: sessionCookie, Value: token})
	req.AddCookie(&http.Cookie{Name: "admin_schema", Value: "admin_panel"})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	var newValue string
	_ = pool.QueryRow(context.Background(),
		`SELECT new_value::text FROM admin_panel.write_audit_log
		 WHERE table_name = 'admin_users' AND action = 'update' ORDER BY id DESC LIMIT 1`,
	).Scan(&newValue)
	if strings.Contains(newValue, "read_only") {
		t.Errorf("audit log new_value should not include the stripped role; got %s", newValue)
	}
}

func TestAddFilterRedirectAppendsToURL(t *testing.T) {
	pool := queryPool(t)
	h := newTestServer(t, pool).Handler()
	token := login(t, h, "admin@example.com", "s3cret-pass")

	rec := authedGet(h, "/admin/tables/customers/_filter?filter_col=tier&filter_op=eq&filter_val=gold", token)
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("add filter should redirect, got %d", rec.Code)
	}
	loc := rec.Header().Get("Location")
	if !strings.Contains(loc, "f.tier.eq=gold") {
		t.Errorf("redirect should append the filter, got %q", loc)
	}
}

func TestAddFilterRejectsUnknownColumn(t *testing.T) {
	pool := queryPool(t)
	h := newTestServer(t, pool).Handler()
	token := login(t, h, "admin@example.com", "s3cret-pass")

	rec := authedGet(h, "/admin/tables/customers/_filter?filter_col=injected&filter_op=eq&filter_val=x", token)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("unknown column should be 400, got %d", rec.Code)
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
