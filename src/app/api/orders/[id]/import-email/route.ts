import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { getHpMailboxAdapter } from "@/lib/adapters/hp-mailbox";
import { addStatusEvent, notifyStatusChange, orderInclude } from "@/lib/services/orders";
import type { OrderStatus } from "@/lib/types";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user || !["PROCUREMENT", "ADMIN"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();
  const { content, orderId: overrideOrderId } = body as {
    content: string;
    orderId?: string;
  };

  if (!content?.trim()) {
    return NextResponse.json({ error: "Email content required" }, { status: 400 });
  }

  const adapter = getHpMailboxAdapter();
  const parsed = adapter.parseEmail(content);

  let order = await prisma.order.findUnique({ where: { id: overrideOrderId ?? id } });

  if (!order && parsed.orderNumber) {
    order = await prisma.order.findFirst({
      where: { orderNumber: parsed.orderNumber },
    });
  }

  if (!order && parsed.hpOrderNumber) {
    order = await prisma.order.findFirst({
      where: { hpOrderNumber: parsed.hpOrderNumber },
    });
  }

  await prisma.inboundEmailRecord.create({
    data: {
      orderId: order?.id,
      rawContent: content,
      parsedOrderNumber: parsed.hpOrderNumber ?? parsed.orderNumber,
      parsedStatus: parsed.status,
      importedById: session.user.id,
    },
  });

  if (!order) {
    return NextResponse.json({
      parsed,
      message: "Email saved but no matching order found",
    });
  }

  if (parsed.hpOrderNumber && !order.hpOrderNumber) {
    await prisma.order.update({
      where: { id: order.id },
      data: { hpOrderNumber: parsed.hpOrderNumber },
    });
  }

  const comment = parsed.message;
  await addStatusEvent(order.id, order.status as OrderStatus, session.user.id, comment, {
    source: "hp_email_import",
    parsedStatus: parsed.status,
  });

  await notifyStatusChange(order.id, order.status as OrderStatus, order.orderNumber, order.officeId);

  const updated = await prisma.order.findUnique({
    where: { id: order.id },
    include: orderInclude,
  });

  return NextResponse.json({ parsed, order: updated });
}
