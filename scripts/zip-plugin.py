"""Archive one explicit plugin directory. Stable ordering; no symlinks or parent directory."""
import pathlib
import sys
import zipfile

source, destination = map(pathlib.Path, sys.argv[1:])
with zipfile.ZipFile(destination, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for item in sorted(source.rglob("*")):
        if item.is_symlink():
            raise ValueError("Plugin archives must not contain symlinks")
        if not item.is_file():
            continue
        entry = zipfile.ZipInfo(item.relative_to(source).as_posix(), date_time=(2026, 1, 1, 0, 0, 0))
        entry.compress_type = zipfile.ZIP_DEFLATED
        entry.external_attr = 0o100644 << 16
        archive.writestr(entry, item.read_bytes(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
