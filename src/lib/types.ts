export type UserRole = "CS" | "PROCUREMENT" | "ADMIN";

export type OrderStatus =
  | "REQUESTED"
  | "PENDING_APPROVAL"
  | "APPROVED_UNORDERED"
  | "APPROVED_ORDERED"
  | "PARTIALLY_DELIVERED"
  | "DELIVERED"
  | "REJECTED";

export type CatalogCategory =
  | "LAPTOP"
  | "MONITOR"
  | "HEADSET"
  | "KEYBOARD"
  | "MOUSE"
  | "CABLE"
  | "POWERPACK"
  | "OTHER";

export type NotificationType =
  | "ORDER_CREATED"
  | "STATUS_UPDATED"
  | "DELIVERY_UPDATED"
  | "BUDGET_WARNING"
  | "SYSTEM";

export type IntegrationStatus = "STUB" | "SUCCESS" | "FAILED";
