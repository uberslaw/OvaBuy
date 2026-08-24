import type { OrderStatus } from "@/lib/types";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { VALID_STATUS_TRANSITIONS } from "@/lib/constants";
import { getNotificationAdapter } from "@/lib/adapters/notifications";
import { getServiceNowAdapter } from "@/lib/adapters/servicenow";

export async function generateOrderNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const count = await prisma.order.count();
  return `OVB-${year}-${String(count + 1).padStart(4, "0")}`;
}

export function computeOrderTotal(
  items: Array<{ quantity: number; unitCost: number }>
): number {
  return items.reduce((sum, item) => sum + item.quantity * item.unitCost, 0);
}

export async function checkBudget(
  officeId: string,
  orderTotal: number
): Promise<{ ok: boolean; message?: string; available?: number }> {
  const office = await prisma.office.findUniqueOrThrow({ where: { id: officeId } });
  const available = office.budgetTotal - office.budgetSpent - office.budgetReserved;

  if (orderTotal > available) {
    return {
      ok: false,
      available,
      message: `Insufficient budget. Available: ${office.currency} ${available.toFixed(0)}, required: ${office.currency} ${orderTotal.toFixed(0)}`,
    };
  }

  return { ok: true, available };
}

export async function reserveBudget(officeId: string, amount: number) {
  await prisma.office.update({
    where: { id: officeId },
    data: { budgetReserved: { increment: amount } },
  });
}

export async function releaseBudget(officeId: string, amount: number) {
  await prisma.office.update({
    where: { id: officeId },
    data: { budgetReserved: { decrement: amount } },
  });
}

export async function commitBudget(officeId: string, amount: number) {
  await prisma.office.update({
    where: { id: officeId },
    data: {
      budgetReserved: { decrement: amount },
      budgetSpent: { increment: amount },
    },
  });
}

export async function addStatusEvent(
  orderId: string,
  status: OrderStatus,
  actorId: string,
  comment?: string,
  metadata?: Record<string, unknown>
) {
  return prisma.orderStatusEvent.create({
    data: {
      orderId,
      status,
      actorId,
      comment,
      metadata: metadata ? JSON.stringify(metadata) : undefined,
    },
  });
}

export function assertStatusTransition(
  current: OrderStatus,
  next: OrderStatus
): void {
  const allowed = VALID_STATUS_TRANSITIONS[current];
  if (!allowed?.includes(next)) {
    throw new Error(`Cannot transition from ${current} to ${next}`);
  }
}

export async function notifyStatusChange(
  orderId: string,
  status: OrderStatus,
  orderNumber: string,
  officeId: string
) {
  const notifications = getNotificationAdapter();

  await notifications.sendToRole("PROCUREMENT", {
    orderId,
    type: "STATUS_UPDATED",
    message: `Order ${orderNumber} updated to ${status.replace(/_/g, " ")}`,
  });

  const csUsers = await prisma.user.findMany({
    where: { role: "CS", officeId },
  });

  for (const user of csUsers) {
    await notifications.send({
      userId: user.id,
      orderId,
      type: "STATUS_UPDATED",
      message: `Your order ${orderNumber} is now ${status.replace(/_/g, " ")}`,
    });
  }
}

export async function createServiceNowStub(orderId: string) {
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { office: true },
  });

  const adapter = getServiceNowAdapter();
  const result = await adapter.createRequest({
    orderId: order.id,
    orderNumber: order.orderNumber,
    office: order.office.name,
    total: order.totalAmount,
    urgent: order.urgent,
    businessCase: order.businessCase,
  });

  if (result.reference) {
    await prisma.order.update({
      where: { id: orderId },
      data: { servicenowRef: result.reference },
    });
  }

  return result;
}

export type OrderWithRelations = Prisma.OrderGetPayload<{
  include: {
    office: true;
    createdBy: true;
    lineItems: { include: { catalogItem: true } };
    attachments: true;
    statusEvents: { include: { actor: true }; orderBy: { createdAt: "asc" } };
  };
}>;

export const orderInclude = {
  office: true,
  createdBy: true,
  lineItems: { include: { catalogItem: true } },
  attachments: true,
  statusEvents: {
    include: { actor: true },
    orderBy: { createdAt: "asc" as const },
  },
};
