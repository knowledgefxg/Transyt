import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { requestPause } from "@/lib/control";
import { dequeueJob, readJob, updateJob } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function killWorkers(id: string): Promise<void> {
  return new Promise((resolve) => {
    execFile("ps", ["-ax", "-o", "pid=,command="], (error, stdout) => {
      if (!error && stdout) {
        for (const line of stdout.split("\n")) {
          if (!line.includes(id)) continue;
          const pid = Number(line.trim().split(/\s+/)[0]);
          if (!pid || pid === process.pid) continue;
          try {
            process.kill(pid, "SIGTERM");
          } catch {
            // Already gone.
          }
        }
      }
      resolve();
    });
  });
}

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const job = await readJob(id);
    if (job.status !== "running" && job.status !== "queued") {
      return NextResponse.json({ error: "现在没有在处理" }, { status: 409 });
    }
    const waiting = dequeueJob(id);
    requestPause(id);
    await killWorkers(id);
    if (waiting) {
      await updateJob(id, (record) => {
        record.status = "paused";
        record.error = undefined;
      });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "没有这个任务" }, { status: 404 });
  }
}
