"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, EmptyState, StatusBadge } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { formatCurrency, formatDateOnly } from "@/lib/utils";
import type { OrderStatus } from "@/lib/types";

interface OrderRow {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  urgent: boolean;
  requiredDate: string;
  totalAmount: number;
  office: { id: string; name: string; currency: string };
}

interface Office {
  id: string;
  name: string;
}

export default function ProcurementPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [offices, setOffices] = useState<Office[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [officeFilter, setOfficeFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
    if (status === "authenticated" && !["PROCUREMENT", "ADMIN"].includes(session?.user.role ?? "")) {
      router.push("/");
    }
  }, [status, session, router]);

  useEffect(() => {
    if (!session) return;
    loadData();
  }, [session, statusFilter, officeFilter]);

  async function loadData() {
    setLoading(true);
    const params = new URLSearchParams();
    if (statusFilter) params.set("status", statusFilter);
    if (officeFilter) params.set("officeId", officeFilter);

    const [ordersRes, budgetsRes, notifRes] = await Promise.all([
      fetch(`/api/orders?${params}`),
      fetch("/api/admin/budgets"),
      fetch("/api/notifications"),
    ]);

    const ordersData = await ordersRes.json();
    const budgetsData = await budgetsRes.json();
    const notifData = await notifRes.json();

    setOrders(ordersData.orders ?? []);
    setOffices(
      (budgetsData.offices ?? []).map((o: Office) => ({ id: o.id, name: o.name }))
    );
    setUnreadCount(notifData.unreadCount ?? 0);
    setLoading(false);
  }

  if (!session?.user) return null;

  return (
    <AppShell user={session.user} unreadCount={unreadCount}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Procurement queue</h1>
          <p className="text-slate-600">All APAC offices — review and update order status</p>
        </div>

        <Card>
          <CardContent className="pt-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>Filter by status</Label>
                <Select
                  className="mt-1"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                >
                  <option value="">All statuses</option>
                  <option value="REQUESTED">Requested</option>
                  <option value="PENDING_APPROVAL">Pending approval</option>
                  <option value="APPROVED_UNORDERED">Approved / Unordered</option>
                  <option value="APPROVED_ORDERED">Approved / Ordered</option>
                  <option value="PARTIALLY_DELIVERED">Partially delivered</option>
                  <option value="DELIVERED">Delivered</option>
                  <option value="REJECTED">Rejected</option>
                </Select>
              </div>
              <div>
                <Label>Filter by office</Label>
                <Select
                  className="mt-1"
                  value={officeFilter}
                  onChange={(e) => setOfficeFilter(e.target.value)}
                >
                  <option value="">All offices</option>
                  {offices.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {loading ? (
          <p className="text-center text-slate-500 py-12">Loading queue…</p>
        ) : orders.length === 0 ? (
          <EmptyState
            title="No orders in queue"
            description="Orders will appear here when Client Services submits requests."
          />
        ) : (
          <Card>
            <CardHeader>
              <h2 className="text-lg font-semibold">{orders.length} orders</h2>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium text-slate-600">Order</th>
                      <th className="px-4 py-3 text-left font-medium text-slate-600">Office</th>
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
                        <td className="px-4 py-3 text-slate-600">{order.office.name}</td>
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
