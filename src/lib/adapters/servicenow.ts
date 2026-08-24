import { prisma } from "@/lib/db";
import type {
  ServiceNowAdapter,
  ServiceNowRequest,
  ServiceNowResult,
} from "./types";

function generateStubReference(): string {
  const num = Math.floor(100000 + Math.random() * 900000);
  return `INC${num}`;
}

export class StubServiceNowAdapter implements ServiceNowAdapter {
  async createRequest(request: ServiceNowRequest): Promise<ServiceNowResult> {
    const reference = generateStubReference();

    await prisma.externalIntegrationLog.create({
      data: {
        orderId: request.orderId,
        adapter: "servicenow",
        action: "create_request",
        payload: JSON.stringify(request),
        response: JSON.stringify({ sys_id: reference, status: "stub" }),
        status: "STUB",
      },
    });

    return {
      reference,
      status: "STUB",
      message: `ServiceNow ticket would be created: ${reference} (API not configured)`,
    };
  }

  async updateRequest(
    reference: string,
    update: Record<string, unknown>
  ): Promise<ServiceNowResult> {
    await prisma.externalIntegrationLog.create({
      data: {
        adapter: "servicenow",
        action: "update_request",
        payload: JSON.stringify({ reference, update }),
        response: JSON.stringify({ status: "stub" }),
        status: "STUB",
      },
    });

    return {
      reference,
      status: "STUB",
      message: `ServiceNow ticket ${reference} would be updated (API not configured)`,
    };
  }
}

export function getServiceNowAdapter(): ServiceNowAdapter {
  if (process.env.SERVICENOW_API_ENABLED === "true") {
    // Future: return real adapter
  }
  return new StubServiceNowAdapter();
}
