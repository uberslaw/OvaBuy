import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { refreshCatalog, canRefreshCatalog } from "@/lib/adapters/hp-catalog";
import { prisma } from "@/lib/db";

export async function GET() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const guard = await canRefreshCatalog();
  const logs = await prisma.catalogRefreshLog.findMany({
      orderBy: { requestedAt: "desc" },
    take: 20,
    include: { requestedBy: { select: { name: true, email: true } } },
  });

  return NextResponse.json({ guard, logs });
}

export async function POST() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const result = await refreshCatalog(session.user.id);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Refresh failed" },
      { status: 429 }
    );
  }
}
