import { NextRequest, NextResponse } from "next/server";
import type { OrderStatus } from "@/lib/types";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import {
  addStatusEvent,
  notifyStatusChange,
  orderInclude,
} from "@/lib/services/orders";
import { getNotificationAdapter } from "@/lib/adapters/notifications";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user || session.user.role !== "CS") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();
  const { mode, lineItems, comment } = body as {
    mode: "partial" | "full";
    lineItems?: Array<{ id: string; deliveredQuantity: number }>;
    comment?: string;
  };

  const order = await prisma.order.findUnique({
    where: { id },
    include: { lineItems: true, office: true },
  });

  if (!order) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (order.officeId !== session.user.officeId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!["APPROVED_ORDERED", "PARTIALLY_DELIVERED"].includes(order.status)) {
    return NextResponse.json(
      { error: "Order must be ordered before marking delivery" },
      { status: 400 }
    );
  }

  if (mode === "partial") {
    if (!lineItems?.length) {
      return NextResponse.json({ error: "Line items required" }, { status: 400 });
    }

    for (const li of lineItems) {
      const existing = order.lineItems.find((l) => l.id === li.id);
      if (!existing) continue;
      if (li.deliveredQuantity < 0 || li.deliveredQuantity > existing.quantity) {
        return NextResponse.json({ error: "Invalid delivered quantity" }, { status: 400 });
      }
      await prisma.orderLineItem.update({
        where: { id: li.id },
        data: { deliveredQuantity: li.deliveredQuantity },
      });
    }
  } else {
    for (const li of order.lineItems) {
      await prisma.orderLineItem.update({
        where: { id: li.id },
        data: { deliveredQuantity: li.quantity },
      });
    }
  }

  const updatedLineItems = await prisma.orderLineItem.findMany({ where: { orderId: id } });
  const allDelivered = updatedLineItems.every((li) => li.deliveredQuantity >= li.quantity);
  const anyDelivered = updatedLineItems.some((li) => li.deliveredQuantity > 0);

  let nextStatus: OrderStatus = order.status as OrderStatus;
  if (allDelivered) {
    nextStatus = "DELIVERED";
  } else if (anyDelivered) {
    nextStatus = "PARTIALLY_DELIVERED";
  }

  if (nextStatus !== order.status) {
    await prisma.order.update({ where: { id }, data: { status: nextStatus } });
    await addStatusEvent(
      id,
      nextStatus,
      session.user.id,
      comment?.trim() ||
        (mode === "full" ? "All items marked as delivered" : "Partial delivery updated")
    );
    await notifyStatusChange(id, nextStatus, order.orderNumber, order.officeId);
  }

  const notifications = getNotificationAdapter();
  await notifications.sendToRole("PROCUREMENT", {
    orderId: id,
    type: "DELIVERY_UPDATED",
    message: `Delivery updated for order ${order.orderNumber}`,
  });

  const updated = await prisma.order.findUnique({
    where: { id },
    include: orderInclude,
  });

  return NextResponse.json({ order: updated });
}
