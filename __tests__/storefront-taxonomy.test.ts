import { describe, expect, it } from "vitest";

import {
  STOREFRONT_DEPARTMENTS,
  computeDepartmentCounts,
  departmentBySlug,
  departmentForCategory,
  leafCategoriesForDepartment,
  orderedDepartments,
  resolveStorefrontCategoryFilter,
} from "@/lib/storefront-taxonomy";

describe("storefront taxonomy", () => {
  it("resolves an empty value to no filter", () => {
    expect(resolveStorefrontCategoryFilter("")).toBeNull();
    expect(resolveStorefrontCategoryFilter(null)).toBeNull();
    expect(resolveStorefrontCategoryFilter("   ")).toBeNull();
  });

  it("resolves an exact leaf category to a single-leaf filter", () => {
    const filter = resolveStorefrontCategoryFilter("Festemidler");
    expect(filter).toMatchObject({
      kind: "leaf",
      leaves: ["Festemidler"],
      leaf: "Festemidler",
      label: "Festemidler",
    });
    expect(filter?.department.slug).toBe("festemidler-og-beslag");
  });

  it("resolves a department slug to the whole department", () => {
    const filter = resolveStorefrontCategoryFilter("festemidler-og-beslag");
    expect(filter?.kind).toBe("department");
    expect(filter?.leaves).toEqual(["Festemidler", "Jernvarer"]);
    expect(filter?.leaf).toBeUndefined();
  });

  it("maps legacy broad values to departments", () => {
    expect(resolveStorefrontCategoryFilter("Trelast")?.department.slug).toBe("trelast-og-byggevarer");
    expect(resolveStorefrontCategoryFilter("Plater")?.department.slug).toBe("trelast-og-byggevarer");
    expect(resolveStorefrontCategoryFilter("Tak")?.department.slug).toBe("tak-og-takrenner");
    expect(resolveStorefrontCategoryFilter("Verktøy")?.department.slug).toBe("verktoy-og-maskiner");
  });

  it("treats an unknown value as a literal leaf (exact eq, no crash)", () => {
    const filter = resolveStorefrontCategoryFilter("Helt ukjent");
    expect(filter).toMatchObject({ kind: "leaf", leaves: ["Helt ukjent"] });
  });

  it("gives every department a canonical home and a fallback for unknowns", () => {
    expect(departmentForCategory("Jernvarer").slug).toBe("festemidler-og-beslag");
    expect(departmentForCategory("Elverktøy").slug).toBe("verktoy-og-maskiner");
    // Fallback values land in the tail department, never crash.
    expect(departmentForCategory("Generelt").slug).toBe("sikkerhet-og-forbruk");
    expect(departmentForCategory("Diverse").slug).toBe("sikkerhet-og-forbruk");
    expect(departmentForCategory("noe helt nytt").slug).toBe("sikkerhet-og-forbruk");
  });

  it("has mutually exclusive department category sets", () => {
    const seen = new Set<string>();
    for (const department of STOREFRONT_DEPARTMENTS) {
      for (const category of department.categories) {
        expect(seen.has(category), `"${category}" appears in two departments`).toBe(false);
        seen.add(category);
      }
    }
  });

  it("covers every leaf category produced by the price-list code map", () => {
    // The 38 canonical leaf categories CATEGORY_BY_CODE can emit, plus fallbacks.
    const leaves = [
      "Armering", "Baderom", "Dører", "Elverktøy", "Festemidler", "Forbruksvarer",
      "Garasjeport", "Gips og plater", "Gjerde og stolper", "Gulv", "Gulvbelegg",
      "Håndverktøy", "Innredning", "Innvendig panel", "Isolasjon", "Jernvarer",
      "Kledning", "Konstruksjonsvirke", "Lim og fuge", "Limtre", "Lister", "Maling",
      "Mur og betong", "Overflatebehandling", "Pensler og ruller", "Sikkerhet",
      "Sparkel", "Spileplater og akustikk", "Stålprofiler", "Takbeslag", "Taktekking",
      "Tapet og vegg", "Terrasse", "Tetting og fukt", "Tilbehør", "Tilbud og restesalg",
      "Ventilasjon", "Vinduer", "Generelt", "Diverse",
    ];
    const mapped = new Set(STOREFRONT_DEPARTMENTS.flatMap((d) => d.categories));
    for (const leaf of leaves) {
      // Either explicitly mapped or routed to the fallback department — never lost.
      const filter = resolveStorefrontCategoryFilter(leaf);
      expect(filter, `"${leaf}" did not resolve`).not.toBeNull();
      expect(mapped.has(leaf) || departmentForCategory(leaf).slug === "sikkerhet-og-forbruk").toBe(true);
    }
  });

  it("computes and orders department counts from leaf counts", () => {
    const categoryCounts = { Festemidler: 792, Jernvarer: 426, Elverktøy: 586, Maling: 254 };
    const counts = computeDepartmentCounts(categoryCounts);
    expect(counts["festemidler-og-beslag"]).toBe(792 + 426);
    expect(counts["verktoy-og-maskiner"]).toBe(586);

    const ordered = orderedDepartments(counts);
    expect(ordered[0].slug).toBe("festemidler-og-beslag");
    expect(ordered[1].slug).toBe("verktoy-og-maskiner");
    // Zero-count departments are dropped.
    expect(ordered.every((d) => d.count > 0)).toBe(true);
  });

  it("lists in-stock leaf categories for a department, ordered by count", () => {
    const department = departmentBySlug("verktoy-og-maskiner")!;
    const leaves = leafCategoriesForDepartment(department, { Elverktøy: 586, Håndverktøy: 307, Tilbehør: 0 });
    expect(leaves.map((l) => l.category)).toEqual(["Elverktøy", "Håndverktøy"]); // Tilbehør dropped (0)
  });
});
