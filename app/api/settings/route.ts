import { NextResponse } from "next/server";
import { readSettings, toPublicSettings, writeSettings } from "@/lib/settings";
import type { Settings } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(toPublicSettings(await readSettings()));
}

export async function POST(request: Request) {
  const body = (await request.json()) as Partial<Settings>;
  const saved = await writeSettings({
    apiBase: typeof body.apiBase === "string" ? body.apiBase : undefined,
    apiKey: typeof body.apiKey === "string" ? body.apiKey : undefined,
    model: typeof body.model === "string" ? body.model : undefined,
    proxy: typeof body.proxy === "string" ? body.proxy : undefined,
    cnSize: body.cnSize,
    enSize: body.enSize,
    cnColor: typeof body.cnColor === "string" ? body.cnColor : undefined,
    enColor: typeof body.enColor === "string" ? body.enColor : undefined,
    subtitleOrder: body.subtitleOrder,
  });
  return NextResponse.json(toPublicSettings(saved));
}
