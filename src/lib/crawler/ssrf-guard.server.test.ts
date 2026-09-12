import { beforeEach, describe, expect, it, vi } from "vitest";

const lookupMock = vi.fn();
vi.mock("node:dns", () => ({
  default: { promises: { lookup: lookupMock } },
}));

const { assertPublicHostname, SsrfBlockedError } = await import("./ssrf-guard.server");

describe("assertPublicHostname", () => {
  beforeEach(() => {
    lookupMock.mockReset();
  });

  it.each([
    ["0.0.0.0"],
    ["10.1.2.3"],
    ["100.64.0.1"],
    ["127.0.0.1"],
    ["169.254.169.254"], // cloud metadata
    ["172.16.5.5"],
    ["192.0.0.5"],
    ["192.168.1.1"],
    ["198.18.0.1"],
    ["224.0.0.1"],
  ])("blocks private/reserved IPv4 %s", async (address) => {
    lookupMock.mockResolvedValue([{ address, family: 4 }]);
    await expect(assertPublicHostname("evil.example")).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it.each([["::1"], ["fe80::1"], ["fc00::1"], ["fd12::1"], ["::ffff:127.0.0.1"]])(
    "blocks private/reserved IPv6 %s",
    async (address) => {
      lookupMock.mockResolvedValue([{ address, family: 6 }]);
      await expect(assertPublicHostname("evil.example")).rejects.toBeInstanceOf(SsrfBlockedError);
    },
  );

  it("allows a public IPv4 address", async () => {
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    await expect(assertPublicHostname("example.com")).resolves.toBeUndefined();
  });

  it("allows a public IPv6 address", async () => {
    lookupMock.mockResolvedValue([{ address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 }]);
    await expect(assertPublicHostname("example.com")).resolves.toBeUndefined();
  });

  it("blocks if ANY resolved address is private, even when others are public", async () => {
    lookupMock.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]);
    await expect(assertPublicHostname("mixed.example")).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it("does not throw when DNS resolution fails", async () => {
    lookupMock.mockRejectedValue(new Error("ENOTFOUND"));
    await expect(assertPublicHostname("does-not-resolve.example")).resolves.toBeUndefined();
  });
});
