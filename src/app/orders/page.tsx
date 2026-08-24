"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, EmptyState, StatusBadge } from "@/components/ui/card";
import { formatCurrency, formatDateOnly } from "@/lib/utils";
import type { OrderStatus } from "@/lib/types";

interface OrderRow {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  urgent: boolean;
  requiredDate: string;
  totalAmount: number;
  office: { name: string; currency: string };
  createdAt: string;
}

export default function OrdersPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
  }, [status, router]);

  useEffect(() => {
    if (!session) return;
    Promise.all([
      fetch("/api/orders").then((r) => r.json()),
      fetch("/api/notifications").then((r) => r.json()),
    ]).then(([ordersData, notifData]) => {
      setOrders(ordersData.orders ?? []);
      setUnreadCount(notifData.unreadCount ?? 0);
      setLoading(false);
    });
  }, [session]);

  if (!session?.user) return null;

  return (
    <AppShell user={session.user} unreadCount={unreadCount}>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Your orders</h1>
            <p className="text-slate-600">
              {session.user.officeName ?? "Office"} — track status from request to delivery
            </p>
          </div>
          <Link href="/orders/new">
            <Button>New order</Button>
          </Link>
        </div>

        {loading ? (
          <p className="text-center text-slate-500 py-12">Loading orders…</p>
        ) : orders.length === 0 ? (
          <EmptyState
            title="No orders yet"
            description="Submit your first hardware request to Procurement."
            action={
              <Link href="/orders/new">
                <Button>Create order</Button>
              </Link>
            }
          />
        ) : (
          <Card>
            <CardHeader>
              <h2 className="text-lg font-semibold">All orders</h2>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium text-slate-600">Order</th>
                      <th className="px-4 py-3 text-left font-medium text-slate-600">Created</th>
                      <th className="px-4 py-3 text-left font-medium text-slate-600">Required</th>
                      <th className="px-4 py-3 text-left font-medium text-slate-600">Total</th>
                      <th className="px-4 py-3 text-left font-medium text-slate-600">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {orders.map((order) => (
                      <tr key={order.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <Link
                            href={`/orders/${order.id}`}
                            className="font-medium text-indigo-600 hover:underline"
                          >
                            {order.orderNumber}
                          </Link>
                          {order.urgent && (
                            <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-700">
                              Urgent
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {formatDateOnly(order.createdAt)}
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {formatDateOnly(order.requiredDate)}
                        </td>
                        <td className="px-4 py-3 text-slate-900">
                          {formatCurrency(order.totalAmount, order.office.currency)}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={order.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
