-- AlterEnum
ALTER TYPE "ScanResultType" ADD VALUE 'GONE';

-- AlterTable
ALTER TABLE "scan_results" ADD COLUMN     "errorMessage" TEXT,
ADD COLUMN     "finalUrl" TEXT;

