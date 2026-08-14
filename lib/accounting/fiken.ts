import { env, hasFikenEnv } from "@/lib/env";

import type { DaybookDraft } from "./daybook";

/**
 * Fiken-integrasjon: poster ferdig balanserte bilag til regnskapet.
 *
 * DRY RUN
 * Uten FIKEN_API_TOKEN kjører alt her i tørrmodus: bilaget bygges og valideres
 * som normalt, men sendes ikke. Det gjør at hele kjeden — cron, dagsoppgjør,
 * admin-UI — kan kjøres og verifiseres før selskapet finnes og Fiken-kontoen er
 * opprettet. Tørrmodus er ikke en test-hack, det er den normale tilstanden fram
 * til tokenet settes.
 *
 * MVA
 * Beløpene som postes er BRUTTO (inkl. mva), med mva-kode på inntektslinjen.
 * Fiken splitter selv ut utgående mva til 2700. Poster man netto pluss en egen
 * mva-linje, havner mva-en to ganger i mva-meldingen.
 */

const FIKEN_API_BASE = "https://api.fiken.no/api/v2";

/**
 * Kontoplan. Samlet her fordi regnskapsføreren kan ville ha andre numre —
 * spesielt 3070: noen fører frakt til kunde på salgskontoen i stedet for egen
 * konto. Endres numrene, endres de bare her.
 */
export const FIKEN_ACCOUNTS = {
  /** Stripe-mellomkonto. Debiteres ved salg, krediteres ved utbetaling. */
  stripeClearing: "1930",
  /** Bankkonto. Debiteres når Stripe utbetaler. */
  bank: "1920",
  /** Salgsinntekt handelsvarer, avgiftspliktig. */
  goodsRevenue: "3000",
  /** Fraktinntekt, avgiftspliktig. */
  shippingRevenue: "3070",
  /** Bank- og kortgebyrer. Stripe-gebyret er en finansiell tjeneste uten mva. */
  paymentFees: "7770",
} as const;

/**
 * Mva-koder i Fiken. "3" er utgående mva høy sats (25 %).
 *
 * MERK: kodeverdiene må verifiseres mot Fikens egen API-spesifikasjon
 * (api.fiken.no/api/v2/docs) før første ekte postering. Er koden feil, blir
 * mva-meldingen feil — og det oppdages typisk først ved terminoppgjør.
 */
export const FIKEN_VAT_CODES = {
  outgoingHigh: "3",
  none: "0",
} as const;

export type FikenJournalLine = {
  amount: number;
  debitAccount: string;
  creditAccount: string;
  debitVatCode?: string;
  creditVatCode?: string;
};

export type FikenJournalEntry = {
  description: string;
  date: string;
  lines: FikenJournalLine[];
};

export type FikenPostResult =
  | { posted: true; journalEntryId: string }
  | { posted: false; dryRun: true; payload: FikenJournalEntry };

/* ── Bilagsbygging ──────────────────────────────────────────────────────── */

/**
 * Salgsbilaget for ett døgn.
 *
 * Debet 1930 Stripe (brutto) mot kredit 3000 varesalg og 3070 frakt, begge med
 * utgående mva-kode. Linjer med beløp 0 utelates — et bilag med en nullinje
 * avvises av Fiken.
 */
export function buildDaybookJournalEntry(draft: DaybookDraft): FikenJournalEntry {
  const lines: FikenJournalLine[] = [];

  if (draft.goodsGrossOre > 0) {
    lines.push({
      amount: draft.goodsGrossOre,
      debitAccount: FIKEN_ACCOUNTS.stripeClearing,
      creditAccount: FIKEN_ACCOUNTS.goodsRevenue,
      creditVatCode: FIKEN_VAT_CODES.outgoingHigh,
    });
  }

  if (draft.shippingGrossOre > 0) {
    lines.push({
      amount: draft.shippingGrossOre,
      debitAccount: FIKEN_ACCOUNTS.stripeClearing,
      creditAccount: FIKEN_ACCOUNTS.shippingRevenue,
      creditVatCode: FIKEN_VAT_CODES.outgoingHigh,
    });
  }

  return {
    description: `Nettbutikk dagsoppgjør ${draft.bookingDate} (${draft.orderCount} ordre)`,
    date: draft.bookingDate,
    lines,
  };
}

export type PayoutDraft = {
  payoutDate: string;
  stripePayoutId: string;
  grossOre: number;
  feeOre: number;
  netOre: number;
};

