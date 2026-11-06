"""Single source of truth for the application version.

Bump APP_VERSION and tag the repository with the same value ("vX.Y.Z"): the
update checker compares the tag of the latest GitHub release with this number.
"""

import struct

APP_NAME = "EasyGest"
APP_VERSION = "2.17.25"

# Repository publishing the Windows releases consumed by the update checker.
UPDATE_REPO = "NSHEKEL/R-f-rence-informatique"
# Portable executable replaced in place by the built-in updater. The 32-bit
# build is published under distinct asset names so the updater of an x86
# machine never downloads the 64-bit binary it cannot run.
_IS_32BIT = struct.calcsize("P") * 8 == 32
UPDATE_ASSET = "EasyGest_x86.exe" if _IS_32BIT else "EasyGest.exe"
# Installer downloaded when the app was installed with EasyGest_Setup.exe.
UPDATE_INSTALLER_ASSET = (
    "EasyGest_Setup_x86.exe" if _IS_32BIT else "EasyGest_Setup.exe"
)


def parse(version: str) -> tuple[int, ...]:
    """Turn "v1.10.2" into (1, 10, 2) so versions compare numerically."""
    cleaned = version.strip().lstrip("vV").split("-")[0]
    parts: list[int] = []
    for chunk in cleaned.split("."):
        digits = "".join(c for c in chunk if c.isdigit())
        parts.append(int(digits) if digits else 0)
    return tuple(parts) or (0,)


def is_newer(candidate: str, current: str) -> bool:
    left, right = parse(candidate), parse(current)
    size = max(len(left), len(right))
    left += (0,) * (size - len(left))
    right += (0,) * (size - len(right))
    return left > right
