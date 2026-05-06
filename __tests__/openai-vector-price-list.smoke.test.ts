import OpenAI from "openai";
import { describe, expect, it } from "vitest";

import { env, hasOpenAiEnv } from "@/lib/env";
import { parsePriceListProductsFromVectorFile } from "@/lib/price-lists";

const shouldRun = process.env.RUN_OPENAI_VECTOR_SMOKE === "1";

describe.skipIf(!shouldRun)("OpenAI vector-store price-list smoke", () => {
  it("parses priced products from the configured vector-store file", async () => {
    expect(hasOpenAiEnv()).toBe(true);

    const vectorStoreId = env.openAiVectorStoreIdStorefront.trim();
    expect(vectorStoreId).not.toBe("");

    const openai = new OpenAI({ apiKey: env.openAiApiKey });
    const store = await openai.vectorStores.retrieve(vectorStoreId);

    expect(store.status).toBe("completed");

    let filesParsed = 0;
    let parsedProducts = 0;
    let pricedProducts = 0;

    for await (const file of openai.vectorStores.files.list(vectorStoreId, { filter: "completed", order: "asc" })) {
      const fileInfo = await openai.files.retrieve(file.id).catch(() => null);
      const fileName = fileInfo?.filename || file.id;
      const parts: string[] = [];

      for await (const contentPart of openai.vectorStores.files.content(file.id, { vector_store_id: vectorStoreId })) {
        if (typeof contentPart.text === "string") {
          parts.push(contentPart.text);
        }
      }

      const products = parsePriceListProductsFromVectorFile(parts.join("\n"), fileName);

      if (products.length > 0) {
        filesParsed += 1;
      }

      parsedProducts += products.length;
      pricedProducts += products.filter((product) => product.priceNok > 0 || product.listPriceNok > 0).length;
    }

    expect(filesParsed).toBeGreaterThan(0);
    expect(parsedProducts).toBeGreaterThan(0);
    expect(pricedProducts).toBe(parsedProducts);
  }, 60_000);
});
