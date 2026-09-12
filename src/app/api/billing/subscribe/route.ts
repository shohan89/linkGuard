import { NextRequest, NextResponse } from "next/server";
import { shopify } from "@/lib/shopify/client.server";
import {
  getOfflineSessionFromRequest,
  UnauthenticatedError,
} from "@/lib/shopify/session.server";
import { BillingService, InvalidPlanTierError } from "@/lib/billing";
import { enforceRateLimit } from "@/lib/security/rate-limit.server";
import type { SubscriptionPlan } from "@prisma/client";

export const runtime = "nodejs";

interface SubscribeBody {
  targetTier?: unknown;
  host?: unknown;
}

export async function POST(request: NextRequest) {
  let session;
  try {
    session = await getOfflineSessionFromRequest(request);
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    throw error;
  }

  const limited = await enforceRateLimit("billing-subscribe", session.shop, 10, 60);
  if (limited) return limited;

  const body: SubscribeBody = await request.json().catch(() => ({}));

  if (typeof body.targetTier !== "string" || typeof body.host !== "string") {
    return NextResponse.json(
      { error: "targetTier and host are required" },
      { status: 400 },
    );
  }

  // Defense-in-depth: shopify.auth.getEmbeddedAppUrl (used on the callback's
  // way back out) already validates this itself, but failing fast here with
  // a clear 400 beats a confusing error deep in the billing flow.
  const host = shopify.utils.sanitizeHost(body.host, false);
  if (!host) {
    return NextResponse.json({ error: "Invalid host parameter" }, { status: 400 });
  }

  const appUrl = process.env.SHOPIFY_APP_URL;
  const returnUrl = `${appUrl}/api/billing/callback?shop=${encodeURIComponent(session.shop)}&host=${encodeURIComponent(host)}`;

  try {
    const { confirmationUrl } = await BillingService.startUpgrade({
      shopDomain: session.shop,
      session,
      targetTier: body.targetTier as SubscriptionPlan,
      returnUrl,
    });
    return NextResponse.json({ confirmationUrl }, { status: 200 });
  } catch (error) {
    if (error instanceof InvalidPlanTierError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "Failed to start upgrade";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
