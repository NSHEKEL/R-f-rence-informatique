"""Client de la Facture Normalisée Électronique (FNE, DGI Côte d'Ivoire).

Ossature prête pour l'interfaçage officiel : l'entreprise s'inscrit sur
l'environnement de test FNE, récupère la documentation technique, l'URL et la
clé API (onglet « Paramétrage » de son espace), puis la DGI valide les
spécimens avant de délivrer l'URL de production.

Deux points restent volontairement à aligner sur la documentation officielle
livrée à l'inscription (elle fixe le schéma exact) :

- ``build_payload`` : la structure de la demande de certification ;
- ``_certified_proof`` : les champs de la réponse qui font foi
  (référence, numéro officiel, sticker/QR).

En attendant, une réponse 2xx place la facture en ``submitted`` — jamais en
``certified`` : le logiciel ne présente pas de facture comme normalisée sans
la preuve officielle.
"""

from __future__ import annotations

import json
import ssl
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from .models import CompanySettings, FneInvoice, Sale

TIMEOUT = 30
MAX_ATTEMPTS = 5

STATUS_PENDING = "pending"
STATUS_SUBMITTED = "submitted"
STATUS_CERTIFIED = "certified"
STATUS_REJECTED = "rejected"
STATUS_ERROR = "error"


class FneError(RuntimeError):
    pass


def _ssl_context() -> ssl.SSLContext:
    try:
        import certifi

        return ssl.create_default_context(cafile=certifi.where())
    except Exception:  # noqa: BLE001
        return ssl.create_default_context()


def _post_json(url: str, payload: dict, headers: dict[str, str]) -> dict:
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={"Content-Type": "application/json", **headers},
    )
    try:
        with urllib.request.urlopen(
            request, timeout=TIMEOUT, context=_ssl_context()
        ) as response:
            text = response.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:500]
        raise FneError(f"Erreur FNE {exc.code} : {detail or exc.reason}") from exc
    except (
        urllib.error.URLError,
        ssl.SSLError,
        TimeoutError,
        OSError,
    ) as exc:
        raise FneError(f"Plateforme FNE injoignable : {exc}") from exc
    try:
        return json.loads(text) if text else {}
    except json.JSONDecodeError:
        return {"raw": text[:2000]}


def _oauth_token(settings: CompanySettings) -> str:
    """OAuth 2.0 client credentials (l'une des deux auth prévues par la DGI)."""
    if not settings.fne_token_url:
        return ""
    form = urllib.parse.urlencode(
        {
            "grant_type": "client_credentials",
            "client_id": settings.fne_client_id,
            "client_secret": settings.fne_client_secret,
        }
    ).encode("utf-8")
    request = urllib.request.Request(
        settings.fne_token_url,
        data=form,
        method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    try:
        with urllib.request.urlopen(
            request, timeout=TIMEOUT, context=_ssl_context()
        ) as response:
            data = json.loads(response.read().decode("utf-8", "replace"))
    except (
        urllib.error.URLError,
        urllib.error.HTTPError,
        ssl.SSLError,
        OSError,
        json.JSONDecodeError,
    ) as exc:
        raise FneError(f"Jeton FNE impossible : {exc}") from exc
    token = str(data.get("access_token", ""))
    if not token:
        raise FneError("La plateforme FNE n'a pas renvoyé de jeton.")
    return token


def build_payload(sale: Sale, settings: CompanySettings) -> dict:
    """Demande de certification d'une vente.

    Structure neutre rassemblant les données que la FNE exige d'une facture
    (émetteur/NCC, client, lignes, totaux) ; les noms de champs seront alignés
    sur le schéma officiel de la documentation technique.
    """
    customer = sale.customer
    return {
        "emitter": {
            "ncc": settings.tax_id,
            "name": settings.name,
            "address": settings.address,
            "phone": settings.phone,
        },
        "buyer": (
            {
                "name": customer.name,
                "phone": customer.phone,
                "email": customer.email,
            }
            if customer
            else None
        ),
        "invoice": {
            "reference": sale.reference,
            "date": sale.date.isoformat() if sale.date else None,
            "payment_method": sale.payment_method,
            "currency": settings.currency,
            "discount": sale.discount,
            "total": sale.total,
            "vat_rate": settings.vat_rate,
        },
        "items": [
            {
                "label": item.product_name,
                "quantity": item.quantity,
                "unit_price": item.unit_price,
                "total": item.subtotal,
            }
            for item in sale.items
        ],
        # Idempotence : la référence EasyGest sert de clé contre les doublons.
        "external_id": sale.reference,
    }


def _certified_proof(response: dict) -> tuple[str, str, str]:
    """(référence, numéro, sticker) officiels — à aligner sur la doc FNE.

    Renvoie des chaînes vides tant que la réponse officielle n'apporte pas la
    preuve : la facture reste alors ``submitted``, jamais ``certified``.
    """
    reference = str(response.get("reference", "") or "")
    number = str(response.get("fne_number", "") or "")
    sticker = str(response.get("token", "") or "")
    return reference, number, sticker


def configured(settings: CompanySettings) -> bool:
    return bool(
        settings.fne_enabled
        and settings.fne_api_url
        and (settings.fne_api_key or settings.fne_token_url)
    )


def certify(db: Session, sale: Sale, settings: CompanySettings, user_id: int) -> FneInvoice:
    """Envoie la vente à la plateforme FNE et consigne la réponse."""
    if not settings.fne_enabled:
        raise FneError("La FNE n'est pas activée (Paramètres → FNE).")
    if not configured(settings):
        raise FneError(
            "Configuration FNE incomplète : URL de l'API et clé/jeton requis."
        )

    invoice = (
        db.query(FneInvoice).filter(FneInvoice.sale_id == sale.id).first()
    )
    if invoice is None:
        invoice = FneInvoice(
            sale_id=sale.id, status=STATUS_PENDING, created_by_id=user_id
        )
        db.add(invoice)
        db.flush()
    if invoice.status == STATUS_CERTIFIED:
        return invoice  # déjà normalisée : jamais modifiée ni renvoyée

    payload = build_payload(sale, settings)
    invoice.request_payload = json.dumps(payload, ensure_ascii=False)
    invoice.attempts += 1

    headers: dict[str, str] = {}
    if settings.fne_api_key:
        # Nom d'en-tête courant ; la doc officielle précisera le sien.
        headers["Authorization"] = f"Bearer {settings.fne_api_key}"
    else:
        headers["Authorization"] = f"Bearer {_oauth_token(settings)}"

    try:
        response = _post_json(settings.fne_api_url, payload, headers)
    except FneError as exc:
        invoice.status = STATUS_ERROR
        invoice.last_error = str(exc)
        invoice.updated_at = datetime.now(timezone.utc)
        db.commit()
        raise

    invoice.response_payload = json.dumps(response, ensure_ascii=False)[:8000]
    invoice.submitted_at = datetime.now(timezone.utc)
    invoice.last_error = ""
    reference, number, sticker = _certified_proof(response)
    if reference or number or sticker:
        invoice.fne_reference = reference
        invoice.fne_number = number
        invoice.fne_token = sticker
        invoice.status = STATUS_CERTIFIED
        invoice.certified_at = datetime.now(timezone.utc)
    else:
        invoice.status = STATUS_SUBMITTED
    invoice.updated_at = datetime.now(timezone.utc)
    db.commit()
    return invoice
