import type { HpMailboxAdapter, ParsedEmailUpdate } from "./types";

export class PasteHpMailboxAdapter implements HpMailboxAdapter {
  parseEmail(content: string): ParsedEmailUpdate {
    const normalized = content.replace(/\r\n/g, "\n");

    const hpOrderMatch =
      normalized.match(/HP\s*Order\s*(?:Number|#|No\.?)\s*[:\s]*([A-Z0-9-]+)/i) ||
      normalized.match(/Order\s*(?:Number|#|No\.?)\s*[:\s]*([A-Z0-9-]+)/i);

    const ovabuyOrderMatch = normalized.match(/OvaBuy\s*(?:Order|Ref)\s*[:\s]*([A-Z0-9-]+)/i);

    const statusKeywords: Array<{ pattern: RegExp; status: string }> = [
      { pattern: /shipped|dispatched|in transit/i, status: "Shipped" },
      { pattern: /delivered|delivery complete/i, status: "Delivered" },
      { pattern: /confirmed|order received|acknowledged/i, status: "Confirmed" },
      { pattern: /processing|being prepared/i, status: "Processing" },
      { pattern: /cancelled|canceled/i, status: "Cancelled" },
      { pattern: /back[\s-]?order|delayed/i, status: "Delayed" },
    ];

    let status: string | undefined;
    for (const { pattern, status: s } of statusKeywords) {
      if (pattern.test(normalized)) {
        status = s;
        break;
      }
    }

    const parts: string[] = [];
    if (hpOrderMatch) parts.push(`HP order ${hpOrderMatch[1]}`);
    if (ovabuyOrderMatch) parts.push(`OvaBuy ref ${ovabuyOrderMatch[1]}`);
    if (status) parts.push(`status: ${status}`);

    return {
      orderNumber: ovabuyOrderMatch?.[1],
      hpOrderNumber: hpOrderMatch?.[1],
      status,
      message: parts.length
        ? `Email import: ${parts.join(", ")}`
        : "Email imported — no structured fields detected",
    };
  }
}

export function getHpMailboxAdapter(): HpMailboxAdapter {
  return new PasteHpMailboxAdapter();
}
