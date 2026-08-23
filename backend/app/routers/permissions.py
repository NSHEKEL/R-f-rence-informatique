from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..auth import get_current_user, require_admin
from ..database import get_db
from ..models import User
from ..permissions import (
    CONFIGURABLE_ROLES,
    PERMISSIONS,
    allowed_keys,
    role_matrix,
    save_matrix,
)
from ..schemas import PermissionMatrix, PermissionUpdate, UserPermissions

router = APIRouter(prefix="/api/permissions", tags=["permissions"])


@router.get("/me", response_model=UserPermissions)
def my_permissions(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return UserPermissions(
        role=current_user.role,
        allowed=allowed_keys(db, current_user),
    )


@router.get("", response_model=PermissionMatrix)
def get_matrix(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    return PermissionMatrix(
        definitions=[
            {"key": key, "label": label, "section": section}
            for key, (label, section) in PERMISSIONS.items()
        ],
        roles=list(CONFIGURABLE_ROLES),
        matrix=role_matrix(db),
    )


@router.put("", response_model=PermissionMatrix)
def update_matrix(
    payload: PermissionUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    save_matrix(db, payload.matrix)
    return get_matrix(db=db, _=_)
