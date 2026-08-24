import { prisma } from "@/lib/db";
import type { NotificationAdapter, NotificationPayload } from "./types";

export class InAppNotificationAdapter implements NotificationAdapter {
  async send(payload: NotificationPayload): Promise<void> {
    await prisma.notification.create({
      data: {
        userId: payload.userId,
        orderId: payload.orderId,
        type: payload.type,
        message: payload.message,
      },
    });

    await prisma.externalIntegrationLog.create({
      data: {
        orderId: payload.orderId,
        adapter: "notification",
        action: "in_app",
        payload: JSON.stringify(payload),
        response: JSON.stringify({ delivered: true }),
        status: "SUCCESS",
      },
    });
  }

  async sendToRole(
    role: "CS" | "PROCUREMENT" | "ADMIN",
    payload: Omit<NotificationPayload, "userId">
  ): Promise<void> {
    const users = await prisma.user.findMany({
      where: { role },
    });

    await Promise.all(
      users.map((user) =>
        this.send({
          ...payload,
          userId: user.id,
        })
      )
    );
  }
}

export function getNotificationAdapter(): NotificationAdapter {
  return new InAppNotificationAdapter();
}
