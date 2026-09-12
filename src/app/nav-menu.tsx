"use client";

// App Bridge intercepts clicks on these links and drives Shopify admin's
// left nav — see https://shopify.dev/docs/api/app-bridge-library/apis/navigation-menu
export function NavMenu() {
  return (
    <ui-nav-menu>
      <a href="/dashboard" rel="home">
        Overview
      </a>
      <a href="/issues">Issues</a>
      <a href="/urls">URLs</a>
      <a href="/scans">Scans</a>
      <a href="/redirects">Redirects</a>
      <a href="/settings">Settings</a>
      <a href="/billing">Billing</a>
    </ui-nav-menu>
  );
}
