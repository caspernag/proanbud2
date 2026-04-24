#!/usr/bin/env python3
"""
Upload NOBB images from .private/nobb-images/ to Supabase Storage bucket
"material-images", skipping files that already exist in the bucket.

Usage:
    python3 scripts/upload_nobb_images.py

Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local
"""

import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

# ---------------------------------------------------------------------------
# Load .env.local
# ---------------------------------------------------------------------------
env_path = Path(__file__).parent.parent / ".env.local"
if env_path.exists():
    for line in env_path.read_text().splitlines():
        m = re.match(r'^([A-Z0-9_]+)=(.*)$', line)
        if m:
            key, val = m.group(1), m.group(2).strip('"\'')
            os.environ.setdefault(key, val)

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
BUCKET = "material-images"
CACHE_DIR = Path(__file__).parent.parent / ".private" / "nobb-images"
CONCURRENCY = 10

if not SUPABASE_URL or not SERVICE_ROLE_KEY:
    print("ERROR: Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
    sys.exit(1)

try:
    from supabase import create_client, Client
except ImportError:
    print("ERROR: supabase package not installed. Run: pip3 install supabase")
    sys.exit(1)

supabase: Client = create_client(SUPABASE_URL, SERVICE_ROLE_KEY)

# ---------------------------------------------------------------------------
# Fetch all existing filenames in the bucket (paginated)
# ---------------------------------------------------------------------------
def fetch_existing_files() -> set[str]:
    existing: set[str] = set()
    offset = 0
    limit = 1000
    print("Fetching existing files from bucket...", flush=True)
    while True:
        res = supabase.storage.from_(BUCKET).list("", {"limit": limit, "offset": offset})
        if not res:
            break
        for item in res:
            existing.add(item["name"])
        if len(res) < limit:
            break
        offset += limit
    print(f"  {len(existing)} files already in bucket.")
    return existing


# ---------------------------------------------------------------------------
# Content-type helper
# ---------------------------------------------------------------------------
def content_type(filename: str) -> str:
    ext = Path(filename).suffix.lower()
    return {
        ".png": "image/png",
        ".webp": "image/webp",
        ".gif": "image/gif",
    }.get(ext, "image/jpeg")


# ---------------------------------------------------------------------------
# Upload a single file
# ---------------------------------------------------------------------------
def upload_file(filepath: Path) -> tuple[str, str]:
    """Returns (status, filename) where status is 'ok' or 'err'."""
    filename = filepath.name
    ct = content_type(filename)
    try:
        data = filepath.read_bytes()
        res = supabase.storage.from_(BUCKET).upload(
            filename,
            data,
            {"content-type": ct, "upsert": "false"},
        )
        # supabase-py raises on error; if we get here it's a success
        _ = res
        return ("ok", filename)
    except Exception as e:
        msg = str(e)
        if "already exists" in msg.lower() or "409" in msg or "duplicate" in msg.lower():
            return ("skip", filename)
        return ("err", f"{filename}: {e}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    if not CACHE_DIR.is_dir():
        print(f"ERROR: Cache dir not found: {CACHE_DIR}")
        sys.exit(1)

    all_files = sorted(
        f for f in CACHE_DIR.iterdir()
        if f.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp", ".gif"}
    )

    existing = fetch_existing_files()
    to_upload = [f for f in all_files if f.name not in existing]

    print(f"\nFound {len(all_files)} local images, {len(to_upload)} not yet in bucket.")
    if not to_upload:
        print("Nothing to upload.")
        return

    print(f"Uploading with concurrency {CONCURRENCY}...\n")

    ok = skip = err = 0
    done = 0
    total = len(to_upload)
    start = time.time()

    with ThreadPoolExecutor(max_workers=CONCURRENCY) as executor:
        futures = {executor.submit(upload_file, f): f for f in to_upload}
        for future in as_completed(futures):
            status, info = future.result()
            if status == "ok":
                ok += 1
            elif status == "skip":
                skip += 1
            else:
                err += 1
                print(f"\n  ERR {info}")
            done += 1
            elapsed = time.time() - start
            rate = done / elapsed if elapsed > 0 else 0
            eta = (total - done) / rate if rate > 0 else 0
            print(
                f"\r  Progress: {done}/{total}  "
                f"({ok} uploaded, {skip} skipped, {err} errors)  "
                f"~{eta:.0f}s remaining   ",
                end="",
                flush=True,
            )

    print(f"\n\nDone! {ok} uploaded, {skip} skipped, {err} errors.")


if __name__ == "__main__":
    main()
