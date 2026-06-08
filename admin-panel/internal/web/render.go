package web

import (
	"html/template"

	"adminpanel/internal/browser"
)

func renderCell(v viewData, row browser.Row, colName string) template.HTML {
	raw := cell(row[colName])
	if raw == "" {
		return ""
	}
	for _, c := range v.Columns {
		if c.Name != colName {
			continue
		}
		if c.UDTName == "json" || c.UDTName == "jsonb" {
			return template.HTML(template.HTMLEscapeString(truncateMid(raw, 120)))
		}
	}
	for _, c := range v.Columns {
		if c.Name == colName && c.FK != nil {
			href := v.Base + "/tables/" + c.FK.TargetTable + "/" + raw
			return template.HTML(
				`<a class="fk-link" href="` +
					template.HTMLEscapeString(href) +
					`">` + template.HTMLEscapeString(raw) + ` ↗</a>`,
			)
		}
	}
	return template.HTML(template.HTMLEscapeString(raw))
}

func sortToggleURL(v viewData, col string) string {
	q := browser.Query{
		Search:  v.Search,
		Filters: v.ActiveFilter,
		Offset:  0,
		Limit:   0,
	}
	existing := -1
	for i, sk := range v.Sort {
		if sk.Column == col {
			existing = i
			break
		}
	}
	if existing == -1 {
		q.Sort = append(q.Sort, browser.SortKey{Column: col, Desc: false})
	} else if !v.Sort[existing].Desc {
		q.Sort = append(q.Sort, browser.SortKey{Column: col, Desc: true})
	}
	return q.Encode()
}

func sortIndicator(v viewData, col string) template.HTML {
	for _, sk := range v.Sort {
		if sk.Column == col {
			if sk.Desc {
				return template.HTML(" <span class=\"sort\">▾</span>")
			}
			return template.HTML(" <span class=\"sort\">▴</span>")
		}
	}
	return ""
}

func removeFilterURL(v viewData, idx int) string {
	q := browser.Query{
		Search:  v.Search,
		Sort:    v.Sort,
		Offset:  0,
		Limit:   0,
		Filters: make([]browser.Filter, 0, len(v.ActiveFilter)),
	}
	for i, f := range v.ActiveFilter {
		if i == idx {
			continue
		}
		q.Filters = append(q.Filters, f)
	}
	return q.Encode()
}

func truncateMid(s string, n int) string {
	if len(s) <= n {
		return s
	}
	half := n / 2
	return s[:half] + " … " + s[len(s)-half:]
}
