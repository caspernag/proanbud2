#!/usr/bin/env python3
"""
Delete all files in Supabase Storage bucket "material-images" whose filename
contains "(1)" — e.g. "12345678(1).jpg", "12345678 (1).png".

Usage:
    python3 scripts/delete_duplicate_material_images.py

Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local
"""

import os
import re
import sys
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

DUPLICATE_PATTERN = re.compile(r'\(1\)\.[a-zA-Z]+$')

def fetch_all_files() -> list[str]:
    names: list[str] = []
    offset = 0
    limit = 1000
    while True:
        res = supabase.storage.from_(BUCKET).list("", {"limit": limit, "offset": offset})
        if not res:
            break
        for item in res:
            names.append(item["name"])
        if len(res) < limit:
            break
        offset += limit
    return names

def main():
    print("Fetching file list from bucket...", flush=True)
    all_files = fetch_all_files()
    print(f"  {len(all_files)} total files in bucket.")

    duplicates = [f for f in all_files if DUPLICATE_PATTERN.search(f)]
    print(f"  {len(duplicates)} duplicate '(1)' files found.")

    if not duplicates:
        print("Nothing to delete.")
        return

    print(f"\nDeleting {len(duplicates)} files...", flush=True)

    # Delete in batches of 100
    BATCH = 100
    deleted = 0
    errors = 0
    for i in range(0, len(duplicates), BATCH):
        batch = duplicates[i:i + BATCH]
        try:
            supabase.storage.from_(BUCKET).remove(batch)
            deleted += len(batch)
        except Exception as e:
            print(f"\n  ERR batch {i//BATCH}: {e}")
            errors += len(batch)
        print(f"\r  {deleted + errors}/{len(duplicates)} processed ({deleted} deleted, {errors} errors)   ", end="", flush=True)

    print(f"\n\nDone! {deleted} deleted, {errors} errors.")

if __name__ == "__main__":
    main()
