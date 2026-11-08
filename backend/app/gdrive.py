"""Google Drive destination; OAuth credentials never enter the database/archive."""

import base64
import hashlib
import http.client
import ipaddress
import json
import os
import re
import secrets
import shutil
import socket
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone

from . import backup
from .database import SessionLocal
from .models import CompanySettings
from .paths import data_dir, backups_dir
from .version import APP_VERSION

API = "https://www.googleapis.com/drive/v3"
UPLOAD_API = "https://www.googleapis.com/upload/drive/v3/files"
TOKEN_URL = "https://oauth2.googleapis.com/token"
AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
REVOKE_URL = "https://oauth2.googleapis.com/revoke"
SCOPE = "https://www.googleapis.com/auth/drive.file"
CHUNK = 8 * 1024 * 1024
STATE_LOCK = threading.RLock()
UPLOAD_LOCK = threading.Lock()
STATES = {}


class DriveError(RuntimeError):
    def __init__(self, message, *, status=0, retryable=False):
        super().__init__(message)
        self.status = status
        self.retryable = retryable


def _read(name):
    try:
        value = json.loads((data_dir() / name).read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def _write(name, value):
    target = data_dir() / name
    temporary = target.with_suffix(".tmp")
    try:
        with temporary.open("w", encoding="utf-8") as handle:
            if os.name != "nt":
                os.chmod(temporary, 0o600)
            json.dump(value, handle)
        temporary.replace(target)
    finally:
        temporary.unlink(missing_ok=True)


def client_config():
    client_id = os.getenv("EASYGEST_GDRIVE_CLIENT_ID", "").strip()
    secret = os.getenv("EASYGEST_GDRIVE_CLIENT_SECRET", "").strip()
    if client_id or secret:
        return {"client_id": client_id, "client_secret": secret}, True
    return _read("gdrive_client.json"), False


def _credentials():
    config, _ = client_config()
    if not config.get("client_id") or not config.get("client_secret"):
        raise DriveError("Configurez le client OAuth Google Drive (identifiant et secret).")
    return config


def configured_status():
    config, environment = client_config()
    return {
        "client_configured": bool(config.get("client_id") and config.get("client_secret")),
        "client_id_suffix": "…" + str(config.get("client_id", ""))[-6:] if config.get("client_id") else "",
        "client_from_env": environment,
    }


def save_client(client_id, client_secret):
    if client_config()[1]:
        raise DriveError("Le client OAuth est défini par les variables d'environnement.")
    if not client_id.strip() or not client_secret.strip():
        raise DriveError("Renseignez l'identifiant et le secret OAuth.")
    with STATE_LOCK:
        if _read("gdrive_token.json").get("refresh_token"):
            raise DriveError("Déconnectez Google Drive avant de changer de client OAuth.")
        STATES.clear()
        _write("gdrive_client.json", {"client_id": client_id.strip(), "client_secret": client_secret.strip()})
    return configured_status()


def connect(port):
    credentials = _credentials()
    state = secrets.token_urlsafe(32)
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    redirect = f"http://127.0.0.1:{int(port)}/api/backups/drive/callback"
    with STATE_LOCK:
        STATES.clear()
        STATES[state] = (time.monotonic() + 600, verifier, redirect, credentials)
    return {"authorization_url": AUTH_URL + "?" + urllib.parse.urlencode({
        "client_id": credentials["client_id"], "redirect_uri": redirect,
        "response_type": "code", "scope": SCOPE, "state": state,
        "code_challenge": challenge, "code_challenge_method": "S256",
        "access_type": "offline", "prompt": "consent",
    })}


def _settings(db):
    settings = db.query(CompanySettings).first()
    if settings is None:
        raise DriveError("Configuration de l'entreprise introuvable.")
    return settings


def _record(db, status, error="", **values):
    settings = _settings(db)
    settings.drive_last_status = status
    settings.drive_last_error = error
    for key, value in values.items():
        setattr(settings, key, value)
    db.commit()


def _failure(status, payload):
    error = payload.get("error", {}) if isinstance(payload, dict) else {}
    if error == "invalid_grant" or status == 401:
        (data_dir() / "gdrive_token.json").unlink(missing_ok=True)
        return DriveError("Connexion Google Drive expirée ou révoquée : reconnexion requise.", status=status)
    reason = ""
    if isinstance(error, dict):
        errors = error.get("errors", [])
        reason = errors[0].get("reason", "") if errors and isinstance(errors[0], dict) else ""
    if reason == "storageQuotaExceeded":
        return DriveError("Espace Google Drive insuffisant. Libérez de l'espace puis réessayez.", status=status)
    if reason in ("userRateLimitExceeded", "rateLimitExceeded") or status == 429:
        return DriveError("Limite de requêtes Google Drive atteinte. Réessayez plus tard.", status=status, retryable=True)
    if status == 404:
        return DriveError("Fichier ou dossier Google Drive introuvable.", status=404)
    if status == 403:
        return DriveError("Accès Google Drive refusé. Vérifiez les autorisations et l'activation de l'API Drive.", status=status)
    return DriveError("Google Drive est temporairement indisponible." if status >= 500 else "Échec de la demande Google Drive.",
                      status=status, retryable=status >= 500)


def _body(response, limit, deadline):
    chunks, size = [], 0
    while size < limit:
        if deadline and time.monotonic() >= deadline:
            raise DriveError("Délai d'envoi Google Drive dépassé. Réessayez.")
        chunk = response.read1(min(64 * 1024, limit - size))
        if not chunk:
            return b"".join(chunks)
        chunks.append(chunk)
        size += len(chunk)
    return b"".join(chunks)


def _http(method, url, data=None, headers=None, *, deadline=None):
    remaining = deadline - time.monotonic() if deadline else 30
    if remaining <= 0:
        raise DriveError("Délai d'envoi Google Drive dépassé. Réessayez.")
    request = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    try:
        with urllib.request.urlopen(request, timeout=min(30, remaining)) as response:
            return response.status, response.headers, _body(response, backup.MAX_UPLOAD + 1, deadline)
    except urllib.error.HTTPError as exc:
        with exc:
            return exc.code, exc.headers, _body(exc, 1024 * 1024, deadline)
    except (urllib.error.URLError, socket.timeout, TimeoutError, OSError, http.client.HTTPException) as exc:
        raise DriveError("Pas de connexion Internet ou délai Google Drive dépassé.", retryable=True) from exc


def _json(content):
    try:
        value = json.loads(content) if content else {}
        if not isinstance(value, dict):
            raise ValueError()
        return value
    except (ValueError, UnicodeError) as exc:
        raise DriveError("Réponse Google Drive invalide.") from exc


def _pause(attempt, deadline):
    delay = 2 ** attempt
    if deadline and time.monotonic() + delay >= deadline:
        raise DriveError("Délai d'envoi Google Drive dépassé. Réessayez.")
    time.sleep(delay)


def request(method, url, data=None, headers=None, *, deadline=None, retry=True):
    for attempt in range(5 if retry else 1):
        try:
            status, response_headers, content = _http(method, url, data, headers, deadline=deadline)
            if 200 <= status < 300 or status == 308:
                return status, response_headers, content
            try:
                payload = _json(content)
            except DriveError:
                payload = {}
            raise _failure(status, payload)
        except DriveError as exc:
            if not retry or not exc.retryable or attempt == 4:
                raise
            _pause(attempt, deadline)


def _form(url, values, deadline=None):
    return _json(request("POST", url, urllib.parse.urlencode(values).encode(),
                         {"Content-Type": "application/x-www-form-urlencoded"}, deadline=deadline)[2])


def callback(state, code, client_ip, db, error=""):
    try:
        address = ipaddress.ip_address(client_ip)
        address = getattr(address, "ipv4_mapped", None) or address
        if not address.is_loopback:
            raise ValueError()
    except ValueError as exc:
        raise DriveError("Le retour Google doit provenir du poste serveur (boucle locale).") from exc
    with STATE_LOCK:
        pending = STATES.pop(state, None)
    if pending is None or pending[0] <= time.monotonic():
        raise DriveError("Connexion Google expirée ou déjà utilisée. Relancez la connexion.")
    if error or not code:
        raise DriveError("Connexion Google Drive annulée ou refusée.")
    _, verifier, redirect, credentials = pending
    try:
        token = _form(TOKEN_URL, {**credentials, "code": code, "code_verifier": verifier,
                      "redirect_uri": redirect, "grant_type": "authorization_code"})
        if not token.get("refresh_token"):
            raise DriveError("Google n'a pas fourni d'autorisation hors connexion. Relancez la connexion.")
        with STATE_LOCK:
            _write("gdrive_token.json", {"refresh_token": token["refresh_token"]})
        client = Client(access_token=token.get("access_token"))
        info = client.about()
        _record(db, "ok", drive_account_email=info.get("user", {}).get("emailAddress", ""))
    except DriveError as exc:
        _record(db, "erreur", str(exc))
        raise


class Client:
    def __init__(self, access_token=None, deadline=None):
        self.deadline = deadline
        if not access_token:
            credentials = _credentials()
            refresh = _read("gdrive_token.json").get("refresh_token")
            if not refresh:
                raise DriveError("Google Drive n'est pas connecté. Reconnexion requise.")
            token = _form(TOKEN_URL, {**credentials, "refresh_token": refresh, "grant_type": "refresh_token"}, deadline=deadline)
            access_token = token.get("access_token")
        if not isinstance(access_token, str) or not access_token:
            raise DriveError("Renouvellement Google Drive impossible. Reconnexion requise.")
        self.headers = {"Authorization": "Bearer " + access_token}

    def raw(self, method, url, data=None, headers=None, retry=True):
        return request(method, url, data, {**self.headers, **(headers or {})}, deadline=self.deadline, retry=retry)

    def api(self, method, endpoint, query=None, body=None):
        url = API + endpoint
        if query:
            url += "?" + urllib.parse.urlencode(query)
        content = json.dumps(body).encode() if body is not None else None
        return _json(self.raw(method, url, content, {"Content-Type": "application/json"})[2])

    def about(self):
        return self.api("GET", "/about", {"fields": "user(emailAddress),storageQuota"})

    def pages(self, query):
        result = []
        query = {**query, "pageSize": 1000}
        while True:
            page = self.api("GET", "/files", query)
            result.extend(page.get("files", []))
            if not page.get("nextPageToken"):
                return result
            query["pageToken"] = page["nextPageToken"]

    def folder(self, db):
        settings = _settings(db)
        folder_id = settings.drive_folder_id
        if folder_id:
            try:
                found = self.api("GET", "/files/" + _id(folder_id), {"fields": "id,name,mimeType,trashed"})
                if not found.get("trashed") and found.get("mimeType") == "application/vnd.google-apps.folder" and found.get("name") == settings.drive_folder_name:
                    return folder_id
            except DriveError as exc:
                if exc.status != 404:
                    raise
        name = settings.drive_folder_name.replace("\\", "\\\\").replace("'", "\\'")
        found = self.pages({"q": "mimeType='application/vnd.google-apps.folder' and trashed=false and name='" + name + "'",
                            "fields": "nextPageToken,files(id)", "orderBy": "createdTime"})
        folder_id = found[0]["id"] if found else self.api("POST", "/files", body={
            "name": settings.drive_folder_name, "mimeType": "application/vnd.google-apps.folder",
            "appProperties": {"easygest": "1"},
        })["id"]
        settings.drive_folder_id = folder_id
        db.commit()
        return folder_id

    def files(self, folder_id):
        return self.pages({"q": "'" + _id(folder_id) + "' in parents and trashed=false and appProperties has { key='easygest' and value='1' } and mimeType!='application/vnd.google-apps.folder'",
                           "fields": "nextPageToken,files(id,name,size,createdTime,md5Checksum)",
                           "orderBy": "createdTime desc"})

    def delete(self, file_id):
        self.api("DELETE", "/files/" + _id(file_id))

    def upload(self, name, content, folder_id, properties):
        metadata = {"name": name, "parents": [folder_id], "appProperties": properties}
        _, headers, _ = self.raw("POST", UPLOAD_API + "?uploadType=resumable", json.dumps(metadata).encode(), {
            "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": "application/zip",
            "X-Upload-Content-Length": str(len(content)),
        })
        location = headers.get("Location", "")
        parsed = urllib.parse.urlsplit(location)
        if parsed.scheme != "https" or parsed.hostname != "www.googleapis.com":
            raise DriveError("Adresse de transfert Google Drive invalide.")
        offset, failures, result = 0, 0, None
        while result is None:
            end = min(offset + CHUNK, len(content))
            try:
                status, headers, body = self.raw("PUT", location, content[offset:end], {
                    "Content-Length": str(end - offset), "Content-Range": f"bytes {offset}-{end - 1}/{len(content)}",
                }, retry=False)
            except DriveError as exc:
                if not exc.retryable or failures >= 4:
                    raise
                _pause(failures, self.deadline)
                failures += 1
                status, headers, body = self.raw("PUT", location, b"", {
                    "Content-Length": "0", "Content-Range": f"bytes */{len(content)}",
                })
            if status == 308:
                match = re.fullmatch(r"bytes=0-(\d+)", headers.get("Range", ""))
                new_offset = int(match[1]) + 1 if match else 0
                if not 0 <= new_offset < len(content):
                    raise DriveError("Position de reprise Google Drive invalide.")
                if new_offset == offset:
                    failures += 1
                    if failures >= 5:
                        raise DriveError("Le transfert Google Drive ne progresse plus.")
                offset = new_offset
            else:
                result = _json(body)
        file_id = result.get("id", "")
        details = self.api("GET", "/files/" + _id(file_id), {"fields": "id,name,size,md5Checksum"})
        if str(details.get("size")) != str(len(content)) or details.get("md5Checksum") != hashlib.md5(content).hexdigest():
            try:
                self.delete(file_id)
            except DriveError:
                pass
            raise DriveError("Vérification Google Drive échouée : taille ou empreinte MD5 incorrecte.")
        return details


def _id(value):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_-]+", value):
        raise DriveError("Identifiant Google Drive invalide.")
    return value


