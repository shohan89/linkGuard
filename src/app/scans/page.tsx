import { guardEmbeddedShop } from "../_lib/guard-embedded-shop";
import { NotEmbeddedNotice } from "../not-embedded-notice";
import { ScansPageClient } from "./view";

export const runtime = "nodejs";

export default async function ScansPage({
  searchParams,
}: PageProps<"/scans">) {
  const params = await searchParams;
  const guard = guardEmbeddedShop(params);

  if (!guard.ok) {
    return <NotEmbeddedNotice />;
  }

  return <ScansPageClient shop={guard.shop} />;
}
