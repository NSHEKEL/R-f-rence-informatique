# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for EasyGestRecuperation.exe — local account rescue.

A small console program run on the shop computer when nobody can log in any
more: it lists the accounts of the installed database, renames an identifier
and resets a password, after backing the database up.

    pyinstaller packaging/EasyGestRecuperation.spec
"""

import os

from PyInstaller.utils.hooks import collect_all

ROOT = os.path.dirname(SPECPATH)
BACKEND = os.path.join(ROOT, "backend")

ICON = os.path.join(SPECPATH, "EasyGest.ico")

datas = []
binaries = []
hiddenimports = []

for pkg in ("bcrypt", "sqlalchemy", "dotenv"):
    try:
        pkg_datas, pkg_binaries, pkg_hidden = collect_all(pkg)
        datas += pkg_datas
        binaries += pkg_binaries
        hiddenimports += pkg_hidden
    except Exception:
        pass


a = Analysis(
    [os.path.join(BACKEND, "recovery.py")],
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
    name="EasyGestRecuperation",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=ICON,
    version=os.path.join(SPECPATH, "version_info.txt"),
)
