import { guardEmbeddedShop } from "../_lib/guard-embedded-shop";
import { NotEmbeddedNotice } from "../not-embedded-notice";
import { UrlsPageClient } from "./view";

export const runtime = "nodejs";

export default async function UrlsPage({
  searchParams,
}: PageProps<"/urls">) {
  const params = await searchParams;
  const guard = guardEmbeddedShop(params);

  if (!guard.ok) {
    return <NotEmbeddedNotice />;
  }

  return <UrlsPageClient shop={guard.shop} />;
}
