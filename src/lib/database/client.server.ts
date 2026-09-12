import { PrismaClient } from "@prisma/client";

// Next.js dev-mode hot reload creates a fresh module scope per edit, which
// would otherwise open a new PrismaClient (and DB connection pool) on every
// save. Caching the instance on `globalThis` survives the reload.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
