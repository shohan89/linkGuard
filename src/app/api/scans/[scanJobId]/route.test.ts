import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getOfflineSessionFromRequestMock = vi.fn();
const getScanStatusMock = vi.fn();

class FakeUnauthenticatedError extends Error {}

vi.mock("@/lib/shopify/session.server", () => ({
  getOfflineSessionFromRequest: getOfflineSessionFromRequestMock,
  UnauthenticatedError: FakeUnauthenticatedError,
}));
vi.mock("@/lib/scanner", () => ({
  getScanStatus: getScanStatusMock,
}));

const { GET } = await import("./route");

function makeContext(scanJobId: string) {
  return { params: Promise.resolve({ scanJobId }) };
}

describe("GET /api/scans/[scanJobId]", () => {
  beforeEach(() => {
    getOfflineSessionFromRequestMock.mockReset().mockResolvedValue({ shop: "shop.myshopify.com" });
    getScanStatusMock.mockReset();
  });

  it("returns 401 when unauthenticated", async () => {
    getOfflineSessionFromRequestMock.mockRejectedValue(new FakeUnauthenticatedError("no token"));
    const response = await GET(new NextRequest("https://app.example/api/scans/job-1"), makeContext("job-1"));
    expect(response.status).toBe(401);
    expect(getScanStatusMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the job doesn't exist for this shop", async () => {
    getScanStatusMock.mockResolvedValue(null);
    const response = await GET(new NextRequest("https://app.example/api/scans/job-1"), makeContext("job-1"));
    expect(response.status).toBe(404);
  });

  it("returns the job's live status, scoped to the authenticated shop", async () => {
    getScanStatusMock.mockResolvedValue({
      status: "RUNNING",
      urlsQueued: 10,
      urlsChecked: 3,
      issuesFound: 0,
    });

    const response = await GET(new NextRequest("https://app.example/api/scans/job-1"), makeContext("job-1"));

    expect(await response.json()).toEqual({
      status: "RUNNING",
      urlsQueued: 10,
      urlsChecked: 3,
      issuesFound: 0,
    });
    expect(getScanStatusMock).toHaveBeenCalledWith("shop.myshopify.com", "job-1");
  });
});
