import { NextRequest, NextResponse } from "next/server";
import {
  getOfflineSessionFromRequest,
  UnauthenticatedError,
} from "@/lib/shopify/session.server";
import { RedirectManagementService } from "@/lib/redirects";
import { IssueService } from "@/lib/issues/issue.server";
import { enforceRateLimit } from "@/lib/security/rate-limit.server";

export const runtime = "nodejs";

interface CreateRedirectBody {
  fromUrl?: unknown;
  toUrl?: unknown;
  confirmed?: unknown;
  issueId?: unknown;
}

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

  const [issues, history] = await Promise.all([
    IssueService.listRedirectIssues(session.shop),
    RedirectManagementService.listHistory(session.shop),
  ]);

  return NextResponse.json({ issues, history });
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

  const limited = await enforceRateLimit("redirects", session.shop, 20, 60);
  if (limited) return limited;

  const body: CreateRedirectBody = await request.json().catch(() => ({}));

  if (typeof body.fromUrl !== "string" || typeof body.toUrl !== "string") {
    return NextResponse.json(
      { error: "fromUrl and toUrl are required strings" },
      { status: 400 },
    );
  }

  const result = await RedirectManagementService.createRedirect({
    session,
    shopDomain: session.shop,
    fromUrl: body.fromUrl,
    toUrl: body.toUrl,
    confirmed: body.confirmed === true,
    issueId: typeof body.issueId === "string" ? body.issueId : undefined,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ redirect: result.redirect }, { status: 201 });
}
