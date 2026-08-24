"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, EmptyState } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";

interface Notification {
  id: string;
  type: string;
  message: string;
  readAt?: string | null;
  createdAt: string;
  orderId?: string | null;
  order?: { id: string; orderNumber: string } | null;
}

export default function NotificationsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
  }, [status, router]);

  useEffect(() => {
    if (!session) return;
    loadNotifications();
  }, [session]);

  async function loadNotifications() {
    const res = await fetch("/api/notifications");
    const data = await res.json();
    setNotifications(data.notifications ?? []);
    setLoading(false);
  }

  async function markAllRead() {
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markAll: true }),
    });
    loadNotifications();
  }

  if (!session?.user) return null;

  const unreadCount = notifications.filter((n) => !n.readAt).length;

  return (
    <AppShell user={session.user} unreadCount={unreadCount}>
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Notifications</h1>
            <p className="text-slate-600">{unreadCount} unread</p>
          </div>
          {unreadCount > 0 && (
            <Button variant="outline" onClick={markAllRead}>
              Mark all read
            </Button>
          )}
        </div>

        {loading ? (
          <p className="text-center text-slate-500 py-12">Loading…</p>
        ) : notifications.length === 0 ? (
          <EmptyState
            title="No notifications"
            description="You'll be notified when orders are created or status changes."
          />
        ) : (
          <Card>
            <CardHeader>
              <h2 className="text-lg font-semibold">Recent</h2>
            </CardHeader>
            <CardContent className="divide-y divide-slate-100 p-0">
              {notifications.map((n) => (
                <div
                  key={n.id}
                  className={`px-6 py-4 ${!n.readAt ? "bg-indigo-50/50" : ""}`}
                >
                  <p className="text-sm text-slate-900">{n.message}</p>
                  <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                    <time>{formatDate(n.createdAt)}</time>
                    {n.order && (
                      <>
                        <span>·</span>
                        <Link
                          href={`/orders/${n.order.id}`}
                          className="text-indigo-600 hover:underline"
                        >
                          {n.order.orderNumber}
                        </Link>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
