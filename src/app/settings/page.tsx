import { guardEmbeddedShop } from "../_lib/guard-embedded-shop";
import { NotEmbeddedNotice } from "../not-embedded-notice";
import { SettingsPageClient } from "./view";

export const runtime = "nodejs";

export default async function SettingsPage({
  searchParams,
}: PageProps<"/settings">) {
  const params = await searchParams;
  const guard = guardEmbeddedShop(params);

  if (!guard.ok) {
    return <NotEmbeddedNotice />;
  }

  return <SettingsPageClient shop={guard.shop} />;
}
