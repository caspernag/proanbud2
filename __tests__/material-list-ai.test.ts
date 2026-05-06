import { describe, expect, it } from "vitest";

import { buildAttachmentContext } from "@/lib/material-list-ai";

describe("material list AI attachment context", () => {
  it("sends supported image attachments as image input data URLs", async () => {
    const imageBytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lXvG6QAAAABJRU5ErkJggg==",
      "base64",
    );
    const file = new File([imageBytes], "terrasse.png", { type: "image/png" });

    const context = await buildAttachmentContext([file]);

    expect(context.userContentParts).toHaveLength(1);
    expect(context.userContentParts[0]).toMatchObject({
      type: "image",
      detail: "high",
      text: expect.stringContaining("Bildet er sendt til AI"),
    });

    const imagePart = context.userContentParts[0];
    expect(imagePart.type).toBe("image");
    if (imagePart.type === "image") {
      expect(imagePart.imageUrl).toMatch(/^data:image\/png;base64,/);
    }
  });

  it("keeps unsupported image formats as descriptive text instead of dropping them", async () => {
    const file = new File([Buffer.from("heic-placeholder")], "befaring.heic", { type: "image/heic" });

    const context = await buildAttachmentContext([file]);

    expect(context.userContentParts).toHaveLength(1);
    expect(context.userContentParts[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("Filtypen kunne ikke sendes som bilde"),
    });
  });
});
