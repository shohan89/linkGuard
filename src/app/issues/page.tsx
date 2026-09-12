import { guardEmbeddedShop } from "../_lib/guard-embedded-shop";
import { NotEmbeddedNotice } from "../not-embedded-notice";
import { IssuesPageClient } from "./view";

export const runtime = "nodejs";

export default async function IssuesPage({
  searchParams,
}: PageProps<"/issues">) {
  const params = await searchParams;
  const guard = guardEmbeddedShop(params);

  if (!guard.ok) {
    return <NotEmbeddedNotice />;
  }

  return <IssuesPageClient shop={guard.shop} />;
}
