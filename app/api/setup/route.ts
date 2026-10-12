import { NextResponse } from "next/server";
import { setupState, startSetup } from "@/lib/setup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(setupState());
}

export async function POST() {
  return NextResponse.json(startSetup());
}
