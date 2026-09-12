import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const validateMock = vi.fn();
const getOfflineIdMock = vi.fn().mockReturnValue("offline_shop.myshopify.com");
const deleteSessionMock = vi.fn();
const markShopUninstalledMock = vi.fn();
const deleteShopDataMock = vi.fn();
const getShopMock = vi.fn();
const webhookEventFindUniqueMock = vi.fn();
const webhookEventUpsertMock = vi.fn();
const webhookEventUpdateManyMock = vi.fn();

vi.mock("@/lib/shopify/client.server", () => ({
  shopify: {
    webhooks: { validate: validateMock },
    session: { getOfflineId: getOfflineIdMock },
  },
  sessionStorage: { deleteSession: deleteSessionMock },
}));
vi.mock("@/lib/database/shops.server", () => ({
  markShopUninstalled: markShopUninstalledMock,
  deleteShopData: deleteShopDataMock,
  getShop: getShopMock,
}));
vi.mock("@/lib/database/client.server", () => ({
  prisma: {
    webhookEvent: {
      findUnique: webhookEventFindUniqueMock,
      upsert: webhookEventUpsertMock,
      updateMany: webhookEventUpdateManyMock,
    },
  },
}));

const { POST } = await import("./route");

function makeRequest(body: string) {
  return new NextRequest("https://app.example/api/webhooks", {
    method: "POST",
    body,
  });
}

describe("POST /api/webhooks", () => {
  beforeEach(() => {
    validateMock.mockReset();
    deleteSessionMock.mockReset().mockResolvedValue(undefined);
    markShopUninstalledMock.mockReset().mockResolvedValue(undefined);
    deleteShopDataMock.mockReset().mockResolvedValue(undefined);
    getShopMock.mockReset().mockResolvedValue({ id: "shop-1" });
    webhookEventFindUniqueMock.mockReset().mockResolvedValue(null);
    webhookEventUpsertMock.mockReset().mockResolvedValue({ id: "event-1" });
    webhookEventUpdateManyMock.mockReset().mockResolvedValue({ count: 1 });
  });

  it("rejects an invalid HMAC", async () => {
    validateMock.mockResolvedValue({ valid: false, reason: "invalid_hmac" });

    const response = await POST(makeRequest("{}"));

    expect(response.status).toBe(401);
    expect(getShopMock).not.toHaveBeenCalled();
  });

  it("records the webhook event and marks it processed on success", async () => {
    validateMock.mockResolvedValue({
      valid: true,
      topic: "APP_UNINSTALLED",
      domain: "shop.myshopify.com",
      webhookId: "wh-1",
    });

    const response = await POST(makeRequest('{"id":1}'));

    expect(response.status).toBe(200);
    expect(webhookEventUpsertMock).toHaveBeenCalledWith({
      where: { shopifyWebhookId: "wh-1" },
      create: { shopId: "shop-1", shopifyWebhookId: "wh-1", topic: "APP_UNINSTALLED", payload: { id: 1 } },
      update: { topic: "APP_UNINSTALLED", payload: { id: 1 } },
    });
    expect(markShopUninstalledMock).toHaveBeenCalledWith("shop.myshopify.com");
    expect(webhookEventUpdateManyMock).toHaveBeenCalledWith({
      where: { id: "event-1" },
      data: { processedAt: expect.any(Date) },
    });
  });

  it("skips reprocessing a webhookId already marked processed (redelivery)", async () => {
    validateMock.mockResolvedValue({
      valid: true,
      topic: "APP_UNINSTALLED",
      domain: "shop.myshopify.com",
      webhookId: "wh-1",
    });
    webhookEventFindUniqueMock.mockResolvedValue({ id: "event-1", processedAt: new Date() });

    const response = await POST(makeRequest("{}"));

    expect(response.status).toBe(200);
    expect(markShopUninstalledMock).not.toHaveBeenCalled();
    expect(webhookEventUpsertMock).not.toHaveBeenCalled();
  });

  it("reprocesses a webhookId that was recorded but never finished (e.g. a prior crash)", async () => {
    validateMock.mockResolvedValue({
      valid: true,
      topic: "APP_UNINSTALLED",
      domain: "shop.myshopify.com",
      webhookId: "wh-1",
    });
    webhookEventFindUniqueMock.mockResolvedValue({ id: "event-1", processedAt: null });

    const response = await POST(makeRequest("{}"));

    expect(response.status).toBe(200);
    expect(markShopUninstalledMock).toHaveBeenCalled();
  });

  it("does not fail when SHOP_REDACT cascades away its own audit row", async () => {
    validateMock.mockResolvedValue({
      valid: true,
      topic: "SHOP_REDACT",
      domain: "shop.myshopify.com",
      webhookId: "wh-2",
    });
    // Simulates the row already being gone by the time we try to mark it processed.
    webhookEventUpdateManyMock.mockResolvedValue({ count: 0 });

    const response = await POST(makeRequest("{}"));

    expect(response.status).toBe(200);
    expect(deleteShopDataMock).toHaveBeenCalledWith("shop.myshopify.com");
  });

  it("records the error and still propagates it when processing throws", async () => {
    validateMock.mockResolvedValue({
      valid: true,
      topic: "APP_UNINSTALLED",
      domain: "shop.myshopify.com",
      webhookId: "wh-1",
    });
    markShopUninstalledMock.mockRejectedValue(new Error("db unavailable"));

    await expect(POST(makeRequest("{}"))).rejects.toThrow("db unavailable");

    expect(webhookEventUpdateManyMock).toHaveBeenCalledWith({
      where: { id: "event-1" },
      data: { error: "db unavailable" },
    });
  });

  it("processes normally without an audit row when there's no local Shop (e.g. already redacted)", async () => {
    validateMock.mockResolvedValue({
      valid: true,
      topic: "SHOP_REDACT",
      domain: "shop.myshopify.com",
      webhookId: "wh-3",
    });
    getShopMock.mockResolvedValue(null);

    const response = await POST(makeRequest("{}"));

    expect(response.status).toBe(200);
    expect(webhookEventUpsertMock).not.toHaveBeenCalled();
    expect(deleteShopDataMock).toHaveBeenCalled();
  });
});
