import { normalizeProjectTitle, slugify } from "@/lib/utils";
import { decodeMaterialSectionsFromUrl } from "@/lib/material-list-encoding";

export const MATERIAL_LIST_PRICE_NOK = 49;

export type MaterialItem = {
  item: string;
  quantity: string;
  note: string;
  quantityReason?: string;
  nobb?: string;
};

export type MaterialSection = {
  title: string;
  description: string;
  items: MaterialItem[];
};

export type ProjectInput = {
  title: string;
  location: string;
  projectType: string;
  areaSqm: number;
  finishLevel: string;
  description: string;
};

export type ProjectView = ProjectInput & {
  id?: string;
  slug: string;
  teaser: string;
  previewBullets: string[];
  riskBullets: string[];
  materialSections: MaterialSection[];
  priceNok: number;
  paymentStatus: "locked" | "paid";
  priceDuelCheapestSupplier?: string;
  priceDuelSavingsNok?: number;
  priceDuelComparedAt?: string;
  pdfGeneratedAt?: string;
  pdfFileName?: string;
  createdAt?: string;
};

export type ProjectRow = {
  id: string;
  slug: string;
  title: string;
  location: string | null;
  project_type: string | null;
  area_sqm: number | null;
  finish_level: string | null;
  description: string | null;
  preview_summary:
    | {
        teaser?: string;
        previewBullets?: string[];
        riskBullets?: string[];
        priceDuelCheapestSupplier?: string;
        priceDuelSavingsNok?: number;
        priceDuelComparedAt?: string;
      }
    | null;
  material_list: MaterialSection[] | null;
  price_nok: number | null;
  payment_status: "locked" | "paid" | null;
  pdf_file_name: string | null;
  pdf_generated_at: string | null;
  pdf_document_base64?: string | null;
  created_at: string;
};

export const PROJECT_ROW_SELECT =
  "id, slug, title, location, project_type, area_sqm, finish_level, description, preview_summary, material_list, price_nok, payment_status, pdf_file_name, pdf_generated_at, created_at" as const;

function inferScenario(input: ProjectInput) {
  const text = `${input.projectType} ${input.title} ${input.description}`.toLowerCase();

  if (/(bad|våtrom|dusj|wc)/.test(text)) {
    return "bathroom";
  }

  if (/(terrasse|platting|uteplass|dekke)/.test(text)) {
    return "terrace";
  }

  if (/(kjøkken|kokk|spisestue)/.test(text)) {
    return "kitchen";
  }

  if (/(tilbygg|påbygg|anneks|bod|garasje)/.test(text)) {
    return "extension";
  }

  return "renovation";
}

function qty(areaSqm: number, divisor: number, unit: string, minimum: number) {
  return `${Math.max(minimum, Math.ceil(areaSqm / divisor))} ${unit}`;
}

