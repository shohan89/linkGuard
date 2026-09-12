import type { Session } from "@shopify/shopify-api";
import { prisma } from "@/lib/database/client.server";
import { getShop } from "@/lib/database/shops.server";
import { IssueService } from "@/lib/issues/issue.server";
import {
  RedirectService,
  ShopifyRedirectUserError,
} from "@/lib/shopify/services/redirect.server";

// ─────────────────────────────────────────────────────────────────────────
// Validation — pure, no I/O, fully deterministic
// ─────────────────────────────────────────────────────────────────────────

export interface ValidatedRedirectUrls {
  /** Always a shop-relative path starting with "/". */
  fromPath: string;
  /** Either a shop-relative path, or a full external URL. */
  toTarget: string;
}

export type RedirectValidationError =
  | "EMPTY_FROM_URL"
  | "EMPTY_TO_URL"
  | "FROM_URL_TOO_LONG"
  | "TO_URL_TOO_LONG"
  | "FROM_URL_WRONG_DOMAIN"
  | "TO_URL_INVALID"
  | "SAME_URL";

/** Shopify's own redirect path/target columns are capped well under this;
 * this just rejects absurd input before it reaches the Admin API at all. */
const MAX_URL_LENGTH = 2048;

export type RedirectValidationResult =
  | { valid: true; urls: ValidatedRedirectUrls }
  | { valid: false; error: RedirectValidationError; message: string };

function tryParseUrl(input: string): URL | null {
  try {
    return new URL(input);
  } catch {
    return null;
  }
}

function normalizeForComparison(pathOrUrl: string): string {
  const lower = pathOrUrl.toLowerCase();
  return lower.length > 1 && lower.endsWith("/") ? lower.slice(0, -1) : lower;
}

/** The "old URL": must resolve to a path on *this* shop — you can't ask
 * Shopify to redirect a path that isn't yours. */
function resolveFromPath(input: string, shopDomain: string): string | null {
  const asUrl = tryParseUrl(input);
  if (asUrl) {
    if (asUrl.hostname.toLowerCase() !== shopDomain.toLowerCase()) {
      return null;
    }
    return asUrl.pathname + asUrl.search || "/";
  }
  return input.startsWith("/") ? input : `/${input}`;
}

/** The "new URL": a path on this shop, or a full external URL — Shopify
 * redirects can legitimately point off-site. */
function resolveTarget(input: string, shopDomain: string): string | null {
  const asUrl = tryParseUrl(input);
  if (asUrl) {
    if (asUrl.protocol !== "http:" && asUrl.protocol !== "https:") {
      return null;
    }
    if (asUrl.hostname.toLowerCase() === shopDomain.toLowerCase()) {
      return asUrl.pathname + asUrl.search || "/";
    }
    return asUrl.toString();
  }
  return input.startsWith("/") ? input : `/${input}`;
}

export function validateRedirectUrls(
  fromUrl: string,
  toUrl: string,
  shopDomain: string,
): RedirectValidationResult {
  const fromTrimmed = fromUrl.trim();
  const toTrimmed = toUrl.trim();

  if (!fromTrimmed) {
    return { valid: false, error: "EMPTY_FROM_URL", message: "Old URL is required" };
  }
  if (!toTrimmed) {
    return { valid: false, error: "EMPTY_TO_URL", message: "New URL is required" };
  }
  if (fromTrimmed.length > MAX_URL_LENGTH) {
    return { valid: false, error: "FROM_URL_TOO_LONG", message: "Old URL is too long" };
  }
  if (toTrimmed.length > MAX_URL_LENGTH) {
    return { valid: false, error: "TO_URL_TOO_LONG", message: "New URL is too long" };
  }

  const fromPath = resolveFromPath(fromTrimmed, shopDomain);
  if (fromPath === null) {
    return {
      valid: false,
      error: "FROM_URL_WRONG_DOMAIN",
      message: "Old URL must be a path on this store",
    };
  }

  const toTarget = resolveTarget(toTrimmed, shopDomain);
  if (toTarget === null) {
    return { valid: false, error: "TO_URL_INVALID", message: "New URL is not a valid URL" };
  }

  if (normalizeForComparison(fromPath) === normalizeForComparison(toTarget)) {
    return {
      valid: false,
      error: "SAME_URL",
      message: "Old URL and new URL must be different",
    };
  }

  return { valid: true, urls: { fromPath, toTarget } };
}

// ─────────────────────────────────────────────────────────────────────────
// Loop detection — walks Shopify's live redirect graph
// ─────────────────────────────────────────────────────────────────────────

function isExternalTarget(target: string, shopDomain: string): boolean {
  const asUrl = tryParseUrl(target);
  return asUrl !== null && asUrl.hostname.toLowerCase() !== shopDomain.toLowerCase();
}

