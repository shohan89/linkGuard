import { NextRequest, NextResponse } from "next/server";
import {
  getOfflineSessionFromRequest,
  UnauthenticatedError,
} from "@/lib/shopify/session.server";
import { BillingService } from "@/lib/billing";
import { enforceRateLimit } from "@/lib/security/rate-limit.server";

export const runtime = "nodejs";

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

  const limited = await enforceRateLimit("billing-cancel", session.shop, 10, 60);
  if (limited) return limited;

  try {
    await BillingService.downgradeToFree(session.shop, session);
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to downgrade";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
