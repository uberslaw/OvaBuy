import Link from "next/link";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/card";
import { formatCurrency, formatDateOnly } from "@/lib/utils";
import type { OrderStatus } from "@/lib/types";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const unreadCount = await prisma.notification.count({
    where: { userId: session.user.id, readAt: null },
  });

  const role = session.user.role;

  if (role === "CS" && session.user.officeId) {
    const office = await prisma.office.findUnique({
      where: { id: session.user.officeId },
    });

    const orders = await prisma.order.findMany({
      where: { officeId: session.user.officeId },
      orderBy: { createdAt: "desc" },
      take: 5,
    });

    const openOrders = orders.filter((o) => !["DELIVERED", "REJECTED"].includes(o.status)).length;

    return (
      <AppShell user={session.user} unreadCount={unreadCount}>
        <div className="space-y-8">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
            <p className="text-slate-600">
              {office?.name} office · Track and submit hardware orders
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-slate-500">Open orders</p>
                <p className="text-3xl font-bold text-slate-900">{openOrders}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-slate-500">Budget available</p>
                <p className="text-3xl font-bold text-slate-900">
                  {office
                    ? formatCurrency(
                        office.budgetTotal - office.budgetSpent - office.budgetReserved,
                        office.currency
                      )
                    : "—"}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6 flex flex-col justify-between h-full">
                <p className="text-sm text-slate-500">Quick action</p>
                <Link href="/orders/new" className="mt-2">
                  <Button className="w-full">New hardware order</Button>
                </Link>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Recent orders</h2>
                <Link href="/orders" className="text-sm text-indigo-600 hover:underline">
                  View all
                </Link>
              </div>
            </CardHeader>
            <CardContent>
              {orders.length === 0 ? (
                <p className="text-sm text-slate-500">No orders yet. Create your first order.</p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {orders.map((order) => (
                    <Link
                      key={order.id}
                      href={`/orders/${order.id}`}
                      className="flex items-center justify-between py-3 hover:bg-slate-50 -mx-2 px-2 rounded-md"
                    >
                      <div>
                        <p className="font-medium text-slate-900">{order.orderNumber}</p>
                        <p className="text-xs text-slate-500">
                          Required {formatDateOnly(order.requiredDate)}
                          {order.urgent && " · Urgent"}
                        </p>
                      </div>
                      <StatusBadge status={order.status as OrderStatus} />
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </AppShell>
    );
  }

  if (role === "PROCUREMENT" || role === "ADMIN") {
    const [requested, pending, ordered, offices] = await Promise.all([
      prisma.order.count({ where: { status: "REQUESTED" } }),
      prisma.order.count({ where: { status: "PENDING_APPROVAL" } }),
      prisma.order.count({ where: { status: "APPROVED_ORDERED" } }),
      prisma.office.findMany({ orderBy: { name: "asc" } }),
    ]);

    const recentOrders = await prisma.order.findMany({
      include: { office: true },
      orderBy: [{ urgent: "desc" }, { requiredDate: "asc" }],
      take: 8,
    });

    return (
      <AppShell user={session.user} unreadCount={unreadCount}>
        <div className="space-y-8">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Procurement dashboard</h1>
            <p className="text-slate-600">Review orders across APAC offices</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-slate-500">New requests</p>
                <p className="text-3xl font-bold text-amber-600">{requested}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-slate-500">Pending approval</p>
                <p className="text-3xl font-bold text-orange-600">{pending}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-slate-500">Awaiting delivery</p>
                <p className="text-3xl font-bold text-purple-600">{ordered}</p>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold">Order queue</h2>
                  <Link href="/procurement" className="text-sm text-indigo-600 hover:underline">
                    Open queue
                  </Link>
                </div>
              </CardHeader>
              <CardContent>
                <div className="divide-y divide-slate-100">
                  {recentOrders.map((order) => (
                    <Link
                      key={order.id}
                      href={`/orders/${order.id}`}
                      className="flex items-center justify-between py-3 hover:bg-slate-50 -mx-2 px-2 rounded-md"
                    >
                      <div>
                        <p className="font-medium text-slate-900">{order.orderNumber}</p>
                        <p className="text-xs text-slate-500">
                          {order.office.name} · {formatDateOnly(order.requiredDate)}
                        </p>
                      </div>
                      <StatusBadge status={order.status as OrderStatus} />
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <h2 className="text-lg font-semibold">Office budgets</h2>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {offices.map((office) => {
                    const available =
                      office.budgetTotal - office.budgetSpent - office.budgetReserved;
                    const pct = office.budgetTotal
                      ? ((office.budgetSpent + office.budgetReserved) / office.budgetTotal) * 100
                      : 0;
                    return (
                      <div key={office.id}>
                        <div className="flex justify-between text-sm">
                          <span className="font-medium">{office.name}</span>
                          <span className="text-slate-500">
                            {formatCurrency(available, office.currency)} left
                          </span>
                        </div>
                        <div className="mt-1 h-2 rounded-full bg-slate-100">
                          <div
                            className="h-2 rounded-full bg-indigo-500"
                            style={{ width: `${Math.min(pct, 100)}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </AppShell>
    );
  }

  redirect("/login");
}
