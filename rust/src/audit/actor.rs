use std::future::Future;

use tokio::task_local;

pub const SYSTEM_ACTOR: &str = "system";

task_local! {
    static ACTOR: String;
}

pub fn current() -> String {
    ACTOR
        .try_with(|v| v.clone())
        .unwrap_or_else(|_| SYSTEM_ACTOR.to_string())
}

pub async fn scope<F, T>(actor: Option<String>, fut: F) -> T
where
    F: Future<Output = T>,
{
    match actor.filter(|a| !a.is_empty()) {
        Some(a) => ACTOR.scope(a, fut).await,
        None => fut.await,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn current_defaults_to_system_outside_scope() {
        assert_eq!(current(), SYSTEM_ACTOR);
    }

    #[tokio::test]
    async fn scope_sets_actor_for_inner_future() {
        let got = scope(Some("alice@example.com".into()), async { current() }).await;
        assert_eq!(got, "alice@example.com");
    }

    #[tokio::test]
    async fn empty_actor_falls_back_to_system() {
        let got = scope(Some(String::new()), async { current() }).await;
        assert_eq!(got, SYSTEM_ACTOR);
    }

    #[tokio::test]
    async fn none_actor_falls_back_to_system() {
        let got = scope(None, async { current() }).await;
        assert_eq!(got, SYSTEM_ACTOR);
    }
}
