export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({
    service: "ventneuf-os-web",
    status: "ok",
    timestamp: new Date().toISOString(),
  });
}
