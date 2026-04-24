#!/usr/bin/env python3
"""
Prefetch product images for every NOBB number found in the price lists.

Reads CSV files from `.private/prislister/*.csv` (latin1, semicolon-separated,
column index 2 = NOBB number — matches lib/price-lists.ts parseSupplierCsv).

Writes images to `.private/nobb-images/<nobb>.<ext>` — the exact same directory
and naming scheme used by app/api/storefront-images/[nobb]/route.ts, so the
storefront picks them up directly from the disk cache with no extra wiring.

Source priority (to minimize wrong-image risk):
  1. NOBB Export API v1 SQUARE  (Byggtjeneste — authoritative, requires Basic auth)
  2. NOBB Export API v2 Mb      (same supplier, fallback endpoint)
  3. Optimera SSR search        (only accepted when `"nobbNumber": "<n>"` is
                                 present in the HTML — strict match prevents
                                 cross-product contamination)

Credentials for the NOBB Export API are read from `.env.local` (NOBB_EXPORT_USERNAME,
NOBB_EXPORT_PASSWORD). Without them, the script still runs but every product must
fall through to Optimera.

Usage:
    python3 scripts/fetch_nobb_images.py               # fetch all missing
    python3 scripts/fetch_nobb_images.py --force       # ignore existing cache
    python3 scripts/fetch_nobb_images.py --limit 50    # only first 50 NOBBs
    python3 scripts/fetch_nobb_images.py --workers 16  # change concurrency
    python3 scripts/fetch_nobb_images.py --clear-nulls # remove .null markers first
    python3 scripts/fetch_nobb_images.py --only-nobb 25410978,11303617
"""
from __future__ import annotations

import argparse
import base64
import csv
import os
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Optional
from urllib.parse import quote
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

# ---------------------------------------------------------------------------
# Paths & constants
# ---------------------------------------------------------------------------

REPO_ROOT = Path(__file__).resolve().parent.parent
PRICE_LIST_DIR = REPO_ROOT / ".private" / "prislister"
CACHE_DIR = REPO_ROOT / ".private" / "nobb-images"
ENV_FILE = REPO_ROOT / ".env.local"

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36"
)

CONTENT_TYPE_EXT = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}
KNOWN_EXTS = (".jpg", ".jpeg", ".png", ".webp", ".gif")

REQUEST_TIMEOUT_SECONDS = 15

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def load_env_local() -> dict[str, str]:
    """Parse .env.local (simple KEY=VALUE, ignores quotes/comments)."""
    if not ENV_FILE.exists():
        return {}
    result: dict[str, str] = {}
    for line in ENV_FILE.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        value = value.strip().strip('"').strip("'")
        result[key.strip()] = value
    return result


def discover_nobb_numbers() -> list[str]:
    """Read all CSVs and return the de-duplicated, ordered set of NOBB numbers."""
    if not PRICE_LIST_DIR.exists():
        raise SystemExit(f"Price list dir not found: {PRICE_LIST_DIR}")

    seen: set[str] = set()
    ordered: list[str] = []

    for csv_path in sorted(PRICE_LIST_DIR.glob("*.csv")):
        with csv_path.open("r", encoding="latin1", newline="") as fh:
            reader = csv.reader(fh, delimiter=";")
            for row in reader:
                if len(row) < 3:
                    continue
                nobb = re.sub(r"\D", "", (row[2] or "").strip())
                if not nobb:
                    continue
                if nobb in seen:
                    continue
                seen.add(nobb)
                ordered.append(nobb)

    return ordered


def existing_cache(nobb: str) -> Optional[Path]:
    for ext in KNOWN_EXTS:
        candidate = CACHE_DIR / f"{nobb}{ext}"
        if candidate.exists() and candidate.stat().st_size > 0:
            return candidate
    return None


def ext_for_content_type(content_type: str) -> str:
    ct = content_type.split(";")[0].strip().lower()
    return CONTENT_TYPE_EXT.get(ct, ".jpg")


def http_get(url: str, headers: Optional[dict[str, str]] = None) -> tuple[int, bytes, dict[str, str]]:
    req = Request(url, headers={"User-Agent": USER_AGENT, **(headers or {})})
    try:
        with urlopen(req, timeout=REQUEST_TIMEOUT_SECONDS) as resp:
            data = resp.read()
            return resp.status, data, dict(resp.headers)
    except HTTPError as exc:
        try:
            body = exc.read()
        except Exception:
            body = b""
        return exc.code, body, dict(exc.headers or {})
    except (URLError, TimeoutError, ConnectionError):
        return 0, b"", {}


