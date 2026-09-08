import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

let version: Promise<string> | undefined;

function releaseVersion() {
  return version ??= readFile(join(process.cwd(), ".next", "BUILD_ID"), "utf8")
    .then((value) => value.trim())
    .catch(() => process.env.AWS_COMMIT_ID?.trim() || "development");
}

export async function GET() {
  return NextResponse.json({ version: await releaseVersion() }, {
    headers: { "cache-control": "no-store, max-age=0" },
  });
}