/**
 * Would creating fromPath -> toTarget complete or extend a cycle? Walks
 * the chain of existing redirects starting at toTarget, asking Shopify
 * (the source of truth — redirects can be created outside this app too)
 * at each hop. An external target can't cycle back through Shopify's own
 * redirect table by definition, so that's an immediate "no". A hard depth
 * cap means a pathological or already-looping chain we stumble into gets
 * treated as a loop rather than walked forever.
 */
export async function detectRedirectLoop(
  session: Session,
  fromPath: string,
  toTarget: string,
  shopDomain: string,
  maxDepth = 10,
): Promise<boolean> {
  if (isExternalTarget(toTarget, shopDomain)) {
    return false;
  }

  let current = toTarget;
  const visited = new Set<string>([normalizeForComparison(fromPath)]);

  for (let i = 0; i < maxDepth; i++) {
    const key = normalizeForComparison(current);
    if (visited.has(key)) {
      return true;
    }
    visited.add(key);

    const existing = await RedirectService.findRedirectByPath(session, current);
    if (!existing) {
      return false;
    }
    current = existing.target;
  }

  return true;
}

// ─────────────────────────────────────────────────────────────────────────
// Orchestration
// ─────────────────────────────────────────────────────────────────────────

export interface CreateRedirectInput {
  session: Session;
  shopDomain: string;
  fromUrl: string;
  toUrl: string;
  /** Must be explicitly true — the UI's confirmation step is what sets this. */
  confirmed: boolean;
  /** The broken-link Issue this redirect fixes, if triggered from one. Gets auto-resolved on success. */
  issueId?: string;
}

export type CreateRedirectResult =
  | { ok: true; redirect: ValidatedRedirectUrls & { id: string } }
  | { ok: false; error: string };

export interface RedirectHistoryEntry {
  id: string;
  fromPath: string;
  toTarget: string;
  createdAt: Date;
  issueId: string | null;
}

export const RedirectManagementService = {
  async createRedirect(input: CreateRedirectInput): Promise<CreateRedirectResult> {
    if (!input.confirmed) {
      return { ok: false, error: "Merchant confirmation is required before creating a redirect" };
    }

    let shopForIssueCheck: { id: string } | null = null;
    if (input.issueId) {
      shopForIssueCheck = await getShop(input.shopDomain);
      const owned =
        shopForIssueCheck &&
        (await prisma.issue.findFirst({
          where: { id: input.issueId, shopId: shopForIssueCheck.id },
          select: { id: true },
        }));
      if (!owned) {
        // Deliberately generic — doesn't reveal whether the id belongs to
        // another shop or doesn't exist at all.
        return { ok: false, error: "Issue not found" };
      }
    }

    const validation = validateRedirectUrls(input.fromUrl, input.toUrl, input.shopDomain);
    if (!validation.valid) {
      return { ok: false, error: validation.message };
    }
    const { fromPath, toTarget } = validation.urls;

    const existing = await RedirectService.findRedirectByPath(input.session, fromPath);
    if (existing) {
      return {
        ok: false,
        error: `${fromPath} already redirects to ${existing.target}`,
      };
    }

    const isLoop = await detectRedirectLoop(
      input.session,
      fromPath,
      toTarget,
      input.shopDomain,
    );
    if (isLoop) {
      return { ok: false, error: "This redirect would create a loop" };
    }

    let created;
    try {
      created = await RedirectService.createRedirect(input.session, {
        path: fromPath,
        target: toTarget,
      });
    } catch (error) {
      const message =
        error instanceof ShopifyRedirectUserError
          ? error.message
          : "Failed to create the redirect on Shopify";
      return { ok: false, error: message };
    }

    const shop = shopForIssueCheck ?? (await getShop(input.shopDomain));
    if (!shop) {
      console.error(
        `Redirect ${created.id} created on Shopify but no local Shop row for ${input.shopDomain} — history not saved`,
      );
      return { ok: true, redirect: { id: created.id, fromPath, toTarget } };
    }

    await prisma.urlRedirect.create({
      data: {
        shopId: shop.id,
        issueId: input.issueId ?? null,
        fromPath,
        toTarget,
        shopifyRedirectId: created.id,
      },
    });

    if (input.issueId) {
      await IssueService.resolveIssue(input.issueId, shop.id);
    }

    return { ok: true, redirect: { id: created.id, fromPath, toTarget } };
  },

  async listHistory(shopDomain: string): Promise<RedirectHistoryEntry[]> {
    const shop = await getShop(shopDomain);
    if (!shop) return [];

    const rows = await prisma.urlRedirect.findMany({
      where: { shopId: shop.id },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    return rows.map((row) => ({
      id: row.id,
      fromPath: row.fromPath,
      toTarget: row.toTarget,
      createdAt: row.createdAt,
      issueId: row.issueId,
    }));
  },
};
