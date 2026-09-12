-- CreateTable
CREATE TABLE "url_redirects" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "issueId" TEXT,
    "fromPath" TEXT NOT NULL,
    "toTarget" TEXT NOT NULL,
    "shopifyRedirectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "url_redirects_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "url_redirects_shopifyRedirectId_key" ON "url_redirects"("shopifyRedirectId");

-- CreateIndex
CREATE INDEX "url_redirects_shopId_idx" ON "url_redirects"("shopId");

-- CreateIndex
CREATE INDEX "url_redirects_shopId_fromPath_idx" ON "url_redirects"("shopId", "fromPath");

-- AddForeignKey
ALTER TABLE "url_redirects" ADD CONSTRAINT "url_redirects_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "url_redirects" ADD CONSTRAINT "url_redirects_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "issues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

