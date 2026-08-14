"""
Outbound email - two backends, tried in this order:

1. Microsoft Graph API (POST /users/{id}/sendMail), app-only via the same
   OAuth2 client-credentials pattern already used for Entra ID login (see
   entra_auth.py) - no SMTP, no mailbox password, and not affected by a
   tenant's SMTP client-authentication block the way plain SMTP is.
   Preferred whenever ENTRA_MAIL_CLIENT_ID/SECRET are set.
2. SMTP relay via smtp.office365.com, mirroring the pattern already proven
   on Delta Health Center's main website (Nodemailer): IPv4-forced
   connection, STARTTLS on 587 (or unauthenticated relay on 25 if this
   app's IP is allow-listed as an Exchange Online connector). Used only if
   Graph isn't configured but M365_SMTP_* is.

If neither is configured, falls back to a "simulate send" mode that logs
instead of crashing or silently dropping the email - safe for local dev.
"""
import os
import socket
import ssl
import smtplib
import logging
import httpx
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

logger = logging.getLogger("mailer")
# Explicit handler + level, independent of whether anything upstream ever
# calls logging.basicConfig() - without this, Python's logging defaults to
# only showing WARNING and above, which would silently swallow every
# simulate-mode log line (the entire point of simulate mode is that it's
# visible).
if not logger.handlers:
    _handler = logging.StreamHandler()
    _handler.setFormatter(logging.Formatter("%(asctime)s [%(name)s] %(message)s"))
    logger.addHandler(_handler)
logger.setLevel(logging.INFO)
logger.propagate = False

FROM_NAME = os.getenv("M365_FROM_NAME", "Delta Health Center IT Helpdesk")
FROM_ADDRESS = os.getenv("M365_FROM_ADDRESS", "")
FRONTEND_BASE_URL = os.getenv("FRONTEND_BASE_URL", "http://localhost:3005")

# --- Graph API config ---
ENTRA_TENANT_ID = os.getenv("ENTRA_TENANT_ID", "")
ENTRA_MAIL_CLIENT_ID = os.getenv("ENTRA_MAIL_CLIENT_ID", "")
ENTRA_MAIL_CLIENT_SECRET = os.getenv("ENTRA_MAIL_CLIENT_SECRET", "")
GRAPH_CONFIGURED = bool(ENTRA_TENANT_ID and ENTRA_MAIL_CLIENT_ID and ENTRA_MAIL_CLIENT_SECRET and FROM_ADDRESS)

# --- SMTP config (fallback) ---
SMTP_HOST = os.getenv("M365_SMTP_HOST", "smtp.office365.com")
SMTP_PORT = int(os.getenv("M365_SMTP_PORT", "587"))
SMTP_USER = os.getenv("M365_SMTP_USER", "")
SMTP_PASS = os.getenv("M365_SMTP_PASS", "")
# Escape hatch matching the other site's rejectUnauthorized:false, in case
# the same relay/TLS handshake quirk shows up here - left OFF by default
# since a corrected SNI hostname (see _send_via_smtp) should validate
# cleanly against Microsoft's real certificate without weakening checks.
_INSECURE_TLS = os.getenv("M365_SMTP_INSECURE_TLS", "false").lower() == "true"
# Port 25 (direct MX relay) typically needs no mailbox credentials at all
# if the sending host's IP is allow-listed in Exchange Online; port 587
# (authenticated client submission) needs a real mailbox/app password.
_SMTP_REQUIRES_AUTH = SMTP_PORT != 25
# Wrapped in bool(...) deliberately - `and`/`or` in Python return the last
# operand evaluated, not a coerced boolean, so without this, SMTP_CONFIGURED
# would silently hold the raw SMTP_PASS string instead of True whenever
# auth is required. Anything that prints/logs this value (e.g. a debug
# check) would leak the password - this exact bug happened once already.
SMTP_CONFIGURED = bool(SMTP_HOST) and bool(not _SMTP_REQUIRES_AUTH or (SMTP_USER and SMTP_PASS))

CONFIGURED = GRAPH_CONFIGURED or SMTP_CONFIGURED

_graph_token_cache: dict = {}


