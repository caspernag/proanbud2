import { copyFile, mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";

import PDFDocument from "pdfkit";
import SVGtoPDF from "svg-to-pdfkit";

import type { ProjectView } from "@/lib/project-data";
import { formatCurrency } from "@/lib/utils";

const PAGE_SIZE: [number, number] = [595.28, 841.89];
const MARGIN = 48;
const FOOTER_SPACE = 24;

const colors = {
  text: "#1f2524",
  muted: "#64706c",
  accent: "#2f6f5e",
  line: "#d7ddda",
  cardBorder: "#d7ddda",
};

type Layout = {
  left: number;
  right: number;
  width: number;
};

let ensurePdfkitDataPromise: Promise<void> | null = null;

export async function createMaterialListPdf(project: ProjectView) {
  await ensurePdfkitDataFiles();
  const logoSvg = await loadLogoSvg();
  const doc = new PDFDocument({
    size: PAGE_SIZE,
    margins: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN },
    bufferPages: true,
  });

  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const layout = getLayout(doc);
  const ensureSpace = (requiredHeight: number) => {
    const bottom = doc.page.height - doc.page.margins.bottom - FOOTER_SPACE;
    if (doc.y + requiredHeight > bottom) {
      doc.addPage();
      doc.y = doc.page.margins.top;
    }
  };

  const drawSectionHeading = (title: string, size = 11) => {
    ensureSpace(24);
    const y = doc.y;

    doc.fillColor(colors.text).font("Helvetica-Bold").fontSize(size);
    doc.text(title, layout.left, y, { lineBreak: false });

    const titleWidth = doc.widthOfString(title);
    const lineStart = Math.min(layout.left + titleWidth + 10, layout.right - 4);
    if (lineStart < layout.right - 1) {
      //drawLine(doc, lineStart, layout.right, y + size - 2, colors.line);
    }
    doc.y = y + size + 9;
  };

  drawHeader(doc, layout, project, logoSvg);
  drawDetailsCards(doc, layout, ensureSpace, project);
  drawPrice(doc, layout, ensureSpace, project);
  drawDescription(doc, layout, ensureSpace, drawSectionHeading, project);
  drawSections(doc, layout, ensureSpace, drawSectionHeading, project);
  drawPageFooters(doc, layout);

  doc.end();
  const buffer = await done;
  return new Uint8Array(buffer);
}

