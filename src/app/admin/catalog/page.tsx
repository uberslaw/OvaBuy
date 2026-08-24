"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";
import { RefreshCw } from "lucide-react";

interface RefreshLog {
  id: string;
  requestedAt: string;
  itemCount: number;
  status: string;
  message?: string | null;
  requestedBy: { name: string; email: string };
}

export default function AdminCatalogPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [logs, setLogs] = useState<RefreshLog[]>([]);
  const [guard, setGuard] = useState<{
    allowed: boolean;
    nextRefreshAt?: string;
    lastRefresh?: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [unreadCount, setUnreadCount] = useState(0);
  const [countdown, setCountdown] = useState("");

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
    if (status === "authenticated" && session?.user.role !== "ADMIN") {
      router.push("/");
    }
  }, [status, session, router]);

  useEffect(() => {
    if (!session) return;
    loadData();
  }, [session]);

  useEffect(() => {
    if (!guard?.nextRefreshAt) {
      setCountdown("");
      return;
    }

    const interval = setInterval(() => {
      const diff = new Date(guard.nextRefreshAt!).getTime() - Date.now();
      if (diff <= 0) {
        setCountdown("");
        loadData();
        clearInterval(interval);
        return;
      }
      const hours = Math.floor(diff / 3600000);
      const mins = Math.floor((diff % 3600000) / 60000);
      setCountdown(`${hours}h ${mins}m`);
    }, 1000);

    return () => clearInterval(interval);
  }, [guard?.nextRefreshAt]);

  async function loadData() {
    const [refreshRes, notifRes] = await Promise.all([
      fetch("/api/catalog/refresh"),
      fetch("/api/notifications"),
    ]);
    const data = await refreshRes.json();
    const notifData = await notifRes.json();
    setLogs(data.logs ?? []);
    setGuard(data.guard ?? null);
    setUnreadCount(notifData.unreadCount ?? 0);
  }

  async function handleRefresh() {
    setLoading(true);
    setError("");
    setMessage("");

    const res = await fetch("/api/catalog/refresh", { method: "POST" });
    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      setError(data.error ?? "Refresh failed");
      return;
    }

    setMessage(data.message ?? `Refreshed ${data.itemCount} items`);
    loadData();
  }

  if (!session?.user) return null;

  return (
    <AppShell user={session.user} unreadCount={unreadCount}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Catalog administration</h1>
          <p className="text-slate-600">
            Refresh hardware pricing and lead times — limited to once per 24 hours globally
          </p>
        </div>

        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold">Catalog refresh</h2>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-slate-600">
              {guard?.allowed
                ? "Refresh is available. PoC uses seed data; production will call HP API."
                : `Next refresh available in ${countdown || "…"}`}
            </p>

            {message && (
              <div className="rounded-md bg-green-50 px-4 py-3 text-sm text-green-700">
                {message}
              </div>
            )}
            {error && (
              <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
            )}

            <Button onClick={handleRefresh} disabled={loading || !guard?.allowed}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              {loading ? "Refreshing…" : "Refresh catalog now"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold">Refresh history</h2>
          </CardHeader>
          <CardContent>
            {logs.length === 0 ? (
              <p className="text-sm text-slate-500">No refresh history yet.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {logs.map((log) => (
                  <div key={log.id} className="py-3 text-sm">
                    <div className="flex justify-between">
                      <span className="font-medium">{formatDate(log.requestedAt)}</span>
                      <span className="text-slate-500">{log.itemCount} items</span>
                    </div>
                    <p className="text-slate-600">
                      {log.requestedBy.name} — {log.message ?? log.status}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
