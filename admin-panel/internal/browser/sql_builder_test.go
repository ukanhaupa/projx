package browser

import (
	"strings"
	"testing"
)

func mkTable() *Table {
	return &Table{
		Schema: "public",
		Name:   "things",
		Columns: []Column{
			{Name: "id", UDTName: "int8"},
			{Name: "name", UDTName: "text"},
			{Name: "active", UDTName: "bool"},
			{Name: "score", UDTName: "numeric"},
			{Name: "tags", UDTName: "_text"},
			{Name: "data", UDTName: "jsonb"},
			{Name: "created_at", UDTName: "timestamptz"},
		},
		PrimaryKey: "id",
	}
}

func TestBuildWhereILikeEscapesWildcards(t *testing.T) {
	tbl := mkTable()
	q := Query{Filters: []Filter{{Column: "name", Operator: OpILike, Values: []string{"50%_off"}}}}
	where, args, err := buildWhere(tbl, q)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(where, "ILIKE") {
		t.Errorf("expected ILIKE in WHERE: %s", where)
	}
	pattern, ok := args[0].(string)
	if !ok || !strings.Contains(pattern, `\%`) || !strings.Contains(pattern, `\_`) {
		t.Errorf("expected escaped %% and _ in pattern, got %v", args[0])
	}
}

func TestBuildWhereStartsAndEnds(t *testing.T) {
	tbl := mkTable()
	for _, op := range []Operator{OpStartsWith, OpEndsWith} {
		q := Query{Filters: []Filter{{Column: "name", Operator: op, Values: []string{"abc"}}}}
		_, args, err := buildWhere(tbl, q)
		if err != nil {
			t.Fatal(err)
		}
		if len(args) != 1 {
			t.Fatalf("expected 1 arg for %s, got %d", op, len(args))
		}
		s := args[0].(string)
		if op == OpStartsWith && !strings.HasSuffix(s, "%") {
			t.Errorf("starts_with should append %%, got %q", s)
		}
		if op == OpEndsWith && !strings.HasPrefix(s, "%") {
			t.Errorf("ends_with should prepend %%, got %q", s)
		}
	}
}

func TestBuildWhereIn(t *testing.T) {
	tbl := mkTable()
	q := Query{Filters: []Filter{{Column: "id", Operator: OpIn, Values: []string{"1", "2", "3"}}}}
	where, args, err := buildWhere(tbl, q)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(where, "IN ($1, $2, $3)") {
		t.Errorf("expected IN placeholders, got %s", where)
	}
	if len(args) != 3 {
		t.Errorf("expected 3 args, got %d", len(args))
	}
}

func TestBuildWhereBetween(t *testing.T) {
	tbl := mkTable()
	q := Query{Filters: []Filter{{Column: "score", Operator: OpBetween, Values: []string{"1", "10"}}}}
	where, args, err := buildWhere(tbl, q)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(where, "BETWEEN $1 AND $2") {
		t.Errorf("expected BETWEEN clause, got %s", where)
	}
	if len(args) != 2 {
		t.Errorf("expected 2 args, got %d", len(args))
	}
}

func TestBuildWhereBetweenRequiresTwoValues(t *testing.T) {
	tbl := mkTable()
	q := Query{Filters: []Filter{{Column: "score", Operator: OpBetween, Values: []string{"1"}}}}
	if _, _, err := buildWhere(tbl, q); err == nil {
		t.Error("between with one value should error")
	}
}

func TestBuildWhereContainsKey(t *testing.T) {
	tbl := mkTable()
	q := Query{Filters: []Filter{{Column: "data", Operator: OpContainsKey, Values: []string{"k"}}}}
	where, _, err := buildWhere(tbl, q)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(where, `"data" ? $1`) {
		t.Errorf("expected JSONB ? operator, got %s", where)
	}
}

func TestBuildWhereHasOnArray(t *testing.T) {
	tbl := mkTable()
	q := Query{Filters: []Filter{{Column: "tags", Operator: OpHas, Values: []string{"vip"}}}}
	where, _, err := buildWhere(tbl, q)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(where, "ANY") {
		t.Errorf("expected ANY() in clause, got %s", where)
	}
}

func TestBuildWhereUnknownOperator(t *testing.T) {
	tbl := mkTable()
	q := Query{Filters: []Filter{{Column: "id", Operator: "wat", Values: []string{"1"}}}}
	if _, _, err := buildWhere(tbl, q); err == nil {
		t.Error("unknown operator should error")
	}
}

func TestBuildOrderByRejectsUnknownColumn(t *testing.T) {
	tbl := mkTable()
	if _, err := buildOrderBy(tbl, []SortKey{{Column: "drop_table"}}); err == nil {
		t.Error("unknown sort column should error")
	}
}

func TestBuildOrderByMulti(t *testing.T) {
	tbl := mkTable()
	got, err := buildOrderBy(tbl, []SortKey{{Column: "name"}, {Column: "id", Desc: true}})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(got, `"name" ASC`) || !strings.Contains(got, `"id" DESC`) {
		t.Errorf("expected name ASC, id DESC: %s", got)
	}
}

func TestBuildSearchUsesTextishColumnsOnly(t *testing.T) {
	tbl := mkTable()
	q := Query{Search: "hello"}
	where, args, err := buildWhere(tbl, q)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(where, `"name"::text ILIKE`) {
		t.Errorf("expected name in search, got %s", where)
	}
	if strings.Contains(where, `"id"::text`) {
		t.Errorf("non-text columns should not be searched, got %s", where)
	}
	if len(args) != 1 {
		t.Errorf("expected 1 search arg, got %d", len(args))
	}
}

func TestEscapeLike(t *testing.T) {
	got := escapeLike(`50% off_promo\backslash`)
	want := `50\% off\_promo\\backslash`
	if got != want {
		t.Errorf("escapeLike = %q, want %q", got, want)
	}
}

func TestTableHasColumn(t *testing.T) {
	tbl := mkTable()
	if !tbl.HasColumn("name") {
		t.Error("HasColumn(name) should be true")
	}
	if tbl.HasColumn("nope") {
		t.Error("HasColumn(nope) should be false")
	}
}
