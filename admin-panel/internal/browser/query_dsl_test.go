package browser

import (
	"net/url"
	"testing"
)

func TestParseAndEncodeRoundtrip(t *testing.T) {
	raw := "f.email.ilike=kanha&f.id.in=1&f.id.in=2&q=hello&sort=-created_at,name&offset=50&limit=20"
	v, err := url.ParseQuery(raw)
	if err != nil {
		t.Fatal(err)
	}
	q := ParseQuery(v)
	if q.Search != "hello" {
		t.Errorf("search = %q", q.Search)
	}
	if q.Offset != 50 {
		t.Errorf("offset = %d", q.Offset)
	}
	if q.Limit != 20 {
		t.Errorf("limit = %d", q.Limit)
	}
	if len(q.Sort) != 2 || q.Sort[0].Column != "created_at" || !q.Sort[0].Desc {
		t.Errorf("sort = %+v", q.Sort)
	}
	if q.Sort[1].Column != "name" || q.Sort[1].Desc {
		t.Errorf("second sort = %+v", q.Sort[1])
	}
	if len(q.Filters) != 2 {
		t.Fatalf("expected 2 filters, got %d", len(q.Filters))
	}
	encoded := q.Encode()
	v2, _ := url.ParseQuery(encoded)
	if v2.Get("q") != "hello" {
		t.Errorf("re-encoded q = %q", v2.Get("q"))
	}
}

func TestOperatorSQLMapping(t *testing.T) {
	cases := map[Operator]string{
		OpEq:  "=",
		OpNeq: "!=",
		OpGt:  ">",
		OpGte: ">=",
		OpLt:  "<",
		OpLte: "<=",
	}
	for op, want := range cases {
		if got := op.SQL(); got != want {
			t.Errorf("%s.SQL() = %q, want %q", op, got, want)
		}
	}
	if OpILike.SQL() != "" {
		t.Error("non-comparison ops should return empty SQL")
	}
}

func TestQueryWithOffsetWithoutPagination(t *testing.T) {
	q := Query{Offset: 100, Limit: 50}
	q2 := q.WithOffset(200)
	if q2.Offset != 200 || q.Offset != 100 {
		t.Errorf("WithOffset should not mutate receiver")
	}
	q3 := q.WithoutPagination()
	if q3.Offset != 0 || q3.Limit != 0 {
		t.Errorf("WithoutPagination should zero out paging")
	}
}

func TestParseQueryHandlesEmpty(t *testing.T) {
	q := ParseQuery(url.Values{})
	if q.Search != "" || q.Offset != 0 || q.Limit != 0 {
		t.Errorf("empty values should give zero Query, got %+v", q)
	}
	if len(q.Sort) != 0 || len(q.Filters) != 0 {
		t.Errorf("empty values should give empty Sort/Filters, got sort=%v filters=%v", q.Sort, q.Filters)
	}
}

func TestParseQueryRejectsMalformedFilterKey(t *testing.T) {
	v := url.Values{"f.": {"x"}, "f.col": {"x"}}
	q := ParseQuery(v)
	if len(q.Filters) != 0 {
		t.Errorf("malformed filter keys should be ignored, got %v", q.Filters)
	}
}
