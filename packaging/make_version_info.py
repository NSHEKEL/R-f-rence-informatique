"""Write packaging/version_info.txt so the .exe shows EasyGest in Windows.

Run before PyInstaller: `python packaging/make_version_info.py`.
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from app.version import APP_NAME, APP_VERSION  # noqa: E402

numbers = [int(part) for part in APP_VERSION.split(".")]
while len(numbers) < 4:
    numbers.append(0)
quad = ", ".join(str(part) for part in numbers[:4])

TEMPLATE = f"""VSVersionInfo(
  ffi=FixedFileInfo(
    filevers=({quad}),
    prodvers=({quad}),
    mask=0x3f,
    flags=0x0,
    OS=0x40004,
    fileType=0x1,
    subtype=0x0,
    date=(0, 0)
  ),
  kids=[
    StringFileInfo([
      StringTable(
        '040C04B0',
        [StringStruct('CompanyName', '{APP_NAME}'),
         StringStruct('FileDescription', 'Gestion de vente et de stock'),
         StringStruct('FileVersion', '{APP_VERSION}'),
         StringStruct('InternalName', '{APP_NAME}'),
         StringStruct('OriginalFilename', '{APP_NAME}.exe'),
         StringStruct('ProductName', '{APP_NAME}'),
         StringStruct('ProductVersion', '{APP_VERSION}')])
    ]),
    VarFileInfo([VarStruct('Translation', [1036, 1200])])
  ]
)
"""

(Path(__file__).resolve().parent / "version_info.txt").write_text(
    TEMPLATE, encoding="utf-8"
)
print(f"version_info.txt écrit pour {APP_NAME} {APP_VERSION}")
