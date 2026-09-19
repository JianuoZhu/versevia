"""Package an exact, verified build; never ship stale files from dist/."""
from pathlib import Path
import hashlib
import json
import zipfile


def package_extension(root):
    root = Path(root).resolve()
    source, dist = root / 'extension', root / 'dist'
    for directory in (source, dist):
        if directory.is_symlink() or not directory.is_dir():
            raise ValueError('Build directories must exist and must not be links.')
        if any(p.is_symlink() for p in directory.rglob('*')):
            raise ValueError('Build directories must not contain links.')
    sources = {p.relative_to(source): p for p in source.rglob('*') if p.is_file()}
    built = {p.relative_to(dist): p for p in dist.rglob('*') if p.is_file()}
    if set(built) != set(sources) | {Path('BUILD.txt')}:
        raise ValueError('Build file list differs from source. Run npm run build.')
    if any(built[name].read_bytes() != path.read_bytes() for name, path in sources.items()):
        raise ValueError('Build differs from source. Run npm run build.')
    manifest = json.loads((source / 'manifest.json').read_text(encoding='utf-8'))
    pkg = json.loads((root / 'package.json').read_text(encoding='utf-8'))
    if manifest['version'] != pkg['version']:
        raise ValueError('Package and extension versions must match.')
    archive_path = root / 'versevia-extension.zip'
    # Fixed ZIP metadata and sorted paths give identical bytes for identical builds.
    with zipfile.ZipFile(archive_path, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name, path in sorted(built.items()):
            info = zipfile.ZipInfo(name.as_posix(), date_time=(2020, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, path.read_bytes())
    digest = hashlib.sha256(archive_path.read_bytes()).hexdigest()
    (root / 'versevia-extension.zip.sha256').write_text(f'{digest}  {archive_path.name}\n', encoding='utf-8')
    return archive_path


if __name__ == '__main__':
    try:
        output = package_extension(Path(__file__).resolve().parents[1])
    except ValueError as error:
        raise SystemExit(str(error)) from error
    print(f'Packaged {output.name} and SHA-256 checksum (standalone extension only).')
