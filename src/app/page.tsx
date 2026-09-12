import { redirect } from "next/navigation";
import { guardEmbeddedShop } from "./_lib/guard-embedded-shop";
import { NotEmbeddedNotice } from "./not-embedded-notice";

export const runtime = "nodejs";

export default async function HomePage({
  searchParams,
}: PageProps<"/">) {
  const params = await searchParams;
  const guard = guardEmbeddedShop(params);

  if (!guard.ok) {
    return <NotEmbeddedNotice />;
  }

  redirect(`/dashboard?shop=${encodeURIComponent(guard.shop)}`);
}
