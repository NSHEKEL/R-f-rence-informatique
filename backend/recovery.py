"""Outil de récupération locale d'un poste EasyGest.

À lancer sur l'ordinateur concerné (EasyGestRecuperation.exe) quand plus
personne ne peut se connecter : identifiant oublié, compte désactivé, mot de
passe perdu. L'outil travaille sur la base déjà installée — il ne crée, ne
vide et ne réinstalle rien.

Déroulé :

1. il montre l'installation (dossier de données, type et emplacement de la
   base, version) ;
2. il en fait une sauvegarde complète avant toute écriture ;
3. il liste les comptes (identifiant, rôle, état, création) ;
4. il renomme l'identifiant et/ou remplace le mot de passe du compte choisi,
   avec les règles et le hachage bcrypt de l'application ;
5. il rejoue la connexion pour prouver que le compte fonctionne ;
6. il inscrit l'opération dans le journal de sécurité.

Les ventes, achats, stocks, clients, fournisseurs, documents et paramètres ne
sont jamais touchés : seules les lignes de la table des comptes changent.
"""

import sys
from getpass import getpass

from app.accounts import (
    find_user,
    identifier_error,
    log_event,
    normalize_identifier,
    password_error,
)
from app.auth import hash_password, verify_password
from app.backup import create as create_backup
from app.database import DATABASE_URL, IS_SQLITE, Base, SessionLocal, engine
from app.models import User
from app.paths import data_dir
from app.version import APP_VERSION


def _hidden_url() -> str:
    """Décrit la base sans laisser filtrer un mot de passe de connexion."""
    if IS_SQLITE:
        return f"SQLite — {DATABASE_URL.split('///')[-1]}"
    host = DATABASE_URL.split("@")[-1]
    return f"PostgreSQL — {host}"


def _ask(question: str) -> str:
    try:
        return input(question).strip()
    except EOFError:
        return ""


def _confirm(question: str) -> bool:
    return _ask(f"{question} (oui/non) : ").lower() in {"o", "oui"}


def _show_installation() -> None:
    print("=" * 62)
    print("  EasyGest — récupération d'un compte sur cette installation")
    print("=" * 62)
    print(f"Version          : {APP_VERSION}")
    print(f"Dossier de données : {data_dir()}")
    print(f"Base de données  : {_hidden_url()}")


def _accounts(db) -> list[User]:
    return db.query(User).order_by(User.id).all()


def _show_accounts(users: list[User]) -> None:
    print("\nComptes présents dans cette installation :")
    print(f"{'N°':>3}  {'Identifiant':<28} {'Nom':<22} {'Rôle':<14} État")
    for index, user in enumerate(users, start=1):
        state = "actif" if user.is_active else "désactivé"
        print(
            f"{index:>3}  {user.email:<28} {(user.name or ''):<22} "
            f"{(user.role or ''):<14} {state}"
        )
    print("\nAucun mot de passe n'est affiché : ils sont hachés (bcrypt).")


def _pick(users: list[User]) -> User | None:
    raw = _ask("\nNuméro du compte à récupérer (vide = annuler) : ")
    if not raw.isdigit():
        return None
    index = int(raw)
    if not 1 <= index <= len(users):
        print("Numéro inconnu.")
        return None
    return users[index - 1]


def _new_identifier(db, user: User) -> str:
    while True:
        raw = _ask("Nouvel identifiant (vide = garder l'actuel) : ")
        if not raw:
            return ""
        identifier = normalize_identifier(raw)
        problem = identifier_error(identifier)
        if problem:
            print(problem)
            continue
        other = find_user(db, identifier)
        if other is not None and other.id != user.id:
            print("Cet identifiant est déjà utilisé par un autre compte.")
            continue
        return identifier


def _new_password() -> str:
    while True:
        password = getpass("Nouveau mot de passe (vide = inchangé) : ")
        if not password:
            return ""
        problem = password_error(password)
        if problem:
            print(problem)
            continue
        if password != getpass("Confirmation : "):
            print("Les deux saisies sont différentes.")
            continue
        return password


