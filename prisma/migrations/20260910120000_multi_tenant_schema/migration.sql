-- CreateEnum
CREATE TYPE "UrlSource" AS ENUM ('PRODUCT', 'COLLECTION', 'PAGE', 'BLOG_ARTICLE', 'NAV_MENU', 'THEME', 'OTHER');

-- CreateEnum
CREATE TYPE "ScanJobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ScanTrigger" AS ENUM ('MANUAL', 'SCHEDULED', 'INSTALL');

-- CreateEnum
CREATE TYPE "ScanResultType" AS ENUM ('OK', 'NOT_FOUND', 'SERVER_ERROR', 'REDIRECT', 'TIMEOUT', 'DNS_ERROR', 'OTHER_ERROR');

-- CreateEnum
CREATE TYPE "IssueType" AS ENUM ('BROKEN_404', 'SERVER_ERROR_5XX', 'REDIRECT_PROBLEM', 'TIMEOUT', 'OTHER');

-- CreateEnum
CREATE TYPE "IssueSeverity" AS ENUM ('CRITICAL', 'WARNING', 'INFO');

-- CreateEnum
CREATE TYPE "IssueStatus" AS ENUM ('OPEN', 'RESOLVED', 'IGNORED');

-- CreateEnum
CREATE TYPE "SubscriptionPlan" AS ENUM ('FREE', 'PRO');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'CANCELLED', 'EXPIRED', 'PENDING', 'FROZEN');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('NEW_ISSUES', 'SCAN_COMPLETE', 'SCAN_FAILED', 'BILLING');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL', 'WEBHOOK', 'IN_APP');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "UsageEventType" AS ENUM ('SCAN_RUN', 'PAGE_CHECKED', 'ISSUE_DETECTED');

-- CreateEnum
CREATE TYPE "AuditActor" AS ENUM ('MERCHANT', 'SYSTEM', 'SHOPIFY');

-- DropTable
DROP TABLE "Session";

-- DropTable
DROP TABLE "Shop";

-- CreateTable
CREATE TABLE "shops" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shop_sessions" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN,
    "locale" TEXT,
    "collaborator" BOOLEAN,
    "emailVerified" BOOLEAN,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "shop_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "urls" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "source" "UrlSource" NOT NULL,
    "resourceId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "urls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "url_links" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "sourceUrlId" TEXT NOT NULL,
    "targetUrl" TEXT NOT NULL,
    "isExternal" BOOLEAN NOT NULL,
    "linkText" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "url_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scan_jobs" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "status" "ScanJobStatus" NOT NULL DEFAULT 'PENDING',
    "trigger" "ScanTrigger" NOT NULL,
    "urlsQueued" INTEGER NOT NULL DEFAULT 0,
    "urlsChecked" INTEGER NOT NULL DEFAULT 0,
    "issuesFound" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scan_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scan_results" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "scanJobId" TEXT NOT NULL,
    "urlLinkId" TEXT NOT NULL,
    "statusCode" INTEGER,
    "responseTimeMs" INTEGER,
    "redirectChain" JSONB,
    "resultType" "ScanResultType" NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scan_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "issues" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "urlLinkId" TEXT NOT NULL,
    "scanResultId" TEXT,
    "type" "IssueType" NOT NULL,
    "severity" "IssueSeverity" NOT NULL,
    "status" "IssueStatus" NOT NULL DEFAULT 'OPEN',
    "statusCode" INTEGER,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "redirects" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "urlLinkId" TEXT NOT NULL,
    "fromUrl" TEXT NOT NULL,
    "toUrl" TEXT NOT NULL,
    "hopCount" INTEGER NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "isLoop" BOOLEAN NOT NULL DEFAULT false,
    "isBroken" BOOLEAN NOT NULL DEFAULT false,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "redirects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "shopifySubscriptionId" TEXT,
    "plan" "SubscriptionPlan" NOT NULL DEFAULT 'FREE',
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "currentPeriodEnd" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "payload" JSONB,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "sentAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_events" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "type" "UsageEventType" NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "metadata" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "shopifyWebhookId" TEXT,
    "topic" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "actor" "AuditActor" NOT NULL,
    "action" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shops_shopDomain_key" ON "shops"("shopDomain");

-- CreateIndex
CREATE INDEX "shop_sessions_shop_idx" ON "shop_sessions"("shop");

-- CreateIndex
CREATE INDEX "urls_shopId_idx" ON "urls"("shopId");

-- CreateIndex
CREATE INDEX "urls_shopId_source_idx" ON "urls"("shopId", "source");

