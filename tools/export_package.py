#!/usr/bin/env python3
"""Create a clean, portable Wox Cinema Studio Pro install archive preserving all current web/examples thumbnails."""
from __future__ import annotations

import argparse
import os
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

INCLUDE_DIRS = (
    "apps",
    "custom_nodes",
    "docs",
    "infra",
    "packs",
    "schema",
    "server",
    "tools",
    "web",
)

INCLUDE_FILES = (
    ".env.example",
    ".gitattributes",
    ".gitignore",
    "LICENSE",
    "README.md",
    "Wox_cinema_studio_pro.bat",
    "Wox_cinema_studio_pro.sh",
    "package-lock.json",
    "package.json",
    "run.sh",
    "tsconfig.json",
)

SKIP_NAMES = {"node_modules", "__pycache__", ".venv", ".git", "results", "queue"}
SKIP_SUFFIXES = (".pyc", ".pyo")


def export_zip(out_path: Path) -> int:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    with zipfile.ZipFile(out_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        for rel in INCLUDE_FILES:
            p = ROOT / rel
            if p.is_file():
                zf.write(p, f"wox_cinema_studio_pro/{rel}")
                count += 1
        for folder in INCLUDE_DIRS:
            base = ROOT / folder
            if not base.is_dir():
                continue
            for dirpath, dirnames, filenames in os.walk(base):
                dirnames[:] = [d for d in sorted(dirnames) if d not in SKIP_NAMES]
                for fn in sorted(filenames):
                    if fn.endswith(SKIP_SUFFIXES):
                        continue
                    fp = Path(dirpath) / fn
                    arc = f"wox_cinema_studio_pro/{fp.relative_to(ROOT).as_posix()}"
                    zf.write(fp, arc)
                    count += 1
    return count


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", default=str(ROOT / "out" / "wox-cinema-studio-pro.zip"), help="Output zip path")
    args = ap.parse_args()
    out = Path(args.out).resolve()
    count = export_zip(out)
    size_mb = out.stat().st_size / (1024 * 1024)
    print(f"Exported {count} files to {out} ({size_mb:.1f} MB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
