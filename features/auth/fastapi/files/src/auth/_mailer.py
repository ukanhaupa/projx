import os
import re
from collections.abc import Awaitable, Callable
from email.message import EmailMessage
from typing import Any, cast
from urllib.parse import urlencode, urlparse

import aiosmtplib
from loguru import logger

_FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")

SmtpConfigSource = Callable[[], Awaitable[dict[str, Any] | None]]


class _MailerState:
    config: dict[str, Any] | None = None
    initialized: bool = False
    warned: bool = False


_state = _MailerState()


async def init_mailer(get_smtp_config: SmtpConfigSource) -> None:
    raw = await get_smtp_config()
    if not raw or not isinstance(raw, dict) or not raw.get("host"):
        logger.warning("[mailer] no SMTP configured in service_configs — emails will be logged")
        _state.config = None
        _state.initialized = True
        return
    _state.config = raw
    _state.initialized = True
    logger.info(f"[mailer] SMTP configured ({raw['host']})")


def _get_smtp_from() -> str:
    if _state.config and _state.config.get("from"):
        return str(_state.config["from"])
    parsed = urlparse(_FRONTEND_URL)
    host = parsed.hostname or "localhost"
    return f"noreply@{host}"


def _have_transport() -> bool:
    if _state.initialized and _state.config is None and not _state.warned:
        _state.warned = True
        logger.warning("[mailer] transporter not initialized — call init_mailer() at startup")
    return _state.config is not None


def _log_email(to: str, subject: str, link: str) -> None:
    logger.info(f"[mailer:dev] To: {to} | Subject: {subject} | Link: {link}")


def _escape_html(value: str) -> str:
    return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


_TEMPLATE_VAR_PATTERN = re.compile(r"\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}")


def extract_template_vars(source: str) -> list[str]:
    return list({m.group(1) for m in _TEMPLATE_VAR_PATTERN.finditer(source)})


def assert_template_vars(source: str, keys: list[str]) -> None:
    template_vars = extract_template_vars(source)
    missing = [k for k in template_vars if k not in keys]
    extra = [k for k in keys if k not in template_vars]
    if missing or extra:
        parts: list[str] = []
        if missing:
            parts.append(f"missing keys: {', '.join(missing)}")
        if extra:
            parts.append(f"extra keys: {', '.join(extra)}")
        raise ValueError(f"Mailer template variable drift: {'; '.join(parts)}")


class EmailTemplate:
    def __init__(self, source: str, keys: list[str]) -> None:
        assert_template_vars(source, keys)
        self.source = source
        self.keys = keys


def define_template(source: str, keys: list[str]) -> EmailTemplate:
    return EmailTemplate(source, keys)


def render_template(
    template: EmailTemplate,
    data: dict[str, str],
    escape: Callable[[str], str] = _escape_html,
) -> str:
    data_keys = list(data.keys())
    missing = [k for k in template.keys if k not in data]
    extra = [k for k in data_keys if k not in template.keys]
    if missing or extra:
        parts: list[str] = []
        if missing:
            parts.append(f"missing values: {', '.join(missing)}")
        if extra:
            parts.append(f"extra values: {', '.join(extra)}")
        raise ValueError(f"Mailer render variable drift: {'; '.join(parts)}")

    def _sub(match: re.Match[str]) -> str:
        return escape(data[match.group(1)])

    return _TEMPLATE_VAR_PATTERN.sub(_sub, template.source)


_EMAIL_HTML_TEMPLATE = define_template(
    """<!doctype html>
<html><body style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:24px auto;padding:24px;color:#222;">
  <h2 style="margin-top:0;">{{title}}</h2>
  <p>{{message}}</p>
  <p><a href="{{actionUrl}}" style="display:inline-block;padding:10px 20px;background:#0a66c2;color:#fff;text-decoration:none;border-radius:4px;">{{actionLabel}}</a></p>
  <p style="font-size:12px;color:#888;margin-top:24px;">If the button doesn't work, paste this link: {{actionUrl}}</p>
</body></html>""",
    ["title", "message", "actionUrl", "actionLabel"],
)

_PASSWORD_RESET_TEXT_TEMPLATE = define_template(
    """Reset your password using this link (expires in 30 minutes):

{{resetLink}}

If you didn't request this, ignore this email.""",
    ["resetLink"],
)

_VERIFICATION_TEXT_TEMPLATE = define_template(
    """Confirm your email by visiting this link (expires in 24 hours):

{{verificationLink}}

If you didn't create this account, ignore this email.""",
    ["verificationLink"],
)


def _render_email(title: str, message: str, action_label: str, action_url: str) -> str:
    return render_template(
        _EMAIL_HTML_TEMPLATE,
        {
            "title": title,
            "message": message,
            "actionLabel": action_label,
            "actionUrl": action_url,
        },
    )


def _build_link(path: str, token: str) -> str:
    base = _FRONTEND_URL.rstrip("/")
    qs = urlencode({"token": token})
    return f"{base}{path}?{qs}"


def build_reset_link(token: str) -> str:
    return _build_link("/reset-password", token)


def build_verification_link(token: str) -> str:
    return _build_link("/verify-email", token)


async def _send_email(to: str, subject: str, text_body: str, html_body: str) -> bool:
    cfg = _state.config
    if cfg is None:
        return False
    msg = EmailMessage()
    msg["From"] = _get_smtp_from()
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(text_body)
    msg.add_alternative(html_body, subtype="html")
    try:
        host = str(cfg["host"])
        port = int(cfg.get("port", 587))
        secure = bool(cfg.get("secure", False))
        username = cfg.get("user")
        password = cfg.get("pass")
        kwargs: dict[str, Any] = {
            "hostname": host,
            "port": port,
            "use_tls": secure,
            "start_tls": not secure,
        }
        if username and password:
            kwargs["username"] = str(username)
            kwargs["password"] = str(password)
        result = await aiosmtplib.send(msg, **kwargs)
        message_id = cast("Any", result)
        logger.info(f"[mailer] sent | to={to} | subject={subject} | result={message_id!r}")
        return True
    except Exception as err:
        logger.error(f"[mailer] send failed | to={to} | subject={subject} | err={err}")
        return False


async def send_password_reset_email(to: str, reset_link: str) -> bool:
    if not _have_transport():
        _log_email(to, "Password reset", reset_link)
        return True
    subject = "Reset your password"
    text_body = render_template(
        _PASSWORD_RESET_TEXT_TEMPLATE,
        {"resetLink": reset_link},
        escape=lambda v: v,
    )
    html_body = _render_email(
        "Reset your password",
        "Click the button below to set a new password. This link expires in 30 minutes. If you didn't request this, ignore this email.",
        "Reset password",
        reset_link,
    )
    return await _send_email(to, subject, text_body, html_body)


async def send_verification_email(to: str, verification_link: str) -> bool:
    if not _have_transport():
        _log_email(to, "Email verification", verification_link)
        return True
    subject = "Verify your email"
    text_body = render_template(
        _VERIFICATION_TEXT_TEMPLATE,
        {"verificationLink": verification_link},
        escape=lambda v: v,
    )
    html_body = _render_email(
        "Verify your email",
        "Click the button below to confirm your email address. This link expires in 24 hours. If you didn't create this account, ignore this email.",
        "Verify email",
        verification_link,
    )
    return await _send_email(to, subject, text_body, html_body)


def _reset_mailer_for_tests() -> None:
    _state.config = None
    _state.initialized = False
    _state.warned = False