function sectionLibrary(input: ProjectInput): MaterialSection[] {
  const scenario = inferScenario(input);
  const areaSqm = Math.max(12, input.areaSqm);

  if (scenario === "bathroom") {
    return [
      {
        title: "Underlag og oppbygging",
        description: "Stabil base for et tett og varig våtrom.",
        items: [
          {
            item: "Våtromsplater",
            quantity: qty(areaSqm, 2, "stk", 18),
            note: "Medregnet vegghøyde og kapp.",
          },
          {
            item: "Støpemasse / avretting",
            quantity: qty(areaSqm, 7, "sekker", 6),
            note: "For fall mot sluk og jevnt underlag.",
          },
          {
            item: "Primer og fugelist",
            quantity: qty(areaSqm, 12, "sett", 2),
            note: "Forberedt for membransystem.",
          },
        ],
      },
      {
        title: "Tettsjikt",
        description: "Kritiske produkter for membran og våtsoner.",
        items: [
          {
            item: "Smøremembran",
            quantity: qty(areaSqm, 4, "spann", 3),
            note: "Beregnet for gulv, vegg og sikkerhetsmargin.",
          },
          {
            item: "Mansjetter og hjørnebånd",
            quantity: qty(areaSqm, 10, "pakker", 2),
            note: "Dekker rørgjennomføringer og hjørner.",
          },
          {
            item: "Slukmansjett",
            quantity: "1 stk",
            note: "Tilpasset ett standard sluk.",
          },
        ],
      },
      {
        title: "Overflater",
        description: "Flis, lim og fuge for ferdig uttrykk.",
        items: [
          {
            item: "Flislim",
            quantity: qty(areaSqm, 6, "sekker", 5),
            note: "Basert på standard flisformat.",
          },
          {
            item: "Gulv- og veggflis",
            quantity: `${Math.ceil(areaSqm * 3.4)} m²`,
            note: "Inkluderer veggflater og 10 % kapp.",
          },
          {
            item: "Fugemasse og silikon",
            quantity: qty(areaSqm, 9, "sett", 3),
            note: "Beregnet for våtromsavslutninger.",
          },
        ],
      },
    ];
  }

  if (scenario === "terrace") {
    return [
      {
        title: "Bærekonstruksjon",
        description: "Fundament og bjelkelag tilpasset uteklima.",
        items: [
          {
            item: "Justerbare stolpesko / fundament",
            quantity: qty(areaSqm, 3, "stk", 8),
            note: "Basert på standard moduloppbygging.",
          },
          {
            item: "Impregnerte bjelker 48x198",
            quantity: `${Math.ceil(areaSqm * 1.8)} lm`,
            note: "Ytterramme, dragere og svill.",
          },
          {
            item: "Bjelkesko og beslag",
            quantity: qty(areaSqm, 5, "pakker", 3),
            note: "For sammenføyninger og avstivning.",
          },
        ],
      },
      {
        title: "Dekke",
        description: "Terrassebord og skruer for ferdig overflate.",
        items: [
          {
            item: "Terrassebord",
            quantity: `${Math.ceil(areaSqm * 1.15)} m²`,
            note: "Inkluderer svinn og avslutninger.",
          },
          {
            item: "Rustfrie terrasseskruer",
            quantity: qty(areaSqm, 1, "esker", 3),
            note: "Dobbel innfesting per bjelke.",
          },
          {
            item: "Endevedforsegling / olje",
            quantity: qty(areaSqm, 18, "spann", 1),
            note: "For vedlikehold etter montering.",
          },
        ],
      },
      {
        title: "Detaljer",
        description: "Elementer som gir et ferdig og sikkert resultat.",
        items: [
          {
            item: "Rekkverksstolper",
            quantity: qty(areaSqm, 4, "stk", 6),
            note: "Kun dersom høyde/fall krever rekkverk.",
          },
          {
            item: "Topprekke og håndløper",
            quantity: `${Math.ceil(areaSqm * 0.8)} lm`,
            note: "Estimert for en åpen terrasse.",
          },
          {
            item: "Skjulte clips / avslutningslister",
            quantity: qty(areaSqm, 8, "pakker", 2),
            note: "For strammere finish.",
          },
        ],
      },
    ];
  }

  if (scenario === "kitchen") {
    return [
      {
        title: "Riving og klargjøring",
        description: "Materialer for å gjøre rommet klart for nytt kjøkken.",
        items: [
          {
            item: "Gipsplater",
            quantity: qty(areaSqm, 2.6, "stk", 10),
            note: "For veggretting og tilpasninger.",
          },
          {
            item: "Sparkel og remse",
            quantity: qty(areaSqm, 12, "sett", 2),
            note: "Dekker skjøter og utbedringer.",
          },
          {
            item: "Primer til gulv/vegg",
            quantity: qty(areaSqm, 18, "spann", 1),
            note: "Klar for videre arbeid.",
          },
        ],
      },
      {
        title: "Innbygging",
        description: "Stabil oppbygging for skap, benk og tekniske soner.",
        items: [
          {
            item: "Kryssfiner bakstykker",
            quantity: qty(areaSqm, 6, "plater", 3),
            note: "For ekstra bæreevne bak overskap.",
          },
          {
            item: "Lekter 48x48",
            quantity: `${Math.ceil(areaSqm * 1.1)} lm`,
            note: "For innfesting og utforing.",
          },
          {
            item: "Fuktbestandige plater",
            quantity: qty(areaSqm, 8, "stk", 4),
            note: "Rundt vask og utsatte soner.",
          },
        ],
      },
      {
        title: "Overflater",
        description: "Finishprodukter som gir ferdig uttrykk.",
        items: [
          {
            item: "Maling eller mikrosement-system",
            quantity: qty(areaSqm, 14, "spann", 2),
            note: "Avhenger av valgt standard.",
          },
          {
            item: "Gulvunderlag / parkettklikk",
            quantity: `${Math.ceil(areaSqm * 1.08)} m²`,
            note: "8 % kapp inkludert.",
          },
          {
            item: "Akryl, silikon og avslutningslister",
            quantity: qty(areaSqm, 10, "sett", 2),
            note: "For detaljarbeid og pen overgang.",
          },
        ],
      },
    ];
  }

  if (scenario === "extension") {
    return [
      {
        title: "Grunn og bæring",
        description: "Materialer som setter rammen for tilbygget.",
        items: [
          {
            item: "Ringmur / fundamentblokker",
            quantity: qty(areaSqm, 2.8, "stk", 18),
            note: "Tilpasset normal boligkonstruksjon.",
          },
          {
            item: "Konstruksjonsvirke 48x198",
            quantity: `${Math.ceil(areaSqm * 3.6)} lm`,
            note: "Bjelkelag, reisverk og avstivning.",
          },
          {
            item: "Bjelkesko, beslag og ankere",
            quantity: qty(areaSqm, 5, "pakker", 4),
            note: "For tilslutning mot eksisterende bygg.",
          },
        ],
      },
      {
        title: "Klima og tetthet",
        description: "Lagene som gjør tilbygget varmt og tett.",
        items: [
          {
            item: "Vindsperre",
            quantity: `${Math.ceil(areaSqm * 2.4)} m²`,
            note: "Yttervegger og overganger inkludert.",
          },
          {
            item: "Mineralull 200 mm",
            quantity: `${Math.ceil(areaSqm * 2.1)} m²`,
            note: "Yttervegger og takflater.",
          },
          {
            item: "Dampsperre og tape",
            quantity: `${Math.ceil(areaSqm * 1.8)} m²`,
            note: "Basert på innvendig klimaskjerm.",
          },
        ],
      },
      {
        title: "Innvendig ferdigstilling",
        description: "Overflater og detaljer som fullfører rommet.",
        items: [
          {
            item: "Gipsplater",
            quantity: qty(areaSqm, 2.4, "stk", 12),
            note: "Vegg og himling med svinn.",
          },
          {
            item: "Sparkel, maling og lister",
            quantity: qty(areaSqm, 10, "sett", 4),
            note: "For standard malerfinish.",
          },
          {
            item: "Gulvunderlag og parkett",
            quantity: `${Math.ceil(areaSqm * 1.1)} m²`,
            note: "Medregnet kapp og reserve.",
          },
        ],
      },
    ];
  }

  return [
    {
      title: "Konstruksjon og underlag",
      description: "Materialer for å bygge opp rommet riktig fra start.",
      items: [
        {
          item: "Konstruksjonsvirke",
          quantity: `${Math.ceil(areaSqm * 2.4)} lm`,
          note: "Tilpasset generelt rehabiliteringsarbeid.",
        },
        {
          item: "Gips- eller rehabplater",
          quantity: qty(areaSqm, 2.8, "stk", 10),
          note: "For vegger og nødvendige tilpasninger.",
        },
        {
          item: "Festemidler og beslag",
          quantity: qty(areaSqm, 8, "pakker", 3),
          note: "Skruer, spiker og forbindelser.",
        },
      ],
    },
    {
      title: "Teknisk klargjøring",
      description: "Lagene som påvirker drift, komfort og holdbarhet.",
      items: [
        {
          item: "Isolasjon",
          quantity: `${Math.ceil(areaSqm * 1.5)} m²`,
          note: "Om prosjektet krever forbedret klimaskjerm.",
        },
        {
          item: "Fuktsperre / primer",
          quantity: qty(areaSqm, 15, "sett", 1),
          note: "Basert på standard romfornyelse.",
        },
        {
          item: "Utforing og lekter",
          quantity: `${Math.ceil(areaSqm * 0.8)} lm`,
          note: "For planhet og innfesting.",
        },
      ],
    },
    {
      title: "Finish",
      description: "Materialer for overflater og siste detalj.",
      items: [
        {
          item: "Sparkel og maling",
          quantity: qty(areaSqm, 12, "sett", 2),
          note: "Beregnet for to strøk.",
        },
        {
          item: "Gulvprodukt",
          quantity: `${Math.ceil(areaSqm * 1.08)} m²`,
          note: "8 % kapp inkludert.",
        },
        {
          item: "Lister, fug og avslutninger",
          quantity: qty(areaSqm, 9, "sett", 2),
          note: "For ferdig uttrykk rundt overganger.",
        },
      ],
    },
  ];
}

