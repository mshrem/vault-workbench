# Build on Windows with 64-bit CPython 3.12. No original library/cache is collected.
from pathlib import Path
from PyInstaller.utils.hooks import collect_all, collect_data_files, copy_metadata

root = Path(SPECPATH).parent
fast_data, fast_binaries, fast_imports = collect_all('fast_simplification')
datas = [(str(root / 'web'), 'web')]
datas += collect_data_files('trimesh') + fast_data
for name in ('numpy', 'scipy', 'trimesh', 'fast-simplification'):
    datas += copy_metadata(name)

a = Analysis([str(root / 'desktop.py')], pathex=[str(root)],
             binaries=fast_binaries, datas=datas,
             hiddenimports=fast_imports + ['scipy.sparse', 'scipy.sparse.csgraph'],
             hookspath=[], hooksconfig={}, runtime_hooks=[], excludes=[], noarchive=False)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name='VAULTWorkbench',
          debug=False, bootloader_ignore_signals=False, strip=False, upx=False,
          console=True, disable_windowed_traceback=False)
coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=False, name='VAULTWorkbench')
