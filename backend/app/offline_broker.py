import copy
import hashlib
import json
import math
import secrets
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

import bcrypt
from jose import JWTError, jwt

from .offline_auth import AUDIENCE, TOKEN_TYPE
from .offline_crypto import canonical, digest, fingerprint, sign
from .offline_store import OfflineStore
from .payment_totals import group_payments, physical_expected
from .schemas import CashMovementCreate, CashSessionClose, CashSessionOpen, ExpenseCreate, SaleCreate
from .units import base_quantity, cached_packaging, quote_line


class BrokerError(Exception):
    def __init__(self, status, message):
        self.status = status
        self.message = message
        super().__init__(message)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None


class OfflineBroker:
    def __init__(self, root=None):
        self.store = OfflineStore(root)
        self.identity = None
        self.online = False
        self.checking = False
        self.sync_lock = threading.Lock()
        self.last_synced = None

    def _url(self, server):
        parsed = urllib.parse.urlsplit(server)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password or parsed.path not in {"", "/"} or parsed.query or parsed.fragment:
            raise BrokerError(400, "Adresse du serveur invalide")
        return server.rstrip("/")

    def _remote(self, server, path, data=None, token=None, timeout=1.5):
        server = self._url(server)
        with self.store.connection() as db:
            device = self.store.get(db, "device")
        headers = {"Content-Type": "application/json", "X-Workstation-Name": device["id"]}
        if token:
            headers["Authorization"] = "Bearer " + token
        request = urllib.request.Request(server + "/api" + path, data=canonical(data) if data is not None else None, headers=headers)
        try:
            with urllib.request.build_opener(NoRedirect).open(request, timeout=timeout) as response:
                raw = response.read(32_000_001)
                if len(raw) > 32_000_000:
                    raise BrokerError(413, "Réponse serveur trop volumineuse")
                return json.loads(raw)
        except urllib.error.HTTPError as error:
            try:
                detail = json.loads(error.read(8192)).get("detail", "Accès refusé")
            except (ValueError, AttributeError):
                detail = "Réponse serveur invalide"
            raise BrokerError(error.code, detail if isinstance(detail, str) else "Données refusées par le serveur") from None
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            raise ConnectionError("Serveur injoignable") from error

    def bootstrap(self):
        with self.store.connection() as db:
            device = self.store.get(db, "device")
            last = self.store.get(db, "last-login")
            server = last["server"] if last else self.store.get(db, "last-server")
        return {"device_id": device["id"], "locked": self.identity is None, "durable": True, "server": server}

    def _claims(self, auth, server, now, device=None):
        try:
            header = jwt.get_unverified_header(auth["grant"])
            if header.get("alg") != "RS256" or header.get("typ") != TOKEN_TYPE or header.get("kid") != fingerprint(server["public_key"]):
                raise ValueError("En-tête invalide")
            claims = jwt.decode(auth["grant"], server["public_key"], algorithms=["RS256"], audience=AUDIENCE,
                                issuer=server["shop_id"], options={"verify_exp": False, "verify_nbf": False})
            if device is None:
                with self.store.connection() as db:
                    device = self.store.get(db, "device")
            if (claims["device_id"] != device["id"] or claims["cnf"] != fingerprint(device["public_key"])
                    or not claims["nbf"] - 60 <= now < claims["exp"] or claims["exp"] <= claims["auth_at"]):
                raise ValueError("Autorisation expirée ou d'un autre poste")
            if auth.get("denied"):
                raise BrokerError(403, auth["denied"])
            return claims
        except BrokerError:
            raise
        except Exception:
            raise BrokerError(401, "Autorisation hors ligne expirée ou invalide : reconnectez-vous au serveur") from None

    def _auth(self, db, permission=None):
        if self.identity is None:
            raise BrokerError(401, "Connectez-vous avec votre mot de passe sur ce poste")
        if self.checking:
            raise BrokerError(423, "Vérification des droits au retour du serveur, réessayez dans un instant")
        auth = self.store.get(db, self.identity["key"])
        server = self.store.get(db, "server:" + self.identity["server"])
        claims = self._claims(auth, server, self.store.clock(db), self.store.get(db, "device"))
        rights = set(claims["permissions"]) & set(auth.get("rights", claims["permissions"]))
        if permission and permission not in rights:
            raise BrokerError(403, "Droit absent de l'autorisation : " + permission)
        return auth, claims, rights

    def login(self, server, email, password, trusted_fingerprint=None):
        server = self._url(server)
        email = email.strip().lower()
        nonce = secrets.token_urlsafe(32)
        with self.store.connection() as db:
            device = self.store.get(db, "device")
        try:
            response = self._remote(server, "/auth/login", {"email": email, "password": password,
                "offline_device_id": device["id"], "offline_device_public_key": device["public_key"], "offline_nonce": nonce})
        except ConnectionError:
            return self._unlock(server, email, password)
        except BrokerError as error:
            self._deny(server, email, error.message) if error.status in {401, 403} else None
            raise
        self.online = True
        me = self._remote(server, "/auth/me", token=response["access_token"])
        rights = self._remote(server, "/permissions/me", token=response["access_token"])["allowed"]
        if not response.get("offline_grant"):
            self.identity = None
            return {"access_token": response["access_token"], "user": me, "rights": rights, "offline_ready": False,
                    "warning": "Mode hors ligne non autorisé : faites approuver ce poste par l'administrateur"}
        public = response["offline_public_key"]
        with self.store.connection() as db:
            pinned = self.store.get(db, "server:" + server)
        new_pin = pinned is None
        if pinned is None:
            if me["role"] != "admin" or trusted_fingerprint != fingerprint(public):
                self.identity = None
                return {"access_token": response["access_token"], "user": me, "rights": rights, "offline_ready": False,
                        "fingerprint": fingerprint(public), "warning": "Un administrateur doit préparer ce poste une fois et comparer l'empreinte du serveur"}
            untrusted = jwt.get_unverified_claims(response["offline_grant"])
            pinned = {"public_key": public, "shop_id": untrusted["iss"]}
        if pinned["public_key"] != public:
            raise BrokerError(403, "La clé du serveur a changé : validation administrateur nécessaire, aucun ticket effacé")
        auth = {"grant": response["offline_grant"], "rights": rights, "access_token": response["access_token"],
                "verifier": bcrypt.hashpw(hashlib.sha256(password.encode()).digest(), bcrypt.gensalt()).decode(), "denied": None}
        claims = self._claims(auth, pinned, jwt.get_unverified_claims(auth["grant"])["auth_at"])
        if claims.get("login_nonce") != nonce:
            raise BrokerError(403, "Réponse de connexion rejouée : aucune autorisation prolongée")
        with self.store.connection() as db:
            self.store.clock(db, claims["auth_at"])
        if new_pin and claims["user"]["role"] != "admin":
            raise BrokerError(403, "La préparation du poste exige une authentification administrateur")
        auth["user"] = claims["user"]
        key = "auth:" + claims["iss"] + ":" + email
        with self.store.connection() as db:
            self.store.put(db, "server:" + server, pinned)
            self.store.put(db, "login:" + server + ":" + email, key)
            self.store.put(db, key, auth)
            self.store.put(db, "last-login", {"server": server, "key": key, "scope": claims["iss"], "user_id": int(claims["sub"])})
            servers = self.store.get(db, "servers", [])
            self.store.put(db, "servers", list(dict.fromkeys([*servers, server])))
        self.identity = {"server": server, "key": key, "scope": claims["iss"], "user_id": int(claims["sub"])}
        self._delegation(server, auth)
        return {"access_token": response["access_token"], "user": claims["user"], "rights": sorted(set(rights) & set(claims["permissions"])), "offline_ready": True, "expires_at": claims["exp"]}

    def _deny(self, server, email, reason):
        with self.store.connection() as db:
            key = self.store.get(db, "login:" + server + ":" + email)
            auth = self.store.get(db, key) if key else None
            if auth:
                auth["denied"] = reason
                self.store.put(db, key, auth)
        self.identity = None

    def _unlock(self, server, email, password):
        self.online = False
        error = None
        with self.store.connection() as db:
            pinned = self.store.get(db, "server:" + server)
            key = self.store.get(db, "login:" + server + ":" + email)
            auth = self.store.get(db, key) if key else None
            now = self.store.clock(db)
            attempts = self.store.get(db, "attempts:" + server + ":" + email, {"count": 0, "until": 0})
            if attempts["until"] > now:
                error = BrokerError(429, "Trop de tentatives : patientez avant de réessayer")
            elif auth is None or pinned is None or not bcrypt.checkpw(hashlib.sha256(password.encode()).digest(), auth["verifier"].encode()):
                count = attempts["count"] + 1
                self.store.put(db, "attempts:" + server + ":" + email, {"count": count, "until": now + min(300, 2 ** min(count, 9))})
                error = BrokerError(401, "Identifiant ou mot de passe hors ligne incorrect ; une première connexion serveur est obligatoire")
            else:
                self.store.put(db, "attempts:" + server + ":" + email, {"count": 0, "until": 0})
        if error:
            raise error
        claims = self._claims(auth, pinned, now)
        self.identity = {"server": server, "key": key, "scope": claims["iss"], "user_id": int(claims["sub"])}
        rights = sorted(set(claims["permissions"]) & set(auth.get("rights", claims["permissions"])))
        return {"access_token": auth["access_token"], "user": auth.get("user", claims["user"]), "rights": rights, "offline_ready": True, "offline": True, "expires_at": claims["exp"]}

    def account(self):
        with self.store.connection() as db:
            auth, claims, rights = self._auth(db)
        return {"access_token": auth["access_token"], "user": auth.get("user", claims["user"]), "rights": sorted(rights), "expires_at": claims["exp"]}

    def resume(self):
        if self.identity:
            return self.account()
        with self.store.connection() as db:
            candidate = self.store.get(db, "last-login")
        if not candidate:
            return None
        self.online = False
        self.identity = candidate
        self.checking = True
        try:
            self.sync(wait=True)
            if not self.online:
                self.identity = None
                return None
        finally:
            self.checking = False
        return self.account()

    def logout(self):
        with self.store.connection() as db:
            previous = self.store.get(db, "last-login")
            if previous:
                self.store.put(db, "last-server", previous["server"])
            self.store.put(db, "last-login", None)
            self.identity = None
            self.checking = False
        return {"locked": True}

    def import_legacy(self, entries):
        if not isinstance(entries, list) or len(canonical(entries)) > 16_000_000:
            raise BrokerError(413, "Ancienne file trop volumineuse")
        with self.store.connection() as db:
            self._auth(db)
            identifiers = self.store.get(db, "legacy-index", [])
            for entry in entries:
                key = "legacy:" + digest(entry)
                if key not in identifiers:
                    self.store.put(db, key, entry)
                    identifiers.append(key)
            self.store.put(db, "legacy-index", identifiers)
        return {"stored": len(entries)}

    def _delegation(self, server, auth):
        claims = jwt.get_unverified_claims(auth["grant"])
        key = "central:" + claims["jti"]
        with self.store.connection() as db:
            device = self.store.get(db, "device")
            cached = self.store.get(db, key)
            attempted = self.store.get(db, "central-attempt:" + claims["jti"], 0)
            if cached or time.time() - attempted < 300:
                return
            self.store.put(db, "central-attempt:" + claims["jti"], time.time())
        try:
            result = self._remote(server, "/offline/delegation", {"grant": auth["grant"], "signature": sign(device["private_key"], {"grant": auth["grant"]})}, token=auth["access_token"], timeout=5)
            with self.store.connection() as db:
                pinned = self.store.get(db, "server:" + server)
            proof = result.pop("proof")
            signed = jwt.decode(proof, pinned["public_key"], algorithms=["RS256"], audience="easygest-offline-delegation", issuer=pinned["shop_id"])
            if signed["hash"] != digest(result):
                return
            body = jwt.decode(result["token"], result["public_key"], algorithms=["RS256"], audience="easygest-central-offline-upload", issuer="easygest-central-offline")
            if body["sub"] != claims["jti"] or body["device_id"] != device["id"]:
                return
            with self.store.connection() as db:
                self.store.put(db, key, result)
        except (BrokerError, ConnectionError, JWTError, ValueError, KeyError):
            return

    def _push_central(self, scope):
        with self.store.connection() as db:
            entries = self.store.events(db, scope)
            groups = {}
            for item in entries:
                event = item["envelope"]["event"]
                if event["kind"] != "sale" or self.store.get(db, "central-ack:" + event["id"]):
                    continue
                grant_id = jwt.get_unverified_claims(event["grant"])["jti"]
                delegated = self.store.get(db, "central:" + grant_id)
                if delegated:
                    groups.setdefault(grant_id, {"credential": delegated, "events": []})["events"].append(item["envelope"])
        for group in groups.values():
            credential = group["credential"]
            batch = []
            for envelope in group["events"][:20]:
                if len(canonical([*batch, envelope])) > 2_800_000:
                    break
                batch.append(envelope)
            if not batch:
                continue
            try:
                answer = self._remote(credential["url"], "/central/public/offline/events", {"token": credential["token"], "events": batch}, timeout=3)
                proof = jwt.decode(answer["proof"], credential["public_key"], algorithms=["RS256"], audience="easygest-central-offline-ack", issuer="easygest-central-offline")
                if proof["hash"] != digest(answer["accepted"]):
                    continue
                expected = {row["event"]["id"]: digest(row["event"]) for row in batch}
                with self.store.connection() as db:
                    for ack in answer["accepted"]:
                        if expected.get(ack["id"]) == ack["hash"]:
                            self.store.put(db, "central-ack:" + ack["id"], ack)
            except (BrokerError, ConnectionError, JWTError, ValueError, KeyError):
                continue

    def _session_key(self):
        return "session:" + self.identity["scope"] + ":" + str(self.identity["user_id"])

    def remember(self, path, data, access_token=None):
        allowed = ("/settings/", "/categories", "/customers", "/cash-sessions", "/license")
        if not path.startswith(allowed) or len(canonical(data)) > 16_000_000:
            return {"cached": False}
        with self.store.connection() as db:
            auth, _, _ = self._auth(db)
            if not access_token or access_token != auth["access_token"]:
                return {"cached": False}
            self.store.put(db, "cache:" + self._session_key() + ":" + path, data)
        return {"cached": True}

    def catalogue(self, images=False):
        with self.store.connection() as db:
            auth, claims, rights = self._auth(db, "vente_nouvelle")
            selected = dict(self.identity)
            key = "catalogue:" + claims["iss"] + ":" + claims["sub"] + ":" + str(bool(images))
            cached = self.store.get(db, key)
            server = self.identity["server"]
            pinned = self.store.get(db, "server:" + server)
        if self.online or cached is None:
            try:
                fresh = self._remote(server, "/offline/catalogue?images=" + str(bool(images)).lower() + "&device_id=" + self.bootstrap()["device_id"], token=auth["access_token"], timeout=6)
                proof = jwt.decode(fresh["proof"], pinned["public_key"], algorithms=["RS256"], audience="easygest-offline-catalogue", issuer=claims["iss"])
                if proof["hash"] != digest(fresh["payload"]) or proof["snapshot_id"] != fresh["snapshot_id"] or proof["sub"] != claims["sub"]:
                    raise BrokerError(403, "Signature du catalogue invalide")
                cached = {**fresh, "at": time.time()}
                with self.store.connection() as db:
                    if self.identity != selected:
                        raise BrokerError(423, "Identité changée pendant le téléchargement du catalogue")
                    self.store.put(db, key, cached)
                    self.store.put(db, "active-catalogue:" + self._session_key(), key)
            except ConnectionError:
                self.online = False
        if cached is None:
            raise BrokerError(409, "Aucun catalogue local : connectez ce poste une première fois au serveur")
        rows = copy.deepcopy(cached["payload"]["products"])
        covered = set(cached["payload"].get("covered_event_ids", []))
        with self.store.connection() as db:
            events = self.store.events(db, claims["iss"], int(claims["sub"]))
        quantities = {}
        for item in events:
            event = item["envelope"]["event"]
            if event["kind"] == "sale" and event["id"] not in covered:
                for line in event["payload"]["sale"]["items"]:
                    quantities[line["product_id"]] = quantities.get(line["product_id"], 0) + line["quantity"]
        for product in rows:
            if isinstance(product.get("quantity"), (float, int)):
                product["quantity"] = round(product["quantity"] - quantities.get(product["id"], 0), 6)
            if not {"produits", "inventaire"}.intersection(rights):
                for field in ("quantity", "min_stock", "quantity_label"):
                    product.pop(field, None)
        if self.online and not cached["payload"]["company"].get("allow_negative_stock_sale"):
            visible = set(cached["payload"].get("visible_online_ids", [row["id"] for row in rows]))
            rows = [row for row in rows if row["id"] in visible]
        return {"data": rows, "fromCache": not self.online, "cached_at": cached["at"]}

    def _local_session(self, db, claims, adopt=False):
        session = self.store.get(db, self._session_key())
        if session and not session.get("closed_at"):
            return session
        if adopt:
            source = self.store.get(db, "cache:" + self._session_key() + ":/cash-sessions/current")
            previous = session.get("server_session_id", session.get("baseline", {}).get("id")) if session else None
            if source and not source.get("closed_at") and source["id"] != previous:
                return self._open(db, claims, {"opening_balance": source.get("opening_balance") or 0, "note": source.get("note") or ""}, source)
        return None

    def _open(self, db, claims, payload, source=None):
        data = CashSessionOpen.model_validate(payload)
        if not math.isfinite(data.opening_balance) or data.opening_balance < 0:
            raise BrokerError(400, "Fonds initial invalide")
        if self._local_session(db, claims):
            raise BrokerError(409, "Votre caisse provisoire est déjà ouverte")
        session_id = str(uuid.uuid4())
        baseline = copy.deepcopy(source) if source else {}
        session = {"uuid": session_id, "id": -int(uuid.UUID(session_id).hex[:12], 16), "baseline": baseline,
                   "opened_at": datetime.fromtimestamp(self.store.clock(db), timezone.utc).isoformat(),
                   "opening_balance": data.opening_balance, "closed_at": None, "note": data.note,
                   "mobile_money_to_cash": claims["mobile_money_to_cash"], "covered_event_ids": []}
        self.store.append(db, claims["iss"], int(claims["sub"]), session_id, "open",
                          {**data.model_dump(mode="json"), "source_session_id": source["id"] if source else None}, self.store.get(db, self.identity["key"])["grant"])
        self.store.put(db, self._session_key(), session)
        sessions = self.store.get(db, "sessions:" + self._session_key(), [])
        self.store.put(db, "sessions:" + self._session_key(), [*sessions, session_id])
        return session

    def sale(self, payload, snapshot):
        with self.store.connection() as db:
            auth, claims, rights = self._auth(db, "vente_nouvelle")
            session = self._local_session(db, claims, adopt=True)
            if session is None:
                raise BrokerError(409, "Ouvrez votre caisse provisoire avant la vente")
            cached = self.store.get(db, self.store.get(db, "active-catalogue:" + self._session_key(), ""))
            if cached is None:
                raise BrokerError(409, "Catalogue signé absent de ce poste")
            requested_session = payload.get("cash_session_id")
            if requested_session is not None and requested_session not in {session["id"], session.get("server_session_id"), session.get("baseline", {}).get("id")}:
                raise BrokerError(409, "Le panier appartient à une autre caisse ; vente non enregistrée")
            data = SaleCreate.model_validate({**payload, "cash_session_id": None})
            if data.status != "Payée" or not data.items:
                raise BrokerError(400, "Ticket invalide")
            products = {row["id"]: row for row in cached["payload"]["products"]}
            total = 0
            normalized = []
            for line in data.items:
                product = products.get(line.product_id)
                if product is None:
                    raise BrokerError(409, "Article absent du catalogue signé")
                spec = cached_packaging(product, line.packaging_id)
                quantity = base_quantity(line, spec)
                if quantity <= 0:
                    raise BrokerError(400, "Quantité positive requise")
                line = line.model_copy(update={"quantity": quantity})
                *_, price = quote_line(SimpleNamespace(**product), spec, line, data.price_mode)
                edited = line.price_edited or (line.discount or 0) > 0 or data.discount > 0
                if line.unit_price is not None and abs(line.unit_price - price) > 0.000001:
                    edited = True
                if edited and "prix_modifier" not in rights:
                    raise BrokerError(403, "Modification de prix non autorisée hors ligne")
                price = line.unit_price if line.unit_price is not None else price
                if not math.isfinite(price) or price < 0:
                    raise BrokerError(400, "Prix invalide")
                total += price * quantity - min(line.discount or 0, price * quantity)
                normalized.append(line.model_dump(mode="json"))
            total = max(total - data.discount, 0)
            if data.is_gift and "ventes_cadeau" not in rights:
                raise BrokerError(403, "Vente cadeau non autorisée")
            if not math.isfinite(float(snapshot["total"])) or abs(total - snapshot["total"]) > 0.01:
                raise BrokerError(409, "Le reçu ne correspond pas aux quantités et tarifs autorisés")
            if data.payments is not None and (not data.payments or abs(sum(leg.amount for leg in data.payments) - total) > 0.01):
                raise BrokerError(400, "Paiement mixte : somme différente du ticket")
            event_id = data.client_id or str(uuid.uuid4())
            uuid.UUID(event_id)
            sale = {**data.model_dump(mode="json"), "client_id": event_id, "items": normalized}
            existing = db.execute("SELECT body FROM events WHERE id=?", (event_id,)).fetchone()
            if existing:
                original = self.store.open(existing[0])["event"]
                if original["scope"] != claims["iss"] or original["user_id"] != int(claims["sub"]) or original["kind"] != "sale" or original["payload"]["sale"] != sale:
                    raise BrokerError(409, "Ce ticket est déjà conservé avec un autre contenu. Vérifiez l'original, ne le ressaisissez pas.")
                return original["payload"]["snapshot"]
            receipt = {**snapshot, "client_id": event_id, "reference": "HL-" + event_id[:12]}
            self.store.append(db, claims["iss"], int(claims["sub"]), session["uuid"], "sale",
                {"sale": sale, "snapshot": receipt, "catalogue_id": cached["snapshot_id"]}, auth["grant"], event_id)
            return receipt

    def _detail(self, db, session, claims, rights):
        result = {"sales": [], "expenses": [], "expenses_total": 0, "cash_expenses": 0, "entries_total": 0, "exits_total": 0,
                  "cash_sales": 0, "other_sales": 0, "mobile_money_sales": 0, "sales_count": 0, "total_sales": 0,
                  "cash_refunds": 0, "refunds_total": 0, "cash_settlements": 0, "deposits_total": 0, "payments": {}, **session.get("baseline", {}),
                  "id": session["id"], "opened_at": session["opened_at"], "opening_balance": session["opening_balance"],
                  "opened_by": claims["user"], "closed_at": session.get("closed_at"), "note": session["note"],
                  "business_day": session["opened_at"][:10], "provisional_uuid": session["uuid"], "mobile_money_to_cash": session["mobile_money_to_cash"]}
        payments = dict(result.get("payments") or {})
        entries = exits = cash_expenses = mobile_expenses = 0
        covered = set(session.get("covered_event_ids", []))
        movements = []
        for item in self.store.events(db, claims["iss"], int(claims["sub"])):
            event = item["envelope"]["event"]
            if event["session_id"] != session["uuid"] or event["id"] in covered:
                continue
            payload = event["payload"]
            if event["kind"] == "sale":
                sale = payload["sale"]
                if not sale.get("is_gift"):
                    for leg in sale.get("payments") or [{"method": sale["payment_method"], "amount": payload["snapshot"]["total"]}]:
                        payments[leg["method"]] = payments.get(leg["method"], 0) + leg["amount"]
                    result["total_sales"] = (result.get("total_sales") or 0) + payload["snapshot"]["total"]
                    result["sales_count"] = (result.get("sales_count") or 0) + 1
                result["sales"] = [*(result.get("sales") or []), payload["snapshot"]]
            elif event["kind"] == "movement":
                entries += payload["amount"] if payload["type"] == "in" else 0
                exits += payload["amount"] if payload["type"] == "out" else 0
                movements.append({**payload, "id": -int(uuid.UUID(event["id"]).hex[:12], 16), "session_id": session["id"], "user_id": int(claims["sub"]), "created_at": datetime.fromtimestamp(event["occurred_at"], timezone.utc).isoformat(), "workstation": event["device_id"]})
            elif event["kind"] == "expense":
                groups = group_payments({payload.get("payment_method") or "": payload["amount"]})
                cash_expenses += groups["cash"]
                mobile_expenses += groups["mobile_money"]
                result["expenses_total"] = (result.get("expenses_total") or 0) + payload["amount"]
                result["expenses"] = [*(result.get("expenses") or []), payload]
        groups = group_payments(payments)
        baseline = session.get("baseline") or {}
        old_groups = group_payments(baseline.get("payments") or {})
        mobile_adjustment = groups["mobile_money"] - old_groups["mobile_money"] - mobile_expenses if session["mobile_money_to_cash"] else 0
        starting = baseline.get("expected_cash") if baseline else session["opening_balance"]
        expected = physical_expected(starting or 0, groups["cash"] - old_groups["cash"], entries=entries, exits=exits, cash_expenses=cash_expenses, mobile_adjustment=mobile_adjustment)
        result.update(payments=payments, payment_groups=groups, cash_sales=groups["cash"], mobile_money_sales=groups["mobile_money"],
            other_sales=sum(payments.values()) - groups["cash"], expected_cash=expected,
            entries_total=(baseline.get("entries_total") or 0) + entries, exits_total=(baseline.get("exits_total") or 0) + exits,
            cash_expenses=(baseline.get("cash_expenses") or 0) + cash_expenses, movements=movements)
        result["net_sales"] = (result.get("total_sales") or 0) - (result.get("refunds_total") or 0)
        if session.get("closing"):
            result.update(session["closing"])
        if "soldes_consulter" not in rights:
            for key in ("opening_balance", "expected_cash", "cash_sales", "mobile_money_sales", "other_sales", "entries_total", "exits_total", "expenses_total", "cash_expenses", "total_sales", "net_sales", "payments", "payment_groups", "closing_balance", "kept_balance", "remitted_amount", "difference"):
                result[key] = None
        return result

    def request(self, method, path, data=None):
        method = method.upper()
        path = path.split("?")[0]
        with self.store.connection() as db:
            auth, claims, rights = self._auth(db)
            if path.startswith("/cash-sessions") and "caisse" not in rights:
                raise BrokerError(403, "Consultation de caisse non autorisée")
            session = self._local_session(db, claims, adopt=method == "GET" and path.startswith("/cash-sessions"))
            if method == "GET":
                if path == "/auth/me":
                    return claims["user"]
                if path == "/permissions/me":
                    return {"allowed": sorted(rights), "role": claims["user"]["role"]}
                if path in {"/cash-sessions/current", "/cash-sessions/today"}:
                    today = session or self.store.get(db, self._session_key())
                    if path.endswith("current") and today and today.get("closed_at"):
                        return None
                    return self._detail(db, today, claims, rights) if today else None
                if path == "/cash-sessions":
                    latest = self.store.get(db, self._session_key())
                    return [self._detail(db, latest, claims, rights)] if latest else []
                if path.startswith("/cash-sessions/") and path.endswith(("/movements", "/z")):
                    today = session or self.store.get(db, self._session_key())
                    detail = self._detail(db, today, claims, rights) if today else None
                    return detail["movements"] if path.endswith("/movements") and detail else detail or []
                if path == "/settings/company" or path == "/settings/pos-display":
                    cached = self.store.get(db, self.store.get(db, "active-catalogue:" + self._session_key(), ""))
                    if cached:
                        return cached["payload"]["company" if path.endswith("company") else "display"]
                if path in {"/settings/printing", "/categories", "/customers"}:
                    if path == "/customers" and "clients" not in rights:
                        raise BrokerError(403, "Consultation des clients non autorisée")
                    cached = self.store.get(db, self.store.get(db, "active-catalogue:" + self._session_key(), ""))
                    field = {"/settings/printing": "printing", "/categories": "categories", "/customers": "customers"}[path]
                    if cached and field in cached["payload"]:
                        return cached["payload"][field]
                if path == "/license":
                    return {"mode": "offline", "features": claims.get("features", []), "catalogue": [], "blocked": False, "status": "active"}
                cached = self.store.get(db, "cache:" + self._session_key() + ":" + path)
                if cached is not None:
                    return cached
                raise BrokerError(503, "Ces données ne sont pas encore disponibles sur ce poste")
            if method == "POST" and path == "/cash-sessions/open":
                if "caisse" not in rights:
                    raise BrokerError(403, "Ouverture de caisse non autorisée")
                return self._detail(db, self._open(db, claims, data), claims, rights)
            if session is None:
                raise BrokerError(409, "Ouvrez votre caisse provisoire")
            if method == "POST" and path == "/cash-sessions/movements":
                payload = CashMovementCreate.model_validate(data)
                required = "recette_enregistrer" if payload.type == "in" and "recette_enregistrer" in rights else "caisse_operations"
                if required not in rights or payload.return_id is not None:
                    raise BrokerError(403, "Opération de caisse non autorisée hors ligne")
                kind = "movement"
            elif method == "POST" and path == "/accounting/expenses":
                if "depenses_gerer" not in rights:
                    raise BrokerError(403, "Dépense non autorisée")
                payload = ExpenseCreate.model_validate(data)
                if not math.isfinite(payload.amount) or payload.amount <= 0 or payload.bank_account_id:
                    raise BrokerError(400, "Dépense hors ligne : montant positif, sans opération bancaire")
                kind = "expense"
            elif method == "POST" and path == "/cash-sessions/close":
                if "caisse_fermer" not in rights:
                    raise BrokerError(403, "Clôture non autorisée")
                payload = CashSessionClose.model_validate(data)
                detail = self._detail(db, session, claims, rights)
                if not math.isfinite(payload.closing_balance) or payload.closing_balance < 0 or (payload.kept_balance or 0) > payload.closing_balance:
                    raise BrokerError(400, "Montants de clôture invalides")
                gap = payload.closing_balance - (detail["expected_cash"] or 0)
                if ("soldes_consulter" not in rights or abs(gap) >= 1) and not payload.note.strip():
                    raise BrokerError(400, "Une justification de clôture est obligatoire")
                session["closed_at"] = datetime.fromtimestamp(self.store.clock(db), timezone.utc).isoformat()
                session["closing"] = {"closing_balance": payload.closing_balance, "kept_balance": payload.kept_balance,
                    "remitted_amount": payload.closing_balance - payload.kept_balance if payload.kept_balance is not None else None, "difference": gap}
                kind = "close"
            else:
                raise BrokerError(503, "Cette opération nécessite le serveur ; aucune donnée locale effacée")
            envelope = self.store.append(db, claims["iss"], int(claims["sub"]), session["uuid"], kind, payload.model_dump(mode="json"), auth["grant"])
            if kind == "close":
                session["closing_event_id"] = envelope["event"]["id"]
            self.store.put(db, self._session_key(), session)
            if kind == "close":
                return self._detail(db, session, claims, rights)
            return {**payload.model_dump(mode="json"), "id": -int(uuid.UUID(envelope["event"]["id"]).hex[:12], 16), "session_id": session["id"], "user_id": int(claims["sub"]), "created_at": datetime.now(timezone.utc).isoformat()}

    def state(self):
        with self.store.connection() as db:
            if self.identity and not self.checking:
                try:
                    self._auth(db)
                except (BrokerError, ValueError):
                    self.identity = None
            servers = self.store.get(db, "servers", [])
            current = self.identity
            entries = []
            for server in servers:
                scope = self.store.get(db, "server:" + server)["shop_id"]
                for item in self.store.events(db, scope, pending=True):
                    event = item["envelope"]["event"]
                    visible = current and current["scope"] == scope and current["user_id"] == event["user_id"]
                    entries.append({"id": event["id"], "kind": event["kind"], "state": item["state"],
                        "reference": event["payload"].get("snapshot", {}).get("reference", event["kind"]) if visible else "Opération conservée",
                        "reason": (item["result"] or {}).get("reason", "") if visible else ""})
            local = self.store.get(db, self._session_key()) if current else None
            for key in self.store.get(db, "legacy-index", []):
                entry = self.store.get(db, key)
                visible = current and entry.get("scope") == current["server"] + ":" + str(current["user_id"])
                entries.append({"id": key, "kind": "sale", "state": "conflict", "reference": entry.get("snapshot", {}).get("reference", "Ancien ticket") if visible else "Ancien ticket conservé", "reason": "Ancienne file sans preuve signée : rapprochement administrateur nécessaire, ne pas ressaisir"})
            close = db.execute("SELECT state FROM events WHERE id=?", (local.get("closing_event_id"),)).fetchone() if local and local.get("closed_at") else None
        return {"online": self.online, "locked": current is None, "checking": self.checking,
                "pending": entries, "last_synced": self.last_synced, "journal_session": bool(local and (not local.get("closed_at") or not close or close["state"] != "applied"))}

    def sync(self, wait=False):
        if not self.sync_lock.acquire(blocking=wait):
            return self.state()
        revoked = False
        synced = 0
        try:
            with self.store.connection() as db:
                servers = self.store.get(db, "servers", [])
            for server in servers:
                try:
                    health = self._remote(server, "/health", timeout=0.8)
                    if health.get("status") != "ok" or health.get("app") != "EasyGest":
                        continue
                except (ConnectionError, BrokerError):
                    if self.identity and self.identity["server"] == server:
                        self.online = False
                    with self.store.connection() as db:
                        scope = self.store.get(db, "server:" + server)["shop_id"]
                    self._push_central(scope)
                    continue
                pinned = None
                with self.store.connection() as db:
                    pinned = self.store.get(db, "server:" + server)
                    device = self.store.get(db, "device")
                selected = dict(self.identity) if self.identity and self.identity["server"] == server else None
                if selected:
                    self.checking = True
                    try:
                        with self.store.connection() as db:
                            auth = self.store.get(db, selected["key"])
                            counter = self.store.get(db, "auth-counter", 0) + 1
                            self.store.put(db, "auth-counter", counter)
                        proof = {"device_id": device["id"], "grant": auth["grant"], "counter": counter}
                        status = self._remote(server, "/offline/status", {**proof, "signature": sign(device["private_key"], proof)}, timeout=5)
                        signature = status.pop("proof")
                        verified = jwt.decode(signature, pinned["public_key"], algorithms=["RS256"], audience="easygest-offline-status", issuer=pinned["shop_id"])
                        if verified["hash"] != digest(status) or verified["counter"] != counter:
                            raise BrokerError(403, "Réponse de droits non authentifiée")
                        with self.store.connection() as db:
                            if self.identity != selected:
                                raise BrokerError(423, "Identité changée pendant la synchronisation")
                            auth.update(access_token=status["access_token"], rights=status["rights"], user=status["user"])
                            self.store.put(db, selected["key"], auth)
                            self.store.clock(db, status["server_time"])
                            local = self.store.get(db, self._session_key())
                            mapping = next((row for row in status["sessions"] if local and row["id"] == local["uuid"]), None)
                            if local and mapping and status["cash_session"] and status["cash_session"]["id"] == mapping["cash_session_id"]:
                                local.update(baseline=status["cash_session"], covered_event_ids=status["covered_event_ids"], server_session_id=mapping["cash_session_id"])
                                self.store.put(db, self._session_key(), local)
                        self.online = True
                        self._delegation(server, auth)
                    except BrokerError as error:
                        if error.status in {401, 403, 409}:
                            with self.store.connection() as db:
                                auth["denied"] = error.message
                                self.store.put(db, selected["key"], auth)
                            if self.identity == selected:
                                self.identity = None
                            revoked = True
                        self.online = False
                    except ConnectionError:
                        self.online = False
                    except (JWTError, KeyError, TypeError, ValueError):
                        with self.store.connection() as db:
                            auth["denied"] = "Réponse de droits non authentifiée : reconnectez-vous au serveur"
                            self.store.put(db, selected["key"], auth)
                        if self.identity == selected:
                            self.identity = None
                        self.online = False
                        revoked = True
                    finally:
                        self.checking = False
                with self.store.connection() as db:
                    entries = self.store.events(db, pinned["shop_id"], pending=True)
                    fresh = [item for item in entries if item["state"] != "conflict"]
                    conflicts = [item for item in entries if item["state"] == "conflict"]
                    cursor = self.store.get(db, "conflict-cursor:" + server, 0)
                    if conflicts:
                        cursor %= len(conflicts)
                        conflicts = conflicts[cursor:] + conflicts[:cursor]
                        self.store.put(db, "conflict-cursor:" + server, cursor + 20)
                    entries = fresh[:80] + conflicts[:20]
                for offset in range(0, min(len(entries), 100), 20):
                    batch = [item["envelope"] for item in entries[offset:offset + 20]]
                    try:
                        response = self._remote(server, "/offline/events", {"events": batch}, timeout=8)
                        proof = jwt.decode(response["proof"], pinned["public_key"], algorithms=["RS256"], audience="easygest-offline-ack", issuer=pinned["shop_id"])
                        if proof["hash"] != digest(response["results"]):
                            raise BrokerError(403, "Accusé de réception non authentifié")
                        with self.store.connection() as db:
                            for result in response["results"]:
                                self.store.acknowledge(db, result["id"], result)
                                synced += int(result["state"] == "applied")
                    except (BrokerError, ConnectionError):
                        break
                self._push_central(pinned["shop_id"])
            result = self.state()
            if synced and not result["pending"]:
                self.last_synced = datetime.now(timezone.utc).isoformat()
                result["last_synced"] = self.last_synced
            result["revoked"] = revoked
            result["synced"] = synced
            return result
        finally:
            self.sync_lock.release()
