import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { readFileSync } from "fs";
import path from "path";

const prisma = new PrismaClient();

async function main() {
  const password = await bcrypt.hash("demo123", 10);

  const offices = [
    { name: "Singapore", currency: "SGD", budgetTotal: 150000 },
    { name: "Sydney", currency: "AUD", budgetTotal: 120000 },
    { name: "Melbourne", currency: "AUD", budgetTotal: 80000 },
    { name: "Tokyo", currency: "JPY", budgetTotal: 12000000 },
    { name: "Hong Kong", currency: "HKD", budgetTotal: 900000 },
    { name: "Mumbai", currency: "INR", budgetTotal: 6000000 },
    { name: "Seoul", currency: "KRW", budgetTotal: 100000000 },
  ];

  for (const office of offices) {
    await prisma.office.upsert({
      where: { name: office.name },
      create: { ...office, region: "APAC" },
      update: { budgetTotal: office.budgetTotal, currency: office.currency },
    });
  }

  const sgOffice = await prisma.office.findUniqueOrThrow({ where: { name: "Singapore" } });
  const sydOffice = await prisma.office.findUniqueOrThrow({ where: { name: "Sydney" } });

  const users = [
    {
      email: "cs.singapore@demo.local",
      name: "Alex Tan",
      role: "CS",
      officeId: sgOffice.id,
    },
    {
      email: "cs.sydney@demo.local",
      name: "Jordan Lee",
      role: "CS",
      officeId: sydOffice.id,
    },
    {
      email: "procurement@demo.local",
      name: "Sam Procurement",
      role: "PROCUREMENT",
      officeId: null,
    },
    {
      email: "admin@demo.local",
      name: "Admin User",
      role: "ADMIN",
      officeId: null,
    },
  ];

  for (const user of users) {
    await prisma.user.upsert({
      where: { email: user.email },
      create: { ...user, password },
      update: { name: user.name, role: user.role, officeId: user.officeId, password },
    });
  }

  const catalogPath = path.join(process.cwd(), "data", "catalog-seed.json");
  const catalogItems = JSON.parse(readFileSync(catalogPath, "utf-8")) as Array<{
    category: string;
    brand: string;
    name: string;
    sku: string;
    unitCost: number;
    leadTimeDays: number;
  }>;

  for (const item of catalogItems) {
    await prisma.catalogItem.upsert({
      where: { sku: item.sku },
      create: {
        category: item.category,
        brand: item.brand,
        name: item.name,
        sku: item.sku,
        unitCost: item.unitCost,
        leadTimeDays: item.leadTimeDays,
        source: "seed",
      },
      update: {
        category: item.category,
        brand: item.brand,
        name: item.name,
        unitCost: item.unitCost,
        leadTimeDays: item.leadTimeDays,
        isActive: true,
      },
    });
  }

  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@demo.local" } });
  const existingLog = await prisma.catalogRefreshLog.findFirst();
  if (!existingLog) {
    await prisma.catalogRefreshLog.create({
      data: {
        requestedById: admin.id,
        itemCount: catalogItems.length,
        status: "success",
        message: "Initial seed import",
      },
    });
  }

  console.log("Seed completed.");
  console.log("Demo accounts (password: demo123):");
  users.forEach((u) => console.log(`  ${u.email} (${u.role})`));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
