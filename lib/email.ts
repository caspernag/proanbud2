import { Resend } from "resend";

import { env } from "@/lib/env";

const BYGGMAKKER_DEMO_EMAIL = "casper@nagsoftware.no";
const PROANBUD_CC_EMAIL = "post@proanbud.no";
const FROM_ADDRESS = "Proanbud <post@proanbud.no>";

function getResend(): Resend | null {
  if (!env.resendApiKey) return null;
  return new Resend(env.resendApiKey);
}

export type OrderEmailItem = {
  product_name: string;
  supplier_label: string;
  quantity: number;
  unit: string;
  unit_price_nok: number;
  total_price_nok: number;
  /** Min-pris from price list (no markup, no VAT). Used for the supplier purchase order email. */
  cost_price_nok?: number;
  cost_total_nok?: number;
  nobb_number?: string | null;
};

export type OrderEmailPayload = {
  orderId: string;
  customerName: string;
  customerEmail: string;
  customerPhone?: string | null;
  deliveryMode: "delivery" | "pickup";
  deliveryAddress?: string | null;
  deliveryPostalCode?: string | null;
  deliveryCity?: string | null;
  earliestDelivery?: string | null;
  latestDelivery?: string | null;
  subtotalNok: number;
  deliveryFeeNok: number;
  vatNok: number;
  totalNok: number;
  items: OrderEmailItem[];
  paidAt: string;
};

function fmtNok(nok: number) {
  return new Intl.NumberFormat("nb-NO", { style: "currency", currency: "NOK", maximumFractionDigits: 2 }).format(nok);
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("nb-NO", { day: "2-digit", month: "long", year: "numeric" });
}

const TREBYGGSTRAND_LOGO = "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRZYMWZpcd5IuYs58FZGCe1ZBSC9KbnxaD7cQ&s";

