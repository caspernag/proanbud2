import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseDelimitedRows, parsePriceImportFile } from "@/lib/price-import-file";
import { parseDecimalNo, parseProductsFromTable } from "@/lib/price-import-tabular";
import { readXlsxWorkbook } from "@/lib/xlsx-reader";

const fixture = readFileSync(path.join(__dirname, "fixtures", "byggmakker-priser.xlsx"));
const fixtureBytes = new Uint8Array(fixture);

const headerlessBytes = new Uint8Array(
  readFileSync(path.join(__dirname, "fixtures", "byggmakker-uten-overskrifter.xlsx")),
);

const options = { supplierName: "Byggmakker", sourceKey: "byggmakker", lastUpdated: "2026-08-14" };

describe("xlsx-leseren", () => {
  it("leser alle ark og celler ut av en ekte Excel-fil", () => {
    const sheets = readXlsxWorkbook(fixtureBytes);

    expect(sheets.map((sheet) => sheet.name)).toEqual(["Info", "Prisliste"]);
    expect(sheets[0].rows[0][0]).toBe("Prisliste Byggmakker");
    // Excel skriver ikke ut helt tomme rader, så radene her er de utfylte.
    expect(sheets[1].rows[1]).toContain("NOBB-nr");
    expect(sheets[1].rows[2][1]).toBe("TERRASSEBORD 28X120 IMP");
  });
});

describe("import av Excel-prisfil", () => {
  it("velger produktarket og leser radene", () => {
    const result = parsePriceImportFile({
      fileName: "byggmakker-priser.xlsx",
      data: fixtureBytes,
      supplierName: "Byggmakker",
      lastUpdated: "2026-08-14",
    });

    expect(result.format).toBe("xlsx");
    expect(result.sheetName).toBe("Prisliste");
    expect(result.products).toHaveLength(3);
    expect(result.mappedColumns).toMatchObject({
      nobb: "NOBB-nr",
      productName: "Produktnavn",
      price: "Nettopris",
      listPrice: "Veiledende pris",
      priceUnit: "Prisenhet",
      salesUnit: "Salgsenhet",
    });
  });

  it("regner om fra prisenhet til salgsenhet", () => {
    const { products } = parsePriceImportFile({
      fileName: "byggmakker-priser.xlsx",
      data: fixtureBytes,
      supplierName: "Byggmakker",
      lastUpdated: "2026-08-14",
    });

    const terrassebord = products.find((product) => product.nobbNumber === "51512345");

    expect(terrassebord).toMatchObject({
      productName: "TERRASSEBORD 28X120 IMP",
      supplierName: "Byggmakker",
      brand: "Marnar",
      category: "Terrasse",
      priceUnit: "M2",
      salesUnit: "PAK",
      salesUnitQuantity: 4.1,
      ean: "7020200000001",
      lastUpdated: "2026-08-14",
    });
    // 119 kr/m² × 4,1 m² per pakke
    expect(terrassebord?.priceNok).toBeCloseTo(487.9, 2);
    expect(terrassebord?.listPriceNok).toBeCloseTo(612.95, 2);
  });

  it("leser norske tallformater og tall lagret som tekst", () => {
    const { products } = parsePriceImportFile({
      fileName: "byggmakker-priser.xlsx",
      data: fixtureBytes,
      supplierName: "Byggmakker",
      lastUpdated: "2026-08-14",
    });

    expect(products.find((product) => product.nobbNumber === "51512346")?.priceNok).toBeCloseTo(249.9, 2);

    const gips = products.find((product) => product.nobbNumber === "51512347");
    expect(gips?.priceNok).toBeCloseTo(1234.5, 2);
    expect(gips?.listPriceNok).toBeCloseTo(1499, 2);
  });

  it("hopper over rader uten NOBB-nummer", () => {
    const { products } = parsePriceImportFile({
      fileName: "byggmakker-priser.xlsx",
      data: fixtureBytes,
      supplierName: "Byggmakker",
    });

    expect(products.some((product) => product.productName === "RAD UTEN NOBB")).toBe(false);
  });
});

