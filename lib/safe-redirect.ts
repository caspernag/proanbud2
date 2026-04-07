const DEFAULT_NEXT_PATH = "/min-side";

export function sanitizeNextPath(rawValue: string | null | undefined, fallback = DEFAULT_NEXT_PATH) {
  if (!rawValue) {
    return fallback;
  }

  const trimmed = rawValue.trim();

  if (!trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.startsWith("/\\")) {
    return fallback;
  }

  if (trimmed.includes("://") || /[\r\n\t]/.test(trimmed)) {
    return fallback;
  }

  try {
    const parsed = new URL(trimmed, "https://local.invalid");
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}
