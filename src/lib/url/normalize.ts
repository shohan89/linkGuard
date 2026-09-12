/**
 * Resolves a possibly-relative URL against a base and normalizes it to a
 * stable, comparable form: lowercase scheme+host, no fragment, no default
 * port, no trailing slash (except root), query params sorted so two URLs
 * differing only in param order dedupe as the same page. Returns null for
 * anything that isn't a fetchable http(s) URL (mailto:, tel:, javascript:,
 * unparseable strings).
 */
export function normalizeUrl(rawUrl: string, baseUrl: string): string | null {
  let resolved: URL;

  try {
    resolved = new URL(rawUrl, baseUrl);
  } catch {
    return null;
  }

  if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
    return null;
  }

  resolved.hash = "";
  resolved.hostname = resolved.hostname.toLowerCase();

  const isDefaultPort =
    (resolved.protocol === "http:" && resolved.port === "80") ||
    (resolved.protocol === "https:" && resolved.port === "443");
  if (isDefaultPort) {
    resolved.port = "";
  }

  if (resolved.pathname.length > 1 && resolved.pathname.endsWith("/")) {
    resolved.pathname = resolved.pathname.replace(/\/+$/, "");
  }

  resolved.searchParams.sort();

  return resolved.toString();
}

/** True when `url`'s host matches the shop's storefront host exactly. */
export function isInternalUrl(url: string, shopHostname: string): boolean {
  try {
    return new URL(url).hostname.toLowerCase() === shopHostname.toLowerCase();
  } catch {
    return false;
  }
}
