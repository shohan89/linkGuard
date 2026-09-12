import { NextRequest, NextResponse } from "next/server";

const SHOP_DOMAIN_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;

/**
 * Shopify admin loads this app inside an iframe. Browsers block framing by
 * default unless the response explicitly allows it via CSP frame-ancestors.
 * Scope it to the requesting shop (when known) and the admin host, never "*".
 */
export function middleware(request: NextRequest) {
  const response = NextResponse.next();

  const shopParam = request.nextUrl.searchParams.get("shop");
  const shop = shopParam && SHOP_DOMAIN_RE.test(shopParam) ? shopParam : null;

  const ancestors = shop
    ? `https://${shop} https://admin.shopify.com`
    : "https://admin.shopify.com";

  response.headers.set(
    "Content-Security-Policy",
    `frame-ancestors ${ancestors};`,
  );

  return response;
}

export const config = {
  matcher: [
    "/",
    "/dashboard",
    "/issues",
    "/urls",
    "/scans",
    "/redirects",
    "/billing",
    "/settings",
    "/api/auth/callback",
  ],
};
