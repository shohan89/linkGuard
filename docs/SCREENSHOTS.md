# Screenshots for the App Store listing

Shopify's current spec (verify against the Partner Dashboard upload
screen at submission time — these numbers change occasionally):

- 1600×900px (16:9) or 1200×800px (3:2), PNG or JPG
- Minimum 3, Shopify allows more — 5–6 gives a fuller picture
- No browser chrome (address bar, tabs) in the image
- Real data, not obviously-fake placeholder text ("Lorem ipsum", "Test
  Product 123") — reviewers reject listings that look unpopulated

This is manual — needs a real browser against the live embedded app.
Can't be automated from this environment (no browser control tool here).

## Before shooting: seed the demo store with realistic data

Screenshots of an empty dashboard (0 URLs, 0 issues) look broken, not
reassuring. Before shooting, either:
- Use a store with real, substantial content (products/pages/blog posts),
  run a scan, and — since a genuinely healthy store shows 0 issues, which
  undersells the product — temporarily introduce 2–3 real broken links
  (e.g. a product link in a blog post pointing at a deleted product) so
  the Issues page has something to show, then scan.
- Or use the seed script already in the repo, which inserts realistic scans, issues, and redirect history for one dev store (every row is tagged so it can be removed cleanly):

  ```
  npx tsx scripts/seed-demo-data.ts --shop <store>.myshopify.com            # add
  npx tsx scripts/seed-demo-data.ts --shop <store>.myshopify.com --remove   # undo
  ```

  Do not run a real scan afterwards if you want the screenshots to match; take them first.

## Shot list

1. **Dashboard / Overview** — health score, total URLs, broken links,
   critical issues, last scan summary. The "hero" shot — should look
   healthy-but-active (a health score like 85–95%, not 100% with zero
   everything, and not near-0% either).
2. **Issues page** — the list of open issues with severity badges
   (CRITICAL/WARNING), showing the "Fix with a redirect" link on at least
   one row.
3. **Redirects page** — the create-redirect form plus a populated redirect
   history list, showing the app actually fixing something.
4. **Scans page** — the "Run scan" button plus a short history of past
   scans with dates and issue counts.
5. **Billing page** — all four plan tiers visible with the current plan
   badge and usage bars (scans used / URL count used).
6. (Optional) **Settings page** — shop info + plan limits, shows the app
   is fully wired up end to end.

## How to shoot

1. Open the app embedded in a real Shopify Admin session (not the bare
   Vercel URL — must show Shopify's admin chrome around it, or crop
   tightly to just the app's content area, whichever Shopify's upload
   tool expects — check the current upload screen's preview to confirm).
2. Set the browser window/viewport to a 16:9 ratio before capturing (e.g.
   1600×900) so there's no cropping needed after.
3. Use your OS's window-region screenshot tool (not full-screen — exclude
   the browser's own title bar/tabs/address bar).
4. Save as PNG, check file size is reasonable (Shopify has an upload size
   cap — check the current limit on the upload screen).
