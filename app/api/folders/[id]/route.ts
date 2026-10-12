import { NextResponse } from "next/server";
import { removeFolder, renameFolder } from "@/lib/folders";
import { listJobs, updateJob } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  let name = "";
  try {
    const body = (await request.json()) as { name?: string };
    name = String(body.name || "").trim();
  } catch {
    name = "";
  }
  if (!name) return NextResponse.json({ error: "名字不能空着" }, { status: 400 });
  const folder = await renameFolder(id, name);
  if (!folder) return NextResponse.json({ error: "没有这个收藏夹" }, { status: 404 });
  return NextResponse.json(folder);
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const jobs = await listJobs();
  await Promise.all(
    jobs.filter((job) => job.folderId === id).map((job) => updateJob(job.id, (record) => {
      record.folderId = "";
    })),
  );
  await removeFolder(id);
  return NextResponse.json({ ok: true });
}
