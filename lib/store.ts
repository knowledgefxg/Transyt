import fs from "fs/promises";
import path from "path";
import type { JobRecord } from "./types";
import { youtubeVideoId } from "./youtube";

const root = path.join(process.cwd(), "data", "jobs");

const globalState = globalThis as unknown as {
  __transyt?: { activeId: string | null; queue: { id: string; from: "start" | "translate" }[] };
};

function runtime() {
  if (!globalState.__transyt) globalState.__transyt = { activeId: null, queue: [] };
  return globalState.__transyt;
}

export function jobDir(id: string): string {
  if (!/^[a-f0-9]{16}$/.test(id)) throw new Error("任务编号不正确");
  return path.join(root, id);
}

export function isActiveJob(id: string): boolean {
  const state = runtime();
  return state.activeId === id || state.queue.some((item) => item.id === id);
}

export async function writeJob(job: JobRecord): Promise<void> {
  const dir = jobDir(job.id);
  await fs.mkdir(dir, { recursive: true });
  const target = path.join(dir, "job.json");
  const temp = `${target}.tmp`;
  await fs.writeFile(temp, JSON.stringify(job, null, 2));
  await fs.rename(temp, target);
}

export async function readJob(id: string): Promise<JobRecord> {
  const raw = await fs.readFile(path.join(jobDir(id), "job.json"), "utf8");
  return JSON.parse(raw) as JobRecord;
}

const chains = new Map<string, Promise<void>>();

export function updateJob(id: string, change: (job: JobRecord) => void): Promise<void> {
  const previous = chains.get(id) || Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      const job = await readJob(id);
      change(job);
      job.updatedAt = new Date().toISOString();
      await writeJob(job);
    });
  chains.set(id, next);
  return next;
}

export async function settleJob(job: JobRecord): Promise<JobRecord> {
  if ((job.status === "running" || job.status === "queued") && !isActiveJob(job.id)) {
    job.status = "error";
    job.error = job.error || "服务重启了，任务已中断。转写如果已经完成，可以继续翻译。";
    const active = job.stages.find((stage) => stage.status === "active");
    if (active) active.status = "error";
    job.updatedAt = new Date().toISOString();
    await writeJob(job);
  }
  return job;
}

export async function listJobs(): Promise<JobRecord[]> {
  try {
    const names = await fs.readdir(root);
    const jobs = await Promise.all(
      names.map(async (name) => {
        try {
          return await readJob(name);
        } catch {
          return null;
        }
      }),
    );
    const settled = await Promise.all(
      jobs.filter((job): job is JobRecord => Boolean(job)).map((job) => settleJob(job)),
    );
    return settled.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}

export function enqueueJob(id: string, from: "start" | "translate", run: (id: string, from: "start" | "translate") => Promise<void>) {
  const state = runtime();
  state.queue.push({ id, from });
  void drain(run);
}

export function dequeueJob(id: string): boolean {
  const state = runtime();
  if (state.activeId === id) return false;
  const before = state.queue.length;
  state.queue = state.queue.filter((item) => item.id !== id);
  return state.queue.length !== before;
}

async function drain(run: (id: string, from: "start" | "translate") => Promise<void>) {
  const state = runtime();
  if (state.activeId) return;
  const next = state.queue.shift();
  if (!next) return;
  state.activeId = next.id;
  try {
    await run(next.id, next.from);
  } finally {
    state.activeId = null;
    if (state.queue.length) void drain(run);
  }
}

export async function deleteJobGroup(id: string): Promise<void> {
  const job = await readJob(id);
  const key = youtubeVideoId(job.sourceUrl) || job.id;
  let names: string[] = [];
  try {
    names = await fs.readdir(root);
  } catch {
    names = [];
  }
  const related: JobRecord[] = [];
  for (const name of names) {
    try {
      const item = await readJob(name);
      if ((youtubeVideoId(item.sourceUrl) || item.id) === key) related.push(item);
    } catch {
      continue;
    }
  }
  if (related.some((item) => isActiveJob(item.id))) {
    throw new Error("这条视频还在处理，结束后再删");
  }
  const state = runtime();
  const ids = new Set(related.map((item) => item.id));
  state.queue = state.queue.filter((item) => !ids.has(item.id));
  await Promise.all([...ids].map((itemId) => fs.rm(jobDir(itemId), { recursive: true, force: true })));
}