function drawHeader(doc: PDFKit.PDFDocument, layout: Layout, project: ProjectView, logoSvg: string | null) {
  const startY = doc.y;
  let renderedLogo = false;
  const logoWidth = 150;
  const logoX = layout.left;
  const logoY = startY - 4;
  const logoHeight = (200 / 848) * logoWidth;

  if (logoSvg) {
    try {
      // svg-to-pdfkit augments PDFKit at runtime; casting keeps TS strict mode happy.
      SVGtoPDF(doc as unknown as PDFKit.PDFDocument, logoSvg, logoX, logoY, {
        width: logoWidth,
        preserveAspectRatio: "xMinYMin meet",
      });
      renderedLogo = true;
    } catch {
      renderedLogo = false;
    }
  }

  if (!renderedLogo) {
    doc.fillColor(colors.text).font("Helvetica-Bold").fontSize(18).text("Proanbud", layout.left, startY + 3);
  }

  const generatedAt = new Date().toLocaleString("nb-NO", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  doc
    .fillColor(colors.muted)
    .font("Helvetica")
    .fontSize(8)
    .text("Generert", layout.right - 140, startY + 4, { width: 140, align: "right" });

  doc
    .fillColor(colors.text)
    .font("Helvetica-Bold")
    .fontSize(10)
    .text(generatedAt, layout.right - 140, startY + 16, { width: 140, align: "right" });

  const titleY = startY + logoHeight + 18;
  doc.fillColor(colors.accent).font("Helvetica-Bold").fontSize(11).text("Materialliste", layout.left, titleY);
  doc.fillColor(colors.text).font("Helvetica-Bold").fontSize(16);
  doc.text(normalizeText(project.title) || "Prosjekt", layout.left, titleY + 18, {
    width: layout.width - 170,
    lineGap: 1,
  });

  const dividerY = Math.max(doc.y + 8, titleY + 56);
  drawLine(doc, layout.left, layout.right, dividerY, colors.line);
  doc.y = dividerY + 14;
}

function drawDetailsCards(
  doc: PDFKit.PDFDocument,
  layout: Layout,
  ensureSpace: (height: number) => void,
  project: ProjectView,
) {
  const details = [
    { label: "LOKASJON", value: normalizeText(project.location) || "Ikke oppgitt" },
    { label: "PROSJEKTTYPE", value: normalizeText(project.projectType) || "Ikke oppgitt" },
    { label: "AREAL", value: `${project.areaSqm} m²` },
    { label: "STANDARD", value: normalizeText(project.finishLevel) || "Ikke oppgitt" },
  ];

  const gap = 10;
  const cardHeight = 58;
  const cardWidth = (layout.width - gap * 3) / 4;

  ensureSpace(cardHeight + 18);
  const topY = doc.y;

  for (let index = 0; index < details.length; index += 1) {
    const detail = details[index];
    const x = layout.left + index * (cardWidth + gap);
    const width = index === details.length - 1 ? layout.right - x : cardWidth;

    doc
      .lineWidth(1)
      .strokeColor(colors.cardBorder)
      .rect(x, topY, width, cardHeight)
      .stroke();

    doc.fillColor(colors.muted).font("Helvetica").fontSize(7).text(detail.label, x + 10, topY + 13, {
      width: width - 20,
      lineBreak: false,
    });

    doc.fillColor(colors.text).font("Helvetica-Bold").fontSize(10).text(detail.value, x + 10, topY + 28, {
      width: width - 20,
      lineGap: 1,
    });
  }

  doc.y = topY + cardHeight + 16;
}

function drawPrice(
  doc: PDFKit.PDFDocument,
  layout: Layout,
  ensureSpace: (height: number) => void,
  project: ProjectView,
) {
  ensureSpace(42);
  const topY = doc.y;
  const estimateNok = calculateRealisticEstimateNok(project);
  doc.fillColor(colors.muted).font("Helvetica").fontSize(8).text("Prisestimat (materialer)", layout.left, topY, {
    lineBreak: false,
  });
  doc.fillColor(colors.text).font("Helvetica-Bold").fontSize(12).text(formatCurrency(estimateNok), layout.left, topY + 12, {
    lineBreak: false,
  });
  doc
    .fillColor(colors.muted)
    .font("Helvetica")
    .fontSize(8)
    .text("Basert på areal, prosjekttype og standard.", layout.left, topY + 28, { lineBreak: false });
  doc.y = topY + 44;
}

function drawDescription(
  doc: PDFKit.PDFDocument,
  layout: Layout,
  ensureSpace: (height: number) => void,
  drawSectionHeading: (title: string, size?: number) => void,
  project: ProjectView,
) {
  const text = normalizeText(project.description) || "Ingen beskrivelse oppgitt.";
  const textHeight = doc.heightOfString(text, {
    width: layout.width,
    align: "left",
    lineGap: 2
  });

  ensureSpace(textHeight + 34);
  drawSectionHeading("Prosjektbeskrivelse");

  doc.fillColor(colors.text).font("Helvetica").fontSize(10).text(text, layout.left, doc.y, {
    width: layout.width,
    lineGap: 2,
  });

  doc.y += 14;
}

function drawSections(
  doc: PDFKit.PDFDocument,
  layout: Layout,
  ensureSpace: (height: number) => void,
  drawSectionHeading: (title: string, size?: number) => void,
  project: ProjectView,
) {
  drawSectionHeading("Materialseksjoner");

  for (let sectionIndex = 0; sectionIndex < project.materialSections.length; sectionIndex += 1) {
    const section = project.materialSections[sectionIndex];
    const sectionTitle = normalizeText(section.title) || "Seksjon";
    const sectionDescription = normalizeText(section.description);

    if (sectionIndex > 0) {
      doc.y += 14;
    }

    ensureSpace(70);
    drawSectionHeading(sectionTitle, 12);

    if (sectionDescription) {
      const descriptionHeight = doc.heightOfString(sectionDescription, {
        width: layout.width,
        lineGap: 1,
      });
      ensureSpace(descriptionHeight + 10);
      doc.fillColor(colors.muted).font("Helvetica").fontSize(10).text(sectionDescription, layout.left, doc.y, {
        width: layout.width,
        lineGap: 1,
      });
      doc.y += 8;
    }

    for (const item of section.items) {
      const itemName = normalizeText(item.item) || "Uspesifisert materiale";
      const quantity = normalizeText(item.quantity) || "-";
      const note = normalizeText(item.note);
      const quantityWidth = 84;
      const itemWidth = layout.width - quantityWidth - 8;

      const itemHeight = doc.heightOfString(itemName, { width: itemWidth, lineGap: 1 });
      const noteHeight = note ? doc.heightOfString(note, { width: layout.width, lineGap: 1 }) : 0;
      const rowHeight = Math.max(itemHeight, 12) + (note ? noteHeight + 8 : 4);

      ensureSpace(rowHeight + 12);
      drawLine(doc, layout.left, layout.right, doc.y, colors.line);

      const rowTop = doc.y + 6;
      doc.fillColor(colors.text).font("Helvetica-Bold").fontSize(10).text(itemName, layout.left, rowTop, {
        width: itemWidth,
        lineGap: 1,
      });

      doc.fillColor(colors.text).font("Helvetica-Bold").fontSize(10).text(quantity, layout.right - quantityWidth, rowTop, {
        width: quantityWidth,
        align: "right",
      });

      let nextY = rowTop + itemHeight + 3;
      if (note) {
        doc.fillColor(colors.muted).font("Helvetica").fontSize(9.5).text(note, layout.left, nextY, {
          width: layout.width,
          lineGap: 1,
        });
        nextY += noteHeight + 3;
      }

      doc.y = nextY;
    }

    doc.y += 18;
  }
}

function calculateRealisticEstimateNok(project: ProjectView) {
  const type = normalizeText(project.projectType).toLowerCase();
  const finish = normalizeText(project.finishLevel).toLowerCase();
  const area = Math.max(8, Number(project.areaSqm) || 8);

  let unitPricePerSqm = 8500;
  if (type.includes("terrasse")) {
    unitPricePerSqm = 4200;
    } else if (type.includes("bad") || type.includes("vatrom") || type.includes("våtrom")) {
    unitPricePerSqm = 14500;
  } else if (type.includes("kjokken") || type.includes("kjoekken")) {
    unitPricePerSqm = 10500;
    } else if (type.includes("tilbygg") || type.includes("pabygg") || type.includes("påbygg")) {
    unitPricePerSqm = 13500;
  } else if (type.includes("nybygg")) {
    unitPricePerSqm = 12500;
  }

  let finishFactor = 1;
  if (finish.includes("enkel") || finish.includes("basis")) {
    finishFactor = 0.88;
    } else if (finish.includes("hoy") || finish.includes("høy") || finish.includes("premium") || finish.includes("eksklusiv")) {
    finishFactor = 1.22;
  }

  const computed = area * unitPricePerSqm * finishFactor;

  return Math.max(10000, Math.round(computed / 1000) * 1000);
}

function drawPageFooters(doc: PDFKit.PDFDocument, layout: Layout) {
  const pages = doc.bufferedPageRange();
  for (let index = 0; index < pages.count; index += 1) {
    doc.switchToPage(index);
    const footerY = doc.page.height - doc.page.margins.bottom - 10;
    doc
      .fillColor(colors.muted)
      .font("Helvetica")
      .fontSize(8)
      .text(`ProAnbud materialliste  •  Side ${index + 1} av ${pages.count}`, layout.left, footerY, {
        width: layout.width,
        align: "left",
        lineBreak: false,
      });
  }
}

function getLayout(doc: PDFKit.PDFDocument): Layout {
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  return {
    left,
    right,
    width: right - left,
  };
}

function drawLine(doc: PDFKit.PDFDocument, x1: number, x2: number, y: number, color: string) {
  doc
    .lineWidth(1)
    .strokeColor(color)
    .moveTo(x1, y)
    .lineTo(x2, y)
    .stroke();
}

async function ensurePdfkitDataFiles() {
  if (ensurePdfkitDataPromise) {
    return ensurePdfkitDataPromise;
  }

  ensurePdfkitDataPromise = (async () => {
    const sourceDir = path.join(process.cwd(), "node_modules", "pdfkit", "js", "data");
    const targetDirs = [
      path.join(process.cwd(), ".next", "dev", "server", "vendor-chunks", "data"),
      path.join(process.cwd(), ".next", "server", "vendor-chunks", "data"),
    ];

    let files: string[] = [];
    try {
      files = await readdir(sourceDir);
    } catch {
      return;
    }

    for (const targetDir of targetDirs) {
      try {
        await mkdir(targetDir, { recursive: true });
      } catch {
        continue;
      }

      for (const file of files) {
        if (!file.endsWith(".afm") && !file.endsWith(".icc")) {
          continue;
        }

        const sourcePath = path.join(sourceDir, file);
        const targetPath = path.join(targetDir, file);

        try {
          await copyFile(sourcePath, targetPath);
        } catch {
          // Best effort: if copy fails, pdfkit may still succeed in environments that bundle data correctly.
        }
      }
    }
  })();

  return ensurePdfkitDataPromise;
}

async function loadLogoSvg() {
  const logoPath = path.join(process.cwd(), "public", "logo", "light", "logo-primary.svg");
  try {
    return await readFile(logoPath, "utf8");
  } catch {
    return null;
  }
}

function normalizeText(text: string | null | undefined) {
  return (text ?? "").replace(/\s+/g, " ").trim();
}