# ---------------------------------------------------------------------------
# Image sources
# ---------------------------------------------------------------------------


@dataclass
class ImageResult:
    source: str
    content_type: str
    data: bytes


def fetch_nobb_export(nobb: str, auth_header: Optional[str]) -> Optional[ImageResult]:
    """NOBB Export CDN (Byggtjeneste). Works WITHOUT auth in practice — if
    credentials are provided we send them anyway (harmless, same endpoint)."""
    endpoints = [
        (f"https://export.byggtjeneste.no/api/v1/media/images/items/{quote(nobb)}/SQUARE", "nobb-v1"),
        (f"https://export.byggtjeneste.no/api/v2/media/images/items/{quote(nobb)}/Mb?imagesize=SQUARE", "nobb-v2"),
    ]
    headers = {"Authorization": auth_header} if auth_header else None
    for url, label in endpoints:
        status, data, resp_headers = http_get(url, headers=headers)
        if status != 200 or not data:
            continue
        ct = resp_headers.get("Content-Type") or resp_headers.get("content-type") or ""
        if not ct.lower().startswith("image/"):
            continue
        return ImageResult(source=label, content_type=ct, data=data)
    return None


_NOBB_MATCH_CACHE: dict[str, tuple[str, str] | None] = {}
_NOBB_MATCH_LOCK = threading.Lock()


def fetch_optimera(nobb: str) -> Optional[ImageResult]:
    """Optimera SSR search — strict NOBB match required."""
    search_url = f"https://www.optimera.no/sok?q={quote(nobb)}"
    status, body, _headers = http_get(search_url, headers={"Accept": "text/html,*/*"})
    if status != 200 or not body:
        return None

    html = body.decode("utf-8", errors="replace")

    # Require exact NOBB match in the server-rendered product data.
    if not re.search(rf'"nobbNumber"\s*:\s*"{re.escape(nobb)}"', html):
        return None

    image_match = re.search(
        r'https://media\.optimera\.no/[^"\'\s?]+\.(?:jpg|jpeg|png|webp)',
        html,
        re.IGNORECASE,
    )
    if not image_match:
        return None

    image_url = image_match.group(0)
    status, data, headers = http_get(image_url)
    if status != 200 or not data:
        return None
    ct = headers.get("Content-Type") or headers.get("content-type") or ""
    if not ct.lower().startswith("image/"):
        return None
    return ImageResult(source="optimera", content_type=ct, data=data)


# ---------------------------------------------------------------------------
# Worker
# ---------------------------------------------------------------------------


@dataclass
class OutcomeCounters:
    hit_nobb: int = 0
    hit_optimera: int = 0
    skipped_cached: int = 0
    skipped_null: int = 0
    miss: int = 0
    error: int = 0