describe("Excel-prisfil uten overskriftsrad", () => {
  const parse = () =>
    parsePriceImportFile({
      fileName: "prisliste.xlsx",
      data: headerlessBytes,
      supplierName: "Byggmakker",
      lastUpdated: "2026-08-14",
    });

  it("gjenkjenner kolonnene på innhold", () => {
    const result = parse();

    expect(result.products).toHaveLength(4);
    expect(result.mappedColumns).toMatchObject({
      nobb: "kolonne A",
      productName: "kolonne B",
      description: "kolonne C",
      listPrice: "kolonne E",
      price: "kolonne G",
      salesUnit: "kolonne H",
      categoryCode: "kolonne J",
    });
    expect(result.warnings.some((warning) => warning.includes("ingen overskriftsrad"))).toBe(true);
  });

  it("skiller nettopris fra veiledende pris via rabattkolonnen", () => {
    const gran = parse().products.find((product) => product.nobbNumber === "27885359");

    expect(gran).toMatchObject({
      productName: "GRAN 19X100 SKURLAST 6 SORT",
      salesUnit: "LM",
      priceUnit: "LM",
      category: "Konstruksjonsvirke",
    });
    // 15,92 − 51,69 % = 7,69 (rabattkolonnen skal ikke bli tatt for en pris)
    expect(gran?.priceNok).toBeCloseTo(7.69, 2);
    expect(gran?.listPriceNok).toBeCloseTo(15.92, 2);
  });

  it("tolker hele kroner som kroner, ikke øre", () => {
    const skruer = parse().products.find((product) => product.nobbNumber === "46583456");

    expect(skruer?.priceNok).toBe(200);
    expect(skruer?.listPriceNok).toBe(250);
  });

  it("tar med tilleggsteksten i beskrivelsen", () => {
    const furu = parse().products.find((product) => product.nobbNumber === "54225863");

    expect(furu?.description).toBe("IMPREGNERT");
    expect(furu?.priceNok).toBeCloseTo(274.26, 2);
  });
});

describe("import av CSV med overskriftsrad", () => {
  it("kobler kolonner på navn uansett rekkefølge", () => {
    const csv = [
      "Varenummer;Beskrivelse;Din pris;Enhet",
      '600123;"GIPSPLATE 13X900X2400";99,50;STK',
      "600124;LEKT 48X48;19,90;STK",
    ].join("\n");

    const result = parsePriceImportFile({
      fileName: "prisliste.csv",
      data: new TextEncoder().encode(csv),
      supplierName: "Byggmakker",
      lastUpdated: "2026-08-14",
    });

    expect(result.format).toBe("csv-headers");
    expect(result.products).toHaveLength(2);
    expect(result.products[0]).toMatchObject({
      nobbNumber: "600123",
      productName: "GIPSPLATE 13X900X2400",
      priceNok: 99.5,
      salesUnit: "STK",
    });
  });

  it("faller tilbake til posisjonsparseren for Byggmakkers råeksport", () => {
    const raw = "0506;7020200000000;600001;;TERRASSEBORD 28X120 IMP;11900;8900;M2;;4,1 M2/PK;PAK;4,1;;;";

    const result = parsePriceImportFile({
      fileName: "byggmakker.csv",
      data: new TextEncoder().encode(raw),
      supplierName: "Byggmakker",
      lastUpdated: "2026-08-14",
    });

    expect(result.format).toBe("csv-posisjoner");
    expect(result.products[0]).toMatchObject({ nobbNumber: "600001", priceNok: 364.9 });
  });

  it("beholder siterte felt med skilletegn inni", () => {
    const rows = parseDelimitedRows('a;b;c\n"en;to";tre;"fire ""fem"""');

    expect(rows[1]).toEqual(["en;to", "tre", 'fire "fem"']);
  });
});

describe("overskriftsgjenkjenning", () => {
  it("finner overskriftsraden under tittelrader", () => {
    const rows = [
      ["Prisliste 2026"],
      [],
      ["NOBB", "Varetekst", "Pris"],
      ["12345678", "SKRUE 4,2X55", "89,90"],
    ];

    const result = parseProductsFromTable(rows, options);

    expect(result.headerRowIndex).toBe(2);
    expect(result.products).toHaveLength(1);
  });

  it("lar «prisenhet» beholde sin egen kolonne", () => {
    const rows = [
      ["NOBB", "Produktnavn", "Prisenhet (PE)", "Pris eks. mva"],
      ["12345678", "LEKT 48X48", "STK", "19,90"],
    ];

    const result = parseProductsFromTable(rows, options);

    expect(result.mappedColumns).toMatchObject({ priceUnit: "Prisenhet (PE)", price: "Pris eks. mva" });
    expect(result.products[0].priceNok).toBeCloseTo(19.9, 2);
  });

  it("hopper over NOBB-numre Excel har gjort om til eksponentialform", () => {
    const rows = [
      ["NOBB", "Produktnavn", "Pris"],
      ["1,23457E+11", "UKJENT VARE", "10"],
    ];

    expect(parseProductsFromTable(rows, options).products).toHaveLength(0);
  });
});

describe("parseDecimalNo", () => {
  it("tolker norske og engelske tallformater", () => {
    expect(parseDecimalNo("1 234,56")).toBeCloseTo(1234.56, 2);
    expect(parseDecimalNo("1.234,56")).toBeCloseTo(1234.56, 2);
    expect(parseDecimalNo("1,234.56")).toBeCloseTo(1234.56, 2);
    expect(parseDecimalNo("1.234")).toBe(1234);
    expect(parseDecimalNo("19.90")).toBeCloseTo(19.9, 2);
    expect(parseDecimalNo("kr 199,-")).toBe(199);
    expect(parseDecimalNo("199")).toBe(199);
    expect(parseDecimalNo("")).toBeNull();
    expect(parseDecimalNo("—")).toBeNull();
  });
});
