"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useParams } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { OrderTimeline } from "@/components/order-timeline";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, StatusBadge } from "@/components/ui/card";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { ORDER_STATUS_LABELS, VALID_STATUS_TRANSITIONS } from "@/lib/constants";
import { formatCurrency, formatDate, formatDateOnly } from "@/lib/utils";
import type { OrderStatus } from "@/lib/types";

interface OrderDetail {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  urgent: boolean;
  requiredDate: string;
  businessCase: string;
  businessCasePreset?: string | null;
  jobNumber?: string | null;
  costCentre?: string | null;
  hpOrderNumber?: string | null;
  servicenowRef?: string | null;
  totalAmount: number;
  createdAt: string;
  office: { name: string; currency: string };
  createdBy: { name: string; email: string };
  lineItems: Array<{
    id: string;
    quantity: number;
    deliveredQuantity: number;
    unitCostAtOrder: number;
    catalogItem: { name: string; sku: string };
  }>;
  attachments: Array<{ id: string; filename: string }>;
  statusEvents: Array<{
    id: string;
    status: OrderStatus;
    comment?: string | null;
    createdAt: string;
    actor: { name: string; role: string };
  }>;
}

export default function OrderDetailPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const params = useParams();
  const orderId = params.id as string;

  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  const [error, setError] = useState("");

  const [newStatus, setNewStatus] = useState<OrderStatus | "">("");
  const [comment, setComment] = useState("");
  const [hpOrderNumber, setHpOrderNumber] = useState("");
  const [emailContent, setEmailContent] = useState("");
  const [deliveryQtys, setDeliveryQtys] = useState<Record<string, number>>({});
  const [actionLoading, setActionLoading] = useState(false);

  const loadOrder = useCallback(async () => {
    const [orderRes, notifRes] = await Promise.all([
      fetch(`/api/orders/${orderId}`),
      fetch("/api/notifications"),
    ]);
    const orderData = await orderRes.json();
    const notifData = await notifRes.json();

    if (!orderRes.ok) {
      setError(orderData.error ?? "Failed to load order");
      setLoading(false);
      return;
    }

    setOrder(orderData.order);
    setHpOrderNumber(orderData.order.hpOrderNumber ?? "");
    const qtys: Record<string, number> = {};
    orderData.order.lineItems.forEach(
      (li: { id: string; deliveredQuantity: number }) => {
        qtys[li.id] = li.deliveredQuantity;
      }
    );
    setDeliveryQtys(qtys);
    setUnreadCount(notifData.unreadCount ?? 0);
    setLoading(false);
  }, [orderId]);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
  }, [status, router]);

  useEffect(() => {
    if (session) loadOrder();
  }, [session, loadOrder]);

  async function handleStatusUpdate(e: React.FormEvent) {
    e.preventDefault();
    if (!newStatus || !comment.trim()) return;
    setActionLoading(true);

    const res = await fetch(`/api/orders/${orderId}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus, comment, hpOrderNumber }),
    });

    const data = await res.json();
    setActionLoading(false);

    if (!res.ok) {
      setError(data.error ?? "Failed to update status");
      return;
    }

    setOrder(data.order);
    setComment("");
    setNewStatus("");
    setError("");
  }

  async function handleEmailImport(e: React.FormEvent) {
    e.preventDefault();
    if (!emailContent.trim()) return;
    setActionLoading(true);

    const res = await fetch(`/api/orders/${orderId}/import-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: emailContent }),
    });

    const data = await res.json();
    setActionLoading(false);

    if (!res.ok) {
      setError(data.error ?? "Failed to import email");
      return;
    }

    if (data.order) setOrder(data.order);
    setEmailContent("");
    loadOrder();
  }

  async function handleDelivery(mode: "partial" | "full") {
    setActionLoading(true);

    const lineItems =
      mode === "full"
        ? undefined
        : order!.lineItems.map((li) => ({
            id: li.id,
            deliveredQuantity: deliveryQtys[li.id] ?? 0,
          }));

    const res = await fetch(`/api/orders/${orderId}/delivery`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode, lineItems }),
    });

    const data = await res.json();
    setActionLoading(false);

    if (!res.ok) {
      setError(data.error ?? "Failed to update delivery");
      return;
    }

    setOrder(data.order);
    loadOrder();
  }

  if (!session?.user) return null;

  if (loading) {
    return (
      <AppShell user={session.user} unreadCount={unreadCount}>
        <p className="text-center text-slate-500 py-12">Loading order…</p>
      </AppShell>
    );
  }

  if (!order) {
    return (
      <AppShell user={session.user} unreadCount={unreadCount}>
        <p className="text-center text-red-600 py-12">{error || "Order not found"}</p>
      </AppShell>
    );
  }

  const isProcurement = ["PROCUREMENT", "ADMIN"].includes(session.user.role);
  const isCS = session.user.role === "CS";
  const allowedTransitions = VALID_STATUS_TRANSITIONS[order.status] ?? [];

  return (
    <AppShell user={session.user} unreadCount={unreadCount}>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-slate-900">{order.orderNumber}</h1>
              <StatusBadge status={order.status} />
              {order.urgent && (
                <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                  Urgent
                </span>
              )}
            </div>
            <p className="mt-1 text-slate-600">
              {order.office.name} · Submitted {formatDate(order.createdAt)} by{" "}
              {order.createdBy.name}
            </p>
          </div>
          <div className="text-right text-sm">
            <p className="font-semibold text-slate-900">
              {formatCurrency(order.totalAmount, order.office.currency)}
            </p>
            <p className="text-slate-500">Required {formatDateOnly(order.requiredDate)}</p>
          </div>
        </div>

        {order.servicenowRef && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            ServiceNow reference (stub): {order.servicenowRef} — API not configured
          </div>
        )}

        {error && (
          <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-6">
            <OrderTimeline events={order.statusEvents} />

            <Card>
              <CardHeader>
                <h2 className="text-lg font-semibold">Line items</h2>
              </CardHeader>
              <CardContent>
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-slate-500">
                      <th className="pb-2">Item</th>
                      <th className="pb-2">Ordered</th>
                      <th className="pb-2">Delivered</th>
                      <th className="pb-2 text-right">Cost</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {order.lineItems.map((li) => (
                      <tr key={li.id}>
                        <td className="py-2">
                          <p className="font-medium">{li.catalogItem.name}</p>
                          <p className="text-xs text-slate-500">{li.catalogItem.sku}</p>
                        </td>
                        <td className="py-2">{li.quantity}</td>
                        <td className="py-2">
                          {isCS &&
                          ["APPROVED_ORDERED", "PARTIALLY_DELIVERED"].includes(order.status) ? (
                            <Input
                              type="number"
                              min={0}
                              max={li.quantity}
                              className="w-20"
                              value={deliveryQtys[li.id] ?? 0}
                              onChange={(e) =>
                                setDeliveryQtys({
                                  ...deliveryQtys,
                                  [li.id]: parseInt(e.target.value) || 0,
                                })
                              }
                            />
                          ) : (
                            `${li.deliveredQuantity} / ${li.quantity}`
                          )}
                        </td>
                        <td className="py-2 text-right">
                          {formatCurrency(li.unitCostAtOrder * li.quantity, order.office.currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <h2 className="text-lg font-semibold">Details</h2>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div>
                  <p className="text-slate-500">Business case</p>
                  <p className="text-slate-900">{order.businessCase}</p>
                </div>
                {order.businessCasePreset && (
                  <div>
                    <p className="text-slate-500">Preset</p>
                    <p>{order.businessCasePreset}</p>
                  </div>
                )}
                {order.jobNumber && (
                  <div>
                    <p className="text-slate-500">Job number</p>
                    <p>{order.jobNumber}</p>
                  </div>
                )}
                {order.costCentre && (
                  <div>
                    <p className="text-slate-500">Cost centre</p>
                    <p>{order.costCentre}</p>
                  </div>
                )}
                {order.hpOrderNumber && (
                  <div>
                    <p className="text-slate-500">HP order number</p>
                    <p className="font-mono">{order.hpOrderNumber}</p>
                  </div>
                )}
                {order.attachments.length > 0 && (
                  <div>
                    <p className="text-slate-500 mb-1">Attachments</p>
                    <ul className="space-y-1">
                      {order.attachments.map((a) => (
                        <li key={a.id} className="text-indigo-600">
                          {a.filename}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>

            {isProcurement && allowedTransitions.length > 0 && (
              <Card>
                <CardHeader>
                  <h2 className="text-lg font-semibold">Update status</h2>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleStatusUpdate} className="space-y-3">
                    <div>
                      <Label>New status</Label>
                      <Select
                        className="mt-1"
                        value={newStatus}
                        onChange={(e) => setNewStatus(e.target.value as OrderStatus)}
                        required
                      >
                        <option value="">Select…</option>
                        {order.status === "REQUESTED" && (
                          <option value="PENDING_APPROVAL">Mark as reviewing</option>
                        )}
                        {allowedTransitions.map((s) => (
                          <option key={s} value={s}>
                            {ORDER_STATUS_LABELS[s]}
                          </option>
                        ))}
                      </Select>
                    </div>
                    {newStatus === "APPROVED_ORDERED" && (
                      <div>
                        <Label>HP order number</Label>
                        <Input
                          className="mt-1"
                          value={hpOrderNumber}
                          onChange={(e) => setHpOrderNumber(e.target.value)}
                          placeholder="HP-12345678"
                          required
                        />
                      </div>
                    )}
                    <div>
                      <Label>Comment (required)</Label>
                      <Textarea
                        className="mt-1"
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        required
                        placeholder="Add context for Client Services…"
                      />
                    </div>
                    <Button type="submit" className="w-full" disabled={actionLoading}>
                      Update order
                    </Button>
                  </form>
                </CardContent>
              </Card>
            )}

            {isProcurement && (
              <Card>
                <CardHeader>
                  <h2 className="text-lg font-semibold">Import HP email</h2>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleEmailImport} className="space-y-3">
                    <Textarea
                      value={emailContent}
                      onChange={(e) => setEmailContent(e.target.value)}
                      placeholder="Paste HP order confirmation or shipping email…"
                      rows={5}
                    />
                    <Button type="submit" variant="outline" className="w-full" disabled={actionLoading}>
                      Import update
                    </Button>
                  </form>
                </CardContent>
              </Card>
            )}

            {isCS && ["APPROVED_ORDERED", "PARTIALLY_DELIVERED"].includes(order.status) && (
              <Card>
                <CardHeader>
                  <h2 className="text-lg font-semibold">Mark delivery</h2>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => handleDelivery("partial")}
                    disabled={actionLoading}
                  >
                    Save partial delivery
                  </Button>
                  <Button
                    className="w-full"
                    onClick={() => handleDelivery("full")}
                    disabled={actionLoading}
                  >
                    Mark fully delivered
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
