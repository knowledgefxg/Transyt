import { NextResponse } from "next/server";
import { clearPause } from "@/lib/control";
import { runPipeline } from "@/lib/pipeline";
import { enqueueJob, isActiveJob, readJob } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const job = await readJob(id);
    if (job.status === "running" || isActiveJob(id)) {
      return NextResponse.json({ error: "这个任务还在跑" }, { status: 409 });
    }
    if (job.status === "paused") {
      clearPause(id);
      enqueueJob(id, "start", runPipeline);
      return NextResponse.json({ ok: true });
    }
    if (!job.canResume) {
      return NextResponse.json({ error: "还没有可继续的转写结果" }, { status: 400 });
    }
    enqueueJob(id, "translate", runPipeline);
    return NextResponse.json(await readJob(id));
  } catch {
    return NextResponse.json({ error: "没有这个任务" }, { status: 404 });
  }
}