function buildOrderHtml(p: OrderEmailPayload): string {
  // Use cost_price_nok (min-pris) if available, otherwise fall back to unit_price_nok
  const costSubtotal = p.items.reduce((sum, item) => {
    const costPrice = item.cost_price_nok ?? item.unit_price_nok;
    return sum + costPrice * item.quantity;
  }, 0);
  const costTotal = costSubtotal + p.deliveryFeeNok;

  const itemRows = p.items
    .map((item) => {
      const costPrice = item.cost_price_nok ?? item.unit_price_nok;
      const costLineTotal = item.cost_total_nok ?? costPrice * item.quantity;
      return `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e7e5e4;font-size:13px;color:#1c1917">${item.product_name}</td>
      ${item.nobb_number ? `<td style="padding:8px 12px;border-bottom:1px solid #e7e5e4;font-size:12px;color:#57534e;font-family:monospace">${item.nobb_number}</td>` : `<td style="padding:8px 12px;border-bottom:1px solid #e7e5e4"></td>`}
      <td style="padding:8px 12px;border-bottom:1px solid #e7e5e4;font-size:13px;text-align:right;color:#1c1917">${item.quantity}&nbsp;${item.unit}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e7e5e4;font-size:13px;text-align:right;color:#1c1917">${fmtNok(costPrice)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e7e5e4;font-size:13px;text-align:right;font-weight:600;color:#1c1917">${fmtNok(costLineTotal)}</td>
    </tr>`;
    })
    .join("");

  const deliveryBlock =
    p.deliveryMode === "delivery"
      ? `
      <p style="margin:4px 0;font-size:13px;color:#1c1917"><strong>Leveringsadresse:</strong> ${p.deliveryAddress ?? ""}, ${p.deliveryPostalCode ?? ""} ${p.deliveryCity ?? ""}</p>
      ${p.earliestDelivery && p.latestDelivery ? `<p style="margin:4px 0;font-size:13px;color:#1c1917"><strong>Ønsket leveringsvindu:</strong> ${fmtDate(p.earliestDelivery)} – ${fmtDate(p.latestDelivery)}</p>` : ""}
    `
      : `<p style="margin:4px 0;font-size:13px;color:#1c1917"><strong>Hentested:</strong> Nærmeste Byggmakker-varehus</p>`;

  return `<!DOCTYPE html>
<html lang="no">
<head><meta charset="UTF-8"><title>Bestillingsforespørsel fra Proanbud</title></head>
<body style="margin:0;padding:0;background:#f4f4f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:700px;margin:32px auto;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #ddd">

    <!-- Header -->
    <div style="background:#ffffff;padding:20px 32px;border-bottom:3px solid #00843D;display:flex;align-items:center;gap:16px">
      <img src="${TREBYGGSTRAND_LOGO}" alt="Trebyggstrand" style="height:52px;width:auto;display:block" />
      <div style="border-left:1px solid #e5e7eb;padding-left:16px">
        <div style="font-size:18px;font-weight:700;color:#1a1a1a">Bestillingsforespørsel</div>
        <div style="font-size:12px;color:#6b7280;margin-top:2px">Fra Proanbud AS &nbsp;·&nbsp; Ref. #${p.orderId.slice(0, 8).toUpperCase()}</div>
      </div>
    </div>

    <!-- Body -->
    <div style="padding:24px 32px">

      <!-- Customer / delivery info -->
      <table style="width:100%;margin-bottom:24px;border-collapse:collapse">
        <tr>
          <td style="vertical-align:top;width:50%;padding-right:16px">
            <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;margin-bottom:8px">Sluttkundens kontaktinfo</div>
            <div style="font-size:13px;color:#1c1917;line-height:1.6">
              ${p.customerName}<br/>
              ${p.customerEmail}<br/>
              ${p.customerPhone ? p.customerPhone + "<br/>" : ""}
            </div>
          </td>
          <td style="vertical-align:top;width:50%;padding-left:16px;border-left:1px solid #e7e5e4">
            <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;margin-bottom:8px">Leveringsinformasjon</div>
            <div style="font-size:13px;color:#1c1917;line-height:1.6">
              ${p.deliveryMode === "delivery" ? `${p.deliveryAddress ?? ""}<br/>${p.deliveryPostalCode ?? ""} ${p.deliveryCity ?? ""}` : "Henting i varehus"}
              ${p.latestDelivery ? `<br/><span style="color:#6b7280">Ønsket levering: ${fmtDate(p.latestDelivery)}</span>` : ""}
            </div>
          </td>
        </tr>
      </table>

      <!-- Items table -->
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;margin-bottom:10px">Produkter (${p.items.length} linjer)</div>
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;font-size:13px">
        <thead>
          <tr style="background:#f9fafb;border-top:1px solid #e5e7eb;border-bottom:1px solid #e5e7eb">
            <th style="padding:9px 12px;text-align:left;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:#6b7280">Produkt</th>
            <th style="padding:9px 12px;text-align:left;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:#6b7280">NOBB-nr</th>
            <th style="padding:9px 12px;text-align:right;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:#6b7280">Antall</th>
            <th style="padding:9px 12px;text-align:right;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:#6b7280">Min-pris</th>
            <th style="padding:9px 12px;text-align:right;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:#6b7280">Sum</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
      </table>

      <!-- Price summary (cost prices, no VAT) -->
      <div style="max-width:300px;margin-left:auto;margin-bottom:24px">
        <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f3f4f6">
          <span style="font-size:13px;color:#6b7280">Varer (ex. MVA)</span>
          <span style="font-size:13px;color:#1c1917">${fmtNok(costSubtotal)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f3f4f6">
          <span style="font-size:13px;color:#6b7280">Frakt</span>
          <span style="font-size:13px;color:#1c1917">${p.deliveryFeeNok === 0 ? "Ikke oppgitt" : fmtNok(p.deliveryFeeNok)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:10px 0">
          <span style="font-size:14px;font-weight:700;color:#1c1917">Total ex. MVA</span>
          <span style="font-size:14px;font-weight:700;color:#00843D">${fmtNok(costTotal)}</span>
        </div>
      </div>

      <p style="font-size:11px;color:#9ca3af;margin:0;padding-top:16px;border-top:1px solid #f3f4f6">
        Bestilt ${fmtDate(p.paidAt)} via Proanbud AS (org.nr. 123 456 789) &nbsp;·&nbsp; post@proanbud.no
        <br/>Prisene er min-priser fra prislisten ex. MVA og uten påslag.
      </p>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Sends a material order notification to Byggmakker (demo) with CC to Proanbud.
 * Silently returns if RESEND_API_KEY is not set (safe for dev/test).
 */
export async function sendMaterialOrderEmail(payload: OrderEmailPayload): Promise<void> {
  const resend = getResend();
  if (!resend) {
    console.warn("[email] RESEND_API_KEY ikke satt – hopper over e-post");
    return;
  }

  console.log(`[email] Sender e-post for ordre ${payload.orderId} til ${BYGGMAKKER_DEMO_EMAIL} (cc: ${PROANBUD_CC_EMAIL})`);

  const result = await resend.emails.send({
    from: FROM_ADDRESS,
    to: BYGGMAKKER_DEMO_EMAIL,
    cc: PROANBUD_CC_EMAIL,
    subject: `Ny bestilling #${payload.orderId.slice(0, 8).toUpperCase()} – ${payload.customerName}`,
    html: buildOrderHtml(payload),
  });

  if (result.error) {
    console.error("[email] Resend returnerte feil:", result.error);
    throw new Error(`Resend feil: ${result.error.message}`);
  }

  console.log("[email] E-post sendt OK, id:", result.data?.id);
}
