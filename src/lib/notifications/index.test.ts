import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IssueDTO } from "@/lib/issues/issue.server";
import type { ScanSummary } from "@/lib/scanner";

const getShopMock = vi.fn();
const notificationCreateMock = vi.fn();
const sendMock = vi.fn();

vi.mock("@/lib/database/shops.server", () => ({ getShop: getShopMock }));
vi.mock("@/lib/database/client.server", () => ({
  prisma: { notification: { create: notificationCreateMock } },
}));
vi.mock("@/lib/notifications/email.server", async () => {
  const actual = await vi.importActual<typeof import("./email.server")>("./email.server");
  return {
    EmailNotConfiguredError: actual.EmailNotConfiguredError,
    EmailService: { send: sendMock },
  };
});

const { NotificationService } = await import("./index");

const SHOP_ID = "shop-1";
const SHOP_DOMAIN = "shop.myshopify.com";

function fakeIssue(overrides: Partial<IssueDTO> = {}): IssueDTO {
  return {
    id: "issue-1",
    url: "https://shop.example/missing",
    isExternal: false,
    type: "BROKEN_404",
    severity: "CRITICAL",
    status: "OPEN",
    statusCode: 404,
    firstSeenAt: new Date("2026-01-01T00:00:00Z"),
    lastSeenAt: new Date("2026-01-01T00:00:00Z"),
    resolvedAt: null,
    ...overrides,
  };
}

describe("NotificationService.notifyIssueDetected", () => {
  beforeEach(() => {
    getShopMock.mockReset().mockResolvedValue({ id: SHOP_ID, contactEmail: "merchant@example.com" });
    notificationCreateMock.mockReset().mockResolvedValue(undefined);
    sendMock.mockReset().mockResolvedValue(undefined);
  });

  it("sends and records for a BROKEN_404 issue", async () => {
    await NotificationService.notifyIssueDetected(SHOP_DOMAIN, fakeIssue({ type: "BROKEN_404" }));

    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: "merchant@example.com" }),
    );
    expect(notificationCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ shopId: SHOP_ID, type: "NEW_ISSUES", status: "SENT" }),
      }),
    );
  });

  it("sends for a non-404 CRITICAL issue too", async () => {
    await NotificationService.notifyIssueDetected(
      SHOP_DOMAIN,
      fakeIssue({ type: "SERVER_ERROR_5XX", severity: "CRITICAL" }),
    );
    expect(sendMock).toHaveBeenCalled();
  });

  it("does not send for a non-404, non-critical issue", async () => {
    await NotificationService.notifyIssueDetected(
      SHOP_DOMAIN,
      fakeIssue({ type: "TIMEOUT", severity: "WARNING" }),
    );
    expect(sendMock).not.toHaveBeenCalled();
    expect(notificationCreateMock).not.toHaveBeenCalled();
  });

  it("records a FAILED notification (not a thrown error) when the shop has no contact email", async () => {
    getShopMock.mockResolvedValue({ id: SHOP_ID, contactEmail: null });

    await NotificationService.notifyIssueDetected(SHOP_DOMAIN, fakeIssue());

    expect(sendMock).not.toHaveBeenCalled();
    expect(notificationCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "FAILED", error: expect.stringContaining("contact email") }),
      }),
    );
  });

  it("records a FAILED notification when sending itself throws, without throwing to the caller", async () => {
    sendMock.mockRejectedValue(new Error("Resend rejected the email: bad request"));

    await expect(
      NotificationService.notifyIssueDetected(SHOP_DOMAIN, fakeIssue()),
    ).resolves.toBeUndefined();

    expect(notificationCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "FAILED", error: expect.stringContaining("bad request") }),
      }),
    );
  });

  it("does nothing when the shop doesn't exist", async () => {
    getShopMock.mockResolvedValue(null);
    await NotificationService.notifyIssueDetected(SHOP_DOMAIN, fakeIssue());
    expect(sendMock).not.toHaveBeenCalled();
    expect(notificationCreateMock).not.toHaveBeenCalled();
  });
});

describe("NotificationService.notifyScanCompleted", () => {
  beforeEach(() => {
    getShopMock.mockReset().mockResolvedValue({ id: SHOP_ID, contactEmail: "merchant@example.com" });
    notificationCreateMock.mockReset().mockResolvedValue(undefined);
    sendMock.mockReset().mockResolvedValue(undefined);
  });

  it("sends a SCAN_COMPLETE notification", async () => {
    const summary: ScanSummary = {
      shopDomain: SHOP_DOMAIN,
      linksChecked: 10,
      issuesFound: 2,
      startedAt: new Date(),
      finishedAt: new Date(),
    };

    await NotificationService.notifyScanCompleted(SHOP_DOMAIN, summary);

    expect(notificationCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: "SCAN_COMPLETE" }) }),
    );
  });
});

describe("NotificationService.notifyWeeklyReport", () => {
  beforeEach(() => {
    getShopMock.mockReset().mockResolvedValue({ id: SHOP_ID, contactEmail: "merchant@example.com" });
    notificationCreateMock.mockReset().mockResolvedValue(undefined);
    sendMock.mockReset().mockResolvedValue(undefined);
  });

  it("sends a WEEKLY_REPORT notification", async () => {
    await NotificationService.notifyWeeklyReport({
      shopDomain: SHOP_DOMAIN,
      periodStart: new Date("2026-01-01"),
      periodEnd: new Date("2026-01-08"),
      scansRun: 7,
      newIssues: 3,
      resolvedIssues: 2,
      openIssues: 1,
      healthScore: 92,
    });

    expect(notificationCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: "WEEKLY_REPORT" }) }),
    );
  });
});
