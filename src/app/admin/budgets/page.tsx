"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { formatCurrency } from "@/lib/utils";

interface Office {
  id: string;
  name: string;
  currency: string;
  budgetTotal: number;
  budgetReserved: number;
  budgetSpent: number;
}

export default function AdminBudgetsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [offices, setOffices] = useState<Office[]>([]);
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [unreadCount, setUnreadCount] = useState(0);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
    if (status === "authenticated" && session?.user.role !== "ADMIN") {
      router.push("/");
    }
  }, [status, session, router]);

  useEffect(() => {
    if (!session) return;
    loadOffices();
  }, [session]);

  async function loadOffices() {
    const [budgetsRes, notifRes] = await Promise.all([
      fetch("/api/admin/budgets"),
      fetch("/api/notifications"),
    ]);
    const data = await budgetsRes.json();
    const notifData = await notifRes.json();
    setOffices(data.offices ?? []);
    setUnreadCount(notifData.unreadCount ?? 0);
  }

  async function saveBudget(officeId: string) {
    const budgetTotal = parseFloat(editing[officeId]);
    if (isNaN(budgetTotal) || budgetTotal < 0) return;

    const res = await fetch("/api/admin/budgets", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ officeId, budgetTotal, reason: "Admin UI update" }),
    });

    if (res.ok) {
      setMessage("Budget updated");
      loadOffices();
      setTimeout(() => setMessage(""), 3000);
    }
  }

  if (!session?.user) return null;

  return (
    <AppShell user={session.user} unreadCount={unreadCount}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Office budgets</h1>
          <p className="text-slate-600">Manage APAC office hardware budgets</p>
        </div>

        {message && (
          <div className="rounded-md bg-green-50 px-4 py-3 text-sm text-green-700">{message}</div>
        )}

        <div className="grid gap-4">
          {offices.map((office) => {
            const available =
              office.budgetTotal - office.budgetSpent - office.budgetReserved;
            const usedPct = office.budgetTotal
              ? ((office.budgetSpent + office.budgetReserved) / office.budgetTotal) * 100
              : 0;

            return (
              <Card key={office.id}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-semibold">{office.name}</h2>
                    <span className="text-sm text-slate-500">{office.currency}</span>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-4 text-sm">
                    <div>
                      <p className="text-slate-500">Total budget</p>
                      <p className="font-semibold">
                        {formatCurrency(office.budgetTotal, office.currency)}
                      </p>
                    </div>
                    <div>
                      <p className="text-slate-500">Spent</p>
                      <p>{formatCurrency(office.budgetSpent, office.currency)}</p>
                    </div>
                    <div>
                      <p className="text-slate-500">Reserved</p>
                      <p>{formatCurrency(office.budgetReserved, office.currency)}</p>
                    </div>
                    <div>
                      <p className="text-slate-500">Available</p>
                      <p className="font-semibold text-green-700">
                        {formatCurrency(available, office.currency)}
                      </p>
                    </div>
                  </div>

                  <div className="h-2 rounded-full bg-slate-100">
                    <div
                      className="h-2 rounded-full bg-indigo-500"
                      style={{ width: `${Math.min(usedPct, 100)}%` }}
                    />
                  </div>

                  <div className="flex gap-3 items-end">
                    <div className="flex-1">
                      <Label>Update total budget</Label>
                      <Input
                        className="mt-1"
                        type="number"
                        placeholder={String(office.budgetTotal)}
                        value={editing[office.id] ?? ""}
                        onChange={(e) =>
                          setEditing({ ...editing, [office.id]: e.target.value })
                        }
                      />
                    </div>
                    <Button onClick={() => saveBudget(office.id)}>Save</Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
}