def status(db):
    settings = _settings(db)
    result = {**configured_status(), "connected": bool(_read("gdrive_token.json").get("refresh_token")),
              "account_email": settings.drive_account_email, "quota_used": None, "quota_limit": None,
              "folder_name": settings.drive_folder_name, "folder_id": settings.drive_folder_id,
              "enabled": settings.drive_enabled, "keep": settings.drive_keep,
              "last_upload_at": settings.drive_last_upload_at.replace(tzinfo=timezone.utc) if settings.drive_last_upload_at else None,
              "last_status": settings.drive_last_status, "last_error": settings.drive_last_error,
              "last_file_id": settings.drive_last_file_id}
    if result["connected"]:
        try:
            info = Client().about()
            result.update(account_email=info.get("user", {}).get("emailAddress", ""),
                          quota_used=info.get("storageQuota", {}).get("usage"), quota_limit=info.get("storageQuota", {}).get("limit"))
        except DriveError as exc:
            _record(db, "erreur", str(exc))
            result.update(connected=bool(_read("gdrive_token.json").get("refresh_token")), last_status="erreur", last_error=str(exc))
    return result


def disconnect(db):
    refresh = _read("gdrive_token.json").get("refresh_token")
    try:
        if refresh:
            _form(REVOKE_URL, {"token": refresh})
    finally:
        with STATE_LOCK:
            STATES.clear()
            (data_dir() / "gdrive_token.json").unlink(missing_ok=True)
        settings = _settings(db)
        settings.drive_enabled = False
        settings.drive_account_email = ""
        db.commit()


