import { guardEmbeddedShop } from "../_lib/guard-embedded-shop";
import { NotEmbeddedNotice } from "../not-embedded-notice";
import { BillingPageClient } from "./view";

export const runtime = "nodejs";

export default async function BillingPage({
  searchParams,
}: PageProps<"/billing">) {
  const params = await searchParams;
  const guard = guardEmbeddedShop(params);

  if (!guard.ok) {
    return <NotEmbeddedNotice />;
  }

  const host = typeof params.host === "string" ? params.host : "";

  return <BillingPageClient shop={guard.shop} host={host} />;
}
