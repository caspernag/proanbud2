#!/usr/bin/env python3
"""
Backfill the nobb_images table from the material-images Supabase Storage bucket.

Reads all image files from the bucket and upserts rows into nobb_images so the
API route can do a single DB lookup instead of HEAD requests.

Usage:
    python3 scripts/backfill_nobb_images_table.py

Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local
"""

import os
import re
import sys
from datetime import timezone, datetime
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

if not SUPABASE_URL or not SERVICE_ROLE_KEY:
    print("ERROR: Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
    sys.exit(1)

try:
    from supabase import create_client, Client
except ImportError:
    print("ERROR: supabase package not installed. Run: pip3 install supabase")
    sys.exit(1)

supabase: Client = create_client(SUPABASE_URL, SERVICE_ROLE_KEY)

IMAGE_RE = re.compile(r'^(\d+)\.(jpg|jpeg|png|webp|gif)$', re.IGNORECASE)

def fetch_all_bucket_files() -> list[dict]:
    files: list[dict] = []
    offset = 0
    limit = 1000
    while True:
        res = supabase.storage.from_(BUCKET).list("", {"limit": limit, "offset": offset})
        if not res:
            break
        files.extend(res)
        if len(res) < limit:
            break
        offset += limit
    return files

def main():
    print("Fetching file list from bucket...", flush=True)
    all_files = fetch_all_bucket_files()
    print(f"  {len(all_files)} total files in bucket.")

    rows = []
    now = datetime.now(timezone.utc).isoformat()
    skipped = 0
    for f in all_files:
        name = f.get("name", "")
        m = IMAGE_RE.match(name)
        if not m:
            skipped += 1
            continue
        nobb = m.group(1)
        rows.append({
            "nobb_number": nobb,
            "storage_path": name,
            "null_until": None,
            "updated_at": now,
        })

    print(f"  {len(rows)} image rows to upsert, {skipped} non-image files skipped.")

    if not rows:
        print("Nothing to upsert.")
        return

    print(f"\nUpserting into nobb_images table...", flush=True)

    BATCH = 500
    upserted = 0
    errors = 0
    for i in range(0, len(rows), BATCH):
        batch = rows[i:i + BATCH]
        try:
            supabase.table("nobb_images").upsert(batch, on_conflict="nobb_number").execute()
            upserted += len(batch)
        except Exception as e:
            print(f"\n  ERR batch {i // BATCH}: {e}")
            errors += len(batch)
        print(f"\r  {upserted + errors}/{len(rows)} processed ({upserted} upserted, {errors} errors)   ", end="", flush=True)

    print(f"\n\nDone! {upserted} rows upserted, {errors} errors.")

if __name__ == "__main__":
    main()
