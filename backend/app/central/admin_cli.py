"""Create or reset the global administrator of the central server::

    venv/bin/python -m app.central.admin_cli "Ange" proprietaire@easygest.ci "mot-de-passe"
"""

import sys

from .database import SessionLocal
from .models import GlobalAdmin
from .security import hash_password
from .seed import seed


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(__doc__)
        return 1
    name, email, password = argv[0], argv[1].strip().lower(), argv[2]
    seed()
    db = SessionLocal()
    try:
        admin = db.query(GlobalAdmin).filter(GlobalAdmin.email == email).first()
        if admin is None:
            admin = GlobalAdmin(
                name=name, email=email, hashed_password=hash_password(password)
            )
            db.add(admin)
            action = "créé"
        else:
            admin.name = name
            admin.hashed_password = hash_password(password)
            admin.is_active = True
            action = "mis à jour"
        db.commit()
        print(f"Administrateur global {action} : {email}")
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
