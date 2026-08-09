"""Outgoing mail used by the password reset flow.

The SMTP account is stored in the company settings so the shop can configure
it without touching the machine; when it is not configured, callers fall back
to a reset performed by the administrator.
"""

import smtplib
from email.message import EmailMessage

from .models import CompanySettings


def is_configured(settings: CompanySettings | None) -> bool:
    return bool(settings and settings.smtp_host and settings.smtp_from)


def send_mail(
    settings: CompanySettings, to: str, subject: str, body: str
) -> None:
    message = EmailMessage()
    message["From"] = settings.smtp_from
    message["To"] = to
    message["Subject"] = subject
    message.set_content(body)

    port = settings.smtp_port or 587
    if port == 465:
        server = smtplib.SMTP_SSL(settings.smtp_host, port, timeout=15)
    else:
        server = smtplib.SMTP(settings.smtp_host, port, timeout=15)
    try:
        if port != 465 and settings.smtp_tls:
            server.starttls()
        if settings.smtp_user:
            server.login(settings.smtp_user, settings.smtp_password or "")
        server.send_message(message)
    finally:
        server.quit()
