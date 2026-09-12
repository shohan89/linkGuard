import { NextRequest, NextResponse } from "next/server";
import {
  getOfflineSessionFromRequest,
  UnauthenticatedError,
} from "@/lib/shopify/session.server";
import { listMonitoredUrls } from "@/lib/scanner";

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

  const urls = await listMonitoredUrls(session.shop);
  return NextResponse.json(urls);
}
