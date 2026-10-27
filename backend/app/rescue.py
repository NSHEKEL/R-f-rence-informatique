"""Clé de secours signée par l'éditeur, valable sur un seul poste.

Quand une installation n'a plus de clé de récupération locale — personne ne
l'avait générée avant l'incident — le propriétaire du logiciel peut en émettre
une depuis sa console : elle contient le code d'installation du poste et une
date d'expiration, et elle est signée avec la clé privée de l'éditeur.

Le poste vérifie la signature avec la clé publique ci-dessous, embarquée dans
le programme. Une clé émise pour un autre poste, périmée ou modifiée est
refusée, et chaque clé ne sert qu'une fois : il n'y a donc ni mot de passe
universel ni porte dérobée permanente.
"""

from jose import JWTError, jwt

SCOPE = "rescue"
ALGORITHM = "RS256"

# Public half of the publisher key pair; the private half never leaves the
# central server. Publishing it here is harmless: it only verifies.
PUBLISHER_PUBLIC_KEY = """-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtntghlFdECB4ko7vBsK4
Q0OSZFZslMcM5yqNKVOGjKqR7cEcdO7SUIspUY4OVoArZDTHOL0DizTQWGZSWFig
hWuBYt7ktoNTaN+w9VxKK67dDvvlKxyZ3v+Dd2Xog79ktVFFVXh3mpgEfDSMtaEW
X4vTMsIMQQimmnXxc2UuIRgJnG8fqK0RkpVzButXwOEsaT5xBpe4yB2LkoferNJO
VuoBJ2B3gT3u4296PUNXyIj+OtAzMF542rqVVoqVPX2TKqOrfo8FabeJzH9PwYHP
6gjYHtL2xh0KXeOTUcrTxT3++iVMPKkknqHT+4HCR7wh/qrUb3xyUQYT6JN5TlF7
qQIDAQAB
-----END PUBLIC KEY-----
"""


class RescueError(ValueError):
    """The key cannot open this installation; the message is for the user."""


def read_key(key: str, installation: str) -> str:
    """Check a publisher key and return its single-use reference.

    Raises ``RescueError`` when the signature, the target installation or the
    expiry date does not hold.
    """
    try:
        payload = jwt.decode(
            key.strip(),
            PUBLISHER_PUBLIC_KEY,
            algorithms=[ALGORITHM],
            options={"verify_aud": False},
        )
    except JWTError as error:
        message = str(error).lower()
        if "expire" in message:
            raise RescueError("Clé de secours expirée.") from error
        raise RescueError("Clé de secours invalide.") from error
    if payload.get("scope") != SCOPE:
        raise RescueError("Cette clé n'est pas une clé de secours.")
    if payload.get("installation") != installation:
        raise RescueError("Cette clé vise un autre poste.")
    reference = payload.get("jti", "")
    if not isinstance(reference, str) or not reference:
        raise RescueError("Clé de secours invalide.")
    return reference
