import { NextResponse } from "next/server";

import { env, isStripeBypassed } from "@/lib/env";
import { MATERIAL_LIST_PRICE_NOK } from "@/lib/project-data";
import { getStripe } from "@/lib/stripe";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const formData = await request.formData();
  const slug = String(formData.get("slug") || "").trim();
  const requestedProjectName = String(formData.get("projectName") || "Materialliste").trim();
  const priceNok = MATERIAL_LIST_PRICE_NOK;
  const origin = resolveCheckoutOrigin(request.url);
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = supabase ? await supabase.auth.getUser() : { data: { user: null } };
  let resolvedProjectId = "";
  let resolvedProjectName = requestedProjectName || "Materialliste";
  let resolvedSlug = slug;

  if (!slug) {
    return NextResponse.json({ error: "Mangler prosjekt-slug." }, { status: 400 });
  }

  if (supabase && user) {
    const { data: project } = await supabase
      .from("projects")
      .select("id, slug, title")
      .eq("slug", slug)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!project) {
      return NextResponse.json({ error: "Prosjekt ikke funnet." }, { status: 404 });
    }

    resolvedProjectId = project.id;
    resolvedProjectName = project.title;
    resolvedSlug = project.slug;
  }

  if (isStripeBypassed()) {
    if (supabase && user && resolvedProjectId) {
      await supabase
        .from("projects")
        .update({ payment_status: "paid" })
        .eq("id", resolvedProjectId)
        .eq("user_id", user.id);
    }

    return NextResponse.json({ url: `${origin}/min-side/materiallister/${resolvedSlug}?unlocked=1&test_mode=1` });
  }

  const stripe = getStripe();

  if (!stripe) {
    return NextResponse.json(
      {
        error: "Legg inn STRIPE_SECRET_KEY for å aktivere betalingsmuren.",
      },
      { status: 503 },
    );
  }

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: user?.email,
    success_url: `${origin}/betaling/suksess?slug=${resolvedSlug}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/min-side/materiallister/${resolvedSlug}?betaling=avbrutt`,
    metadata: {
      kind: "project_unlock",
      projectId: resolvedProjectId,
      slug: resolvedSlug,
      projectName: resolvedProjectName,
    },
    line_items: env.stripePriceId
      ? [
          {
            price: env.stripePriceId,
            quantity: 1,
          },
        ]
      : [
          {
            price_data: {
              currency: "nok",
              product_data: {
                name: `Materialliste: ${resolvedProjectName}`,
                description: "AI-generert materialliste klargjort for partnerpris og bestilling.",
              },
              unit_amount: priceNok * 100,
            },
            quantity: 1,
          },
        ],
  });

  if (supabase && user && resolvedProjectId) {
    const { error: updateError } = await supabase
      .from("projects")
      .update({ stripe_checkout_session_id: session.id })
      .eq("id", resolvedProjectId)
      .eq("user_id", user.id);

    if (updateError) {
      return NextResponse.json({ error: "Kunne ikke lagre betalingssesjon." }, { status: 500 });
    }
  }

  return NextResponse.json({ url: session.url });
}

function resolveCheckoutOrigin(requestUrl: string) {
  const url = new URL(requestUrl);
  return url.origin;
}
