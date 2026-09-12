import { assertPublicHostname, SsrfBlockedError } from "./ssrf-guard.server";

export type LinkCheckResultType =
  | "OK"
  | "NOT_FOUND"
  | "GONE"
  | "SERVER_ERROR"
  | "REDIRECT"
  | "TIMEOUT"
  | "DNS_ERROR"
  | "OTHER_ERROR";

export interface RedirectHop {
  url: string;
  statusCode: number;
}

export interface LinkCheckResult {
  url: string;
  finalUrl: string | null;
  statusCode: number | null;
  responseTimeMs: number;
  redirectChain: RedirectHop[];
  resultType: LinkCheckResultType;
  errorMessage: string | null;
  checkedAt: Date;
}

export interface CheckLinkOptions {
  timeoutMs?: number;
  maxRedirects?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_REDIRECTS = 10;
const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);

function classifyStatusCode(statusCode: number): LinkCheckResultType {
  if (statusCode >= 200 && statusCode < 300) return "OK";
  if (statusCode === 404) return "NOT_FOUND";
  if (statusCode === 410) return "GONE";
  if (statusCode >= 500) return "SERVER_ERROR";
  return "OTHER_ERROR";
}

/** Node/undici sets `error.cause.code` for low-level socket failures. */
function classifyNetworkError(error: unknown): {
  resultType: LinkCheckResultType;
  message: string;
} {
  if (error instanceof DOMException && error.name === "AbortError") {
    return { resultType: "TIMEOUT", message: "Request timed out" };
  }

  if (error instanceof SsrfBlockedError) {
    return { resultType: "OTHER_ERROR", message: error.message };
  }

  const cause = error instanceof Error ? (error.cause as { code?: string } | undefined) : undefined;
  const code = cause?.code;

  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return { resultType: "DNS_ERROR", message: `DNS lookup failed (${code})` };
  }
  if (code === "ETIMEDOUT") {
    return { resultType: "TIMEOUT", message: "Connection timed out" };
  }

  const message = error instanceof Error ? error.message : "Unknown network error";
  return { resultType: "OTHER_ERROR", message };
}

/**
 * Fetches a URL and follows redirects manually (rather than letting fetch
 * auto-follow) so every hop's status and URL is captured — that's what
 * makes redirect-chain and redirect-loop detection possible at all. One
 * timeout covers the whole chain, not each hop individually, and a hard
 * cap on hops turns a redirect loop into a REDIRECT result instead of
 * hanging.
 */
export async function checkLink(
  url: string,
  options: CheckLinkOptions = {},
): Promise<LinkCheckResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = performance.now();

  const redirectChain: RedirectHop[] = [];
  let currentUrl = url;

  try {
    for (let hop = 0; hop <= maxRedirects; hop++) {
      await assertPublicHostname(new URL(currentUrl).hostname);

      const response = await fetch(currentUrl, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
      });

      if (REDIRECT_STATUS_CODES.has(response.status)) {
        const location = response.headers.get("location");
        if (!location) {
          await response.body?.cancel();
          return finish({
            url,
            finalUrl: currentUrl,
            statusCode: response.status,
            resultType: "OTHER_ERROR",
            errorMessage: `Redirect status ${response.status} had no Location header`,
            redirectChain,
            startedAt,
          });
        }

        redirectChain.push({ url: currentUrl, statusCode: response.status });
        await response.body?.cancel();

        if (hop === maxRedirects) {
          return finish({
            url,
            finalUrl: currentUrl,
            statusCode: response.status,
            resultType: "REDIRECT",
            errorMessage: `Exceeded ${maxRedirects} redirects (possible loop)`,
            redirectChain,
            startedAt,
          });
        }

        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }

      await response.body?.cancel();
      return finish({
        url,
        finalUrl: currentUrl,
        statusCode: response.status,
        resultType: classifyStatusCode(response.status),
        errorMessage: null,
        redirectChain,
        startedAt,
      });
    }

    // Unreachable given the loop bounds above, but keeps the function
    // total rather than relying on TypeScript's control-flow inference.
    return finish({
      url,
      finalUrl: currentUrl,
      statusCode: null,
      resultType: "REDIRECT",
      errorMessage: `Exceeded ${maxRedirects} redirects (possible loop)`,
      redirectChain,
      startedAt,
    });
  } catch (error) {
    const { resultType, message } = classifyNetworkError(error);
    return finish({
      url,
      finalUrl: null,
      statusCode: null,
      resultType,
      errorMessage: message,
      redirectChain,
      startedAt,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function finish(params: {
  url: string;
  finalUrl: string | null;
  statusCode: number | null;
  resultType: LinkCheckResultType;
  errorMessage: string | null;
  redirectChain: RedirectHop[];
  startedAt: number;
}): LinkCheckResult {
  return {
    url: params.url,
    finalUrl: params.finalUrl,
    statusCode: params.statusCode,
    responseTimeMs: Math.round(performance.now() - params.startedAt),
    redirectChain: params.redirectChain,
    resultType: params.resultType,
    errorMessage: params.errorMessage,
    checkedAt: new Date(),
  };
}
