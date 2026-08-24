"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { BUSINESS_CASE_PRESETS, CATEGORY_LABELS } from "@/lib/constants";
import { formatCurrency } from "@/lib/utils";
import type { CatalogCategory } from "@/lib/types";
import { Plus, Trash2 } from "lucide-react";

interface CatalogItem {
  id: string;
  category: CatalogCategory;
  brand: string;
  name: string;
  sku: string;
  unitCost: number;
  leadTimeDays: number;
}

interface LineItemRow {
  catalogItemId: string;
  quantity: number;
}

const LAPTOP_SKUS = ["HP-EB840-G11", "HP-EB1040-G11", "HP-ZBP-G11", "HP-PB450-G11"];

export default function NewOrderPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [lineItems, setLineItems] = useState<LineItemRow[]>([{ catalogItemId: "", quantity: 1 }]);
  const [urgent, setUrgent] = useState(false);
  const [requiredDate, setRequiredDate] = useState("");
  const [businessCasePreset, setBusinessCasePreset] = useState("");
  const [businessCase, setBusinessCase] = useState("");
  const [jobNumber, setJobNumber] = useState("");
  const [costCentre, setCostCentre] = useState("");
  const [attachments, setAttachments] = useState<FileList | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
    if (status === "authenticated" && session?.user.role !== "CS") {
      router.push("/");
    }
  }, [status, session, router]);

  useEffect(() => {
    if (!session) return;
    fetch("/api/catalog")
      .then((r) => r.json())
      .then((d) => setCatalog(d.items ?? []));
    fetch("/api/notifications")
      .then((r) => r.json())
      .then((d) => setUnreadCount(d.unreadCount ?? 0));

    const minDate = new Date();
    minDate.setDate(minDate.getDate() + 7);
    setRequiredDate(minDate.toISOString().split("T")[0]);
  }, [session]);

  function addLineItem() {
    setLineItems([...lineItems, { catalogItemId: "", quantity: 1 }]);
  }

  function removeLineItem(index: number) {
    setLineItems(lineItems.filter((_, i) => i !== index));
  }

  function updateLineItem(index: number, field: keyof LineItemRow, value: string | number) {
    const updated = [...lineItems];
    updated[index] = { ...updated[index], [field]: value };
    setLineItems(updated);
  }

  function addLaptopPreset(sku: string) {
    const item = catalog.find((c) => c.sku === sku);
    if (!item) return;
    const emptyIndex = lineItems.findIndex((li) => !li.catalogItemId);
    if (emptyIndex >= 0) {
      updateLineItem(emptyIndex, "catalogItemId", item.id);
    } else {
      setLineItems([...lineItems, { catalogItemId: item.id, quantity: 1 }]);
    }
  }

  const selectedItems = lineItems
    .filter((li) => li.catalogItemId)
    .map((li) => {
      const item = catalog.find((c) => c.id === li.catalogItemId)!;
      return { ...li, item };
    });

  const total = selectedItems.reduce(
    (sum, li) => sum + li.quantity * (li.item?.unitCost ?? 0),
    0
  );

  const maxLeadTime = selectedItems.reduce(
    (max, li) => Math.max(max, li.item?.leadTimeDays ?? 0),
    0
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    const validItems = lineItems.filter((li) => li.catalogItemId && li.quantity > 0);
    if (validItems.length === 0) {
      setError("Add at least one hardware item");
      setSubmitting(false);
      return;
    }

    const formData = new FormData();
    formData.set("urgent", String(urgent));
    formData.set("requiredDate", requiredDate);
    formData.set("businessCase", businessCase);
    formData.set("businessCasePreset", businessCasePreset);
    formData.set("jobNumber", jobNumber);
    formData.set("costCentre", costCentre);
    formData.set("lineItems", JSON.stringify(validItems));

    if (attachments) {
      Array.from(attachments).forEach((file) => {
        formData.append("attachments", file);
      });
    }

    const res = await fetch("/api/orders", { method: "POST", body: formData });
    const data = await res.json();

    setSubmitting(false);

    if (!res.ok) {
      setError(data.error ?? "Failed to submit order");
      return;
    }

    router.push(`/orders/${data.order.id}`);
  }

  if (!session?.user) return null;

  return (
    <AppShell user={session.user} unreadCount={unreadCount}>
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">New hardware order</h1>
          <p className="text-slate-600">
            Office: <strong>{session.user.officeName}</strong>
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <Card>
            <CardHeader>
              <h2 className="text-lg font-semibold">Hardware items</h2>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="mb-2 text-sm text-slate-600">Quick add laptop models:</p>
                <div className="flex flex-wrap gap-2">
                  {LAPTOP_SKUS.map((sku) => {
                    const item = catalog.find((c) => c.sku === sku);
                    return (
                      <button
                        key={sku}
                        type="button"
                        onClick={() => addLaptopPreset(sku)}
                        className="rounded-md border border-slate-200 px-3 py-1 text-xs hover:bg-slate-50"
                        disabled={!item}
                      >
                        {item?.name.replace("HP ", "") ?? sku}
                      </button>
                    );
                  })}
                </div>
              </div>

              {lineItems.map((li, index) => (
                <div key={index} className="flex gap-3 items-end">
                  <div className="flex-1">
                    <Label>Item</Label>
                    <Select
                      className="mt-1"
                      value={li.catalogItemId}
                      onChange={(e) => updateLineItem(index, "catalogItemId", e.target.value)}
                      required={index === 0}
                    >
                      <option value="">Select hardware…</option>
                      {catalog.map((item) => (
                        <option key={item.id} value={item.id}>
                          [{CATEGORY_LABELS[item.category]}] {item.name} —{" "}
                          {formatCurrency(item.unitCost, "USD")} · {item.leadTimeDays}d
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="w-24">
                    <Label>Qty</Label>
                    <Input
                      className="mt-1"
                      type="number"
                      min={1}
                      value={li.quantity}
                      onChange={(e) =>
                        updateLineItem(index, "quantity", parseInt(e.target.value) || 1)
                      }
                    />
                  </div>
                  {lineItems.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeLineItem(index)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}

              <Button type="button" variant="outline" onClick={addLineItem}>
                <Plus className="h-4 w-4" />
                Add item
              </Button>

              {total > 0 && (
                <p className="text-sm font-medium text-slate-900">
                  Estimated total: {formatCurrency(total, "USD")}
                  {maxLeadTime > 0 && (
                    <span className="ml-2 font-normal text-slate-500">
                      · Longest lead time: {maxLeadTime} days
                    </span>
                  )}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="text-lg font-semibold">Request details</h2>
            </CardHeader>
            <CardContent className="space-y-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={urgent}
                  onChange={(e) => setUrgent(e.target.checked)}
                  className="rounded border-slate-300"
                />
                Urgent request
              </label>

              <div>
                <Label htmlFor="requiredDate">Required by</Label>
                <Input
                  id="requiredDate"
                  type="date"
                  className="mt-1"
                  value={requiredDate}
                  onChange={(e) => setRequiredDate(e.target.value)}
                  required
                />
              </div>

              <div>
                <Label htmlFor="preset">Business case preset</Label>
                <Select
                  id="preset"
                  className="mt-1"
                  value={businessCasePreset}
                  onChange={(e) => {
                    setBusinessCasePreset(e.target.value);
                    if (e.target.value !== "Other") setBusinessCase(e.target.value);
                  }}
                >
                  <option value="">Select preset…</option>
                  {BUSINESS_CASE_PRESETS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </Select>
              </div>

              <div>
                <Label htmlFor="businessCase">Business case</Label>
                <Textarea
                  id="businessCase"
                  className="mt-1"
                  value={businessCase}
                  onChange={(e) => setBusinessCase(e.target.value)}
                  required
                  placeholder="Explain why this hardware is needed…"
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="jobNumber">Job number</Label>
                  <Input
                    id="jobNumber"
                    className="mt-1"
                    value={jobNumber}
                    onChange={(e) => setJobNumber(e.target.value)}
                    placeholder="e.g. PRJ-2026-0142"
                  />
                </div>
                <div>
                  <Label htmlFor="costCentre">Cost centre</Label>
                  <Input
                    id="costCentre"
                    className="mt-1"
                    value={costCentre}
                    onChange={(e) => setCostCentre(e.target.value)}
                    placeholder="e.g. CC-APAC-CS-01"
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="attachments">Attachments</Label>
                <Input
                  id="attachments"
                  type="file"
                  className="mt-1"
                  multiple
                  accept=".pdf,.png,.jpg,.jpeg,.eml,.doc,.docx"
                  onChange={(e) => setAttachments(e.target.files)}
                />
                <p className="mt-1 text-xs text-slate-500">
                  Approvals, quotes, or supporting documents (PDF, images, EML)
                </p>
              </div>
            </CardContent>
          </Card>

          {error && (
            <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
          )}

          <div className="flex gap-3">
            <Button type="submit" disabled={submitting}>
              {submitting ? "Submitting…" : "Submit to Procurement"}
            </Button>
            <Button type="button" variant="outline" onClick={() => router.back()}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </AppShell>
  );
}
