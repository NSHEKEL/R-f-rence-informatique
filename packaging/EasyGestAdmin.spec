# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for EasyGestAdmin.exe — the owner's console.

Same runtime as the shop application, but the entry point starts the central
server and opens the Global Administrator console:

    pyinstaller packaging/EasyGestAdmin.spec
"""

import os

from PyInstaller.utils.hooks import collect_all, collect_submodules

ROOT = os.path.dirname(SPECPATH)
BACKEND = os.path.join(ROOT, "backend")

ICON = os.path.join(SPECPATH, "EasyGest.ico")

# The console is a route of the same React build, so it travels with the
# executable: no development checkout is needed on the owner's computer.
datas = [(os.path.join(ROOT, "frontend", "dist"), "frontend_dist")]
binaries = []
hiddenimports = collect_submodules("uvicorn")
hiddenimports += collect_submodules("webview") + ["clr", "pythonnet"]

for pkg in (
    "uvicorn",
    "bcrypt",
    "jose",
    "anyio",
    "webview",
    "clr_loader",
    "pythonnet",
):
    try:
        pkg_datas, pkg_binaries, pkg_hidden = collect_all(pkg)
        datas += pkg_datas
        binaries += pkg_binaries
        hiddenimports += pkg_hidden
    except Exception:
        pass


a = Analysis(
    [os.path.join(BACKEND, "admin.py")],
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
    name="EasyGestAdmin",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=ICON,
    version=os.path.join(SPECPATH, "version_info.txt"),
)
