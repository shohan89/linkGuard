import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const lookupMock = vi.fn();
vi.mock("node:dns", () => ({
  default: { promises: { lookup: lookupMock } },
}));

const { checkLink } = await import("./index");

function jsonHeaders(headers: Record<string, string> = {}) {
  return new Headers(headers);
}

describe("checkLink", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    // Default: every hostname resolves to a public address, so existing
    // behavioral tests don't need to know about the SSRF guard.
    lookupMock.mockReset().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("classifies 200 as OK with no redirect chain", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 200 }));

    const result = await checkLink("https://shop.example/page");

    expect(result.resultType).toBe("OK");
    expect(result.statusCode).toBe(200);
    expect(result.finalUrl).toBe("https://shop.example/page");
    expect(result.redirectChain).toEqual([]);
    expect(result.errorMessage).toBeNull();
    expect(result.responseTimeMs).toBeGreaterThanOrEqual(0);
  });

  it("follows a 301 to its final 200 and records the hop", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response("", {
          status: 301,
          headers: jsonHeaders({ location: "https://shop.example/new-page" }),
        }),
      )
      .mockResolvedValueOnce(new Response("", { status: 200 }));

    const result = await checkLink("https://shop.example/old-page");

    expect(result.resultType).toBe("OK");
    expect(result.statusCode).toBe(200);
    expect(result.finalUrl).toBe("https://shop.example/new-page");
    expect(result.redirectChain).toEqual([
      { url: "https://shop.example/old-page", statusCode: 301 },
    ]);
  });

  it("follows a 302 the same way as a 301", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response("", {
          status: 302,
          headers: jsonHeaders({ location: "/target" }),
        }),
      )
      .mockResolvedValueOnce(new Response("", { status: 200 }));

    const result = await checkLink("https://shop.example/source");

    expect(result.resultType).toBe("OK");
    expect(result.redirectChain[0].statusCode).toBe(302);
    expect(result.finalUrl).toBe("https://shop.example/target");
  });

  it("resolves a relative Location header against the current URL", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response("", {
          status: 301,
          headers: jsonHeaders({ location: "/pages/about" }),
        }),
      )
      .mockResolvedValueOnce(new Response("", { status: 200 }));

    const result = await checkLink("https://shop.example/old");

    expect(result.finalUrl).toBe("https://shop.example/pages/about");
  });

  it("classifies 404 as NOT_FOUND", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 404 }));
    const result = await checkLink("https://shop.example/missing");
    expect(result.resultType).toBe("NOT_FOUND");
    expect(result.statusCode).toBe(404);
  });

  it("classifies 410 as GONE", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 410 }));
    const result = await checkLink("https://shop.example/removed");
    expect(result.resultType).toBe("GONE");
  });

  it("classifies 500 as SERVER_ERROR", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    const result = await checkLink("https://shop.example/broken");
    expect(result.resultType).toBe("SERVER_ERROR");
    expect(result.statusCode).toBe(500);
  });

  it("classifies 503 as SERVER_ERROR", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 503 }));
    const result = await checkLink("https://shop.example/unavailable");
    expect(result.resultType).toBe("SERVER_ERROR");
    expect(result.statusCode).toBe(503);
  });

  it("reports OTHER_ERROR when a redirect has no Location header", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 301 }));

    const result = await checkLink("https://shop.example/broken-redirect");

    expect(result.resultType).toBe("OTHER_ERROR");
    expect(result.errorMessage).toMatch(/Location/);
  });

  it("stops at maxRedirects and reports REDIRECT instead of looping forever", async () => {
    fetchMock.mockImplementation(async () =>
      new Response("", {
        status: 302,
        headers: jsonHeaders({ location: "https://shop.example/loop" }),
      }),
    );

    const result = await checkLink("https://shop.example/loop", { maxRedirects: 3 });

    expect(result.resultType).toBe("REDIRECT");
    expect(result.errorMessage).toMatch(/redirects/i);
    // maxRedirects + 1 requests: it follows 3 hops, the 4th response is
    // still a redirect and that's when it gives up.
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("classifies an AbortError as TIMEOUT", async () => {
    fetchMock.mockRejectedValue(
      new DOMException("The operation was aborted.", "AbortError"),
    );

    const result = await checkLink("https://shop.example/slow");

    expect(result.resultType).toBe("TIMEOUT");
    expect(result.statusCode).toBeNull();
  });

  it("classifies ENOTFOUND as DNS_ERROR", async () => {
    fetchMock.mockRejectedValue(
      Object.assign(new Error("fetch failed"), { cause: { code: "ENOTFOUND" } }),
    );

    const result = await checkLink("https://does-not-resolve.example");

    expect(result.resultType).toBe("DNS_ERROR");
    expect(result.errorMessage).toMatch(/ENOTFOUND/);
  });

  it("classifies an unrecognized network error as OTHER_ERROR", async () => {
    fetchMock.mockRejectedValue(new Error("something weird happened"));

    const result = await checkLink("https://shop.example/weird");

    expect(result.resultType).toBe("OTHER_ERROR");
    expect(result.errorMessage).toBe("something weird happened");
  });

  it("blocks the initial URL when it resolves to a private address (SSRF)", async () => {
    lookupMock.mockResolvedValue([{ address: "169.254.169.254", family: 4 }]);

    const result = await checkLink("https://internal.example/metadata");

    expect(result.resultType).toBe("OTHER_ERROR");
    expect(result.errorMessage).toMatch(/private\/internal address/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks a redirect hop that points at a private address", async () => {
    lookupMock
      .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }]) // first hop: public
      .mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]); // redirect target: private
    fetchMock.mockResolvedValueOnce(
      new Response("", {
        status: 302,
        headers: jsonHeaders({ location: "http://127.0.0.1:6379/" }),
      }),
    );

    const result = await checkLink("https://shop.example/redirect-to-internal");

    expect(result.resultType).toBe("OTHER_ERROR");
    expect(result.errorMessage).toMatch(/private\/internal address/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("allows an unresolvable hostname through to fetch's own DNS_ERROR classification", async () => {
    lookupMock.mockRejectedValue(new Error("getaddrinfo ENOTFOUND"));
    fetchMock.mockRejectedValue(
      Object.assign(new Error("fetch failed"), { cause: { code: "ENOTFOUND" } }),
    );

    const result = await checkLink("https://does-not-resolve.example");

    expect(result.resultType).toBe("DNS_ERROR");
  });

  it("cancels the response body on a terminal (non-redirect) response", async () => {
    const cancel = vi.fn();
    const response = new Response("", { status: 200 });
    Object.defineProperty(response, "body", { value: { cancel } });
    fetchMock.mockResolvedValue(response);

    await checkLink("https://shop.example/page");

    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
