"use client";

import { useEffect } from "react";

/**
 * Shopify's OAuth consent screen refuses to render inside an iframe
 * (X-Frame-Options). When this app is loaded embedded but has no valid
 * session, we must navigate the *top-level* browser window to /api/auth,
 * not just this iframe. A server-side redirect can't do that — it only
 * ever redirects the iframe itself — so this runs client-side instead.
 */
export function ExitIframe({ authUrl }: { authUrl: string }) {
  useEffect(() => {
    if (window.top === window.self) {
      window.location.href = authUrl;
    } else {
      window.top!.location.href = authUrl;
    }
  }, [authUrl]);

  return null;
}