/**
 * Utbetalingsbilaget: Stripe flytter penger til banken, minus gebyr.
 *
 * Debet 1920 bank (netto) + debet 7770 gebyr mot kredit 1930 Stripe (brutto).
 * Gebyret er unntatt mva som finansiell tjeneste — vi får ikke fradrag, så hele
 * beløpet er kostnad og linjen har ingen mva-kode.
 */
export function buildPayoutJournalEntry(payout: PayoutDraft): FikenJournalEntry {
  const lines: FikenJournalLine[] = [
    {
      amount: payout.netOre,
      debitAccount: FIKEN_ACCOUNTS.bank,
      creditAccount: FIKEN_ACCOUNTS.stripeClearing,
    },
  ];

  if (payout.feeOre > 0) {
    lines.push({
      amount: payout.feeOre,
      debitAccount: FIKEN_ACCOUNTS.paymentFees,
      creditAccount: FIKEN_ACCOUNTS.stripeClearing,
    });
  }

  return {
    description: `Stripe-utbetaling ${payout.payoutDate} (${payout.stripePayoutId})`,
    date: payout.payoutDate,
    lines,
  };
}

export type RefundDraft = {
  stripeRefundId: string;
  refundDate: string;
  orderReference: string;
  goodsGrossOre: number;
  shippingGrossOre: number;
};

/**
 * Kreditnotabilaget: motsatt vei av salgsbilaget.
 *
 * Debet 3000/3070 (inntekten reduseres) mot kredit 1930 Stripe. Mva-koden må
 * være med, ellers reverseres omsetningen uten at den utgående mva-en følger
 * med — og da betaler vi mva på et salg som er gjort om.
 */
export function buildRefundJournalEntry(refund: RefundDraft): FikenJournalEntry {
  const lines: FikenJournalLine[] = [];

  if (refund.goodsGrossOre > 0) {
    lines.push({
      amount: refund.goodsGrossOre,
      debitAccount: FIKEN_ACCOUNTS.goodsRevenue,
      debitVatCode: FIKEN_VAT_CODES.outgoingHigh,
      creditAccount: FIKEN_ACCOUNTS.stripeClearing,
    });
  }

  if (refund.shippingGrossOre > 0) {
    lines.push({
      amount: refund.shippingGrossOre,
      debitAccount: FIKEN_ACCOUNTS.shippingRevenue,
      debitVatCode: FIKEN_VAT_CODES.outgoingHigh,
      creditAccount: FIKEN_ACCOUNTS.stripeClearing,
    });
  }

  return {
    description: `Kreditnota ordre ${refund.orderReference} (refusjon ${refund.stripeRefundId})`,
    date: refund.refundDate,
    lines,
  };
}

/* ── Postering ──────────────────────────────────────────────────────────── */

/**
 * Sender bilaget til Fiken, eller logger det i tørrmodus.
 *
 * Kaster ved feil. Kalleren skal fange, markere bilaget som `failed` og la det
 * bli liggende — automatisk retry i løkke er farlig her: en delvis vellykket
 * postering vi ikke fikk lest svaret på, ville blitt postet på nytt.
 */
export async function postJournalEntry(entry: FikenJournalEntry): Promise<FikenPostResult> {
  if (entry.lines.length === 0) {
    throw new Error("Bilaget har ingen linjer og kan ikke posteres.");
  }

  if (!hasFikenEnv()) {
    console.log(
      `[fiken] TØRRMODUS – bilag ikke sendt: ${entry.description}`,
      JSON.stringify(entry.lines),
    );
    return { posted: false, dryRun: true, payload: entry };
  }

  const response = await fetch(
    `${FIKEN_API_BASE}/companies/${encodeURIComponent(env.fikenCompanySlug)}/generalJournalEntries`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.fikenApiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        description: entry.description,
        journalEntries: [
          {
            description: entry.description,
            date: entry.date,
            lines: entry.lines,
          },
        ],
      }),
    },
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Fiken avviste bilaget (${response.status}): ${body.slice(0, 400)}`);
  }

  // Fiken svarer 201 med Location-header til det opprettede bilaget. Id-en er
  // siste ledd i URL-en, og er det vi lagrer som bevis på at bilaget er postet.
  const location = response.headers.get("location") ?? "";
  const journalEntryId = location.split("/").filter(Boolean).pop() ?? "";

  if (!journalEntryId) {
    throw new Error("Fiken godtok bilaget, men svarte uten bilags-id. Kontroller manuelt i Fiken før ny postering.");
  }

  return { posted: true, journalEntryId };
}
