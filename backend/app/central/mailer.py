"""Alert e-mails sent by the central server to the global administrator.

Configuration comes exclusively from the environment (never in the code or
the database):

    CENTRAL_SMTP_HOST, CENTRAL_SMTP_PORT (587), CENTRAL_SMTP_USER,
    CENTRAL_SMTP_PASSWORD, CENTRAL_SMTP_FROM, CENTRAL_SMTP_TLS (1/0),
    CENTRAL_ALERT_EMAIL (recipient; defaults to the global admin's e-mail)

When SMTP is not configured, alerts are simply marked unsent — the demand is
still stored and visible in the console; nothing is ever pretended.
"""

import os
import smtplib
from email.message import EmailMessage


def configured() -> bool:
    return bool(os.getenv("CENTRAL_SMTP_HOST") and os.getenv("CENTRAL_SMTP_FROM"))


def send_alert(to: str, subject: str, body: str) -> None:
    """Send one e-mail; raises on failure so callers can record the error."""
    if not configured():
        raise RuntimeError("SMTP central non configuré")
    message = EmailMessage()
    message["From"] = os.getenv("CENTRAL_SMTP_FROM")
    message["To"] = to
    message["Subject"] = subject
    message.set_content(body)

    port = int(os.getenv("CENTRAL_SMTP_PORT", "587"))
    if port == 465:
        server = smtplib.SMTP_SSL(os.getenv("CENTRAL_SMTP_HOST"), port, timeout=15)
    else:
        server = smtplib.SMTP(os.getenv("CENTRAL_SMTP_HOST"), port, timeout=15)
    try:
        user = os.getenv("CENTRAL_SMTP_USER", "")
        if os.getenv("CENTRAL_SMTP_TLS", "1") != "0" and port != 465:
            server.starttls()
        if user:
            server.login(user, os.getenv("CENTRAL_SMTP_PASSWORD", ""))
        server.send_message(message)
    finally:
        server.quit()
