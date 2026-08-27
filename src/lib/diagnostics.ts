import { existsSync } from "fs";
import { join } from "path";

const FLAG_PATH = join(process.cwd(), "logs", "diagnostics.enabled");

export function isDiagnosticsEnabled(): boolean {
  try {
    return existsSync(FLAG_PATH);
  } catch {
    return false;
  }
}

export function logDiagnostic(message: string, detail?: Record<string, unknown>) {
  if (!isDiagnosticsEnabled()) return;
  const payload = detail ? ` ${JSON.stringify(detail)}` : "";
  console.log(`[OvaBuy diagnostics] ${message}${payload}`);
}