def run() -> int:
    Base.metadata.create_all(bind=engine)
    _show_installation()
    db = SessionLocal()
    try:
        users = _accounts(db)
        if not users:
            print(
                "\nAucun compte dans cette base. Fermez cet outil et lancez "
                "EasyGest : il propose la création du compte administrateur."
            )
            return 1
        _show_accounts(users)
        user = _pick(users)
        if user is None:
            print("Rien n'a été modifié.")
            return 0

        created = (
            f", créé le {user.created_at:%d/%m/%Y}" if user.created_at else ""
        )
        print(
            f"\nCompte choisi : n° interne {user.id}, identifiant "
            f"« {user.email} », rôle {user.role or '—'}{created}"
        )
        identifier = _new_identifier(db, user)
        password = _new_password()
        reactivate = not user.is_active and _confirm(
            "Ce compte est désactivé : le réactiver ?"
        )
        if not identifier and not password and not reactivate:
            print("Rien à modifier.")
            return 0

        backup = create_backup(db, reason="recuperation")
        print(f"\nSauvegarde créée avant modification : {backup}")
        if not _confirm("Appliquer les modifications sur ce compte ?"):
            print("Annulé ; la sauvegarde est conservée.")
            return 0

        before = user.email
        if identifier:
            user.email = identifier
        if password:
            user.hashed_password = hash_password(password)
        if reactivate:
            user.is_active = True
        db.commit()
        db.refresh(user)

        log_event(
            db,
            event="recuperation_locale",
            identifier=user.email,
            detail=(
                "outil local : "
                + ", ".join(
                    filter(
                        None,
                        [
                            f"identifiant {before} → {user.email}"
                            if identifier
                            else "",
                            "mot de passe remplacé" if password else "",
                            "compte réactivé" if reactivate else "",
                        ],
                    )
                )
            ),
            user=user,
            success=True,
        )

        checked = find_user(db, user.email)
        ok = checked is not None and checked.is_active
        if password:
            ok = ok and verify_password(password, checked.hashed_password)
        print("\n" + "-" * 62)
        print("RAPPORT DE RÉCUPÉRATION")
        print(f"  Installation      : {data_dir()}")
        print(f"  Base              : {_hidden_url()}")
        print(f"  Version EasyGest  : {APP_VERSION}")
        print(f"  Compte (n° interne): {user.id}")
        print(f"  Ancien identifiant : {before}")
        print(f"  Nouvel identifiant : {user.email}")
        print(f"  Rôle / état       : {user.role or '—'} / "
              f"{'actif' if user.is_active else 'désactivé'}")
        print("  Tables modifiées   : users, security_log")
        print("  Données métier     : inchangées (ventes, achats, stock, "
              "clients, fournisseurs, documents, paramètres)")
        print(f"  Sauvegarde         : {backup}")
        print(f"  Test de connexion  : {'réussi' if ok else 'ÉCHEC'}")
        print("-" * 62)
        print(
            "\nLancez EasyGest et connectez-vous avec cet identifiant. "
            "Cet outil ne laisse aucun accès permanent : il faut de nouveau "
            "l'exécuter sur ce poste pour l'utiliser."
        )
        return 0 if ok else 1
    finally:
        db.close()


def main() -> int:
    if "--selftest" in sys.argv:
        # Sanity check run by the build: the tool must open the database.
        Base.metadata.create_all(bind=engine)
        db = SessionLocal()
        try:
            db.query(User).count()
        finally:
            db.close()
        return 0
    try:
        return run()
    except KeyboardInterrupt:
        print("\nInterrompu ; aucune modification n'a été appliquée.")
        return 1


if __name__ == "__main__":
    code = main()
    if "--selftest" not in sys.argv:
        _ask("\nAppuyez sur Entrée pour fermer cette fenêtre. ")
    sys.exit(code)
