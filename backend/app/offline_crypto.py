import base64
import ctypes
import hashlib
import json
import os
import sys
from pathlib import Path

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def protected(value, decrypt=False):
    if sys.platform != "win32":
        raise RuntimeError("Le journal hors ligne nécessite Windows et DPAPI")

    class Blob(ctypes.Structure):
        _fields_ = [("size", ctypes.c_ulong), ("data", ctypes.POINTER(ctypes.c_char))]

    buffer = ctypes.create_string_buffer(value)
    source = Blob(len(value), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_char)))
    result = Blob()
    crypto = ctypes.WinDLL("crypt32", use_last_error=True)
    operation = crypto.CryptUnprotectData if decrypt else crypto.CryptProtectData
    if not operation(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(result)):
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        return ctypes.string_at(result.data, result.size)
    finally:
        ctypes.WinDLL("kernel32").LocalFree(result.data)


def private_key():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048).private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()).decode()


def public_key(private):
    return serialization.load_pem_private_key(private.encode(), password=None).public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo).decode()


def fingerprint(public):
    key = serialization.load_pem_public_key(public.encode())
    if not isinstance(key, rsa.RSAPublicKey) or key.key_size < 2048:
        raise ValueError("Clé RSA invalide")
    return hashlib.sha256(key.public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)).hexdigest()


def sign(private, value):
    key = serialization.load_pem_private_key(private.encode(), password=None)
    return base64.b64encode(key.sign(canonical(value), padding.PKCS1v15(), hashes.SHA256())).decode()


def verify(public, value, signature):
    serialization.load_pem_public_key(public.encode()).verify(base64.b64decode(signature, validate=True), canonical(value), padding.PKCS1v15(), hashes.SHA256())


def persistent_secret(path: Path, create):
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        value = create()
        raw = value.encode() if isinstance(value, str) else value
        blob = b"DPAPI\0" + protected(raw) if sys.platform == "win32" else b"FILE\0" + raw
        try:
            fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        except FileExistsError:
            pass
        else:
            with os.fdopen(fd, "wb") as stream:
                stream.write(blob)
                stream.flush()
                os.fsync(stream.fileno())
    blob = path.read_bytes()
    if blob.startswith(b"DPAPI\0"):
        return protected(blob[6:], decrypt=True)
    if sys.platform == "win32" or not blob.startswith(b"FILE\0"):
        raise ValueError("Clé locale illisible ou non protégée")
    return blob[5:]
