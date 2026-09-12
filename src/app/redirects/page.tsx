import { guardEmbeddedShop } from "../_lib/guard-embedded-shop";
import { NotEmbeddedNotice } from "../not-embedded-notice";
import { RedirectsPageClient } from "./view";

export const runtime = "nodejs";

export default async function RedirectsPage({
  searchParams,
}: PageProps<"/redirects">) {
  const params = await searchParams;
  const guard = guardEmbeddedShop(params);

  if (!guard.ok) {
    return <NotEmbeddedNotice />;
  }

  const fromUrlParam = typeof params.fromUrl === "string" ? params.fromUrl : undefined;
  const issueIdParam = typeof params.issueId === "string" ? params.issueId : undefined;

  return (
    <RedirectsPageClient shop={guard.shop} initialFromUrl={fromUrlParam} issueId={issueIdParam} />
  );
}
