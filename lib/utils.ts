export function formatCurrency(value: number) {
  return new Intl.NumberFormat("nb-NO", {
    style: "currency",
    currency: "NOK",
    maximumFractionDigits: 0,
  }).format(value);
}

export function slugify(value: string) {
  return (
    value
      .toLocaleLowerCase("nb-NO")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9æøå]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 60) || "prosjekt"
  );
}

export function normalizeProjectTitle(value: string, fallback = "Nytt prosjekt") {
  const trimmed = value.trim().replace(/\s+/g, " ");

  if (!trimmed) {
    return fallback;
  }

  // Guard against accidental numeric suffixes appended to the default title.
  const normalizedDefaultTitle = trimmed.replace(/^(nytt byggeprosjekt)\s*\d{6,}$/i, "Nytt byggeprosjekt");

  return normalizedDefaultTitle;
}

export function toNumber(value: FormDataEntryValue | string | null | undefined, fallback: number) {
  if (typeof value !== "string") {
    return fallback;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : fallback;
}
