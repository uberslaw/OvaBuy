import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export async function GET() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const offices = await prisma.office.findMany({
    orderBy: { name: "asc" },
  });

  return NextResponse.json({ offices });
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { officeId, budgetTotal, reason } = body as {
    officeId: string;
    budgetTotal: number;
    reason?: string;
  };

  if (!officeId || budgetTotal == null || budgetTotal < 0) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const office = await prisma.office.findUnique({ where: { id: officeId } });
  if (!office) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.$transaction([
    prisma.budgetAdjustment.create({
      data: {
        officeId,
        previousTotal: office.budgetTotal,
        newTotal: budgetTotal,
        reason: reason ?? "Admin adjustment",
        adjustedById: session.user.id,
      },
    }),
    prisma.office.update({
      where: { id: officeId },
      data: { budgetTotal },
    }),
  ]);

  const updated = await prisma.office.findUnique({ where: { id: officeId } });
  return NextResponse.json({ office: updated });
}
