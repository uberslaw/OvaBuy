import type { CatalogCategory } from "@/lib/types";

export interface CatalogItemInput {
  category: CatalogCategory;
  brand: string;
  name: string;
  sku: string;
  unitCost: number;
  leadTimeDays: number;
}

export interface CatalogRefreshResult {
  itemCount: number;
  message: string;
}

export interface HpCatalogAdapter {
  refresh(): Promise<CatalogRefreshResult>;
}

export interface ParsedEmailUpdate {
  orderNumber?: string;
  hpOrderNumber?: string;
  status?: string;
  message: string;
}

export interface HpMailboxAdapter {
  parseEmail(content: string): ParsedEmailUpdate;
}

export interface ServiceNowRequest {
  orderId: string;
  orderNumber: string;
  office: string;
  total: number;
  urgent: boolean;
  businessCase: string;
}

export interface ServiceNowResult {
  reference: string;
  status: "STUB" | "SUCCESS" | "FAILED";
  message: string;
}

export interface ServiceNowAdapter {
  createRequest(request: ServiceNowRequest): Promise<ServiceNowResult>;
  updateRequest(reference: string, update: Record<string, unknown>): Promise<ServiceNowResult>;
}

export interface NotificationPayload {
  userId: string;
  orderId?: string;
  type: "ORDER_CREATED" | "STATUS_UPDATED" | "DELIVERY_UPDATED" | "BUDGET_WARNING" | "SYSTEM";
  message: string;
}

export interface NotificationAdapter {
  send(payload: NotificationPayload): Promise<void>;
  sendToRole(role: "CS" | "PROCUREMENT" | "ADMIN", payload: Omit<NotificationPayload, "userId">): Promise<void>;
}
