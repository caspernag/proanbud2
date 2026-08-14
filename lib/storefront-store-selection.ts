export const STOREFRONT_SELECTED_STORE_COOKIE = "prisbygg_selected_store";
export const STOREFRONT_SELECTED_STORE_STORAGE_KEY = "prisbygg_selected_store_v1";

export type StorefrontStoreOption = {
  id: string;
  name: string;
  address?: string;
  addressUrl?: string;
  latitude?: number;
  longitude?: number;
  /**
   * Om Nag Software har prisavtale med butikken. Byggmakker bekreftet
   * 2026-08-14 at noen Byggmakker-butikker er franchise uten avtale — gratis
   * henting "uten tillegg i prisen" gjelder kun avtale-butikker. Franchise-
   * og uavklarte butikker (ofte gjenkjennbare på et eget firmanavn i tillegg
   * til "Byggmakker", f.eks. "Gunvald Johansen", "Materialhandelen") skal
   * IKKE tilbys som hentested før avtaleforholdet er bekreftet.
   */
  hasPricingAgreement: boolean;
};

export const STOREFRONT_STORE_OPTIONS: StorefrontStoreOption[] = [
  storeOption("7080001087326", "Bodø", "Olav V gate 92, 8004 Bodø", false, 67.2804, 14.4049),
  storeOption("7080000926886", "Degernes", "Haldenveien 823, 1892 Degernes", false, 59.3555, 11.4127),
  storeOption("7080001181192", "Fauske", "Terminalveien 7, 8208 Fauske", false, 67.2596, 15.3941),
  storeOption("7080000447824", "Førde", "Brulandsvegen 150, 6800 Førde", false, 61.4522, 5.8572),
  storeOption("7080000447961", "Jørpeland", "Jøssangvegen 5, 4100 Jørpeland", true, 59.0225, 6.0408),
  storeOption("7080000989454", "Kolvereid", "Foldavegen 4774, 7970 Kolvereid", true, 64.8652, 11.6042),
  storeOption("7080000898886", "Laksevåg", "Sjøkrigsskoleveien 15, 5165 Laksevåg", false, 60.3825, 5.2861),
  storeOption("7080001198954", "Leira", "Skulevegen 5, 2920 Leira", true, 60.985, 9.2328),
  storeOption("7080003904591", "Leknes", "Idrettsgata 67, 8370 Leknes", false, 68.1475, 13.6115),
  storeOption("7080000448593", "Mo i Rana", "Verkstedveien 13, 8624 Mo i Rana", true, 66.3128, 14.1428),
  storeOption("7080000201037", "Mosjøen", "Ørbradden 5, 8663 Mosjøen", true, 65.836, 13.1908),
  storeOption("7080000917051", "Namsos", "Klingavegen 2, 7800 Namsos", true, 64.4662, 11.4957),
  storeOption("7080003819499", "Oslo", "Haraldrudveien 5, 0581 Oslo", false, 59.9312, 10.8306),
  storeOption("7080001393915", "Skui", "Ringeriksveien 256, 1340 Skui", true, 59.9272, 10.4494),
  storeOption("7080000448005", "Stavanger", "Breiflåtveien 21, 4017 Stavanger", true, 58.969, 5.7331),
  storeOption("7080000917075", "Steinkjer", "Sagbruksvegen 8, 7725 Steinkjer", true, 64.0149, 11.4954),
  storeOption("7080001007980", "Sunndalsøra", "Industrivegen 1, 6600 Sunndalsøra", false, 62.6754, 8.5624),
  storeOption("7080000448135", "Svolvær", "Industriveien 5, 8300 Svolvær", false, 68.2342, 14.5683),
  storeOption("7080001387839", "Tiller", "Vestre Rosten 97, 7075 Tiller", false, 63.3548, 10.3796),
  storeOption("7080001100582", "Tynset", "Tomtegata 4, 2500 Tynset", true, 62.2759, 10.7824),
  storeOption("7080000782901", "Øydegard", "Arnvika 4, 6670 Øydegard", false, 63.0274, 7.8312),
  storeOption("byggmakker-brobekk", "Byggmakker Brobekk (Oslo)", "Haraldrudveien 50, 0581 Oslo", true),
  storeOption("byggmakker-alnabru-proff", "Byggmakker Alnabru Proff", "Strømsveien 3, 0181 Oslo", true),
  storeOption("byggmakker-arendal", "Byggmakker Arendal", "Frolandsveien 17, 4848 Arendal", true),
  storeOption("byggmakker-berkak", "Byggmakker Berkåk", "Postmyrveien 22, 7391 Rennebu", true),
  storeOption("byggmakker-bjugn", "Byggmakker Bjugn", "Emil Schanches gate 5, 7160 Bjugn", true),
  storeOption("byggmakker-bruland", "Byggmakker Bruland", "Brulandsvegen 150, 6800 Førde", false),
  storeOption("byggmakker-bytas", "Byggmakker Bytås AS", "Arnvika 4, 6670 Øydegard", false),
  storeOption("byggmakker-bo", "Byggmakker Bø", "Grivisvingen 2, 3802 Bø i Telemark", true),
  storeOption("byggmakker-dokka", "Byggmakker Dokka", "Storgata 123, 2870 Dokka", true),
  storeOption("byggmakker-drammen", "Byggmakker Drammen", "Ingvald Ludvigsens gate 20, 3027 Drammen", true),
  storeOption("byggmakker-eiker", "Byggmakker Eiker", "Prestebråtan 11, 3300 Hokksund", false),
  storeOption("byggmakker-fredrikstad-ostsiden", "Byggmakker Fredrikstad Østsiden", "Borgarveien 13, 1633 Gamle Fredrikstad", true),
  storeOption("byggmakker-geitanger-bergen", "Byggmakker Geitanger (Bergen)", "Ulsmågskaret 15, 5224 Nesttun", true),
  storeOption("byggmakker-gjovik", "Byggmakker Gjøvik", "Valdresvegen 4, 2816 Gjøvik", true),
  storeOption("byggmakker-gramyra", "Byggmakker Gråmyra", "Gråmyrvegen 47, 7608 Levanger", true),
  storeOption("byggmakker-gunvald-johansen-bodo", "Byggmakker Gunvald Johansen Bodø", "Olav V gate 9, 8004 Bodø", false),
  storeOption("byggmakker-gunvald-johansen-fauske", "Byggmakker Gunvald Johansen Fauske", "Terminalveien 7, 8208 Fauske", false),
  storeOption("byggmakker-gunvald-johansen-leknes", "Byggmakker Gunvald Johansen Leknes", "Leknessletta 7, 8370 Leknes", false),
  storeOption("byggmakker-gunvald-johansen-svolvaer", "Byggmakker Gunvald Johansen Svolvær", "Industriveien 5, 8300 Svolvær", false),
  storeOption("byggmakker-hamar", "Byggmakker Hamar", "Arnkvernvegen 20, 2320 Furnes", true),
  storeOption("byggmakker-havna", "Byggmakker Havna", "Skolegangen 2, 3961 Stathelle", true),
  storeOption("byggmakker-hvaler", "Byggmakker Hvaler", "Lammenes 8, 1680 Skjærhalden", true),
  storeOption("byggmakker-honefoss", "Byggmakker Hønefoss", "Hensmoveien 28, 3516 Hønefoss", false),
  storeOption("byggmakker-hovellast-lillestrom", "Byggmakker Høvellast Lillestrøm", "Nordahl Brunsgate 10, 2004 Lillestrøm", false),
  storeOption("byggmakker-jessheim-proff", "Byggmakker Jessheim Proff", "Industrivegen 24, 2069 Jessheim", true),
  storeOption("byggmakker-kongsberg", "Byggmakker Kongsberg", "Bingeplassveien 13, 3610 Kongsberg", true),
  storeOption("byggmakker-kragero", "Byggmakker Kragerø", "Dalaneveien 22, 3770 Kragerø", true),
  storeOption("byggmakker-kristiansand", "Byggmakker Kristiansand", "Buråsen 2, 4636 Kristiansand", true),
  storeOption("byggmakker-larvik", "Byggmakker Larvik", "Øya 6, 3262 Larvik", true),
  storeOption("byggmakker-leangen-trondheim", "Byggmakker Leangen (Trondheim)", "Landbruksvegen 17, 7047 Trondheim", true),
  storeOption("byggmakker-levanger", "Byggmakker Levanger", "Okkenhaugvegen 8, 7600 Levanger", true),
  storeOption("byggmakker-lillehammer", "Byggmakker Lillehammer", "Landbruksvegen 1, 2619 Lillehammer", true),
  storeOption("byggmakker-mandal-proff", "Byggmakker Mandal Proff", "Doneheia 46, 4516 Mandal", true),
  storeOption("byggmakker-materialhandelen-batsfjord", "Byggmakker Materialhandelen Båtsfjord", "Fomavegen 14, 9990 Båtsfjord", false),
  storeOption("byggmakker-materialhandelen-tana", "Byggmakker Materialhandelen Tana", "Grenvegen 20, 9845 Tana", false),
  storeOption("byggmakker-moss", "Byggmakker Moss", "Varnaveien 31, 1526 Moss", true),
  storeOption("byggmakker-notodden", "Byggmakker Notodden", "Merdevegen 14A, 3676 Notodden", true),
  storeOption("byggmakker-oldernes-vadso", "Byggmakker Oldernes Vadsø", "Båtsfjordveien 11, 9801 Vadsø", false),
  storeOption("byggmakker-oppdal", "Byggmakker Oppdal", "Søndre Industrivegen 7, 7340 Oppdal", true),
  storeOption("byggmakker-overhalla", "Byggmakker Overhalla", "Kornsilovegen 14, 7863 Overhalla", true),
  storeOption("byggmakker-proff-bergen", "Byggmakker Proff Gravdal (Bergen)", "Sjøkrigsskoleveien 15, 5165 Laksevåg", true),
  storeOption("byggmakker-raufoss", "Byggmakker Raufoss", "Sigurd Østliens veg 3, 2830 Raufoss", true),
  storeOption("byggmakker-rissa", "Byggmakker Rissa", "Fv718 11, 2710 Rissa", true),
  storeOption("byggmakker-rjukan", "Byggmakker Rjukan", "Svaddevegen 14, 3660 Rjukan", true),
  storeOption("byggmakker-roros", "Byggmakker Røros", "Langegga 1, 7374 Røros", true),
  storeOption("byggmakker-rorvik", "Byggmakker Rørvik", "Havnegata 7, 7900 Rørvik", true),
  storeOption("byggmakker-rade", "Byggmakker Råde", "Sarpsborgveien 11, 1640 Råde", true),
  storeOption("byggmakker-sandefjord", "Byggmakker Sandefjord", "Hotvedtveien 6, 3220 Sandefjord", true),
  storeOption("byggmakker-sarpsborg", "Byggmakker Sarpsborg", "Vogts vei 3, 1710 Sarpsborg", true),
  storeOption("byggmakker-seljord", "Byggmakker Seljord", "Vekanvegen 12, 3840 Seljord", true),
  storeOption("byggmakker-skien", "Byggmakker Skien", "Kjørbekkdalen 5, 3735 Skien", true),
  storeOption("byggmakker-stavanger", "Byggmakker Stavanger", "Breiflåtveien 21, 4017 Stavanger", true),
  storeOption("byggmakker-stavern", "Byggmakker Stavern", "Terneveien 23, 3290 Stavern", true),
  storeOption("byggmakker-steinkjer", "Byggmakker Steinkjer", "Sagbruksvegen 8, 7725 Steinkjer", true),
  storeOption("byggmakker-storen", "Byggmakker Støren", "Kjørkvollveien 27, 7290 Støren", true),
  storeOption("byggmakker-surnadal", "Byggmakker Surnadal", "Industrivegen 1, 6652 Surnadal", false),
  storeOption("byggmakker-sogne-proff", "Byggmakker Søgne Proff", "Linnegrøvan 32, 4640 Søgne", true),
  storeOption("byggmakker-tiller", "Byggmakker Tiller (Trondheim)", "Vestre Rosten 97, 7075 Tiller", true),
  storeOption("byggmakker-tredal", "Byggmakker Tredal", "Industrivegen 1, 6600 Sunndalsøra", false),
  storeOption("byggmakker-tonsberg-proff", "Byggmakker Tønsberg Proff", "Fjordgaten 23, 3125 Tønsberg", true),
  storeOption("byggmakker-verdal", "Byggmakker Verdal", "Industrivegen 4, 7650 Verdal", true),
  storeOption("byggmakker-vagsbygd", "Byggmakker Vågsbygd", "Sagmyra 2, 4624 Kristiansand", true),
  storeOption("byggmakker-orland", "Byggmakker Ørland", "Industrigata 7, 7130 Brekstad", true),
  storeOption("byggmakker-aasen-og-five", "Byggmakker Aasen og Five", "Gamle Kongeveg 11, 7503 Stjørdal", false),
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
    // Ukjent butikk, ikke i den kuraterte listen — ingen bekreftet avtale.
    hasPricingAgreement: false,
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
  hasPricingAgreement: boolean,
  latitude?: number,
  longitude?: number,
): StorefrontStoreOption {
  return {
    id,
    name,
    address,
    addressUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`,
    hasPricingAgreement,
    ...(typeof latitude === "number" && typeof longitude === "number" ? { latitude, longitude } : {}),
  };
}

/** Butikker Nag Software faktisk har prisavtale med — de eneste som skal tilbys som hentested. */
export function storefrontAgreementStores(
  stores: StorefrontStoreOption[] = STOREFRONT_STORE_OPTIONS,
): StorefrontStoreOption[] {
  return stores.filter((store) => store.hasPricingAgreement);
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

export function suggestNearestStoreByAddress(location: {
  addressLine1?: string;
  postalCode?: string;
  city?: string;
}): StorefrontStoreOption | null {
  const query = normalizeAddressText(`${location.addressLine1 ?? ""} ${location.city ?? ""} ${location.postalCode ?? ""}`);
  const postalCode = normalizePostalCode(location.postalCode);
  const city = normalizeAddressText(location.city ?? "");

  if (!query && !postalCode && !city) {
    return null;
  }

  // Kun avtale-butikker skal kunne bli auto-foreslått som hentested.
  const candidates = storefrontAgreementStores();

  const byPostal = candidates.find((store) => {
    const storeAddress = normalizeAddressText(store.address ?? "");
    return postalCode && storeAddress.includes(postalCode);
  });

  if (byPostal) {
    return byPostal;
  }

  const byCity = candidates.find((store) => {
    const cityName = normalizeAddressText(store.name);
    const storeAddress = normalizeAddressText(store.address ?? "");
    return (
      (city && cityName.includes(city)) ||
      (city && storeAddress.includes(city)) ||
      (query && cityName.includes(query)) ||
      (query && storeAddress.includes(query))
    );
  });

  if (byCity) {
    return byCity;
  }

  const byPostalPrefix = candidates.find((store) => {
    const storePostalCode = normalizePostalCode((store.address ?? "").match(/\b(\d{4})\b/)?.[1] ?? "");
    if (!postalCode || !storePostalCode) return false;
    return postalCode.slice(0, 2) === storePostalCode.slice(0, 2);
  });

  return byPostalPrefix ?? null;
}

function normalizeAddressText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePostalCode(value?: string) {
  return (value ?? "").replace(/\D/g, "").slice(0, 4);
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