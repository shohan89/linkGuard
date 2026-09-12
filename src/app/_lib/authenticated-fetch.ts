declare global {
  interface Window {
    shopify?: {
      idToken: () => Promise<string>;
    };
  }
}

/**
 * Attaches the App Bridge session token as a bearer token, matching what
 * getOfflineSessionFromRequest (lib/shopify/session.server) expects on the
 * server side. Every client-initiated write to our own API routes should
 * go through this rather than a bare fetch.
 */
export async function authenticatedFetch(
  input: string,
  init: RequestInit = {},
): Promise<Response> {
  const token = await window.shopify?.idToken();
  const headers = new Headers(init.headers);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return fetch(input, { ...init, headers });
}

export {};
