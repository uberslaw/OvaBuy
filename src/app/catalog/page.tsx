"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, EmptyState } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { CATEGORY_LABELS } from "@/lib/constants";
import { formatCurrency, formatDateOnly } from "@/lib/utils";
import type { CatalogCategory } from "@/lib/types";
import { RefreshCw } from "lucide-react";

interface CatalogItem {
  id: string;
  category: CatalogCategory;
  brand: string;
  name: string;
  sku: string;
  unitCost: number;
  leadTimeDays: number;
  lastRefreshedAt: string;
}

export default function CatalogPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [brands, setBrands] = useState<string[]>([]);
  const [category, setCategory] = useState("ALL");
  const [brand, setBrand] = useState("ALL");
  const [search, setSearch] = useState("");
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
  }, [status, router]);

  useEffect(() => {
    if (!session) return;
    loadCatalog();
    fetch("/api/notifications")
      .then((r) => r.json())
      .then((d) => setUnreadCount(d.unreadCount ?? 0));
  }, [session, category, brand, search]);

  async function loadCatalog() {
    setLoading(true);
    const params = new URLSearchParams();
    if (category !== "ALL") params.set("category", category);
    if (brand !== "ALL") params.set("brand", brand);
    if (search) params.set("search", search);

    const res = await fetch(`/api/catalog?${params}`);
    const data = await res.json();
    setItems(data.items ?? []);
    setBrands(data.brands ?? []);
    setLastRefreshedAt(data.lastRefreshedAt);
    setLoading(false);
  }

  if (!session?.user) return null;

  return (
    <AppShell user={session.user} unreadCount={unreadCount}>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Hardware catalog</h1>
            <p className="text-slate-600">
              Browse HP laptops and peripherals — cost and lead time
              {lastRefreshedAt && (
                <span className="ml-1 text-slate-400">
                  · Last refreshed {formatDateOnly(lastRefreshedAt)}
                </span>
              )}
            </p>
          </div>
          {session.user.role === "ADMIN" && (
            <Button variant="outline" onClick={() => router.push("/admin/catalog")}>
              <RefreshCw className="h-4 w-4" />
              Manage refresh
            </Button>
          )}
        </div>

        <Card>
          <CardContent className="pt-6">
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <Label>Category</Label>
                <Select
                  className="mt-1"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  <option value="ALL">All categories</option>
                  {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label>Brand</Label>
                <Select
                  className="mt-1"
                  value={brand}
                  onChange={(e) => setBrand(e.target.value)}
                >
                  <option value="ALL">All brands</option>
                  {brands.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label>Search</Label>
                <Input
                  className="mt-1"
                  placeholder="Name or SKU…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {loading ? (
          <p className="text-center text-slate-500 py-12">Loading catalog…</p>
        ) : items.length === 0 ? (
          <EmptyState
            title="No items found"
            description="Try adjusting your filters or ask an admin to refresh the catalog."
          />
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-slate-600">Item</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600">SKU</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600">Category</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600">Brand</th>
                  <th className="px-4 py-3 text-right font-medium text-slate-600">Cost</th>
                  <th className="px-4 py-3 text-right font-medium text-slate-600">Lead time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-900">{item.name}</td>
                    <td className="px-4 py-3 text-slate-600">{item.sku}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {CATEGORY_LABELS[item.category]}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{item.brand}</td>
                    <td className="px-4 py-3 text-right text-slate-900">
                      {formatCurrency(item.unitCost, "USD")}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-600">
                      {item.leadTimeDays} days
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}
