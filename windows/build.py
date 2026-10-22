"""Build and smoke-test the portable EXE on a Windows x64 build machine."""
import os
from pathlib import Path
import shutil
import subprocess
import sys
import venv
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def run(command):
    subprocess.run([str(value) for value in command], cwd=ROOT, check=True)


def main():
    if os.name != 'nt' or sys.version_info[:2] != (3, 12) or sys.maxsize <= 2**32:
        raise SystemExit('Build on Windows with 64-bit Python 3.12.')
    environment = ROOT / '.windows-build-env'
    venv.EnvBuilder(with_pip=True).create(environment)
    python = environment / 'Scripts' / 'python.exe'
    run([python, '-m', 'pip', 'install', '--only-binary=:all:', '-r', ROOT / 'requirements-windows-build.txt'])
    run([python, '-m', 'PyInstaller', '--noconfirm', '--clean', '--distpath', ROOT / 'dist',
         '--workpath', ROOT / 'build' / 'windows', ROOT / 'windows' / 'VAULTWorkbench.spec'])
    bundle = ROOT / 'dist' / 'VAULTWorkbench'
    executable = bundle / 'VAULTWorkbench.exe'
    run([python, ROOT / 'windows' / 'verify_build.py', executable])
    shutil.copy2(ROOT / 'WINDOWS.md', bundle / 'WINDOWS.md')
    (bundle / 'Choose-original-folder.cmd').write_text(
        '@echo off\ncd /d "%~dp0"\n"VAULTWorkbench.exe" --choose-library\n', encoding='ascii', newline='\r\n')
    output = ROOT / 'dist' / 'VAULTWorkbench-Windows-x64.zip'
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for path in sorted(bundle.rglob('*')):
            if path.is_file():
                archive.write(path, path.relative_to(bundle.parent).as_posix())
    print(f'Windows build and smoke tests passed. Portable ZIP: {output}', flush=True)


if __name__ == '__main__':
    main()
