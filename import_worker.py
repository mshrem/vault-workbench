"""One-file preview conversion. Run in a child process to release mesh memory."""
import argparse
import json
from pathlib import Path
import struct
import traceback
from version import CONVERTER_REVISION

# Preview-only, in millimetres. Reject numerical slivers down to 10 nanometres
# without welding, rounding, or moving original vertices. Bounds are measured
# before cleanup, and the source STL is never rewritten.
PREVIEW_MIN_TRIANGLE_HEIGHT = 1e-5


def clean_preview(mesh):
    before = len(mesh.faces)
    mesh.update_faces(mesh.nondegenerate_faces(height=PREVIEW_MIN_TRIANGLE_HEIGHT))
    nondegenerate = len(mesh.faces)
    mesh.update_faces(mesh.unique_faces())
    mesh.remove_unreferenced_vertices()
    return dict(degenerateFacesRemoved=before-nondegenerate,
                duplicateFacesRemoved=nondegenerate-len(mesh.faces), cleanedFaces=len(mesh.faces))


def conversion_error(error):
    """Useful shareable diagnostics without absolute paths or source geometry."""
    result = dict(errorType=type(error).__name__, previewAvailable=False,
                  errorFrames=[dict(file=Path(frame.filename).name, line=frame.lineno,
                                    function=frame.name)
                               for frame in traceback.extract_tb(error.__traceback__)[-16:]])
    if isinstance(error, ModuleNotFoundError):
        module = error.name or 'unknown'
        result.update(missingModule=module,
                      error=f"Missing Python dependency: {module}. Update the app and rebuild the Docker image; on Windows rerun setup-importer-windows.cmd.")
    else:
        result['error'] = f'{type(error).__name__}: conversion failed. Error type and stack frames are included in this report.'
    return result


def convert(source, target, max_mb=128, progress=lambda stage: None):
    import numpy as np
    import trimesh
    from trimesh.exchange.gltf import export_glb

    source, target = Path(source), Path(target)
    progress('scan_bounds')
    size = source.stat().st_size
    with source.open('rb') as stream:
        header = stream.read(84)
    count = struct.unpack('<I', header[80:84])[0] if len(header) == 84 else 0
    binary = count > 0 and size == 84 + count * 50
    mesh = None
    if binary:
        # Bounds for even very large binary STLs use fixed-size chunks.
        dtype = np.dtype([('normal', '<f4', (3,)), ('v', '<f4', (3, 3)), ('attr', '<u2')])
        triangles = np.memmap(source, dtype=dtype, mode='r', offset=84, shape=(count,))
        low, high = np.full(3, np.inf), np.full(3, -np.inf)
        for offset in range(0, count, 65536):
            points = triangles['v'][offset:offset + 65536].reshape(-1, 3)
            if not np.isfinite(points).all():
                raise ValueError('STL contains non-finite coordinates')
            low = np.minimum(low, points.min(axis=0))
            high = np.maximum(high, points.max(axis=0))
        del triangles
        bounds = np.array([low, high])
    elif size > max_mb * 1024 * 1024:
        raise ValueError('Large ASCII or unrecognized STL: increase the size limit or inspect in your slicer')
    else:
        progress('load_stl')
        mesh = trimesh.load_mesh(source, process=True)
        bounds, count = mesh.bounds.copy(), len(mesh.faces)
    if not count or not np.isfinite(bounds).all() or np.max(bounds[1] - bounds[0]) <= 0:
        raise ValueError('STL has no usable geometry')
    result = dict(sourceFaces=int(count), printBounds=np.round(bounds, 4).tolist(),
                  printSize=np.round(bounds[1] - bounds[0], 4).tolist(), previewAvailable=False,
                  converterRevision=CONVERTER_REVISION)
    if size > max_mb * 1024 * 1024:
        result['reasonCode'] = 'source_size_limit'
        result['note'] = f'Dimensions scanned. Preview exceeds the {max_mb} MB source limit.'
        return result
    if mesh is None:
        progress('load_stl')
        mesh = trimesh.load_mesh(source, process=True)
    mesh.apply_translation(-bounds.mean(axis=0))
    progress('clean_preview')
    result.update(clean_preview(mesh))
    if not len(mesh.faces):
        raise ValueError('No non-degenerate preview triangles')
    if len(mesh.faces) > 45000:
        progress('simplify')
        mesh = mesh.simplify_quadric_decimation(face_count=45000, aggression=5)
    mesh.update_faces(mesh.nondegenerate_faces(height=PREVIEW_MIN_TRIANGLE_HEIGHT))
    mesh.remove_unreferenced_vertices()
    if not len(mesh.faces):
        raise ValueError('No non-degenerate preview triangles')
    # Some intricate/support meshes cannot reach the target. Keep browser use bounded.
    if len(mesh.faces) > 180000:
        result.update(reasonCode='mesh_too_complex', remainingFaces=len(mesh.faces))
        result['note'] = 'Dimensions scanned. Mesh remains too complex for a lightweight preview.'
        return result
    progress('repair_normals')
    normals = mesh.vertex_normals.copy()
    lengths = np.linalg.norm(normals, axis=1)
    invalid = ~np.isfinite(lengths) | (lengths < 1e-8)
    if invalid.any():
        face = mesh.vertex_faces[:, 0]
        normals[invalid] = mesh.face_normals[face[invalid]]
        lengths = np.linalg.norm(normals, axis=1)
    if not np.isfinite(normals).all() or (lengths < 1e-8).any():
        raise ValueError('Cannot generate valid surface normals')
    mesh.vertex_normals = normals / lengths[:, None]
    progress('write_preview')
    payload = export_glb(trimesh.Scene(mesh), include_normals=True)
    temporary = target.with_suffix('.glb.tmp')
    try:
        temporary.write_bytes(payload)
        temporary.replace(target)
    finally:
        temporary.unlink(missing_ok=True)
    result.update(previewAvailable=True, previewFaces=len(mesh.faces), previewBytes=len(payload), reasonCode='ready')
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True)
    parser.add_argument('--target', required=True)
    parser.add_argument('--max-mb', type=int, default=128)
    args = parser.parse_args(argv)
    phase = 'starting'
    def progress(stage):
        nonlocal phase
        phase = stage
        try:
            Path(args.target).with_suffix('.stage.json').write_text(json.dumps({'stage': stage}), encoding='utf-8')
        except OSError:
            pass
    try:
        result = convert(args.source, args.target, args.max_mb, progress)
        print(json.dumps(dict(result, stage=phase)), flush=True)
        return 0
    except Exception as error:
        result = conversion_error(error)
        result.update(stage=phase, reasonCode='missing_dependency' if isinstance(error, ModuleNotFoundError) else 'conversion_failed')
        print(json.dumps(result), flush=True)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
