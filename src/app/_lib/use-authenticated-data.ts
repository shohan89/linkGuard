"use client";

import { useEffect, useState } from "react";
import { authenticatedFetch } from "./authenticated-fetch";

export type DataState<T> =
  | { status: "loading" }
  | { status: "unauthenticated" }
  | { status: "error"; message: string }
  | { status: "ok"; data: T };

/**
 * The one place every embedded page's client view fetches its tenant data
 * from. Runs client-side, after App Bridge has mounted, so every request
 * carries a bearer session token the server can actually verify — unlike
 * the page's own SSR render, which only ever sees the unauthenticated
 * `shop` query param and must not be trusted with real data. See
 * app/_lib/guard-embedded-shop.tsx for the SSR-side half of this.
 */
export function useAuthenticatedData<T>(path: string): DataState<T> {
  const [state, setState] = useState<DataState<T>>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    authenticatedFetch(path)
      .then(async (response) => {
        if (cancelled) return;
        if (response.status === 401) {
          setState({ status: "unauthenticated" });
          return;
        }
        if (!response.ok) {
          setState({ status: "error", message: `Request failed (${response.status})` });
          return;
        }
        const data = (await response.json()) as T;
        setState({ status: "ok", data });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error", message: "Network error" });
      });

    return () => {
      cancelled = true;
    };
  }, [path]);

  return state;
}
