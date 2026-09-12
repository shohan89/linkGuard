import "@shopify/shopify-api/adapters/web-api";
import { ApiVersion, LogSeverity, shopifyApi } from "@shopify/shopify-api";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import { prisma } from "@/lib/database/client.server";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

const appUrl = new URL(required("SHOPIFY_APP_URL"));

export const shopify = shopifyApi({
  apiKey: required("SHOPIFY_API_KEY"),
  apiSecretKey: required("SHOPIFY_API_SECRET"),
  scopes: required("SHOPIFY_SCOPES").split(",").map((s) => s.trim()),
  hostName: appUrl.host,
  hostScheme: appUrl.protocol.replace(":", "") as "http" | "https",
  apiVersion: ApiVersion.October26,
  isEmbeddedApp: true,
  logger: {
    level: process.env.NODE_ENV === "development" ? LogSeverity.Info : LogSeverity.Warning,
  },
});

export const sessionStorage = new PrismaSessionStorage(prisma, {
  tableName: "shopSession",
});
