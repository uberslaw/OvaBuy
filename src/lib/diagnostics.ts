import { existsSync } from "fs";
import { join } from "path";

const FLAG_RELATIVE = join("OvaBuy", "logs", "diagnostics.enabled");

export function isDiagnosticsEnabled(): boolean {
  const base = process.env.LOCALAPPDATA;
  if (!base) return false;
  try {
    return existsSync(join(base, FLAG_RELATIVE));
  } catch {
    return false;
  }
}

export function logDiagnostic(message: string, detail?: Record<string, unknown>) {
  if (!isDiagnosticsEnabled()) return;
  const payload = detail ? ` ${JSON.stringify(detail)}` : "";
  console.log(`[OvaBuy diagnostics] ${message}${payload}`);
}
