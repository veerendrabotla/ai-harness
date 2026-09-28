/**
 * Stripe Integration Service.
 * Handles Stripe SDK initialization, webhook signature verification,
 * and shared helpers for billing operations.
 */
import Stripe from "stripe";
import { getEnv } from "@ai-harness/shared";

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (_stripe) return _stripe;

  const secretKey = getEnv().STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("STRIPE_SECRET_KEY environment variable is not set");
  }

  _stripe = new Stripe(secretKey, {
    typescript: true,
  });

  return _stripe;
}

export function verifyWebhookSignature(
  payload: Buffer,
  signature: string,
): Stripe.Event {
  const webhookSecret = getEnv().STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    throw new Error("STRIPE_WEBHOOK_SECRET environment variable is not set");
  }

  return getStripe().webhooks.constructEvent(payload, signature, webhookSecret);
}

export interface CheckoutSessionParams {
  workspaceId: string;
  userId: string;
  planId: string;
  successUrl: string;
  cancelUrl: string;
}

export async function createCheckoutSession(
  params: CheckoutSessionParams,
): Promise<Stripe.Checkout.Session> {
  const stripe = getStripe();

  const planPrices: Record<string, string> = {
    pro: getEnv().STRIPE_PRICE_PRO ?? "",
    enterprise: getEnv().STRIPE_PRICE_ENTERPRISE ?? "",
  };

  const priceId = planPrices[params.planId];
  if (!priceId) {
    throw new Error(`No Stripe price configured for plan: ${params.planId}`);
  }

  return stripe.checkout.sessions.create({
    mode: "subscription",
    payment_method_types: ["card"],
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    client_reference_id: params.workspaceId,
    metadata: {
      workspaceId: params.workspaceId,
      userId: params.userId,
      planId: params.planId,
    },
  });
}

export async function createBillingPortalSession(
  customerId: string,
  returnUrl: string,
): Promise<Stripe.BillingPortal.Session> {
  return getStripe().billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });
}

export async function cancelSubscription(
  subscriptionId: string,
  atPeriodEnd = true,
): Promise<Stripe.Subscription> {
  return getStripe().subscriptions.update(subscriptionId, {
    cancel_at_period_end: atPeriodEnd,
  });
}

export async function reactivateSubscription(
  subscriptionId: string,
): Promise<Stripe.Subscription> {
  return getStripe().subscriptions.update(subscriptionId, {
    cancel_at_period_end: false,
  });
}
