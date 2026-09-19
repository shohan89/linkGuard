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
  /** Partner development store — can't add a payment method, so only test billing charges can be approved. */
  isDevelopmentStore: boolean;
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
        partnerDevelopment
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
    plan: { displayName: string; partnerDevelopment: boolean };
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
      isDevelopmentStore: shop.plan.partnerDevelopment,
    };
  },
};
