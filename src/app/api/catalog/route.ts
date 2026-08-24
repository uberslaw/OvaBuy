import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import type { CatalogCategory } from "@/lib/types";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const category = searchParams.get("category");
  const brand = searchParams.get("brand");
  const search = searchParams.get("search");

  const items = await prisma.catalogItem.findMany({
    where: {
      isActive: true,
      ...(category && category !== "ALL"
        ? { category: category as CatalogCategory }
        : {}),
      ...(brand && brand !== "ALL" ? { brand } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search } },
              { sku: { contains: search } },
              { brand: { contains: search } },
            ],
          }
        : {}),
    },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });

  const brands = await prisma.catalogItem.findMany({
    where: { isActive: true },
    select: { brand: true },
    distinct: ["brand"],
    orderBy: { brand: "asc" },
  });

  const lastRefresh = await prisma.catalogRefreshLog.findFirst({
    where: { status: "success" },
    orderBy: { requestedAt: "desc" },
  });

  return NextResponse.json({
    items,
    brands: brands.map((b) => b.brand),
    lastRefreshedAt: lastRefresh?.requestedAt ?? null,
  });
}