export function buildProjectView(input: ProjectInput, overrides?: Partial<ProjectView>): ProjectView {
  const scenario = inferScenario(input);
  const priceNok = MATERIAL_LIST_PRICE_NOK;
  const teaserByScenario: Record<string, string> = {
    bathroom:
      "AI-en har identifisert våtromssoner, membranbehov og kritiske tettesjikt på et grunnlag leverandører kan prises mot.",
    terrace:
      "AI-en har estimert bjelkelag, terrassebord og beslag med reserve for kapp, klart for direkte prissammenligning.",
    kitchen:
      "AI-en har brutt prosjektet ned i klargjøring, innbygging og finish så leverandører sammenlignes på samme liste.",
    extension:
      "AI-en har delt opp tilbygget i konstruksjon, tetthet og ferdigstilling for å redusere feil og styrke innkjøpsgrunnlaget.",
    renovation:
      "AI-en har laget et første materialløp med fokus på underlag, tekniske lag og finish, klart for prisduell.",
  };

  const previewBullets = [
    `${Math.ceil(input.areaSqm * 1.1)} m² overflategrunnlag analysert for ${input.projectType.toLowerCase()}.`,
    `${input.finishLevel}-nivå gir anbefalinger for finish, reserve og detaljarbeid.`,
    "Samme materialliste kan brukes mot flere leverandører for renere prissammenligning.",
  ];

  const riskBullets = [
    "Kapp, svinn og overlapp er lagt inn i de mest kritiske postene.",
    "Tekniske fag som elektriker/rørlegger er markert som egne avklaringer.",
    "Bør kontrollmåles opp mot tegning eller befaring før endelig bestilling.",
  ];

  return {
    ...input,
    slug: overrides?.slug ?? slugify(input.title),
    teaser: teaserByScenario[scenario],
    previewBullets,
    riskBullets,
    materialSections: [],
    priceNok,
    paymentStatus: overrides?.paymentStatus ?? "locked",
    ...overrides,
  };
}

