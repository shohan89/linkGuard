import type { Session } from "@shopify/shopify-api";
import { runAdminQuery } from "@/lib/shopify/admin.server";

export interface ShopifySubscription {
  id: string;
  name: string;
  status: string;
  currentPeriodEnd: string | null;
  test: boolean;
}

const ACTIVE_SUBSCRIPTIONS_QUERY = `#graphql
  query ActiveSubscriptions {
    currentAppInstallation {
      activeSubscriptions {
        id
        name
        status
        currentPeriodEnd
        test
      }
    }
  }
`;

interface ActiveSubscriptionsResponse {
  currentAppInstallation: { activeSubscriptions: ShopifySubscription[] };
}

const CREATE_SUBSCRIPTION_MUTATION = `#graphql
  mutation CreateSubscription(
    $name: String!
    $returnUrl: URL!
    $test: Boolean!
    $lineItems: [AppSubscriptionLineItemInput!]!
  ) {
    appSubscriptionCreate(
      name: $name
      returnUrl: $returnUrl
      test: $test
      lineItems: $lineItems
    ) {
      appSubscription {
        id
        status
      }
      confirmationUrl
      userErrors {
        field
        message
      }
    }
  }
`;

interface CreateSubscriptionResponse {
  appSubscriptionCreate: {
    appSubscription: { id: string; status: string } | null;
    confirmationUrl: string | null;
    userErrors: { field: string[] | null; message: string }[];
  };
}

const CANCEL_SUBSCRIPTION_MUTATION = `#graphql
  mutation CancelSubscription($id: ID!) {
    appSubscriptionCancel(id: $id) {
      appSubscription {
        id
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`;

interface CancelSubscriptionResponse {
  appSubscriptionCancel: {
    appSubscription: { id: string; status: string } | null;
    userErrors: { field: string[] | null; message: string }[];
  };
}

export class ShopifyBillingUserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShopifyBillingUserError";
  }
}

export const ShopifyBillingService = {
  async getActiveSubscriptions(session: Session): Promise<ShopifySubscription[]> {
    const data = await runAdminQuery<ActiveSubscriptionsResponse>(
      session,
      ACTIVE_SUBSCRIPTIONS_QUERY,
    );
    return data.currentAppInstallation.activeSubscriptions;
  },

  /**
   * Starts a subscription. `test` MUST be true off of production — Shopify
   * requires an explicit flag for non-billing test charges, and this also
   * means development stores never get charged even by mistake.
   *
   * Note: Shopify rejects this entirely with "Apps without a public
   * distribution cannot use the Billing API" until the app's distribution
   * in the Partner/Dev Dashboard is set to Public — a one-time dashboard
   * setting, not something this code can work around.
   */
  async createSubscription(
    session: Session,
    input: { name: string; priceUsd: number; returnUrl: string; test: boolean },
  ): Promise<{ confirmationUrl: string; subscriptionId: string }> {
    const data = await runAdminQuery<CreateSubscriptionResponse>(
      session,
      CREATE_SUBSCRIPTION_MUTATION,
      {
        name: input.name,
        returnUrl: input.returnUrl,
        test: input.test,
        lineItems: [
          {
            plan: {
              appRecurringPricingDetails: {
                price: { amount: input.priceUsd, currencyCode: "USD" },
                interval: "EVERY_30_DAYS",
              },
            },
          },
        ],
      },
    );

    const { appSubscription, confirmationUrl, userErrors } = data.appSubscriptionCreate;

    if (userErrors.length > 0) {
      throw new ShopifyBillingUserError(userErrors.map((e) => e.message).join("; "));
    }
    if (!appSubscription || !confirmationUrl) {
      throw new ShopifyBillingUserError("Shopify did not return a confirmation URL");
    }

    return { confirmationUrl, subscriptionId: appSubscription.id };
  },

  async cancelSubscription(session: Session, subscriptionId: string): Promise<void> {
    const data = await runAdminQuery<CancelSubscriptionResponse>(
      session,
      CANCEL_SUBSCRIPTION_MUTATION,
      { id: subscriptionId },
    );

    const { userErrors } = data.appSubscriptionCancel;
    if (userErrors.length > 0) {
      throw new ShopifyBillingUserError(userErrors.map((e) => e.message).join("; "));
    }
  },
};
