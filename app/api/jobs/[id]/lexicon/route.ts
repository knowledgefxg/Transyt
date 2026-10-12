import fs from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { attachCueTimes, extractLexicon, levelSpan, type Lexeme } from "@/lib/lexicon";
import { readSettings } from "@/lib/settings";
import { jobDir, readJob, updateJob } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function readCues(dir: string): Promise<{ start?: number; text?: string }[]> {
  try {
    return JSON.parse(await fs.readFile(path.join(dir, "cues.json"), "utf8")) as { start?: number; text?: string }[];
  } catch {
    return [];
  }
}

function storedItems(raw: unknown): { from?: string; to?: string; items: Lexeme[] } | null {
  if (Array.isArray(raw)) return { items: raw as Lexeme[] };
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as { items?: unknown }).items)) return null;
  const record = raw as { from?: string; to?: string; items: Lexeme[] };
  return { from: record.from, to: record.to, items: record.items };
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  let dir: string;
  try {
    dir = jobDir(id);
  } catch {
    return NextResponse.json({ error: "没有这个任务" }, { status: 404 });
  }
  try {
    const stored = storedItems(JSON.parse(await fs.readFile(path.join(dir, "lexicon.json"), "utf8")));
    if (!stored) return NextResponse.json({ error: "还没有词汇" }, { status: 404 });
    const items = attachCueTimes(stored.items, await readCues(dir));
    return NextResponse.json({ items, from: stored.from, to: stored.to });
  } catch {
    return NextResponse.json({ error: "还没有词汇" }, { status: 404 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const force = new URL(request.url).searchParams.get("force") === "1";
  let body: { from?: string; to?: string } = {};
  try {
    body = (await request.json()) as { from?: string; to?: string };
  } catch {
    body = {};
  }
  const span = levelSpan(body.from || "A1", body.to || "C2");
  const from = span[0];
  const to = span[span.length - 1];
  let dir: string;
  try {
    dir = jobDir(id);
    await readJob(id);
  } catch {
    return NextResponse.json({ error: "没有这个任务" }, { status: 404 });
  }

  const file = path.join(dir, "lexicon.json");
  if (!force) {
    try {
      const cached = JSON.parse(await fs.readFile(file, "utf8")) as { from?: string; to?: string; version?: number; items?: Lexeme[] } | Lexeme[];
      const items = Array.isArray(cached) ? cached : cached.items;
      const cachedFrom = Array.isArray(cached) ? "A1" : cached.from;
      const cachedTo = Array.isArray(cached) ? "C2" : cached.to;
      const version = Array.isArray(cached) ? 0 : cached.version;
      if (version === 4 && Array.isArray(items) && cachedFrom === from && cachedTo === to) {
        return NextResponse.json({ items: attachCueTimes(items, await readCues(dir)), from, to });
      }
    } catch {
      // 还没有提取过。
    }
  }

  const cues = await readCues(dir);
  if (!cues.length) return NextResponse.json({ error: "还没有文稿" }, { status: 400 });
  const transcript = cues.map((cue) => cue.text || "").filter(Boolean).join("\n");
  try {
    const settings = await readSettings();
    const items = attachCueTimes(await extractLexicon(transcript, settings, { from, to }), cues);
    await fs.writeFile(file, JSON.stringify({ from, to, version: 4, items }, null, 2));
    await updateJob(id, (job) => {
      if (!job.outputs.includes("lexicon.json")) job.outputs.push("lexicon.json");
    });
    return NextResponse.json({ items, from, to });
  } catch (error) {
    const message = error instanceof Error ? error.message : "没有提取出来";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
