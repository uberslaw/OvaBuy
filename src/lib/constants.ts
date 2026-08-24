import type { OrderStatus, CatalogCategory } from "@/lib/types";

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  REQUESTED: "Requested",
  PENDING_APPROVAL: "Pending Approval",
  APPROVED_UNORDERED: "Approved / Unordered",
  APPROVED_ORDERED: "Approved / Ordered",
  PARTIALLY_DELIVERED: "Partially Delivered",
  DELIVERED: "Delivered",
  REJECTED: "Rejected",
};

export const ORDER_STATUS_COLORS: Record<OrderStatus, string> = {
  REQUESTED: "bg-amber-100 text-amber-800 border-amber-200",
  PENDING_APPROVAL: "bg-orange-100 text-orange-800 border-orange-200",
  APPROVED_UNORDERED: "bg-blue-100 text-blue-800 border-blue-200",
  APPROVED_ORDERED: "bg-purple-100 text-purple-800 border-purple-200",
  PARTIALLY_DELIVERED: "bg-cyan-100 text-cyan-800 border-cyan-200",
  DELIVERED: "bg-green-100 text-green-800 border-green-200",
  REJECTED: "bg-red-100 text-red-800 border-red-200",
};

export const CATEGORY_LABELS: Record<CatalogCategory, string> = {
  LAPTOP: "Laptop",
  MONITOR: "Monitor",
  HEADSET: "Headset",
  KEYBOARD: "Keyboard",
  MOUSE: "Mouse",
  CABLE: "Cable",
  POWERPACK: "Power Pack",
  OTHER: "Other",
};

export const BUSINESS_CASE_PRESETS = [
  "New hire",
  "Replacement",
  "Project rollout",
  "Break/fix",
  "Other",
] as const;

export const CATALOG_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

export const VALID_STATUS_TRANSITIONS: Partial<Record<OrderStatus, OrderStatus[]>> = {
  REQUESTED: ["PENDING_APPROVAL", "REJECTED"],
  PENDING_APPROVAL: ["APPROVED_UNORDERED", "REJECTED"],
  APPROVED_UNORDERED: ["APPROVED_ORDERED", "REJECTED"],
  APPROVED_ORDERED: ["PARTIALLY_DELIVERED", "DELIVERED"],
  PARTIALLY_DELIVERED: ["DELIVERED"],
};