export function projectFromRow(row: ProjectRow): ProjectView {
  const normalizedTitle = normalizeProjectTitle(row.title);

  return {
    id: row.id,
    slug: row.slug,
    title: normalizedTitle,
    location: row.location ?? "Uspesifisert sted",
    projectType: row.project_type ?? "Rehabilitering",
    areaSqm: row.area_sqm ?? 30,
    finishLevel: row.finish_level ?? "Standard",
    description: row.description ?? "Prosjektbeskrivelse mangler",
    teaser:
      row.preview_summary?.teaser ??
      "AI-en har analysert prosjektbeskrivelsen og satt opp materialstruktur for prissammenligning.",
    previewBullets:
      row.preview_summary?.previewBullets ??
      buildProjectView({
        title: normalizedTitle,
        location: row.location ?? "Uspesifisert sted",
        projectType: row.project_type ?? "Rehabilitering",
        areaSqm: row.area_sqm ?? 30,
        finishLevel: row.finish_level ?? "Standard",
        description: row.description ?? "",
      }).previewBullets,
    riskBullets:
      row.preview_summary?.riskBullets ??
      buildProjectView({
        title: normalizedTitle,
        location: row.location ?? "Uspesifisert sted",
        projectType: row.project_type ?? "Rehabilitering",
        areaSqm: row.area_sqm ?? 30,
        finishLevel: row.finish_level ?? "Standard",
        description: row.description ?? "",
      }).riskBullets,
    materialSections:
      row.material_list ??
      [],
    priceNok: MATERIAL_LIST_PRICE_NOK,
    paymentStatus: row.payment_status === "paid" ? "paid" : "locked",
    priceDuelCheapestSupplier: row.preview_summary?.priceDuelCheapestSupplier ?? undefined,
    priceDuelSavingsNok: row.preview_summary?.priceDuelSavingsNok ?? undefined,
    priceDuelComparedAt: row.preview_summary?.priceDuelComparedAt ?? undefined,
    pdfGeneratedAt: row.pdf_generated_at ?? undefined,
    pdfFileName: row.pdf_file_name ?? undefined,
    createdAt: row.created_at,
  };
}

