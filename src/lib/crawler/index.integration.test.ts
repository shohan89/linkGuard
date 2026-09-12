import { describe, expect, it } from "vitest";
import { checkLink } from "@/lib/crawler";

/**
 * Real network calls, real DNS resolution, real SSRF guard — no mocked
 * fetch or dns module. httpbin.org is a well-known, stable public test
 * service purpose-built for exactly this (predictable status codes and
 * redirects), which is what makes it viable for a real-network test
 * without depending on some specific merchant's storefront being up.
 */
describe("checkLink (real network)", () => {
  it("classifies a real 200 response as OK", async () => {
    const result = await checkLink("https://httpbin.org/status/200");
    expect(result.resultType).toBe("OK");
    expect(result.statusCode).toBe(200);
  }, 15_000);

  it("classifies a real 404 response as NOT_FOUND", async () => {
    const result = await checkLink("https://httpbin.org/status/404");
    expect(result.resultType).toBe("NOT_FOUND");
    expect(result.statusCode).toBe(404);
  }, 15_000);

  it("classifies a real 500 response as SERVER_ERROR", async () => {
    const result = await checkLink("https://httpbin.org/status/500");
    expect(result.resultType).toBe("SERVER_ERROR");
    expect(result.statusCode).toBe(500);
  }, 15_000);

  it("follows a real redirect to its final destination", async () => {
    const result = await checkLink(
      "https://httpbin.org/redirect-to?url=https%3A%2F%2Fhttpbin.org%2Fstatus%2F200&status_code=302",
    );
    expect(result.resultType).toBe("OK");
    expect(result.redirectChain).toHaveLength(1);
    expect(result.redirectChain[0].statusCode).toBe(302);
    expect(result.finalUrl).toBe("https://httpbin.org/status/200");
  }, 15_000);

  it("classifies an unresolvable domain as DNS_ERROR", async () => {
    const result = await checkLink(
      "https://this-domain-genuinely-does-not-exist-linkguard-test.invalid",
    );
    expect(result.resultType).toBe("DNS_ERROR");
  }, 15_000);

  it("SSRF guard blocks a real loopback target instead of connecting to it", async () => {
    const result = await checkLink("http://localhost:1/");
    expect(result.resultType).toBe("OTHER_ERROR");
    expect(result.errorMessage).toMatch(/private\/internal address/);
  });

  it("SSRF guard blocks a redirect that points at a private address", async () => {
    const result = await checkLink(
      "https://httpbin.org/redirect-to?url=http%3A%2F%2F127.0.0.1%3A1%2F&status_code=302",
    );
    expect(result.resultType).toBe("OTHER_ERROR");
    expect(result.errorMessage).toMatch(/private\/internal address/);
  }, 15_000);
});
