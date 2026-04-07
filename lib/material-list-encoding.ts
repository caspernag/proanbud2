import { gunzipSync, gzipSync } from "node:zlib";

import type { MaterialSection } from "@/lib/project-data";

const MAX_COMPRESSED_PARAM_LENGTH = 6_000;

export function encodeMaterialSectionsForUrl(sections: MaterialSection[]) {
  const json = JSON.stringify(sections);
  const compressed = gzipSync(Buffer.from(json, "utf8"));
  const token = compressed.toString("base64url");

  if (token.length > MAX_COMPRESSED_PARAM_LENGTH) {
    return null;
  }

  return token;
}

export function decodeMaterialSectionsFromUrl(token: string) {
  try {
    const bytes = Buffer.from(token, "base64url");
    const json = gunzipSync(bytes).toString("utf8");
    return JSON.parse(json) as unknown;
  } catch {
    return null;
  }
}
