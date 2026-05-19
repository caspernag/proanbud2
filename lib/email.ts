import { Resend } from "resend";

import { env } from "@/lib/env";

const BYGGMAKKER_DEMO_EMAIL = "casper@nagsoftware.no";
const PROANBUD_CC_EMAIL = "post@proanbud.no";
const FROM_ADDRESS = "Proanbud <post@proanbud.no>";
const TREBYGG_ORDER_FROM_ADDRESS = "Trebygg Strand AS <post@proanbud.no>";
const DEFAULT_PUBLIC_ORIGIN = "https://www.proanbud.no";

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

export type ShopOrderEmailItem = {
  productName: string;
  supplierName: string;
  quantity: number;
  unit: string;
  unitPriceNok: number;
  lineTotalNok: number;
  nobbNumber?: string | null;
};

export type ShopOrderEmailPayload = {
  orderId: string;
  orderSlug?: string | null;
  customerName: string;
  customerEmail: string;
  customerPhone?: string | null;
  shippingAddress: string;
  shippingPostalCode: string;
  shippingCity: string;
  subtotalNok: number;
  shippingNok: number;
  vatNok: number;
  totalNok: number;
  items: ShopOrderEmailItem[];
  paidAt: string;
};

export type ByggmakkerShopOrderEmailItem = {
  nobbNumber: string;
  productName: string;
  quantity: number;
  unit: string;
};

export type ByggmakkerShopOrderEmailPayload = {
  orderId: string;
  orderSlug?: string | null;
  customerName: string;
  customerEmail: string;
  customerPhone?: string | null;
  shippingAddress: string;
  shippingPostalCode: string;
  shippingCity: string;
  customerNote?: string | null;
  items: ByggmakkerShopOrderEmailItem[];
  paidAt: string;
};

function fmtNok(nok: number) {
  return new Intl.NumberFormat("nb-NO", { style: "currency", currency: "NOK", maximumFractionDigits: 2 }).format(nok);
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("nb-NO", { day: "2-digit", month: "long", year: "numeric" });
}

function fmtSupplierOrderDate(iso: string) {
  return new Date(iso).toLocaleDateString("nb-NO", { day: "numeric", month: "long", year: "numeric" });
}

function publicOrigin() {
  const configuredOrigin =
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");

  return (configuredOrigin || DEFAULT_PUBLIC_ORIGIN).replace(/\/$/, "");
}

function publicUrl(path: string) {
  return `${publicOrigin()}${path.startsWith("/") ? path : `/${path}`}`;
}

function escapeHtml(value: string | number | null | undefined) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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

