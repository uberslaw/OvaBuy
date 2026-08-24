import { NextRequest, NextResponse } from "next/server";
import type { OrderStatus } from "@/lib/types";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import {
  addStatusEvent,
  assertStatusTransition,
  commitBudget,
  notifyStatusChange,
  orderInclude,
  releaseBudget,
} from "@/lib/services/orders";
import { getServiceNowAdapter } from "@/lib/adapters/servicenow";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user || !["PROCUREMENT", "ADMIN"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();
  const { status, comment, hpOrderNumber } = body as {
    status: OrderStatus;
    comment: string;
    hpOrderNumber?: string;
  };

  if (!status || !comment?.trim()) {
    return NextResponse.json(
      { error: "Status and comment are required" },
      { status: 400 }
    );
  }

  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    assertStatusTransition(order.status as OrderStatus, status);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid transition" },
      { status: 400 }
    );
  }

  if (status === "APPROVED_ORDERED" && order.status !== "APPROVED_ORDERED" && !hpOrderNumber?.trim()) {
    return NextResponse.json(
      { error: "HP order number is required when marking as ordered" },
      { status: 400 }
    );
  }

  if (order.status === "REQUESTED" && status !== "REJECTED") {
    // First procurement touch moves to pending approval if still requested
  }

  const nextStatus =
    order.status === "REQUESTED" &&
    ["APPROVED_UNORDERED", "PENDING_APPROVAL"].includes(status)
      ? status === "PENDING_APPROVAL"
        ? "PENDING_APPROVAL"
        : "APPROVED_UNORDERED"
      : status;

  await prisma.$transaction(async () => {
    if (order.status === "REQUESTED" && nextStatus === "APPROVED_UNORDERED") {
      await addStatusEvent(id, "PENDING_APPROVAL", session.user.id, "Procurement reviewing order");
    }

    if (nextStatus === "REJECTED") {
      await releaseBudget(order.officeId, order.totalAmount);
    }

    if (nextStatus === "APPROVED_ORDERED" && order.status !== "APPROVED_ORDERED") {
      await commitBudget(order.officeId, order.totalAmount);
    }

    await prisma.order.update({
      where: { id },
      data: {
        status: nextStatus,
        ...(hpOrderNumber ? { hpOrderNumber: hpOrderNumber.trim() } : {}),
      },
    });

    await addStatusEvent(id, nextStatus, session.user.id, comment.trim(), {
      hpOrderNumber: hpOrderNumber ?? undefined,
    });
  });

  if (order.servicenowRef) {
    const sn = getServiceNowAdapter();
    await sn.updateRequest(order.servicenowRef, { status: nextStatus, comment });
  }

  await notifyStatusChange(id, nextStatus, order.orderNumber, order.officeId);

  const updated = await prisma.order.findUnique({
    where: { id },
    include: orderInclude,
  });

  return NextResponse.json({ order: updated });
}
