import { NextResponse } from "next/server";
import { readJob, settleJob, deleteJobGroup, updateJob } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const job = await settleJob(await readJob(id));
    return NextResponse.json(job);
  } catch {
    return NextResponse.json({ error: "没有这个任务" }, { status: 404 });
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  let folderId = "";
  try {
    const body = (await request.json()) as { folderId?: string };
    folderId = String(body.folderId || "");
  } catch {
    return NextResponse.json({ error: "没有要改的内容" }, { status: 400 });
  }
  try {
    await readJob(id);
  } catch {
    return NextResponse.json({ error: "没有这个任务" }, { status: 404 });
  }
  await updateJob(id, (job) => {
    job.folderId = folderId;
  });
  return NextResponse.json(await readJob(id));
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    await deleteJobGroup(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "没有删掉";
    const status = message.includes("还在处理") ? 409 : message.includes("ENOENT") ? 404 : 400;
    return NextResponse.json({ error: message === "任务编号不正确" ? "没有这个任务" : message }, { status });
  }
}
