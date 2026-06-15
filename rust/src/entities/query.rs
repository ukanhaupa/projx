use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const DEFAULT_PAGE_SIZE: u64 = 25;
pub const MAX_PAGE_SIZE: u64 = 100;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Pagination {
    pub page: u64,
    pub page_size: u64,
    pub total_records: u64,
    pub total_pages: u64,
}

#[derive(Debug, Serialize)]
pub struct PageResult {
    pub data: Value,
    pub pagination: Pagination,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct ListParams {
    pub page: u64,
    pub page_size: u64,
    pub order_by: Vec<String>,
    pub search: Option<String>,
    pub include_deleted: bool,
    pub filters: HashMap<String, String>,
}

const RESERVED_KEYS: &[&str] = &[
    "page",
    "page_size",
    "search",
    "order_by",
    "expand",
    "include_deleted",
];

impl ListParams {
    pub fn parse(query: &HashMap<String, String>) -> Self {
        let page = query
            .get("page")
            .and_then(|v| v.parse::<u64>().ok())
            .filter(|n| *n > 0)
            .unwrap_or(1);

        let page_size = query
            .get("page_size")
            .and_then(|v| v.parse::<u64>().ok())
            .filter(|n| *n > 0)
            .map(|n| n.clamp(1, MAX_PAGE_SIZE))
            .unwrap_or(DEFAULT_PAGE_SIZE);

        let order_by = query
            .get("order_by")
            .map(|v| {
                v.split(',')
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect()
            })
            .unwrap_or_default();

        let search = query
            .get("search")
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string());

        let include_deleted = query
            .get("include_deleted")
            .map(|v| v == "true")
            .unwrap_or(false);

        let mut filters = HashMap::new();
        for (k, v) in query {
            if RESERVED_KEYS.contains(&k.as_str()) {
                continue;
            }
            if !v.is_empty() {
                filters.insert(k.clone(), v.clone());
            }
        }

        Self {
            page,
            page_size,
            order_by,
            search,
            include_deleted,
            filters,
        }
    }

    pub fn offset(&self) -> u64 {
        self.page.saturating_sub(1) * self.page_size
    }

    pub fn pagination(&self, total: u64) -> Pagination {
        let total_pages = if self.page_size == 0 {
            0
        } else {
            total.div_ceil(self.page_size)
        };
        Pagination {
            page: self.page,
            page_size: self.page_size,
            total_records: total,
            total_pages,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum OrderDir {
    Asc,
    Desc,
}

#[derive(Debug, Clone, PartialEq)]
pub struct OrderClause {
    pub column: String,
    pub direction: OrderDir,
}

pub fn parse_order_clauses(order_by: &[String], allowed: &[&str]) -> Vec<OrderClause> {
    let mut out = Vec::new();
    for raw in order_by {
        let (dir, key) = if let Some(stripped) = raw.strip_prefix('-') {
            (OrderDir::Desc, stripped)
        } else {
            (OrderDir::Asc, raw.as_str())
        };
        if allowed.contains(&key) {
            out.push(OrderClause {
                column: key.to_string(),
                direction: dir,
            });
        }
    }
    out
}

pub fn search_clauses(searchable: &[&str], needle: &str) -> Vec<(String, String)> {
    let pattern = format!("%{}%", needle);
    searchable
        .iter()
        .map(|c| ((*c).to_string(), pattern.clone()))
        .collect()
}

pub fn allowed_filters(
    filters: &HashMap<String, String>,
    allowed: &[&str],
) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = filters
        .iter()
        .filter(|(k, _)| allowed.contains(&k.as_str()))
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();
    out.sort_by(|a, b| a.0.cmp(&b.0));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn q(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| ((*k).to_string(), (*v).to_string()))
            .collect()
    }

    #[test]
    fn parse_defaults() {
        let p = ListParams::parse(&HashMap::new());
        assert_eq!(p.page, 1);
        assert_eq!(p.page_size, DEFAULT_PAGE_SIZE);
        assert!(p.order_by.is_empty());
        assert!(p.search.is_none());
        assert!(!p.include_deleted);
        assert!(p.filters.is_empty());
    }

    #[test]
    fn parse_clamps_page_size() {
        let p = ListParams::parse(&q(&[("page_size", "500")]));
        assert_eq!(p.page_size, MAX_PAGE_SIZE);
        let p = ListParams::parse(&q(&[("page_size", "0")]));
        assert_eq!(p.page_size, DEFAULT_PAGE_SIZE);
        let p = ListParams::parse(&q(&[("page_size", "garbage")]));
        assert_eq!(p.page_size, DEFAULT_PAGE_SIZE);
    }

    #[test]
    fn parse_order_by_split_and_trim() {
        let p = ListParams::parse(&q(&[("order_by", " -created_at , title ")]));
        assert_eq!(
            p.order_by,
            vec!["-created_at".to_string(), "title".to_string()]
        );
    }

    #[test]
    fn parse_filters_excludes_reserved() {
        let p = ListParams::parse(&q(&[
            ("page", "2"),
            ("search", "hi"),
            ("title", "rust"),
            ("expand", "author"),
        ]));
        assert_eq!(p.page, 2);
        assert_eq!(p.search.as_deref(), Some("hi"));
        assert_eq!(p.filters.get("title"), Some(&"rust".to_string()));
        assert!(!p.filters.contains_key("expand"));
        assert!(!p.filters.contains_key("page"));
    }

    #[test]
    fn parse_include_deleted_bool() {
        assert!(ListParams::parse(&q(&[("include_deleted", "true")])).include_deleted);
        assert!(!ListParams::parse(&q(&[("include_deleted", "false")])).include_deleted);
        assert!(!ListParams::parse(&q(&[("include_deleted", "1")])).include_deleted);
    }

    #[test]
    fn offset_math() {
        let p = ListParams {
            page: 3,
            page_size: 10,
            ..Default::default()
        };
        assert_eq!(p.offset(), 20);
        let p0 = ListParams {
            page: 1,
            page_size: 10,
            ..Default::default()
        };
        assert_eq!(p0.offset(), 0);
    }

    #[test]
    fn pagination_total_pages_round_up() {
        let p = ListParams {
            page: 1,
            page_size: 10,
            ..Default::default()
        };
        assert_eq!(p.pagination(25).total_pages, 3);
        assert_eq!(p.pagination(20).total_pages, 2);
        assert_eq!(p.pagination(0).total_pages, 0);
    }

    #[test]
    fn order_clauses_filtered_by_allowed() {
        let raw = vec![
            "-created_at".to_string(),
            "secret".to_string(),
            "title".to_string(),
        ];
        let allowed = ["created_at", "title"];
        let out = parse_order_clauses(&raw, &allowed);
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].column, "created_at");
        assert_eq!(out[0].direction, OrderDir::Desc);
        assert_eq!(out[1].column, "title");
        assert_eq!(out[1].direction, OrderDir::Asc);
    }

    #[test]
    fn search_clauses_format_pattern() {
        let c = search_clauses(&["title", "body"], "rust");
        assert_eq!(c.len(), 2);
        assert_eq!(c[0].1, "%rust%");
    }

    #[test]
    fn allowed_filters_restricts_columns() {
        let mut f = HashMap::new();
        f.insert("title".to_string(), "x".to_string());
        f.insert("secret".to_string(), "y".to_string());
        let out = allowed_filters(&f, &["title", "body"]);
        assert_eq!(out, vec![("title".to_string(), "x".to_string())]);
    }
}
