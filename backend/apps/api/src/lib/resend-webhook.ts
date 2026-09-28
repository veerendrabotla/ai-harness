/**
 * Resend Inbound Webhook Handler.
 * Receives delivery status events (delivered, bounced, complained) from Resend.
 */
import type { FastifyInstance } from "fastify";
import { createHmac, timingSafeEqual } from "node:crypto";
import pino from "pino";
import { updateDeliveryStatus } from "./email-delivery.js";

const log = pino({ name: "resend-webhook", level: "warn" });

interface ResendWebhookEvent {
  type: string;
  created_at: string;
  data: {
    email_id: string;
    from: string;
    to: string[];
    subject: string;
    created_at: string;
  };
}

function verifyResendSignature(payload: string, signature: string, secret: string): boolean {
  const expectedSignature = createHmac("sha256", secret).update(payload).digest("hex");
  const sig = signature.replace("sha256=", "");
  try {
    return timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expectedSignature, "hex"));
  } catch {
    return false;
  }
}

export function registerResendWebhookRoutes(app: FastifyInstance): void {
  /**
   * Resend webhook endpoint for delivery status events.
   */
  app.post("/v1/email-webhook/resend", {
    schema: {
      tags: ["email", "webhooks"],
      summary: "Resend email delivery webhook",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const signature = req.headers["resend-signature"] as string | undefined;
    const payloadStr = JSON.stringify(req.body);

    // Verify webhook signature if secret is configured
    const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;
    if (webhookSecret && signature) {
      if (!verifyResendSignature(payloadStr, signature, webhookSecret)) {
        reply.code(401);
        return reply.send({ error: "Invalid signature" });
      }
    }

    const event = req.body as ResendWebhookEvent;

    // Map Resend event type to our status
    let status: "SENT" | "DELIVERED" | "OPENED" | "BOUNCED" | "COMPLAINT" | null = null;
    switch (event.type) {
      case "email.sent":
        status = "SENT";
        break;
      case "email.delivered":
        status = "DELIVERED";
        break;
      case "email.opened":
        status = "OPENED";
        break;
      case "email.bounced":
        status = "BOUNCED";
        break;
      case "email.complained":
        status = "COMPLAINT";
        break;
    }

    if (status && event.data?.email_id) {
      try {
        await updateDeliveryStatus(
          app.prisma,
          event.data.email_id,
          status,
          undefined,
          event.type === "email.bounced" ? "Bounced per Resend webhook" : undefined,
        );
      } catch (err) {
        log.error({ err }, "[Resend Webhook] Failed to update delivery status:");
      }
    }

    return reply.code(200).send({ received: true });
  });
}
