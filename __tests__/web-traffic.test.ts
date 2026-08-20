import { describe, expect, it } from "vitest";

import {
  aggregatePathsBySlug,
  buildPopularProducts,
  fillTrafficDays,
  slugFromRequestPath,
  trafficWindowLabel,
  type VercelPathVisits,
} from "@/lib/web-traffic";

function path(requestPath: string, pageviews: number, visitors = pageviews): VercelPathVisits {
  return { requestPath, pageviews, visitors };
}

describe("slugFromRequestPath", () => {
  it("plukker ut sluggen fra en produktside", () => {
    expect(slugFromRequestPath("/gipsplate-13mm")).toBe("gipsplate-13mm");
    // Ekte sti fra Vercel Analytics.
    expect(slugFromRequestPath("/furu-28x120-cuimp-terrasse-kl1-byggmakker-25410978")).toBe(
      "furu-28x120-cuimp-terrasse-kl1-byggmakker-25410978",
    );
  });

  it("ignorerer query og fragment", () => {
    expect(slugFromRequestPath("/gipsplate-13mm?utm_source=google")).toBe("gipsplate-13mm");
    expect(slugFromRequestPath("/gipsplate-13mm#tekniske-data")).toBe("gipsplate-13mm");
  });

  it("ignorerer etterfølgende skråstrek", () => {
    expect(slugFromRequestPath("/gipsplate-13mm/")).toBe("gipsplate-13mm");
  });

  it("dekoder prosentkodede tegn", () => {
    expect(slugFromRequestPath("/kledning-gr%C3%A5")).toBe("kledning-grå");
  });

  it("gir null for forsiden og for URL-er med flere segmenter", () => {
    expect(slugFromRequestPath("/")).toBeNull();
    expect(slugFromRequestPath("/sjefen/dashboard")).toBeNull();
    expect(slugFromRequestPath("/ordre/abc123")).toBeNull();
  });

  it("gir null for noe som ikke er en sti", () => {
    expect(slugFromRequestPath("gipsplate")).toBeNull();
  });

  it("gir null for Vercels «Others»-samlerad", () => {
    // Vercel legger på denne raden for alt som faller utenfor `limit`. Den ser
    // ut som en verdi blant stiene, men er en sum — og skal aldri bli produkt.
    expect(slugFromRequestPath("Others")).toBeNull();
  });

  it("faller tilbake på råsegmentet ved ugyldig prosentkoding", () => {
    expect(slugFromRequestPath("/rabatt-100%")).toBe("rabatt-100%");
  });
});

describe("aggregatePathsBySlug", () => {
  it("summerer visninger for URL-varianter av samme side", () => {
    const bySlug = aggregatePathsBySlug([
      path("/gipsplate", 10, 8),
      path("/gipsplate?utm_source=google", 4, 3),
      path("/gipsplate/", 1, 1),
    ]);

    expect(bySlug.get("gipsplate")).toEqual({ pageviews: 15, visitors: 8 });
  });

  it("holder besøkende på den største varianten i stedet for å dobbelttelle", () => {
    const bySlug = aggregatePathsBySlug([path("/plate", 5, 5), path("/plate?a=1", 5, 4)]);

    expect(bySlug.get("plate")?.visitors).toBe(5);
  });

  it("hopper over URL-er som ikke kan være produktsider", () => {
    const bySlug = aggregatePathsBySlug([path("/", 100), path("/sjefen/dashboard", 50), path("/plate", 2)]);

    expect([...bySlug.keys()]).toEqual(["plate"]);
  });
});

describe("buildPopularProducts", () => {
  const katalog = new Map([
    ["gipsplate", { id: "p1", productName: "Gipsplate 13 mm" }],
    ["stender", { id: "p2", productName: "Stender 48x98" }],
  ]);

  it("rangerer bare slugger som finnes i katalogen", () => {
    const popular = buildPopularProducts(
      [path("/checkout", 900), path("/gipsplate", 10), path("/stender", 30), path("/finnes-ikke", 500)],
      katalog,
    );

    expect(popular.map((entry) => entry.slug)).toEqual(["stender", "gipsplate"]);
    expect(popular[0]).toMatchObject({ productId: "p2", productName: "Stender 48x98", pageviews: 30 });
  });

  it("rangerer på besøkende, ikke sidevisninger", () => {
    // Én person som lastet siden 40 ganger skal ikke slå seks personer som så
    // den én gang hver.
    const popular = buildPopularProducts(
      [path("/gipsplate", 40, 1), path("/stender", 6, 6)],
      katalog,
    );

    expect(popular.map((entry) => entry.slug)).toEqual(["stender", "gipsplate"]);
  });

  it("bryter likt antall besøkende på sidevisninger", () => {
    const popular = buildPopularProducts([path("/gipsplate", 3, 3), path("/stender", 9, 3)], katalog);

    expect(popular.map((entry) => entry.slug)).toEqual(["stender", "gipsplate"]);
  });

  it("respekterer grensen", () => {
    expect(buildPopularProducts([path("/gipsplate", 10), path("/stender", 30)], katalog, 1)).toHaveLength(1);
  });

  it("bryter helt likt resultat deterministisk på slug", () => {
    const popular = buildPopularProducts([path("/stender", 7, 7), path("/gipsplate", 7, 7)], katalog);

    expect(popular.map((entry) => entry.slug)).toEqual(["gipsplate", "stender"]);
  });

  it("gir tom liste når ingen URL-er er produkter", () => {
    expect(buildPopularProducts([path("/", 900), path("/checkout", 40)], katalog)).toEqual([]);
  });
});

describe("fillTrafficDays", () => {
  const until = new Date("2026-08-20T09:00:00Z");

  it("fyller ut døgn uten trafikk og sorterer kronologisk", () => {
    const filled = fillTrafficDays([{ date: "2026-08-19", pageviews: 12, visitors: 9 }], until, 3);

    expect(filled).toEqual([
      { date: "2026-08-18", pageviews: 0, visitors: 0 },
      { date: "2026-08-19", pageviews: 12, visitors: 9 },
      { date: "2026-08-20", pageviews: 0, visitors: 0 },
    ]);
  });

  it("ignorerer døgn utenfor vinduet", () => {
    const filled = fillTrafficDays([{ date: "2026-01-01", pageviews: 99, visitors: 99 }], until, 2);

    expect(filled.map((day) => day.date)).toEqual(["2026-08-19", "2026-08-20"]);
    expect(filled.every((day) => day.pageviews === 0)).toBe(true);
  });

  it("går tilbake fra sluttdatoen den får, ikke fra dagens dato", () => {
    const filled = fillTrafficDays([], new Date("2026-03-02T23:30:00Z"), 3);

    expect(filled.map((day) => day.date)).toEqual(["2026-02-28", "2026-03-01", "2026-03-02"]);
  });
});

describe("trafficWindowLabel", () => {
  it("kaller ett døgn «24 timer»", () => {
    expect(trafficWindowLabel(1)).toBe("24 timer");
    expect(trafficWindowLabel(7)).toBe("7 dager");
    expect(trafficWindowLabel(30)).toBe("30 dager");
  });
});
