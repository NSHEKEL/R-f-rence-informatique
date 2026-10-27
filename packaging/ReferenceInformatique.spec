# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for the Référence Informatique Windows package.

Run from the repository root (after building the frontend into frontend/dist):

    pyinstaller packaging/ReferenceInformatique.spec
"""

import os

from PyInstaller.utils.hooks import collect_all, collect_submodules

# Paths in a .spec are resolved relative to the spec's directory, so anchor
# everything to the repository root (the parent of packaging/).
ROOT = os.path.dirname(SPECPATH)
BACKEND = os.path.join(ROOT, "backend")

datas = [(os.path.join(ROOT, "frontend", "dist"), "frontend_dist")]
binaries = []
hiddenimports = collect_submodules("uvicorn")

for pkg in ("uvicorn", "bcrypt", "jose", "anyio"):
    try:
        pkg_datas, pkg_binaries, pkg_hidden = collect_all(pkg)
        datas += pkg_datas
        binaries += pkg_binaries
        hiddenimports += pkg_hidden
    except Exception:
        pass


a = Analysis(
    [os.path.join(BACKEND, "run.py")],
    pathex=[BACKEND],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="ReferenceInformatique",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
