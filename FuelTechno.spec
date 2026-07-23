# -*- mode: python ; coding: utf-8 -*-
import os

# ==========================================================
# 1. Assets do frontend
# ==========================================================
# Pastas inteiras, copiadas preservando a estrutura.
# Criou uma pasta nova? Acrescente o nome aqui e acabou.
ASSET_DIRS  = ['pages', 'partials']
ROOT_FILES  = ['index.html', 'app.js', 'style.css']

datas       = [(f, '.') for f in ROOT_FILES if os.path.exists(f)]
datas      += [(d, d)   for d in ASSET_DIRS if os.path.isdir(d)]

binaries      = []
hiddenimports = []

# ==========================================================
# 2. Dependências que o PyInstaller não rastreia sozinho
# ==========================================================
# firebase-admin puxa grpc + google-cloud-firestore, que carregam
# módulos por string em runtime — sem isso o .exe abre e quebra
# só na hora de salvar config.

a = Analysis(
    ['main.py'],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='FuelTechno',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,   # troque para True enquanto estiver depurando o build
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)