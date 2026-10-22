"""Portable Windows entry point. Run desktop.py from source or build the EXE."""
import argparse
import json
import os
from pathlib import Path
import sys


def load_library(settings):
    try:
        value = json.loads(settings.read_text(encoding='utf-8'))
        return value.get('library') if isinstance(value, dict) else None
    except (OSError, ValueError):
        return None


def save_library(settings, library):
    settings.parent.mkdir(parents=True, exist_ok=True)
    temporary = settings.with_suffix('.json.tmp')
    temporary.write_text(json.dumps({'library': str(library)}, indent=2), encoding='utf-8')
    temporary.replace(settings)


def pick_library(initial=None):
    import tkinter as tk
    from tkinter import filedialog
    root = tk.Tk()
    root.withdraw()
    try:
        root.attributes('-topmost', True)
        return filedialog.askdirectory(parent=root, mustexist=True,
                                       title='Choose USSA VAULT (the folder containing VAULT and PEGBOARD)',
                                       initialdir=str(initial or Path.home())) or None
    finally:
        root.destroy()


def resolve_library(explicit, settings, choose=False, picker=pick_library):
    if explicit and not choose:
        folder = Path(explicit).expanduser().resolve()
        if not folder.is_dir():
            raise ValueError(f'Original folder does not exist: {folder}')
    else:
        saved = load_library(settings)
        folder = Path(saved).expanduser() if isinstance(saved, str) and saved else None
        if choose or folder is None or not folder.is_dir():
            selected = picker(folder if folder and folder.is_dir() else None)
            if not selected:
                return None
            folder = Path(selected).expanduser().resolve()
            if not folder.is_dir():
                raise ValueError('The selected original folder does not exist.')
    save_library(settings, folder)
    return folder


def check_runtime():
    """Exercise native importer extensions inside the packaged application."""
    import numpy as np
    import scipy.sparse
    import fast_simplification
    import trimesh
    mesh = trimesh.creation.icosphere(subdivisions=2)
    if not np.isfinite(mesh.vertex_faces).all():
        raise RuntimeError('Invalid incident-face lookup')
    simplified = mesh.simplify_quadric_decimation(face_count=100)
    if not 0 < len(simplified.faces) <= 100:
        raise RuntimeError('Native simplification did not work')
    print(json.dumps({'ok': True, 'faces': len(simplified.faces)}), flush=True)
    return 0


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    # Dispatch before loading server, settings, folder dialogs, or browser code.
    if argv[:1] == ['--convert-worker']:
        from import_worker import main as worker_main
        return worker_main(argv[1:])
    if argv == ['--check-runtime']:
        return check_runtime()

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--library', default=os.getenv('VAULT_ROOT'))
    parser.add_argument('--choose-library', action='store_true', help='Choose another original folder')
    parser.add_argument('--port', type=int, default=8787)
    parser.add_argument('--no-open', action='store_true', help='Do not launch the browser')
    args = parser.parse_args(argv)
    if not 1 <= args.port <= 65535:
        parser.error('Port must be between 1 and 65535')

    from importer import default_data_dir
    library = resolve_library(args.library, default_data_dir() / 'desktop-settings.json', args.choose_library)
    if library is None:
        print('No original folder selected. Launch again to choose it.', flush=True)
        return 0
    from server import main as serve
    print('Keep this window open while using VAULT Workbench. Press Ctrl+C to stop.', flush=True)
    command = ['--host', '127.0.0.1', '--port', str(args.port), '--library', str(library)]
    if not args.no_open:
        command.append('--open')
    serve(command)
    return 0


if __name__ == '__main__':
    # Worker failures must retain their machine-readable JSON and must never pause.
    if sys.argv[1:2] in (['--convert-worker'], ['--check-runtime']):
        raise SystemExit(main())
    try:
        raise SystemExit(main())
    except (OSError, ValueError) as error:
        print(f'VAULT Workbench could not start: {error}', file=sys.stderr, flush=True)
        print('If port 8787 is in use, close the other local copy first.', file=sys.stderr, flush=True)
        if sys.stdin is not None and sys.stdin.isatty():
            input('Press Enter to close. ')
        raise SystemExit(1)
