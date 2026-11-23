import base64
import getpass
import json
import os
import secrets
import sqlite3
import subprocess
import sys
import threading
import time
import uuid
from contextlib import contextmanager
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from .offline_crypto import canonical, digest, persistent_secret, private_key, public_key, sign
from .licensing import installation_uid


def local_events_pending():
    if sys.platform != "win32":
        return False
    root = Path(os.environ.get("EASYGEST_OFFLINE_HOME") or Path(os.environ["LOCALAPPDATA"]) / "EasyGest" / "offline")
    path = root / "journal.sqlite3"
    try:
        path.stat()
    except FileNotFoundError:
        return False
    db = sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True, timeout=5)
    try:
        return db.execute("SELECT 1 FROM events WHERE scope=? AND state!='applied' LIMIT 1", (installation_uid(),)).fetchone() is not None
    finally:
        db.close()


class OfflineStore:
    def __init__(self, root=None):
        if sys.platform != "win32":
            raise RuntimeError("Journal Windows indisponible sur cette plateforme")
        self.root = Path(root or os.environ.get("EASYGEST_OFFLINE_HOME") or Path(os.environ["LOCALAPPDATA"]) / "EasyGest" / "offline")
        self.root.mkdir(parents=True, exist_ok=True)
        account = os.environ.get("USERDOMAIN", "") + "\\" + getpass.getuser()
        subprocess.run(["icacls", str(self.root), "/inheritance:r", "/grant:r", f"{account}:(OI)(CI)F", "SYSTEM:(OI)(CI)F"], check=True, capture_output=True, creationflags=0x08000000)
        self.cipher = AESGCM(persistent_secret(self.root / "journal.key", lambda: secrets.token_bytes(32)))
        self.lock = threading.RLock()
        with self.connection() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS documents (key TEXT PRIMARY KEY, value BLOB NOT NULL);
                CREATE TABLE IF NOT EXISTS events (
                    id TEXT PRIMARY KEY, scope TEXT NOT NULL, user_id INTEGER NOT NULL,
                    session_id TEXT NOT NULL, sequence INTEGER NOT NULL, kind TEXT NOT NULL,
                    hash TEXT NOT NULL, body BLOB NOT NULL, state TEXT NOT NULL DEFAULT 'pending',
                    result BLOB, UNIQUE(scope,session_id,sequence));
                CREATE INDEX IF NOT EXISTS ix_offline_delivery ON events(scope,state,sequence);
            """)
            db.execute("BEGIN IMMEDIATE")
            if self.get(db, "device") is None:
                key = private_key()
                self.put(db, "device", {"id": str(uuid.uuid4()), "private_key": key, "public_key": public_key(key)})

    @contextmanager
    def connection(self):
        with self.lock:
            db = sqlite3.connect(self.root / "journal.sqlite3", timeout=15)
            db.row_factory = sqlite3.Row
            db.execute("PRAGMA journal_mode=WAL")
            db.execute("PRAGMA synchronous=FULL")
            try:
                db.execute("BEGIN IMMEDIATE")
                yield db
                db.commit()
            except BaseException:
                db.rollback()
                raise
            finally:
                db.close()

    def seal(self, value):
        nonce = secrets.token_bytes(12)
        return nonce + self.cipher.encrypt(nonce, canonical(value), b"EasyGest-offline-v1")

    def open(self, blob):
        return json.loads(self.cipher.decrypt(blob[:12], blob[12:], b"EasyGest-offline-v1"))

    def get(self, db, key, default=None):
        row = db.execute("SELECT value FROM documents WHERE key=?", (key,)).fetchone()
        return self.open(row[0]) if row else default

    def put(self, db, key, value):
        db.execute("INSERT INTO documents(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, self.seal(value)))

    def clock(self, db, server_time=None):
        now = time.time()
        last = self.get(db, "clock", {"wall": now, "offset": 0})
        if server_time is None and now < last["wall"] - 60:
            raise ValueError("Horloge reculée : reconnectez le poste au serveur")
        offset = float(server_time) - now if server_time is not None else last["offset"]
        self.put(db, "clock", {"wall": now if server_time is not None else max(now, last["wall"]), "offset": offset})
        return now + offset

    def append(self, db, scope, user_id, session_id, kind, payload, grant, event_id=None):
        device = self.get(db, "device")
        event_id = event_id or str(uuid.uuid4())
        existing = db.execute("SELECT body FROM events WHERE id=?", (event_id,)).fetchone()
        if existing:
            envelope = self.open(existing[0])
            event = envelope["event"]
            if event["scope"] != scope or event["user_id"] != user_id or event["session_id"] != session_id or event["payload"] != payload or event["kind"] != kind:
                raise ValueError("UUID déjà utilisé avec un contenu différent")
            return envelope
        sequence = db.execute("SELECT coalesce(max(sequence),0)+1 FROM events WHERE scope=? AND session_id=?", (scope, session_id)).fetchone()[0]
        event = {"id": event_id, "v": 1, "scope": scope, "device_id": device["id"], "user_id": user_id,
                 "session_id": session_id, "sequence": sequence, "kind": kind,
                 "occurred_at": self.clock(db), "grant": grant, "payload": payload}
        envelope = {"event": event, "signature": sign(device["private_key"], event)}
        db.execute("INSERT INTO events(id,scope,user_id,session_id,sequence,kind,hash,body) VALUES (?,?,?,?,?,?,?,?)", (event_id, scope, user_id, session_id, sequence, kind, digest(event), self.seal(envelope)))
        return envelope

    def events(self, db, scope, user_id=None, pending=False):
        query = "SELECT * FROM events WHERE scope=?"
        args = [scope]
        if user_id is not None:
            query += " AND user_id=?"
            args.append(user_id)
        if pending:
            query += " AND state!='applied'"
        rows = db.execute(query + " ORDER BY rowid", args).fetchall()
        return [{"envelope": self.open(row["body"]), "state": row["state"], "result": self.open(row["result"]) if row["result"] else None} for row in rows]

    def acknowledge(self, db, event_id, result):
        row = db.execute("SELECT hash FROM events WHERE id=?", (event_id,)).fetchone()
        if row is None or result.get("hash") != row["hash"] or result.get("state") not in {"applied", "conflict", "received"}:
            raise ValueError("Accusé de réception invalide")
        db.execute("UPDATE events SET state=?,result=? WHERE id=?", (result["state"], self.seal(result), event_id))
