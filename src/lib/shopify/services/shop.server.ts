import type { Session } from "@shopify/shopify-api";
import { runAdminQuery } from "@/lib/shopify/admin.server";

export interface ShopInfo {
  id: string;
  name: string;
  myshopifyDomain: string;
  email: string;
  currencyCode: string;
  primaryDomainUrl: string;
  planDisplayName: string;
}

const SHOP_INFO_QUERY = `#graphql
  query ShopInfo {
    shop {
      id
      name
      myshopifyDomain
      email
      currencyCode
      primaryDomain {
        url
      }
      plan {
        displayName
      }
    }
  }
`;

interface ShopInfoResponse {
  shop: {
    id: string;
    name: string;
    myshopifyDomain: string;
    email: string;
    currencyCode: string;
    primaryDomain: { url: string };
    plan: { displayName: string };
  };
}

export const ShopService = {
  async getShopInfo(session: Session): Promise<ShopInfo> {
    const { shop } = await runAdminQuery<ShopInfoResponse>(
      session,
      SHOP_INFO_QUERY,
    );

    return {
      id: shop.id,
      name: shop.name,
      myshopifyDomain: shop.myshopifyDomain,
      email: shop.email,
      currencyCode: shop.currencyCode,
      primaryDomainUrl: shop.primaryDomain.url,
      planDisplayName: shop.plan.displayName,
    };
  },
};
