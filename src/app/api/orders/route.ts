import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import {
  addStatusEvent,
  checkBudget,
  computeOrderTotal,
  createServiceNowStub,
  generateOrderNumber,
  orderInclude,
  reserveBudget,
} from "@/lib/services/orders";
import { getNotificationAdapter } from "@/lib/adapters/notifications";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const officeId = searchParams.get("officeId");

  const where =
    session.user.role === "CS"
      ? {
          officeId: session.user.officeId ?? undefined,
          ...(status ? { status: status as never } : {}),
        }
      : {
          ...(officeId ? { officeId } : {}),
          ...(status ? { status: status as never } : {}),
        };

  const orders = await prisma.order.findMany({
    where,
    include: {
      office: true,
      createdBy: { select: { name: true, email: true } },
      lineItems: { include: { catalogItem: true } },
    },
    orderBy: [{ urgent: "desc" }, { requiredDate: "asc" }, { createdAt: "desc" }],
  });

  return NextResponse.json({ orders });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role !== "CS" || !session.user.officeId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const formData = await req.formData();

  const urgent = formData.get("urgent") === "true";
  const requiredDate = String(formData.get("requiredDate") ?? "");
  const businessCase = String(formData.get("businessCase") ?? "");
  const businessCasePreset = String(formData.get("businessCasePreset") ?? "") || null;
  const jobNumber = String(formData.get("jobNumber") ?? "") || null;
  const costCentre = String(formData.get("costCentre") ?? "") || null;
  const lineItemsRaw = String(formData.get("lineItems") ?? "[]");

  let lineItems: Array<{ catalogItemId: string; quantity: number }>;
  try {
    lineItems = JSON.parse(lineItemsRaw);
  } catch {
    return NextResponse.json({ error: "Invalid line items" }, { status: 400 });
  }

  if (!requiredDate || !businessCase || lineItems.length === 0) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const catalogItems = await prisma.catalogItem.findMany({
    where: { id: { in: lineItems.map((l) => l.catalogItemId) }, isActive: true },
  });

  if (catalogItems.length !== lineItems.length) {
    return NextResponse.json({ error: "Invalid catalog items" }, { status: 400 });
  }

  const pricedItems = lineItems.map((li) => {
    const item = catalogItems.find((c) => c.id === li.catalogItemId)!;
    return {
      catalogItemId: li.catalogItemId,
      quantity: li.quantity,
      unitCostAtOrder: item.unitCost,
    };
  });

  const totalAmount = computeOrderTotal(
    pricedItems.map((p) => ({ quantity: p.quantity, unitCost: p.unitCostAtOrder }))
  );

  const budgetCheck = await checkBudget(session.user.officeId, totalAmount);
  if (!budgetCheck.ok) {
    return NextResponse.json({ error: budgetCheck.message }, { status: 400 });
  }

  const orderNumber = await generateOrderNumber();

  const order = await prisma.$transaction(async (tx) => {
    const created = await tx.order.create({
      data: {
        orderNumber,
        officeId: session.user.officeId!,
        createdById: session.user.id,
        status: "REQUESTED",
        urgent,
        requiredDate: new Date(requiredDate),
        businessCase,
        businessCasePreset,
        jobNumber,
        costCentre,
        totalAmount,
        lineItems: {
          create: pricedItems,
        },
      },
      include: orderInclude,
    });

    await addStatusEvent(created.id, "REQUESTED", session.user.id, "Order submitted by Client Services");

    await reserveBudget(session.user.officeId!, totalAmount);

    return created;
  });

  const uploadDir = path.join(process.cwd(), "uploads", order.id);
  await mkdir(uploadDir, { recursive: true });

  const files = formData.getAll("attachments");
  for (const file of files) {
    if (!(file instanceof File) || file.size === 0) continue;
    const buffer = Buffer.from(await file.arrayBuffer());
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const filePath = path.join(uploadDir, safeName);
    await writeFile(filePath, buffer);
    await prisma.orderAttachment.create({
      data: {
        orderId: order.id,
        filename: file.name,
        path: filePath,
        uploadedById: session.user.id,
      },
    });
  }

  const notifications = getNotificationAdapter();
  await notifications.sendToRole("PROCUREMENT", {
    orderId: order.id,
    type: "ORDER_CREATED",
    message: `New ${urgent ? "URGENT " : ""}order ${orderNumber} from ${order.office.name} — ${order.office.currency} ${totalAmount.toFixed(0)}`,
  });

  const snResult = await createServiceNowStub(order.id);

  const refreshed = await prisma.order.findUnique({
    where: { id: order.id },
    include: orderInclude,
  });

  return NextResponse.json({
    order: refreshed,
    servicenow: snResult,
  });
}