def upload_existing(db, path, name=None):
    if not UPLOAD_LOCK.acquire(timeout=5):
        raise DriveError("Un envoi Google Drive est déjà en cours. Réessayez dans quelques instants.")
    try:
        try:
            if path.suffix != ".zip":
                raise DriveError("Seules les archives ZIP EasyGest vérifiées peuvent être envoyées.")
            content = path.read_bytes()
            report = backup.inspect_backup(content)
            if not report["compatible"]:
                raise DriveError("Cette archive provient d'une version plus récente d'EasyGest.")
            _record(db, "en cours")
            client = Client(deadline=time.monotonic() + 180)
            folder_id = client.folder(db)
            result = client.upload(name or path.name, content, folder_id, {
                "easygest": "1", "sha256": hashlib.sha256(content).hexdigest(),
                "app_version": report["app_version"] or APP_VERSION, "created_at": report["created_at"] or datetime.now().astimezone().isoformat(),
            })
            files = client.files(folder_id)
            for entry in files[max(_settings(db).drive_keep, 1):]:
                client.delete(entry["id"])
            _record(db, "ok", drive_last_upload_at=datetime.now(timezone.utc), drive_last_file_id=result["id"])
            return {"status": "ok", "file_id": result["id"], "name": result["name"]}
        except (DriveError, backup.BackupError, OSError) as exc:
            message = str(exc) if isinstance(exc, (DriveError, backup.BackupError)) else "Impossible de lire l'archive locale."
            _record(db, "erreur", message)
            raise DriveError(message) from exc
    finally:
        UPLOAD_LOCK.release()


