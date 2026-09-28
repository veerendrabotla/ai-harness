/**
 * Billing Routes.
 * Stripe-powered checkout, portal, webhook, and subscription management.
 */
import type { FastifyInstance } from "fastify";
import { errors, getEnv } from "@ai-harness/shared";
import { ok } from "../../lib/http.js";
import { BILLING_PLANS, getPlanById } from "../../lib/billing.js";
import {
  createCheckoutSession,
  createBillingPortalSession,
  verifyWebhookSignature,
  cancelSubscription,
  reactivateSubscription,
} from "./stripe.js";
import type Stripe from "stripe";

export default function registerBillingRoutes(app: FastifyInstance) {
  // ── List plans ────────────────────────────────────────────
  app.get("/v1/billing/plans", {
    schema: {
      tags: ["billing"],
      summary: "List available billing plans",
    },
  }, async (_req, reply) => {
    return ok(reply, BILLING_PLANS);
  });

  // ── Get current subscription ──────────────────────────────
  app.get("/v1/billing/subscription", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["billing"],
      summary: "Get the current subscription for a workspace",
      security: [{ bearerAuth: [] }],
      querystring: {
        type: "object",
        required: ["workspaceId"],
        properties: {
          workspaceId: { type: "string", format: "uuid" },
        },
      },
    },
  }, async (req, reply) => {
    const query = (req.query ?? {}) as { workspaceId: string };
    await app.requireWorkspaceRole(req, query.workspaceId, "VIEWER");

    const subscription = await app.prisma.subscription.findFirst({
      where: { workspaceId: query.workspaceId },
      orderBy: { createdAt: "desc" },
    });

    if (!subscription) {
      return ok(reply, {
        plan: "free",
        status: "ACTIVE",
        currentPeriodStart: null,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
      });
    }

    return ok(reply, {
      id: subscription.id,
      plan: subscription.plan,
      status: subscription.status,
      currentPeriodStart: subscription.currentPeriodStart,
      currentPeriodEnd: subscription.currentPeriodEnd,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      trialStart: subscription.trialStart,
      trialEnd: subscription.trialEnd,
    });
  });

  // ── Create checkout session ───────────────────────────────
  app.post("/v1/billing/checkout", {
    config: { rateLimit: { max: 10, timeWindow: "1 hour" } },
    preHandler: [app.authenticate],
    schema: {
      tags: ["billing"],
      summary: "Create a Stripe checkout session for upgrading a plan",
      security: [{ bearerAuth: [] }],
      body: {
        type: "object",
        required: ["workspaceId", "planId"],
        properties: {
          workspaceId: { type: "string", format: "uuid" },
          planId: { type: "string", enum: ["pro", "enterprise"] },
          successUrl: { type: "string", format: "uri" },
          cancelUrl: { type: "string", format: "uri" },
        },
      },
    },
  }, async (req, reply) => {
    const { workspaceId, planId, successUrl, cancelUrl } = req.body as {
      workspaceId: string;
      planId: string;
      successUrl?: string;
      cancelUrl?: string;
    };
    const userId = req.user!.sub;

    await app.requireWorkspaceRole(req, workspaceId, "OWNER");

    const plan = getPlanById(planId);
    if (plan.id === "free") {
      throw errors.validation("Cannot checkout for the free plan");
    }

    const session = await createCheckoutSession({
      workspaceId,
      userId,
      planId,
      successUrl: successUrl ?? `${getEnv().FRONTEND_ORIGIN}/billing/success`,
      cancelUrl: cancelUrl ?? `${getEnv().FRONTEND_ORIGIN}/billing/cancel`,
    });

    // Persist the session ID for webhook correlation
    await app.prisma.subscription.upsert({
      where: { workspaceId },
      create: {
        workspaceId,
        stripeSessionId: session.id,
        plan: planId,
        status: "INCOMPLETE",
      },
      update: {
        stripeSessionId: session.id,
        plan: planId,
      },
    });

    return ok(reply, {
      sessionId: session.id,
      url: session.url,
    });
  });

  // ── Create billing portal session ─────────────────────────
  app.post("/v1/billing/portal", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["billing"],
      summary: "Create a Stripe customer portal session",
      security: [{ bearerAuth: [] }],
      body: {
        type: "object",
        required: ["workspaceId"],
        properties: {
          workspaceId: { type: "string", format: "uuid" },
          returnUrl: { type: "string", format: "uri" },
        },
      },
    },
  }, async (req, reply) => {
    const { workspaceId, returnUrl } = req.body as {
      workspaceId: string;
      returnUrl?: string;
    };

    await app.requireWorkspaceRole(req, workspaceId, "OWNER");

    const subscription = await app.prisma.subscription.findFirst({
      where: { workspaceId },
      select: { stripeCustomerId: true },
    });

    if (!subscription?.stripeCustomerId) {
      throw errors.validation("No billing account found. Subscribe to a plan first.");
    }

    const portal = await createBillingPortalSession(
      subscription.stripeCustomerId,
      returnUrl ?? `${getEnv().FRONTEND_ORIGIN}/billing`,
    );

    return ok(reply, { url: portal.url });
  });

  // ── Cancel subscription ───────────────────────────────────
  app.post("/v1/billing/subscription/cancel", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["billing"],
      summary: "Cancel the workspace subscription (at period end)",
      security: [{ bearerAuth: [] }],
      body: {
        type: "object",
        required: ["workspaceId"],
        properties: {
          workspaceId: { type: "string", format: "uuid" },
          immediate: { type: "boolean", default: false },
        },
      },
    },
  }, async (req, reply) => {
    const { workspaceId, immediate } = req.body as {
      workspaceId: string;
      immediate?: boolean;
    };

    await app.requireWorkspaceRole(req, workspaceId, "OWNER");

    const subscription = await app.prisma.subscription.findFirst({
      where: { workspaceId, status: { in: ["ACTIVE", "TRIALING"] } },
      select: { stripeSubscriptionId: true },
    });

    if (!subscription?.stripeSubscriptionId) {
      throw errors.validation("No active subscription to cancel.");
    }

    const updated = await cancelSubscription(subscription.stripeSubscriptionId, !immediate);

    await app.prisma.subscription.updateMany({
      where: { workspaceId },
      data: {
        cancelAtPeriodEnd: updated.cancel_at_period_end,
        ...(immediate && { status: "CANCELED", canceledAt: new Date() }),
      },
    });

    return ok(reply, {
      cancelAtPeriodEnd: updated.cancel_at_period_end,
      canceledAt: immediate ? new Date() : null,
    });
  });

  // ── Reactivate subscription ───────────────────────────────
  app.post("/v1/billing/subscription/reactivate", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["billing"],
      summary: "Reactivate a subscription that was set to cancel at period end",
      security: [{ bearerAuth: [] }],
      body: {
        type: "object",
        required: ["workspaceId"],
        properties: {
          workspaceId: { type: "string", format: "uuid" },
        },
      },
    },
  }, async (req, reply) => {
    const { workspaceId } = req.body as { workspaceId: string };

    await app.requireWorkspaceRole(req, workspaceId, "OWNER");

    const subscription = await app.prisma.subscription.findFirst({
      where: { workspaceId, cancelAtPeriodEnd: true },
      select: { stripeSubscriptionId: true },
    });

    if (!subscription?.stripeSubscriptionId) {
      throw errors.validation("No subscription pending cancellation.");
    }

    const updated = await reactivateSubscription(subscription.stripeSubscriptionId);

    await app.prisma.subscription.updateMany({
      where: { workspaceId },
      data: { cancelAtPeriodEnd: updated.cancel_at_period_end },
    });

    return ok(reply, { cancelAtPeriodEnd: updated.cancel_at_period_end });
  });

  // ── Stripe Webhook ────────────────────────────────────────
  app.post("/v1/billing/webhook", {
    schema: {
      tags: ["billing"],
      summary: "Stripe webhook receiver",
    },
    config: {
      rateLimit: { max: 100, timeWindow: "1 minute" },
      // Stripe needs the raw body for signature verification
      rawBody: true,
    },
  }, async (req, reply) => {
    const signature = req.headers["stripe-signature"] as string | undefined;
    if (!signature) {
      return reply.code(400).send({ error: "Missing stripe-signature header" });
    }

    const rawBody = (req as { rawBody?: Buffer }).rawBody;
    if (!rawBody) {
      return reply.code(400).send({ error: "Missing raw request body" });
    }

    let event: Stripe.Event;
    try {
      event = verifyWebhookSignature(rawBody, signature);
    } catch (err) {
      app.log.warn({ err }, "Stripe webhook signature verification failed");
      return reply.code(400).send({ error: "Invalid signature" });
    }

    try {
      await handleWebhookEvent(app, event);
    } catch (err) {
      app.log.error({ err, eventType: event.type }, "Failed to handle Stripe webhook event");
    }

    return reply.code(200).send({ received: true });
  });
}