def _get_graph_token() -> str:
    cached = _graph_token_cache.get("token")
    if cached:
        return cached
    resp = httpx.post(
        f"https://login.microsoftonline.com/{ENTRA_TENANT_ID}/oauth2/v2.0/token",
        data={
            "client_id": ENTRA_MAIL_CLIENT_ID,
            "client_secret": ENTRA_MAIL_CLIENT_SECRET,
            "scope": "https://graph.microsoft.com/.default",
            "grant_type": "client_credentials",
        },
        timeout=10,
    )
    resp.raise_for_status()
    token = resp.json()["access_token"]
    _graph_token_cache["token"] = token
    return token


def _send_via_graph(to_email: str, subject: str, html_body: str) -> None:
    # Graph's sendMail action only supports a single body content type per
    # message (no true multipart/alternative like the SMTP path below), so
    # this sends HTML only - an acceptable tradeoff for the much simpler
    # auth story.
    token = _get_graph_token()
    payload = {
        "message": {
            "subject": subject,
            "body": {"contentType": "HTML", "content": html_body},
            "toRecipients": [{"emailAddress": {"address": to_email}}],
            "from": {"emailAddress": {"address": FROM_ADDRESS, "name": FROM_NAME}},
        },
        "saveToSentItems": "false",
    }
    resp = httpx.post(
        f"https://graph.microsoft.com/v1.0/users/{FROM_ADDRESS}/sendMail",
        json=payload,
        headers={"Authorization": f"Bearer {token}"},
        timeout=15,
    )
    if resp.status_code == 401:
        # Token might have expired or been invalidated - retry once with a
        # fresh one before giving up.
        _graph_token_cache.pop("token", None)
        token = _get_graph_token()
        resp = httpx.post(
            f"https://graph.microsoft.com/v1.0/users/{FROM_ADDRESS}/sendMail",
            json=payload,
            headers={"Authorization": f"Bearer {token}"},
            timeout=15,
        )
    resp.raise_for_status()


def _resolve_ipv4(host: str) -> str:
    infos = socket.getaddrinfo(host, None, socket.AF_INET)
    return infos[0][4][0]


def _build_mime_message(to_email: str, subject: str, html_body: str, text_body: str) -> MIMEMultipart:
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"{FROM_NAME} <{FROM_ADDRESS}>" if FROM_ADDRESS else FROM_NAME
    msg["To"] = to_email
    # Plain-text part first, HTML second - per RFC 2046 the LAST part an
    # alternative-type client understands is what it renders, so this
    # ordering is what makes HTML clients show the HTML while plain-text/
    # high-security clients fall back to text.
    msg.attach(MIMEText(text_body, "plain"))
    msg.attach(MIMEText(html_body, "html"))
    return msg


def _send_via_smtp(to_email: str, subject: str, html_body: str, text_body: str) -> None:
    msg = _build_mime_message(to_email, subject, html_body, text_body)
    ipv4_host = _resolve_ipv4(SMTP_HOST)

    smtp = smtplib.SMTP(ipv4_host, SMTP_PORT, timeout=10)
    try:
        smtp.ehlo()
        if smtp.has_extn("STARTTLS"):
            # Certificate/SNI verification must use the real DNS name, not
            # the IP we connected to - smtplib reads this off `_host`
            # during starttls(), so it's corrected back to the hostname
            # here (mirrors the Node version's explicit `servername: host`).
            smtp._host = SMTP_HOST
            context = ssl.create_default_context()
            if _INSECURE_TLS:
                context.check_hostname = False
                context.verify_mode = ssl.CERT_NONE
            smtp.starttls(context=context)
            smtp.ehlo()
        if SMTP_USER and SMTP_PASS:
            smtp.login(SMTP_USER, SMTP_PASS)
        smtp.send_message(msg)
    finally:
        smtp.quit()


def send_mail(to_email: str, subject: str, html_body: str, text_body: str) -> bool:
    """Best-effort send - never raises. A ticket mutation must succeed
    regardless of whether its notification email does; call sites should
    treat this as fire-and-forget (see main.py's use of BackgroundTasks)."""
    if not to_email:
        return False

    if not CONFIGURED:
        logger.info("[SIMULATED EMAIL] To: %s | Subject: %s\n%s", to_email, subject, text_body)
        return True

    try:
        if GRAPH_CONFIGURED:
            _send_via_graph(to_email, subject, html_body)
        else:
            _send_via_smtp(to_email, subject, html_body, text_body)
        return True
    except Exception as e:
        logger.warning("Failed to send email to %s: %s", to_email, e)
        return False
