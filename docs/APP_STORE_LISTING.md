# App Store listing content (draft)

Paste these into Partner Dashboard → LinkGuard → Distribution → Public
distribution → App listing. Everything here is drafted from what the app
actually does — verify against the live app before submitting, and adjust
tone/wording to taste; this is a starting point, not final copy.

## App name

```
LinkGuard
```

## Tagline (≤ 70 characters incl. spaces — Shopify enforces a limit here)

```
Find and fix broken links before your customers do
```
(51 characters)

## App introduction (≤ 100 characters — shown in search results)

```
Automatic broken link, 404, and redirect monitoring for your store
```
(68 characters)

## App details / description

```
LinkGuard scans your store's products, collections, pages, blog posts,
and navigation for broken links, 404 errors, server errors, and redirect
problems — automatically, on a schedule, with no setup beyond installing
the app.

WHAT IT CHECKS
• Internal links pointing to products, pages, or collections that no
  longer exist
• External links to other sites that have gone down or moved
• Server errors (5xx) on any linked page
• Redirect chains and loops that slow down your store or confuse search
  engines

HOW IT HELPS
• See a health score for your store's links at a glance
• Get a prioritized list of issues — broken links on your own store are
  flagged critical; the same problem on someone else's site is a warning
• Fix a broken link with one click — LinkGuard creates a real redirect on
  your store through Shopify's own URL Redirect feature
• Get notified by email when new critical issues are found, and a weekly
  summary of your store's link health

PLANS
Free forever for small catalogs (up to 25 URLs, weekly scans). Paid plans
add daily scans, more monitored URLs, and higher monthly scan limits —
see Pricing below.

PRIVACY
LinkGuard only reads your store's public content (products, pages,
collections, navigation) and never accesses customer, order, or checkout
data. See our Privacy Policy for details.
```

## Feature list (bullet points, Shopify limits to a handful of short lines)

```
- Automatic scheduled scans for broken links and 404s
- Redirect-chain and redirect-loop detection
- One-click fix: creates a real Shopify redirect from a broken-link issue
- Health score and issue severity at a glance
- Email alerts for new critical issues and weekly summaries
```

## Category

```
Primary: Store management
Secondary: SEO
```
(Confirm exact category names against whatever Shopify's category picker
currently offers — these change over time.)

## Search terms / keywords

```
broken links, 404, redirects, link checker, SEO, dead links, site health
```

## Pricing (must match `src/lib/billing/plans.ts` exactly — verify before submitting)

| Plan | Price | Monitored URLs | Scans/month | Scan frequency |
|---|---|---|---|---|
| Free | $0 | 25 | 4 | Weekly |
| Starter | $7.99/month | 100 | 30 | Daily |
| Growth | $14.99/month | 500 | 30 | Daily |
| Pro | $29.99/month | 5,000 | 30 | Daily |

All plans billed recurring every 30 days through Shopify Billing.
Merchants can upgrade, downgrade, or cancel anytime from the app's
Billing page.

## Required links

```
Privacy policy:  https://linkguard-jade.vercel.app/privacy
Terms of service: https://linkguard-jade.vercel.app/terms
Support:         https://linkguard-jade.vercel.app/support
Support email:   clustercloudbd@gmail.com
```
(Swap the domain for your final custom domain if you attach one before
submitting — see `docs/DEPLOYMENT.md`.)

## Scope justification (Shopify reviewers ask for this if not obvious)

| Scope | Why LinkGuard needs it |
|---|---|
| `read_products` | Discover product URLs to monitor |
| `read_content` | Discover blog/article URLs to monitor |
| `read_online_store_pages` | Discover custom page URLs to monitor |
| `read_online_store_navigation` | Read existing redirects (loop detection, duplicate-path checks) |
| `write_online_store_navigation` | Create redirects when a merchant fixes a broken link from an issue |

## App icon

Not yet created — needs a 1200×1200px PNG or JPG, under 1MB, no
transparency required by Shopify but recommended for a clean look at
different admin sizes. Not something this session can generate reliably
as a real production asset — commission or design one before submitting.
