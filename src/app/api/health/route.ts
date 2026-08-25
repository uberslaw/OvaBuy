import { readFileSync } from "fs";
import { join } from "path";

export async function GET() {
  let version = "0.0.0";
  try {
    const pkg = JSON.parse(
      readFileSync(join(process.cwd(), "package.json"), "utf8"),
    ) as { version?: string };
    version = pkg.version ?? version;
  } catch {
    /* package.json unreadable during early setup */
  }

  return Response.json({
    ok: true,
    version,
    productVersion: `OvaBuy ${version}`,
  });
}
