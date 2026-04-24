import "server-only";

const AVAILABILITY_API_BASE_URL = "https://www.byggmakker.no/api/availability";
const SEARCH_BASE_URL = "https://www.byggmakker.no/sok";
const REQUEST_TIMEOUT_MS = 8_000;
const CACHE_TTL_MS = 10 * 60 * 1000;

type AvailabilityCacheEntry = {
  expiresAt: number;
  value: ByggmakkerAvailability;
};

export type ByggmakkerStoreStock = {
  id: string;
  name: string;
  quantity: number;
};

export type ByggmakkerAvailability = {
  query: string;
  productUrl: string;
  netAvailable: boolean;
  netQuantity: number | null;
  storeAvailable: boolean;
  storeCount: number;
  stores: ByggmakkerStoreStock[];
  rawLabel: string;
};

type AvailabilityWarehouseEntry = {
  availability?: { status?: string };
  quantity?: number | null;
  restrictions?: { salesDisabled?: boolean | null };
  store?: { id?: string | number; name?: string } | null;
};

type AvailabilityPayload = {
  ean?: string;
  warehouseAvailabilities?: AvailabilityWarehouseEntry[];
  storeAvailabilities?: AvailabilityWarehouseEntry[];
};

const availabilityCache = new Map<string, AvailabilityCacheEntry>();

/**
 * Fetch Byggmakker net-warehouse availability for a single EAN.
 * Returns null when the EAN is invalid or the upstream call fails.
 */
export async function getByggmakkerAvailability(
  rawEan: string,
): Promise<ByggmakkerAvailability | null> {
  const ean = normalizeEan(rawEan);

  if (!ean) {
    return null;
  }

  const cached = availabilityCache.get(ean);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const payload = await fetchAvailabilityPayload(ean);

  if (!payload) {
    return null;
  }

  const availability = parseAvailabilityPayload(ean, buildSearchUrl(ean), payload);

  if (!availability) {
    return null;
  }

  availabilityCache.set(ean, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    value: availability,
  });

  return availability;
}

/**
 * Batch fetch Byggmakker availability for a set of EANs.
 * Returns a Map keyed by the normalized EAN. Missing/invalid EANs are omitted.
 */
export async function getByggmakkerAvailabilityBatch(
  rawEans: Iterable<string>,
): Promise<Map<string, ByggmakkerAvailability>> {
  const result = new Map<string, ByggmakkerAvailability>();
  const inputs = new Set<string>();

  for (const raw of rawEans) {
    const normalized = normalizeEan(raw);
    if (normalized) inputs.add(normalized);
  }

  if (inputs.size === 0) return result;

  const pending: string[] = [];
  const now = Date.now();

  for (const ean of inputs) {
    const cached = availabilityCache.get(ean);
    if (cached && cached.expiresAt > now) {
      result.set(ean, cached.value);
      continue;
    }
    pending.push(ean);
  }

  if (pending.length === 0) return result;

  const payloads = await fetchAvailabilityBatch(pending);
  if (!payloads) return result;

  for (const entry of payloads) {
    const ean = normalizeEan(entry?.ean ?? "");
    if (!ean) continue;

    const availability = parseAvailabilityPayload(ean, buildSearchUrl(ean), entry);
    if (!availability) continue;

    result.set(ean, availability);
    availabilityCache.set(ean, {
      expiresAt: now + CACHE_TTL_MS,
      value: availability,
    });
  }

  return result;
}

async function fetchAvailabilityPayload(ean: string): Promise<AvailabilityPayload | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${AVAILABILITY_API_BASE_URL}/${encodeURIComponent(ean)}`, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
        Accept: "application/json,text/plain,*/*",
      },
      cache: "no-store",
    });

    if (!response.ok) return null;

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) return null;

    return (await response.json()) as AvailabilityPayload;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchAvailabilityBatch(eans: string[]): Promise<AvailabilityPayload[] | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(AVAILABILITY_API_BASE_URL, {
      method: "POST",
      signal: controller.signal,
      redirect: "follow",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
      },
      body: JSON.stringify({ eans }),
    });

    if (!response.ok) return null;

    const data = (await response.json()) as unknown;

    if (Array.isArray(data)) {
      return data as AvailabilityPayload[];
    }

    if (data && typeof data === "object") {
      const results = (data as { results?: unknown }).results;
      if (Array.isArray(results)) {
        return results as AvailabilityPayload[];
      }

      // Byggmakker returns an object keyed by EAN: { "7071...": { ean, storeAvailabilities, ... } }
      const values = Object.values(data as Record<string, unknown>).filter(
        (value): value is AvailabilityPayload =>
          typeof value === "object" && value !== null && !Array.isArray(value),
      );
      if (values.length > 0) return values;
    }

    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function parseAvailabilityPayload(
  query: string,
  productUrl: string,
  payload: AvailabilityPayload,
): ByggmakkerAvailability | null {
  const warehouses = Array.isArray(payload.warehouseAvailabilities)
    ? payload.warehouseAvailabilities
    : [];
  const stores = Array.isArray(payload.storeAvailabilities)
    ? payload.storeAvailabilities
    : [];

  const isStocked = (entry: AvailabilityWarehouseEntry) => {
    const status = entry.availability?.status;
    const quantity = Number(entry.quantity ?? 0);
    const salesDisabled = Boolean(entry.restrictions?.salesDisabled);
    return status === "AVAILABLE" && quantity > 0 && !salesDisabled;
  };

  const availableWarehouses = warehouses.filter(isStocked);
  const availableStores = stores.filter(isStocked);

  const warehouseQuantity = availableWarehouses.reduce(
    (sum, entry) => sum + Number(entry.quantity ?? 0),
    0,
  );
  const netAvailable = warehouseQuantity > 0;
  const storeAvailable = availableStores.length > 0;
  const storeList: ByggmakkerStoreStock[] = availableStores
    .map((entry) => ({
      id: String(entry.store?.id ?? ""),
      name: String(entry.store?.name ?? "").trim(),
      quantity: Math.max(0, Math.round(Number(entry.quantity ?? 0))),
    }))
    .filter((entry) => entry.name.length > 0)
    .sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name, "nb-NO"));
  const rawLabel = netAvailable
    ? "På nettlager"
    : storeAvailable
      ? `På lager i ${availableStores.length} butikk${availableStores.length === 1 ? "" : "er"}`
      : "Ikke på lager";

  return {
    query,
    productUrl,
    netAvailable,
    netQuantity: netAvailable ? warehouseQuantity : null,
    storeAvailable,
    storeCount: availableStores.length,
    stores: storeList,
    rawLabel,
  };
}

function normalizeEan(value: string | undefined) {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits.length === 13 ? digits : "";
}

function buildSearchUrl(ean: string) {
  return `${SEARCH_BASE_URL}?query=${encodeURIComponent(ean)}`;
}
