-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'WEEKLY_REPORT';

-- AlterTable
ALTER TABLE "shops" ADD COLUMN     "contactEmail" TEXT;

