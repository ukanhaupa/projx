use uuid::Uuid;

pub fn new() -> String {
    Uuid::new_v4().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_returns_parseable_v4_uuid() {
        let s = new();
        let parsed = Uuid::parse_str(&s).unwrap();
        assert_eq!(parsed.get_version(), Some(uuid::Version::Random));
    }

    #[test]
    fn new_values_are_unique() {
        assert_ne!(new(), new());
    }
}
