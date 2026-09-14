import { NextRequest, NextResponse } from "next/server";
import {
  getOfflineSessionFromRequest,
  UnauthenticatedError,
} from "@/lib/shopify/session.server";
import { getScanStatus } from "@/lib/scanner";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ scanJobId: string }> },
) {
  let session;
  try {
    session = await getOfflineSessionFromRequest(request);
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    throw error;
  }

  const { scanJobId } = await params;
  const status = await getScanStatus(session.shop, scanJobId);

  if (!status) {
    return NextResponse.json({ error: "Scan not found" }, { status: 404 });
  }

  return NextResponse.json(status);
}
