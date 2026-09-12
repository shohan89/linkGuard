import type { Metadata } from "next";
import "@shopify/polaris/build/esm/styles.css";
import "./globals.css";
import { Providers } from "./providers";
import { NavMenu } from "./nav-menu";

export const metadata: Metadata = {
  title: "LinkGuard",
  description: "Broken link and redirect monitoring for Shopify stores.",
};

const shopifyApiKey = process.env.SHOPIFY_API_KEY ?? "";

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <head>
        <meta name="shopify-api-key" content={shopifyApiKey} />
        {/* Must load synchronously, first in <head>, no async/defer — Shopify requirement. */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
      </head>
      <body>
        <Providers>
          <NavMenu />
          {children}
        </Providers>
      </body>
    </html>
  );
}