export function buildProjectFromSearchParams(
  slug: string,
  searchParams: Record<string, string | string[] | undefined>,
) {
  const title =
    typeof searchParams.title === "string"
      ? normalizeProjectTitle(searchParams.title, "")
      : "";

  if (!title) {
    return null;
  }

  const materialSectionsFromSearchParams =
    parseCompressedMaterialSectionsFromSearchParams(searchParams.materialListCompressed) ??
    parseMaterialSectionsFromSearchParams(searchParams.materialList);

  return buildProjectView(
    {
      title,
      location: typeof searchParams.location === "string" ? searchParams.location : "Uspesifisert sted",
      projectType:
        typeof searchParams.projectType === "string" ? searchParams.projectType : "Rehabilitering",
      areaSqm:
        typeof searchParams.areaSqm === "string" ? Number(searchParams.areaSqm) || 30 : 30,
      finishLevel:
        typeof searchParams.finishLevel === "string" ? searchParams.finishLevel : "Standard",
      description:
        typeof searchParams.description === "string"
          ? searchParams.description
          : "Prosjektbeskrivelse mangler",
    },
    {
      slug,
      ...(materialSectionsFromSearchParams ? { materialSections: materialSectionsFromSearchParams } : {}),
    },
  );
}

function parseCompressedMaterialSectionsFromSearchParams(value: string | string[] | undefined) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  const decoded = decodeMaterialSectionsFromUrl(value);
  return parseMaterialSectionsFromUnknown(decoded);
}

function parseMaterialSectionsFromSearchParams(value: string | string[] | undefined) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return parseMaterialSectionsFromUnknown(parsed);
  } catch {
    return null;
  }
}

function parseMaterialSectionsFromUnknown(parsed: unknown) {
  if (!Array.isArray(parsed)) {
    return null;
  }

  const normalized: MaterialSection[] = [];

  for (const section of parsed) {
    if (!section || typeof section !== "object") {
      continue;
    }

    const maybeSection = section as {
      title?: unknown;
      description?: unknown;
      items?: unknown;
    };

    if (!Array.isArray(maybeSection.items)) {
      continue;
    }

    const items: MaterialItem[] = [];

    for (const item of maybeSection.items) {
      if (!item || typeof item !== "object") {
        continue;
      }

      const maybeItem = item as {
        item?: unknown;
        quantity?: unknown;
        note?: unknown;
        quantityReason?: unknown;
        nobb?: unknown;
      };

      const parsedItem: MaterialItem = {
        item: typeof maybeItem.item === "string" ? maybeItem.item : "Byggevare",
        quantity: typeof maybeItem.quantity === "string" ? maybeItem.quantity : "1 stk",
        note:
          typeof maybeItem.note === "string"
            ? maybeItem.note
            : "Estimert fra opplastet prosjektgrunnlag.",
      };

      if (typeof maybeItem.quantityReason === "string" && maybeItem.quantityReason.trim().length > 0) {
        parsedItem.quantityReason = maybeItem.quantityReason;
      }

      if (typeof maybeItem.nobb === "string") {
        const normalizedNobb = maybeItem.nobb.replace(/\D/g, "");

        if (normalizedNobb.length >= 6 && normalizedNobb.length <= 10) {
          parsedItem.nobb = normalizedNobb;
        }
      }

      items.push(parsedItem);
    }

    if (items.length === 0) {
      continue;
    }

    normalized.push({
      title: typeof maybeSection.title === "string" ? maybeSection.title : "Materialseksjon",
      description:
        typeof maybeSection.description === "string"
          ? maybeSection.description
          : "AI-generert seksjon basert på prosjektgrunnlaget.",
      items,
    });
  }

  return normalized.length > 0 ? normalized : null;
}
