import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // bullmq optionally supports @valkey/valkey-glide as an alternative to
  // ioredis; we only ever use ioredis, so that branch is dead code, but
  // webpack still tries to statically resolve it unless bullmq (and
  // ioredis, which has the same kind of optional-dependency branches) are
  // left external instead of bundled.
  serverExternalPackages: ["bullmq", "ioredis"],
};

export default nextConfig;
