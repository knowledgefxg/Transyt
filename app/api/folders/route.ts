import { NextResponse } from "next/server";
import { createFolder, listFolders } from "@/lib/folders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await listFolders());
}

export async function POST(request: Request) {
  let name = "";
  try {
    const body = (await request.json()) as { name?: string };
    name = String(body.name || "").trim();
  } catch {
    name = "";
  }
  if (!name) return NextResponse.json({ error: "先写个收藏夹名字" }, { status: 400 });
  return NextResponse.json(await createFolder(name));
}