def enqueue(db, path):
    settings = db.query(CompanySettings).first()
    if settings is None or not settings.drive_enabled:
        return
    pending = data_dir() / ("gdrive-pending-" + uuid.uuid4().hex + ".zip")
    try:
        shutil.copy2(path, pending)

        def send():
            try:
                with SessionLocal() as session:
                    if _settings(session).drive_enabled:
                        upload_existing(session, pending, name=path.name)
            except Exception:
                pass
            finally:
                pending.unlink(missing_ok=True)

        threading.Thread(target=send, daemon=True).start()
    except (OSError, RuntimeError):
        pending.unlink(missing_ok=True)
        _record(db, "erreur", "Impossible de préparer l'envoi Google Drive.")


def test_connection(db):
    try:
        client = Client(deadline=time.monotonic() + 180)
        info = client.about()
        folder_id = client.folder(db)
        content = b"Verification EasyGest Google Drive\n"
        result = client.upload("EasyGest-test-" + uuid.uuid4().hex + ".txt", content, folder_id, {"easygest": "test"})
        client.delete(result["id"])
        _record(db, "ok", drive_account_email=info.get("user", {}).get("emailAddress", ""))
        return {"status": "ok", "detail": "Connexion Google Drive et transfert vérifiés."}
    except DriveError as exc:
        _record(db, "erreur", str(exc))
        raise