// ── Webhook event handler ─────────────────────────────────

async function handleWebhookEvent(
  app: FastifyInstance,
  event: Stripe.Event,
): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const workspaceId = session.metadata?.workspaceId;
      if (!workspaceId) break;

      const subscriptionId = session.subscription as string | null;
      const customerId = session.customer as string | null;

      let planId = "pro";
      let currentPeriodStart: Date | null = null;
      let currentPeriodEnd: Date | null = null;

      if (subscriptionId) {
        const stripe = (await import("./stripe.js")).getStripe();
        const sub = await stripe.subscriptions.retrieve(subscriptionId);
        const priceItem = sub.items.data[0];
        if (priceItem?.price.id === getEnv().STRIPE_PRICE_ENTERPRISE) {
          planId = "enterprise";
        }
        currentPeriodStart = new Date(sub.current_period_start * 1000);
        currentPeriodEnd = new Date(sub.current_period_end * 1000);
      }

      await app.prisma.subscription.upsert({
        where: { workspaceId },
        create: {
          workspaceId,
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscriptionId,
          stripeSessionId: session.id,
          plan: planId,
          status: "ACTIVE",
          currentPeriodStart,
          currentPeriodEnd,
        },
        update: {
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscriptionId,
          plan: planId,
          status: "ACTIVE",
          currentPeriodStart,
          currentPeriodEnd,
          canceledAt: null,
          cancelAtPeriodEnd: false,
        },
      });

      app.log.info({ workspaceId, planId }, "Subscription activated via checkout");
      break;
    }

    case "invoice.payment_succeeded": {
      const invoice = event.data.object as Stripe.Invoice;
      const subscriptionId = invoice.subscription as string | null;
      if (!subscriptionId) break;

      await app.prisma.subscription.updateMany({
        where: { stripeSubscriptionId: subscriptionId },
        data: { status: "ACTIVE" },
      });
      break;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const subscriptionId = invoice.subscription as string | null;
      if (!subscriptionId) break;

      await app.prisma.subscription.updateMany({
        where: { stripeSubscriptionId: subscriptionId },
        data: { status: "PAST_DUE" },
      });
      break;
    }

    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;
      const currentPeriodStart = new Date(subscription.current_period_start * 1000);
      const currentPeriodEnd = new Date(subscription.current_period_end * 1000);

      await app.prisma.subscription.updateMany({
        where: { stripeSubscriptionId: subscription.id },
        data: {
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
          currentPeriodStart,
          currentPeriodEnd,
          status: subscription.status === "active" ? "ACTIVE"
            : subscription.status === "past_due" ? "PAST_DUE"
            : subscription.status === "canceled" ? "CANCELED"
            : subscription.status === "trialing" ? "TRIALING"
            : "ACTIVE",
        },
      });
      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      await app.prisma.subscription.updateMany({
        where: { stripeSubscriptionId: subscription.id },
        data: {
          status: "CANCELED",
          canceledAt: new Date(),
        },
      });
      app.log.info({ subscriptionId: subscription.id }, "Subscription canceled via webhook");
      break;
    }
  }
}
