import fs from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { jobDir } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SavedSentence = { start: number; end: number; zh: string; en: string };
type SavedWord = { text: string; zh: string; ipa: string; level: string; kind: string; source: string; start?: number };
type Saved = { sentences: SavedSentence[]; words: SavedWord[] };

const empty = (): Saved => ({ sentences: [], words: [] });

async function readSaved(dir: string): Promise<Saved> {
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(dir, "saved.json"), "utf8")) as Saved;
    return {
      sentences: Array.isArray(parsed.sentences) ? parsed.sentences : [],
      words: Array.isArray(parsed.words) ? parsed.words : [],
    };
  } catch {
    return empty();
  }
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    return NextResponse.json(await readSaved(jobDir(id)));
  } catch {
    return NextResponse.json({ error: "没有这个任务" }, { status: 404 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  let dir: string;
  try {
    dir = jobDir(id);
  } catch {
    return NextResponse.json({ error: "没有这个任务" }, { status: 404 });
  }
  const body = (await request.json()) as { type?: string; item?: SavedSentence & SavedWord };
  const saved = await readSaved(dir);
  if (body.type === "sentence" && body.item) {
    const item = body.item;
    const index = saved.sentences.findIndex((row) => row.start === item.start && row.zh === item.zh);
    if (index >= 0) saved.sentences.splice(index, 1);
    else saved.sentences.unshift({ start: item.start, end: item.end, zh: item.zh, en: item.en || "" });
  } else if (body.type === "word" && body.item?.text) {
    const item = body.item;
    const index = saved.words.findIndex((row) => row.text.toLowerCase() === item.text.toLowerCase());
    if (index >= 0) saved.words.splice(index, 1);
    else {
      saved.words.unshift({
        text: item.text,
        zh: item.zh || "",
        ipa: item.ipa || "",
        level: item.level || "",
        kind: item.kind || "",
        source: item.source || "",
        start: item.start,
      });
    }
  } else {
    return NextResponse.json({ error: "没有要收藏的内容" }, { status: 400 });
  }
  await fs.writeFile(path.join(dir, "saved.json"), JSON.stringify(saved, null, 2));
  return NextResponse.json(saved);
}
