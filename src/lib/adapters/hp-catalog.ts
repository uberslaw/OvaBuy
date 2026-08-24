import { readFileSync } from "fs";
import path from "path";
import type { CatalogCategory } from "@/lib/types";
import { prisma } from "@/lib/db";
import type { CatalogItemInput, CatalogRefreshResult, HpCatalogAdapter } from "./types";

function loadSeedItems(): CatalogItemInput[] {
  const filePath = path.join(process.cwd(), "data", "catalog-seed.json");
  const raw = readFileSync(filePath, "utf-8");
  return JSON.parse(raw) as CatalogItemInput[];
}

export class SeedHpCatalogAdapter implements HpCatalogAdapter {
  async refresh(): Promise<CatalogRefreshResult> {
    const items = loadSeedItems();
    const now = new Date();

    for (const item of items) {
      await prisma.catalogItem.upsert({
        where: { sku: item.sku },
        create: {
          ...item,
          category: item.category as CatalogCategory,
          source: "seed",
          lastRefreshedAt: now,
        },
        update: {
          category: item.category as CatalogCategory,
          brand: item.brand,
          name: item.name,
          unitCost: item.unitCost,
          leadTimeDays: item.leadTimeDays,
          isActive: true,
          source: "seed",
          lastRefreshedAt: now,
        },
      });
    }

    const skus = items.map((i) => i.sku);
    await prisma.catalogItem.updateMany({
      where: { sku: { notIn: skus } },
      data: { isActive: false },
    });

    return {
      itemCount: items.length,
      message: `Refreshed ${items.length} catalog items from seed data (HP API not configured).`,
    };
  }
}

export class ApiHpCatalogAdapter implements HpCatalogAdapter {
  async refresh(): Promise<CatalogRefreshResult> {
    if (process.env.HP_API_ENABLED !== "true") {
      return new SeedHpCatalogAdapter().refresh();
    }

    throw new Error("HP API integration not yet implemented.");
  }
}

export function getHpCatalogAdapter(): HpCatalogAdapter {
  return process.env.HP_API_ENABLED === "true"
    ? new ApiHpCatalogAdapter()
    : new SeedHpCatalogAdapter();
}

export async function canRefreshCatalog(): Promise<{
  allowed: boolean;
  nextRefreshAt?: Date;
  lastRefresh?: Date;
}> {
  const last = await prisma.catalogRefreshLog.findFirst({
    where: { status: "success" },
    orderBy: { requestedAt: "desc" },
  });

  if (!last) return { allowed: true };

  const nextRefreshAt = new Date(last.requestedAt.getTime() + 24 * 60 * 60 * 1000);
  const allowed = Date.now() >= nextRefreshAt.getTime();

  return {
    allowed,
    nextRefreshAt: allowed ? undefined : nextRefreshAt,
    lastRefresh: last.requestedAt,
  };
}

export async function refreshCatalog(userId: string): Promise<CatalogRefreshResult> {
  const guard = await canRefreshCatalog();
  if (!guard.allowed) {
    throw new Error(
      `Catalog refresh limited to once per 24 hours. Next refresh at ${guard.nextRefreshAt?.toISOString()}`
    );
  }

  const adapter = getHpCatalogAdapter();
  const result = await adapter.refresh();

  await prisma.catalogRefreshLog.create({
    data: {
      requestedById: userId,
      itemCount: result.itemCount,
      status: "success",
      message: result.message,
    },
  });

  return result;
}