def list_files(db):
    client = Client()
    return client.files(client.folder(db))


def download(db, file_id):
    client = Client(deadline=time.monotonic() + 180)
    details = client.api("GET", "/files/" + _id(file_id), {"fields": "id,name,size,md5Checksum,appProperties"})
    if details.get("appProperties", {}).get("easygest") != "1" or not str(details.get("name", "")).endswith(".zip"):
        raise DriveError("Ce fichier n'est pas une sauvegarde EasyGest.")
    try:
        size = int(details["size"])
    except (KeyError, ValueError, TypeError) as exc:
        raise DriveError("Taille de sauvegarde Google Drive invalide.") from exc
    if not 0 < size <= backup.MAX_UPLOAD:
        raise DriveError("Sauvegarde Google Drive trop volumineuse (maximum 512 Mo).")
    content = client.raw("GET", API + "/files/" + _id(file_id) + "?alt=media")[2]
    if len(content) != size or hashlib.md5(content).hexdigest() != details.get("md5Checksum"):
        raise DriveError("Téléchargement Google Drive endommagé (taille ou MD5 incorrect).")
    report = backup.inspect_backup(content)
    name = "EasyGest-sauvegarde-" + datetime.now().strftime("%Y%m%d-%H%M%S") + "-drive-" + uuid.uuid4().hex[:8] + ".zip"
    target = backups_dir() / name
    temporary = target.with_suffix(".tmp")
    try:
        temporary.write_bytes(content)
        temporary.replace(target)
    finally:
        temporary.unlink(missing_ok=True)
    return {"name": name, "inspection": report}
