export const STOREFRONT_SELECTED_STORE_COOKIE = "proanbud_selected_store";
export const STOREFRONT_SELECTED_STORE_STORAGE_KEY = "proanbud_selected_store_v1";

export type StorefrontStoreOption = {
  id: string;
  name: string;
  address?: string;
  addressUrl?: string;
  latitude?: number;
  longitude?: number;
};

export const STOREFRONT_STORE_OPTIONS: StorefrontStoreOption[] = [
  storeOption("7080001087326", "Bodø", "Olav V gate 92, 8004 Bodø", 67.2804, 14.4049),
  storeOption("7080000926886", "Degernes", "Haldenveien 823, 1892 Degernes", 59.3555, 11.4127),
  storeOption("7080001181192", "Fauske", "Terminalveien 7, 8208 Fauske", 67.2596, 15.3941),
  storeOption("7080000447824", "Førde", "Brulandsvegen 150, 6800 Førde", 61.4522, 5.8572),
  storeOption("7080000447961", "Jørpeland", "Jøssangvegen 5, 4100 Jørpeland", 59.0225, 6.0408),
  storeOption("7080000989454", "Kolvereid", "Foldavegen 4774, 7970 Kolvereid", 64.8652, 11.6042),
  storeOption("7080000898886", "Laksevåg", "Sjøkrigsskoleveien 15, 5165 Laksevåg", 60.3825, 5.2861),
  storeOption("7080001198954", "Leira", "Skulevegen 5, 2920 Leira", 60.985, 9.2328),
  storeOption("7080003904591", "Leknes", "Idrettsgata 67, 8370 Leknes", 68.1475, 13.6115),
  storeOption("7080000448593", "Mo i Rana", "Verkstedveien 13, 8624 Mo i Rana", 66.3128, 14.1428),
  storeOption("7080000201037", "Mosjøen", "Ørbradden 5, 8663 Mosjøen", 65.836, 13.1908),
  storeOption("7080000917051", "Namsos", "Klingavegen 2, 7800 Namsos", 64.4662, 11.4957),
  storeOption("7080003819499", "Oslo", "Haraldrudveien 5, 0581 Oslo", 59.9312, 10.8306),
  storeOption("7080001393915", "Skui", "Ringeriksveien 256, 1340 Skui", 59.9272, 10.4494),
  storeOption("7080000448005", "Stavanger", "Breiflåtveien 21, 4017 Stavanger", 58.969, 5.7331),
  storeOption("7080000917075", "Steinkjer", "Sagbruksvegen 8, 7725 Steinkjer", 64.0149, 11.4954),
  storeOption("7080001007980", "Sunndalsøra", "Industrivegen 1, 6600 Sunndalsøra", 62.6754, 8.5624),
  storeOption("7080000448135", "Svolvær", "Industriveien 5, 8300 Svolvær", 68.2342, 14.5683),
  storeOption("7080001387839", "Tiller", "Vestre Rosten 97, 7075 Tiller", 63.3548, 10.3796),
  storeOption("7080001100582", "Tynset", "Tomtegata 4, 2500 Tynset", 62.2759, 10.7824),
  storeOption("7080000782901", "Øydegard", "Arnvika 4, 6670 Øydegard", 63.0274, 7.8312),
].sort((left, right) => left.name.localeCompare(right.name, "nb-NO"));

const STORE_COORDINATES: Record<string, { latitude: number; longitude: number }> = {
  "7080001087326": { latitude: 67.2804, longitude: 14.4049 }, // Bodo
  "7080000926886": { latitude: 59.3555, longitude: 11.4127 }, // Degernes
  "7080001181192": { latitude: 67.2596, longitude: 15.3941 }, // Fauske
  "7080000447824": { latitude: 61.4522, longitude: 5.8572 }, // Forde
  "7080000447961": { latitude: 59.0225, longitude: 6.0408 }, // Jorpeland
  "7080000989454": { latitude: 64.8652, longitude: 11.6042 }, // Kolvereid
  "7080000898886": { latitude: 60.3825, longitude: 5.2861 }, // Laksevag
  "7080001198954": { latitude: 60.985, longitude: 9.2328 }, // Leira
  "7080003904591": { latitude: 68.1475, longitude: 13.6115 }, // Leknes
  "7080000448593": { latitude: 66.3128, longitude: 14.1428 }, // Mo i Rana
  "7080000201037": { latitude: 65.836, longitude: 13.1908 }, // Mosjoen
  "7080000917051": { latitude: 64.4662, longitude: 11.4957 }, // Namsos
  "7080003819499": { latitude: 59.9312, longitude: 10.8306 }, // Oslo / Brobekk
  "7080001393915": { latitude: 59.9272, longitude: 10.4494 }, // Skui
  "7080000448005": { latitude: 58.969, longitude: 5.7331 }, // Stavanger
  "7080000917075": { latitude: 64.0149, longitude: 11.4954 }, // Steinkjer
  "7080001007980": { latitude: 62.6754, longitude: 8.5624 }, // Sunndalsora
  "7080000448135": { latitude: 68.2342, longitude: 14.5683 }, // Svolvaer
  "7080001387839": { latitude: 63.3548, longitude: 10.3796 }, // Tiller
  "7080001100582": { latitude: 62.2759, longitude: 10.7824 }, // Tynset
  "7080000782901": { latitude: 63.0274, longitude: 7.8312 }, // Oydegard
};

export function enrichStoreOption(store: { id: string; name: string }): StorefrontStoreOption {
  const knownStore = STOREFRONT_STORE_OPTIONS.find((option) => option.id === store.id);

  if (knownStore) {
    return knownStore;
  }

  const coordinates = STORE_COORDINATES[store.id];

  return {
    id: store.id,
    name: store.name,
    ...(coordinates ? coordinates : {}),
  };
}

export function uniqueStoreOptions(stores: Array<{ id: string; name: string }>) {
  const byId = new Map<string, StorefrontStoreOption>();

  for (const store of STOREFRONT_STORE_OPTIONS) {
    byId.set(store.id, store);
  }

  for (const store of stores) {
    if (!store.id || !store.name || byId.has(store.id)) continue;
    byId.set(store.id, enrichStoreOption(store));
  }

  return Array.from(byId.values()).sort((left, right) => left.name.localeCompare(right.name, "nb-NO"));
}

function storeOption(
  id: string,
  name: string,
  address: string,
  latitude: number,
  longitude: number,
): StorefrontStoreOption {
  return {
    id,
    name,
    address,
    addressUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`,
    latitude,
    longitude,
  };
}

export function findNearestStore(
  stores: StorefrontStoreOption[],
  position: { latitude: number; longitude: number },
) {
  return stores
    .filter((store) => typeof store.latitude === "number" && typeof store.longitude === "number")
    .map((store) => ({
      store,
      distance: distanceKm(position.latitude, position.longitude, store.latitude!, store.longitude!),
    }))
    .sort((left, right) => left.distance - right.distance)[0] ?? null;
}

function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const earthRadiusKm = 6371;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}