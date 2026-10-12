import fs from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { jobDir, listJobs } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SavedSentence = { start: number; end: number; zh: string; en: string };
type SavedWord = { text: string; zh: string; ipa: string; level: string; kind: string; source: string; start?: number };

async function readSaved(dir: string) {
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(dir, "saved.json"), "utf8")) as {
      sentences?: SavedSentence[];
      words?: SavedWord[];
    };
    return {
      sentences: Array.isArray(parsed.sentences) ? parsed.sentences : [],
      words: Array.isArray(parsed.words) ? parsed.words : [],
    };
  } catch {
    return { sentences: [] as SavedSentence[], words: [] as SavedWord[] };
  }
}

export async function GET() {
  const jobs = await listJobs();
  const sentences: (SavedSentence & { jobId: string; title: string })[] = [];
  const words: (SavedWord & { jobId: string; title: string })[] = [];
  for (const job of jobs) {
    let saved: { sentences: SavedSentence[]; words: SavedWord[] };
    try {
      saved = await readSaved(jobDir(job.id));
    } catch {
      continue;
    }
    for (const sentence of saved.sentences) sentences.push({ ...sentence, jobId: job.id, title: job.title });
    for (const word of saved.words) words.push({ ...word, jobId: job.id, title: job.title });
  }
  return NextResponse.json({ sentences, words });
}