function buildShopOrderHtml(p: ShopOrderEmailPayload): string {
  const orderReference = p.orderSlug ?? `#${p.orderId.slice(0, 8).toUpperCase()}`;
  const orderUrl = publicUrl(`/ordre/${encodeURIComponent(p.orderSlug ?? p.orderId)}`);
  const logoUrl = "https://app.proanbud.no/logo/light/logo-primary.svg";
  const paidDate = fmtDate(p.paidAt);
  const itemRows = p.items
    .map(
      (item) => `
    <tr>
      <td style="padding:14px 0;border-bottom:1px solid #ede9e3;vertical-align:top">
        <div style="font-size:14px;line-height:1.45;font-weight:700;color:#171412">${escapeHtml(item.productName)}</div>
        <div style="margin-top:4px;font-size:12px;line-height:1.4;color:#78716c">${escapeHtml(item.supplierName)}${item.nobbNumber ? ` &nbsp;·&nbsp; NOBB ${escapeHtml(item.nobbNumber)}` : ""}</div>
      </td>
      <td style="padding:14px 12px;border-bottom:1px solid #ede9e3;vertical-align:top;text-align:right;font-size:13px;color:#44403c;white-space:nowrap">${escapeHtml(item.quantity)}&nbsp;${escapeHtml(item.unit)}</td>
      <td style="padding:14px 0;border-bottom:1px solid #ede9e3;vertical-align:top;text-align:right;font-size:14px;font-weight:800;color:#171412;white-space:nowrap">${fmtNok(item.lineTotalNok)}</td>
    </tr>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="no">
<head><meta charset="UTF-8"><title>Ordrebekreftelse fra Proanbud</title></head>
<body style="margin:0;padding:0;background:#f3f1ec;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#171412">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">Betalingen er registrert. Her er ordrebekreftelsen fra Proanbud.</div>

  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f1ec;border-collapse:collapse">
    <tr>
      <td align="center" style="padding:28px 14px">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:760px;border-collapse:separate;border-spacing:0;background:#ffffff;border:1px solid #e5e0d7;border-radius:18px;overflow:hidden;box-shadow:0 18px 42px rgba(23,20,18,0.08)">
          <tr>
            <td style="padding:24px 28px 18px;background:#fffefb;border-bottom:1px solid #ece6dc">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">
                <tr>
                  <td style="vertical-align:middle">
                    <img src="${logoUrl}" width="178" alt="Proanbud" style="display:block;width:178px;max-width:178px;height:auto;border:0;outline:none;text-decoration:none" />
                  </td>
                  <td align="right" style="vertical-align:middle;font-size:12px;line-height:1.5;color:#78716c">
                    Ordre<br/>
                    <strong style="font-size:14px;color:#171412">${escapeHtml(orderReference)}</strong>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:30px 28px 26px;background:#163f2a;color:#ffffff">
              <div style="display:inline-block;padding:5px 10px;border-radius:999px;background:#d9ff7a;color:#163f2a;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em">Betaling registrert</div>
              <h1 style="margin:16px 0 0;font-size:32px;line-height:1.12;font-weight:800;color:#ffffff">Takk for bestillingen, ${escapeHtml(p.customerName)}.</h1>
              <p style="margin:12px 0 0;max-width:560px;font-size:15px;line-height:1.65;color:#e8f2ea">Ordren er betalt og sendt videre til behandling. Du kan følge status, transport og meldinger på Min side.</p>
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin-top:22px;border-collapse:collapse">
                <tr>
                  <td style="border-radius:8px;background:#ffffff">
                    <a href="${orderUrl}" style="display:inline-block;padding:12px 18px;font-size:13px;font-weight:800;color:#163f2a;text-decoration:none">Åpne ordren</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:24px 28px 6px;background:#ffffff">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">
                <tr>
                  <td width="33.33%" style="padding:0 8px 12px 0;vertical-align:top">
                    <div style="border:1px solid #e7e2d8;background:#faf8f3;border-radius:10px;padding:13px 14px">
                      <div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:#78716c">Status</div>
                      <div style="margin-top:7px;font-size:15px;font-weight:800;color:#163f2a">Betalt</div>
                    </div>
                  </td>
                  <td width="33.33%" style="padding:0 4px 12px;vertical-align:top">
                    <div style="border:1px solid #e7e2d8;background:#faf8f3;border-radius:10px;padding:13px 14px">
                      <div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:#78716c">Betalt dato</div>
                      <div style="margin-top:7px;font-size:15px;font-weight:800;color:#171412">${paidDate}</div>
                    </div>
                  </td>
                  <td width="33.33%" style="padding:0 0 12px 8px;vertical-align:top">
                    <div style="border:1px solid #e7e2d8;background:#faf8f3;border-radius:10px;padding:13px 14px">
                      <div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:#78716c">Total</div>
                      <div style="margin-top:7px;font-size:15px;font-weight:800;color:#171412">${fmtNok(p.totalNok)}</div>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:14px 28px 0;background:#ffffff">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin-bottom:24px">
        <tr>
          <td style="vertical-align:top;width:50%;padding:0 18px 0 0">
            <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:#78716c;margin-bottom:8px">Kunde</div>
            <div style="font-size:14px;line-height:1.7;color:#171412">
              <strong>${escapeHtml(p.customerName)}</strong><br/>
              ${escapeHtml(p.customerEmail)}<br/>
              ${p.customerPhone ? `${escapeHtml(p.customerPhone)}<br/>` : ""}
            </div>
          </td>
          <td style="vertical-align:top;width:50%;padding:0 0 0 18px;border-left:1px solid #ede9e3">
            <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:#78716c;margin-bottom:8px">Levering</div>
            <div style="font-size:14px;line-height:1.7;color:#171412">
              ${escapeHtml(p.shippingAddress)}<br/>
              ${escapeHtml(p.shippingPostalCode)} ${escapeHtml(p.shippingCity)}
            </div>
          </td>
        </tr>
      </table>

      <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:#78716c;margin-bottom:8px">Produkter (${p.items.length} linjer)</div>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin-bottom:22px">
        <thead>
          <tr style="border-top:1px solid #e7e2d8;border-bottom:1px solid #e7e2d8">
            <th style="padding:10px 0;text-align:left;font-size:11px;color:#78716c;text-transform:uppercase;letter-spacing:.06em">Produkt</th>
            <th style="padding:10px 12px;text-align:right;font-size:11px;color:#78716c;text-transform:uppercase;letter-spacing:.06em">Antall</th>
            <th style="padding:10px 0;text-align:right;font-size:11px;color:#78716c;text-transform:uppercase;letter-spacing:.06em">Sum</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
      </table>

      <table role="presentation" align="right" width="320" cellspacing="0" cellpadding="0" style="max-width:320px;border-collapse:collapse;margin-left:auto">
        <tr><td style="padding:7px 0;border-bottom:1px solid #f0ece4;font-size:13px;color:#78716c">Varer</td><td align="right" style="padding:7px 0;border-bottom:1px solid #f0ece4;font-size:13px;color:#171412">${fmtNok(p.subtotalNok)}</td></tr>
        <tr><td style="padding:7px 0;border-bottom:1px solid #f0ece4;font-size:13px;color:#78716c">Frakt</td><td align="right" style="padding:7px 0;border-bottom:1px solid #f0ece4;font-size:13px;color:#171412">${p.shippingNok === 0 ? "Gratis" : fmtNok(p.shippingNok)}</td></tr>
        <tr><td style="padding:7px 0;border-bottom:1px solid #f0ece4;font-size:13px;color:#78716c">MVA inkl.</td><td align="right" style="padding:7px 0;border-bottom:1px solid #f0ece4;font-size:13px;color:#171412">${fmtNok(p.vatNok)}</td></tr>
        <tr><td style="padding:12px 0;font-size:16px;font-weight:800;color:#171412">Totalt betalt</td><td align="right" style="padding:12px 0;font-size:17px;font-weight:900;color:#163f2a">${fmtNok(p.totalNok)}</td></tr>
      </table>

      <div style="clear:both"></div>

              <div style="margin:24px 0 0;padding:14px 16px;border:1px solid #e7e2d8;border-radius:10px;background:#faf8f3;font-size:12px;line-height:1.65;color:#57534e">
                Stripe sender egen betalingskvittering for kortbetalingen. Denne e-posten er Proanbuds ordrebekreftelse for varene og leveringen.
              </div>
            </td>
          </tr>

          <tr>
            <td style="padding:18px 28px 24px;background:#fffefb;border-top:1px solid #ece6dc;font-size:11px;line-height:1.65;color:#a8a29e">
              Proanbud AS &nbsp;·&nbsp; post@proanbud.no<br/>
              Betalt ${paidDate} via Stripe. Ordren kan følges på <a href="${orderUrl}" style="color:#163f2a;font-weight:700;text-decoration:none">ordresiden</a> (ingen innlogging nødvendig).
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export async function sendShopOrderEmail(payload: ShopOrderEmailPayload): Promise<void> {
  const resend = getResend();
  if (!resend) {
    console.warn("[email] RESEND_API_KEY ikke satt – hopper over butikkordre-e-post");
    return;
  }

  console.log(`[email] Sender butikkordre ${payload.orderId} til ${payload.customerEmail} (bcc: ${PROANBUD_CC_EMAIL})`);

  const result = await resend.emails.send({
    from: FROM_ADDRESS,
    to: payload.customerEmail,
    bcc: PROANBUD_CC_EMAIL,
    subject: `Ordrebekreftelse ${payload.orderSlug ?? `#${payload.orderId.slice(0, 8).toUpperCase()}`}`,
    html: buildShopOrderHtml(payload),
  });

  if (result.error) {
    console.error("[email] Resend returnerte feil:", result.error);
    throw new Error(`Resend feil: ${result.error.message}`);
  }

  console.log("[email] Butikkordre-e-post sendt OK, id:", result.data?.id);
}

function buildByggmakkerShopOrderHtml(p: ByggmakkerShopOrderEmailPayload): string {
  const orderReference = p.orderSlug ?? `#${p.orderId.slice(0, 8).toUpperCase()}`;
  const orderDate = fmtSupplierOrderDate(p.paidAt);
  const shippingInstruction = p.customerNote?.trim() || "Ønsker levering.";
  const logoUrl = "https://scontent.fsvg1-1.fna.fbcdn.net/v/t39.30808-6/495159835_3128346780658589_2723926462117955993_n.jpg";
  const itemRows = p.items
    .map(
      (item) => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #e7e5e4;font-size:12px;color:#44403c;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">${escapeHtml(item.nobbNumber)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e7e5e4;font-size:13px;font-weight:700;color:#171412">${escapeHtml(item.productName)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e7e5e4;font-size:13px;text-align:right;color:#171412;white-space:nowrap">${escapeHtml(item.quantity)}&nbsp;${escapeHtml(item.unit)}</td>
    </tr>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="no">
<head><meta charset="UTF-8"><title>Ny bestilling fra Trebygg Strand AS</title></head>
<body style="margin:0;padding:0;background:#f3f1ec;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#171412">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f1ec;border-collapse:collapse">
    <tr>
      <td align="center" style="padding:28px 14px">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:820px;border-collapse:separate;border-spacing:0;background:#ffffff;border:1px solid #e5e0d7;border-radius:14px;overflow:hidden">
          <tr>
            <td style="padding:22px 28px;background:#fffefb;border-bottom:1px solid #ece6dc">
              <img src="${logoUrl}" width="260" alt="Trebygg Strand AS" style="display:block;width:260px;max-width:260px;height:auto;border:0" />
            </td>
          </tr>
          <tr>
            <td style="padding:28px;background:#163f2a;color:#ffffff">
              <div style="display:inline-block;padding:5px 10px;border-radius:999px;background:#d9ff7a;color:#163f2a;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em">Kundeordre</div>
              <h1 style="margin:14px 0 0;font-size:28px;line-height:1.2;color:#ffffff">Bestilling ${escapeHtml(orderReference)}</h1>
              <p style="margin:10px 0 0;max-width:640px;font-size:14px;line-height:1.65;color:#e8f2ea">
                Vennligst behandle ordren på Trebygg Strand AS sin avtale og fakturer etter vanlig avtalt løp.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 28px">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin-bottom:22px">
                <tr>
                  <td style="vertical-align:top;width:50%;padding-right:18px">
                    <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:#78716c;margin-bottom:8px">Sluttkunde</div>
                    <div style="font-size:13px;line-height:1.7;color:#171412">
                      <strong>${escapeHtml(p.customerName)}</strong><br/>
                      ${escapeHtml(p.customerEmail)}<br/>
                      ${p.customerPhone ? `${escapeHtml(p.customerPhone)}<br/>` : ""}
                    </div>
                  </td>
                  <td style="vertical-align:top;width:50%;padding-left:18px;border-left:1px solid #ede9e3">
                    <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:#78716c;margin-bottom:8px">Levering</div>
                    <div style="font-size:13px;line-height:1.7;color:#171412">
                      ${escapeHtml(p.shippingAddress)}<br/>
                      ${escapeHtml(p.shippingPostalCode)} ${escapeHtml(p.shippingCity)}
                    </div>
                  </td>
                </tr>
              </table>

              <div style="margin:0 0 18px;padding:14px 16px;border:1px solid #e7e2d8;border-radius:10px;background:#faf8f3;font-size:13px;line-height:1.65;color:#44403c">
                <strong style="color:#171412">Fraktinstruks:</strong> ${escapeHtml(shippingInstruction)}
              </div>

              <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:#78716c;margin-bottom:8px">Varelinjer (${p.items.length})</div>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin-bottom:22px">
                <thead>
                  <tr style="background:#fafaf9;border-top:1px solid #e7e5e4;border-bottom:1px solid #e7e5e4">
                    <th style="padding:9px 12px;text-align:left;font-size:11px;color:#78716c;text-transform:uppercase">NOBB</th>
                    <th style="padding:9px 12px;text-align:left;font-size:11px;color:#78716c;text-transform:uppercase">Produkt</th>
                    <th style="padding:9px 12px;text-align:right;font-size:11px;color:#78716c;text-transform:uppercase">Mengde</th>
                  </tr>
                </thead>
                <tbody>${itemRows}</tbody>
              </table>

              <p style="margin:0;font-size:11px;line-height:1.65;color:#a8a29e;border-top:1px solid #f0ece4;padding-top:14px">
                Bestilt ${orderDate}.
                <br/>Ordre: ${escapeHtml(orderReference)}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export async function sendByggmakkerShopOrderEmail(payload: ByggmakkerShopOrderEmailPayload): Promise<string | null> {
  const resend = getResend();
  if (!resend) {
    console.warn("[email] RESEND_API_KEY ikke satt – hopper over Byggmakker-ordre");
    return null;
  }

  const recipient = resolveByggmakkerOrderRecipient();

  if (!recipient) {
    console.warn("[email] BYGGMAKKER_ORDER_EMAIL ikke satt – hopper over Byggmakker-ordre");
    return null;
  }

  const replyTo = env.trebyggOrderFromEmail.trim();
  const orderReference = payload.orderSlug ?? `#${payload.orderId.slice(0, 8).toUpperCase()}`;
  console.log(`[email] Sender Byggmakker-ordre ${payload.orderId} fra ${TREBYGG_ORDER_FROM_ADDRESS} til ${recipient} (bcc: ${PROANBUD_CC_EMAIL})`);

  const result = await resend.emails.send({
    from: TREBYGG_ORDER_FROM_ADDRESS,
    to: recipient,
    bcc: PROANBUD_CC_EMAIL,
    ...(replyTo ? { replyTo } : {}),
    subject: `Trebygg bestilling ${orderReference} – vurder transport`,
    html: buildByggmakkerShopOrderHtml(payload),
  });

  if (result.error) {
    console.error("[email] Resend returnerte feil:", result.error);
    throw new Error(`Resend feil: ${result.error.message}`);
  }

  console.log("[email] Byggmakker-ordre sendt OK, id:", result.data?.id);
  return result.data?.id ?? null;
}

function resolveByggmakkerOrderRecipient() {
  const configuredRecipient = env.byggmakkerOrderEmail.trim();

  if (configuredRecipient) {
    return configuredRecipient;
  }

  return process.env.NODE_ENV === "production" ? "" : BYGGMAKKER_DEMO_EMAIL;
}