def process_nobb(
    nobb: str,
    auth_header: Optional[str],
    force: bool,
    skip_null: bool,
) -> tuple[str, str, Optional[str]]:
    """
    Returns (nobb, outcome, source_or_error).
    outcome ∈ {"cached", "null", "nobb", "optimera", "miss", "error"}.
    """
    try:
        if not force:
            hit = existing_cache(nobb)
            if hit is not None:
                return nobb, "cached", str(hit.name)

            null_marker = CACHE_DIR / f"{nobb}.null"
            if skip_null and null_marker.exists():
                return nobb, "null", None

        image: Optional[ImageResult] = fetch_nobb_export(nobb, auth_header)

        if image is None:
            image = fetch_optimera(nobb)

        if image is None:
            # Persist null marker so the TS route also respects this
            CACHE_DIR.mkdir(parents=True, exist_ok=True)
            (CACHE_DIR / f"{nobb}.null").write_bytes(b"")
            return nobb, "miss", None

        # Write image & clear any stale null marker
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        ext = ext_for_content_type(image.content_type)
        target = CACHE_DIR / f"{nobb}{ext}"
        tmp = target.with_suffix(target.suffix + ".tmp")
        tmp.write_bytes(image.data)
        os.replace(tmp, target)

        # Remove any other-extension stale files + null marker
        for other_ext in KNOWN_EXTS:
            if other_ext == ext:
                continue
            stale = CACHE_DIR / f"{nobb}{other_ext}"
            if stale.exists():
                try:
                    stale.unlink()
                except OSError:
                    pass
        null_marker = CACHE_DIR / f"{nobb}.null"
        if null_marker.exists():
            try:
                null_marker.unlink()
            except OSError:
                pass

        outcome = "nobb" if image.source.startswith("nobb") else "optimera"
        return nobb, outcome, image.source
    except Exception as exc:  # noqa: BLE001
        return nobb, "error", f"{type(exc).__name__}: {exc}"


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--workers", type=int, default=8, help="Concurrent fetchers (default: 8)")
    parser.add_argument("--limit", type=int, default=None, help="Process at most N NOBB numbers")
    parser.add_argument("--force", action="store_true", help="Re-fetch even if image already cached")
    parser.add_argument("--clear-nulls", action="store_true", help="Delete all .null markers before starting")
    parser.add_argument("--include-null-retry", action="store_true",
                        help="Retry NOBB numbers previously marked as having no image")
    parser.add_argument("--only-nobb", type=str, default=None,
                        help="Comma-separated NOBB numbers — restrict processing to just these")
    args = parser.parse_args()

    env = load_env_local()
    nobb_user = env.get("NOBB_EXPORT_USERNAME", "").strip()
    nobb_pass = env.get("NOBB_EXPORT_PASSWORD", "").strip()
    auth_header: Optional[str] = None
    if nobb_user and nobb_pass:
        token = base64.b64encode(f"{nobb_user}:{nobb_pass}".encode("utf-8")).decode("ascii")
        auth_header = f"Basic {token}"
        print(f"✓ NOBB Export credentials loaded (user={nobb_user[:3]}***)")
    else:
        print("ℹ  No NOBB Export credentials — using unauthenticated CDN (works for public images).")

    if args.clear_nulls and CACHE_DIR.exists():
        removed = 0
        for marker in CACHE_DIR.glob("*.null"):
            marker.unlink()
            removed += 1
        print(f"✓ Removed {removed} .null marker(s)")

    if args.only_nobb:
        nobbs = [re.sub(r"\D", "", n) for n in args.only_nobb.split(",") if n.strip()]
        nobbs = [n for n in nobbs if n]
    else:
        nobbs = discover_nobb_numbers()

    if args.limit:
        nobbs = nobbs[: args.limit]

    total = len(nobbs)
    if total == 0:
        print("No NOBB numbers to process.")
        return 0

    print(f"→ {total} unique NOBB number(s) to process using {args.workers} worker(s)")
    print()

    counters = OutcomeCounters()
    start = time.monotonic()
    skip_null = not args.include_null_retry

    processed = 0
    lock = threading.Lock()

    def report(nobb: str, outcome: str, detail: Optional[str]) -> None:
        nonlocal processed
        with lock:
            processed += 1
            if outcome == "cached":
                counters.skipped_cached += 1
                tag = "·"
            elif outcome == "null":
                counters.skipped_null += 1
                tag = "·"
            elif outcome == "nobb":
                counters.hit_nobb += 1
                tag = "✓"
            elif outcome == "optimera":
                counters.hit_optimera += 1
                tag = "✓"
            elif outcome == "miss":
                counters.miss += 1
                tag = "✗"
            else:  # error
                counters.error += 1
                tag = "!"

            # Only print non-skip outcomes or every 100th skip to keep log readable
            if outcome in ("cached", "null"):
                if processed % 100 == 0:
                    print(f"  [{processed}/{total}] {tag} skipped so far ({counters.skipped_cached} cached, {counters.skipped_null} null)")
            else:
                extra = f"  ({detail})" if detail else ""
                print(f"  [{processed}/{total}] {tag} {nobb:<12} {outcome}{extra}")

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {
            pool.submit(process_nobb, nobb, auth_header, args.force, skip_null): nobb
            for nobb in nobbs
        }
        for future in as_completed(futures):
            nobb, outcome, detail = future.result()
            report(nobb, outcome, detail)

    elapsed = time.monotonic() - start
    print()
    print("─" * 60)
    print(f"Done in {elapsed:0.1f}s")
    print(f"  ✓ NOBB Export    : {counters.hit_nobb}")
    print(f"  ✓ Optimera       : {counters.hit_optimera}")
    print(f"  · Already cached : {counters.skipped_cached}")
    print(f"  · Prev. null     : {counters.skipped_null}")
    print(f"  ✗ No image found : {counters.miss}")
    print(f"  ! Errors         : {counters.error}")
    print("─" * 60)

    # Exit non-zero only on errors (misses are expected for products without pictures)
    return 1 if counters.error > 0 else 0


if __name__ == "__main__":
    sys.exit(main())