-- CreateIndex
CREATE INDEX "urls_shopId_isActive_idx" ON "urls"("shopId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "urls_shopId_url_key" ON "urls"("shopId", "url");

-- CreateIndex
CREATE INDEX "url_links_shopId_idx" ON "url_links"("shopId");

-- CreateIndex
CREATE INDEX "url_links_shopId_isExternal_idx" ON "url_links"("shopId", "isExternal");

-- CreateIndex
CREATE UNIQUE INDEX "url_links_sourceUrlId_targetUrl_key" ON "url_links"("sourceUrlId", "targetUrl");

-- CreateIndex
CREATE INDEX "scan_jobs_shopId_status_idx" ON "scan_jobs"("shopId", "status");

-- CreateIndex
CREATE INDEX "scan_jobs_shopId_createdAt_idx" ON "scan_jobs"("shopId", "createdAt");

-- CreateIndex
CREATE INDEX "scan_results_shopId_idx" ON "scan_results"("shopId");

-- CreateIndex
CREATE INDEX "scan_results_scanJobId_idx" ON "scan_results"("scanJobId");

-- CreateIndex
CREATE INDEX "scan_results_shopId_resultType_idx" ON "scan_results"("shopId", "resultType");

-- CreateIndex
CREATE INDEX "scan_results_urlLinkId_checkedAt_idx" ON "scan_results"("urlLinkId", "checkedAt");

-- CreateIndex
CREATE INDEX "issues_shopId_status_idx" ON "issues"("shopId", "status");

-- CreateIndex
CREATE INDEX "issues_shopId_severity_idx" ON "issues"("shopId", "severity");

-- CreateIndex
CREATE INDEX "issues_shopId_type_idx" ON "issues"("shopId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "issues_shopId_urlLinkId_type_key" ON "issues"("shopId", "urlLinkId", "type");

-- CreateIndex
CREATE INDEX "redirects_shopId_idx" ON "redirects"("shopId");

-- CreateIndex
CREATE INDEX "redirects_shopId_isLoop_idx" ON "redirects"("shopId", "isLoop");

-- CreateIndex
CREATE INDEX "redirects_shopId_isBroken_idx" ON "redirects"("shopId", "isBroken");

-- CreateIndex
CREATE INDEX "redirects_urlLinkId_idx" ON "redirects"("urlLinkId");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_shopId_key" ON "subscriptions"("shopId");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_shopifySubscriptionId_key" ON "subscriptions"("shopifySubscriptionId");

-- CreateIndex
CREATE INDEX "subscriptions_status_idx" ON "subscriptions"("status");

-- CreateIndex
CREATE INDEX "notifications_shopId_createdAt_idx" ON "notifications"("shopId", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_shopId_status_idx" ON "notifications"("shopId", "status");

-- CreateIndex
CREATE INDEX "usage_events_shopId_type_idx" ON "usage_events"("shopId", "type");

-- CreateIndex
CREATE INDEX "usage_events_shopId_occurredAt_idx" ON "usage_events"("shopId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_shopifyWebhookId_key" ON "webhook_events"("shopifyWebhookId");

-- CreateIndex
CREATE INDEX "webhook_events_shopId_topic_idx" ON "webhook_events"("shopId", "topic");

-- CreateIndex
CREATE INDEX "webhook_events_shopId_createdAt_idx" ON "webhook_events"("shopId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_shopId_createdAt_idx" ON "audit_logs"("shopId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_shopId_action_idx" ON "audit_logs"("shopId", "action");

-- AddForeignKey
ALTER TABLE "shop_sessions" ADD CONSTRAINT "shop_sessions_shop_fkey" FOREIGN KEY ("shop") REFERENCES "shops"("shopDomain") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "urls" ADD CONSTRAINT "urls_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "url_links" ADD CONSTRAINT "url_links_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "url_links" ADD CONSTRAINT "url_links_sourceUrlId_fkey" FOREIGN KEY ("sourceUrlId") REFERENCES "urls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scan_jobs" ADD CONSTRAINT "scan_jobs_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scan_results" ADD CONSTRAINT "scan_results_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scan_results" ADD CONSTRAINT "scan_results_scanJobId_fkey" FOREIGN KEY ("scanJobId") REFERENCES "scan_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scan_results" ADD CONSTRAINT "scan_results_urlLinkId_fkey" FOREIGN KEY ("urlLinkId") REFERENCES "url_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_urlLinkId_fkey" FOREIGN KEY ("urlLinkId") REFERENCES "url_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_scanResultId_fkey" FOREIGN KEY ("scanResultId") REFERENCES "scan_results"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "redirects" ADD CONSTRAINT "redirects_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "redirects" ADD CONSTRAINT "redirects_urlLinkId_fkey" FOREIGN KEY ("urlLinkId") REFERENCES "url_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

