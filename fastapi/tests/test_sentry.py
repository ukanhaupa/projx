from unittest.mock import patch

from src._sentry import (  # pragma: allow-private-import
    _before_send,
    _before_send_transaction,
    init_sentry,
)


def test_init_returns_false_without_dsn():
    assert init_sentry(None) is False
    assert init_sentry({}) is False
    assert init_sentry({"dsn": "   "}) is False


def test_init_initialises_sdk_with_dsn():
    with patch("src._sentry.sentry_sdk.init") as mock_init:
        assert init_sentry({"dsn": "https://k@o.sentry/1", "release": "v1"}) is True
    mock_init.assert_called_once()
    kwargs = mock_init.call_args.kwargs
    assert kwargs["dsn"] == "https://k@o.sentry/1"
    assert kwargs["environment"] == "production"
    assert kwargs["release"] == "v1"


def test_init_uses_configured_environment():
    with patch("src._sentry.sentry_sdk.init") as mock_init:
        init_sentry({"dsn": "https://k@o.sentry/1", "environment": "staging"})
    assert mock_init.call_args.kwargs["environment"] == "staging"
    assert mock_init.call_args.kwargs["release"] is None


def test_before_send_drops_known_client_errors():
    class NotFoundError(Exception):
        pass

    event = {"id": "e"}
    assert _before_send(event, {"exc_info": (None, NotFoundError(), None)}) is None


def test_before_send_drops_4xx_status():
    class SomeError(Exception):
        status_code = 422

    assert _before_send({"id": "e"}, {"exc_info": (None, SomeError(), None)}) is None


def test_before_send_keeps_server_errors():
    class SomeError(Exception):
        status_code = 500

    event = {"id": "e"}
    assert _before_send(event, {"exc_info": (None, SomeError(), None)}) is event


def test_before_send_keeps_event_without_exc_info():
    event = {"id": "e"}
    assert _before_send(event, {}) is event


def test_before_send_transaction_drops_health_checks():
    assert _before_send_transaction({"transaction": "GET /api/health"}, {}) is None


def test_before_send_transaction_keeps_other_routes():
    event = {"transaction": "GET /api/v1/audit-logs"}
    assert _before_send_transaction(event, {}) is event
