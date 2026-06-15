use uuid::Uuid;

pub fn new() -> String {
    Uuid::new_v4().to_string()
}
