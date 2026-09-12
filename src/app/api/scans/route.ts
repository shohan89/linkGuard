import { NextRequest, NextResponse } from "next/server";
import {
  getOfflineSessionFromRequest,
  UnauthenticatedError,
} from "@/lib/shopify/session.server";
import { enqueueScan, ScanAlreadyRunningError } from "@/lib/queue/scan-queue.server";
import { listScans } from "@/lib/scanner";
import { PlanLimitExceededError } from "@/lib/billing";
import { enforceRateLimit } from "@/lib/security/rate-limit.server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  let session;
  try {
    session = await getOfflineSessionFromRequest(request);
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    throw error;
  }

  const scans = await listScans(session.shop);
  return NextResponse.json(scans);
}

/**
 * Triggers a scan. Enqueues and returns immediately — the scan itself
 * runs in the worker process (src/worker.ts), never on this request. That
 * separation is what keeps a large store's scan from blocking the app.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getOfflineSessionFromRequest(request);

    const limited = await enforceRateLimit("scans", session.shop, 10, 60);
    if (limited) return limited;

    const { scanJobId } = await enqueueScan(session.shop, "MANUAL");
    return NextResponse.json({ scanJobId }, { status: 202 });
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof ScanAlreadyRunningError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof PlanLimitExceededError) {
      return NextResponse.json({ error: error.message }, { status: 402 });
    }
    throw error;
  }
}
