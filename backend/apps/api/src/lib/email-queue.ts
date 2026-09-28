/**
 * Email Queue.
 * BullMQ-based asynchronous email delivery with retry and backoff.
 */
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { getEnv, EMAIL_QUEUE, type EmailJob } from "@ai-harness/shared";
import type { PrismaClient } from "@prisma/client";
import { Resend } from "resend";
import pino from "pino";

const log = pino({ name: "email-queue", level: "warn" });

let queue: Queue<EmailJob> | null = null;

function createConnection() {
  const env = getEnv();
  return new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
}

export function getEmailQueue(): Queue<EmailJob> {
  if (!queue) {
    const connection = createConnection();
    queue = new Queue<EmailJob>(EMAIL_QUEUE, {
      connection,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: "exponential", delay: 1000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    });
  }
  return queue;
}

export async function enqueueEmail(job: Omit<EmailJob, "kind">): Promise<void> {
  await getEmailQueue().add("send", { kind: "send", ...job }, {
    priority: job.templateType === "invitation" ? 1 : 5,
  });
}

export async function closeEmailQueue(): Promise<void> {
  if (queue) {
    await queue.close();
    queue = null;
  }
}

/**
 * Start the email delivery worker.
 * Call once at application startup (separate process in production).
 */
export function startEmailWorker(prisma: PrismaClient): Worker<EmailJob> {
  const connection = createConnection();

  const worker = new Worker<EmailJob>(
    EMAIL_QUEUE,
    async (job) => {
      const { emailId, recipientEmail, subject, html, text } = job.data;

      await prisma.emailDelivery.update({
        where: { id: emailId },
        data: { status: "SENT", sentAt: new Date() },
      });

      try {
        const env = getEnv();
        if (env.RESEND_API_KEY && env.RESEND_FROM) {
          const resend = new Resend(env.RESEND_API_KEY);
          const result = await resend.emails.send({
            from: env.RESEND_FROM,
            to: recipientEmail,
            subject,
            html,
            text,
          });

          if (result.error) {
            await prisma.emailDelivery.update({
              where: { id: emailId },
              data: {
                status: "BOUNCED",
                errorMessage: result.error.message ?? "Send failed",
                bouncedAt: new Date(),
              },
            });
            throw new Error(result.error.message ?? "Email send failed");
          }

          await prisma.emailDelivery.update({
            where: { id: emailId },
            data: {
              status: "DELIVERED",
              externalId: result.data?.id ?? null,
              deliveredAt: new Date(),
            },
          });
        } else {
          log.info({ recipientEmail, subject }, "[Email-Dev]");
          await prisma.emailDelivery.update({
            where: { id: emailId },
            data: {
              status: "SENT",
              deliveredAt: new Date(),
            },
          });
        }
      } catch (err) {
        await prisma.emailDelivery.update({
          where: { id: emailId },
          data: {
            status: "BOUNCED",
            errorMessage: err instanceof Error ? err.message : String(err),
            bouncedAt: new Date(),
          },
        });
        throw err;
      }
    },
    {
      connection,
      concurrency: getEnv().WORKER_CONCURRENCY,
      limiter: {
        max: 100,
        duration: 60_000,
      },
    },
  );

  worker.on("failed", (job, err) => {
    log.error({ jobId: job?.id, err }, "[EmailWorker] Job failed:");
  });

  return worker;
}
