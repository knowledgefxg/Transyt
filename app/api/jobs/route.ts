import { randomBytes } from "crypto";
import { createWriteStream } from "fs";
import fs from "fs/promises";
import path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { NextResponse } from "next/server";
import { runPipeline } from "@/lib/pipeline";
import { enqueueJob, jobDir, listJobs, writeJob } from "@/lib/store";
import type { JobMode, JobRecord, Quality, SubtitleMode } from "@/lib/types";
import { writeSettings } from "@/lib/settings";
import { isYouTubeUrl } from "@/lib/youtube";

const videoExtensions = new Set([".mp4", ".mov", ".mkv", ".webm", ".m4v"]);
const maxUploadBytes = 2 * 1024 * 1024 * 1024;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clampStyleSize(value: FormDataEntryValue | null, fallback: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(64, Math.max(12, Math.round(number)));
}

function styleColor(value: FormDataEntryValue | null, fallback: string): string {
  const color = String(value || "");
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color.toUpperCase() : fallback;
}

function stages(uploaded: boolean): JobRecord["stages"] {
  return [
    { id: "download", label: uploaded ? "导入" : "下载", status: "pending" },
    { id: "audio", label: "提取音频", status: "pending" },
    { id: "transcribe", label: "转写", status: "pending" },
    { id: "translate", label: "翻译润色", status: "pending" },
    { id: "burn", label: "烧录字幕", status: "pending" },
    { id: "document", label: "整理文稿", status: "pending" },
  ];
}

export async function GET() {
  const jobs = await listJobs();
  return NextResponse.json(jobs);
}

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "请用表单提交视频" }, { status: 400 });
  }
  const url = String(form.get("url") || "").trim();
  const entry = form.get("file");
  const upload = entry instanceof File && entry.size > 0 ? entry : null;
  const mode: JobMode = form.get("mode") === "doc" ? "doc" : "burn";
  const subtitleRaw = form.get("subtitle");
  const subtitle: SubtitleMode = subtitleRaw === "bilingual" ? "bilingual" : subtitleRaw === "en" ? "en" : "zh";
  const quality: Quality = form.get("quality") === "fast" ? "fast" : "precise";
  const language = String(form.get("language") || "auto");
  const cnSize = clampStyleSize(form.get("cnSize"), 20);
  const enSize = clampStyleSize(form.get("enSize"), 16);
  const cnColor = styleColor(form.get("cnColor"), "#FFFFFF");
  const enColor = styleColor(form.get("enColor"), "#FFE08A");
  const subtitleOrder = form.get("subtitleOrder") === "en-top" ? "en-top" : "zh-top";
  const allowedLang = new Set(["auto", "en", "ja", "ko", "fr", "es", "de", "zh"]);

  if (!allowedLang.has(language)) {
    return NextResponse.json({ error: "不认识这个语种" }, { status: 400 });
  }

  let sourceUrl = "";
  let sourceName = "";
  let title = url;
  if (upload) {
    const ext = path.extname(upload.name).toLowerCase();
    if (!videoExtensions.has(ext)) {
      return NextResponse.json({ error: "请上传 mp4、mov、mkv、webm 或 m4v" }, { status: 400 });
    }
    if (upload.size > maxUploadBytes) {
      return NextResponse.json({ error: "视频不能超过 2GB" }, { status: 400 });
    }
    sourceName = upload.name.split(/[/\\]/).pop()?.replace(/[\u0000-\u001f]/g, "").slice(0, 180) || "本地视频";
    title = sourceName;
  } else if (!isYouTubeUrl(url)) {
    return NextResponse.json({ error: "贴一条 YouTube 链接，或上传一个视频" }, { status: 400 });
  } else {
    sourceUrl = url;
  }

  const id = randomBytes(8).toString("hex");
  const dir = jobDir(id);
  await fs.mkdir(dir, { recursive: true });
  if (upload) {
    const ext = path.extname(upload.name).toLowerCase();
    await pipeline(
      Readable.fromWeb(upload.stream() as unknown as Parameters<typeof Readable.fromWeb>[0]),
      createWriteStream(path.join(dir, `upload${ext}`)),
    );
  }

  const now = new Date().toISOString();
  const job: JobRecord = {
    id,
    title,
    sourceUrl,
    sourceName,
    mode,
    subtitle,
    quality,
    language,
    cnSize,
    enSize,
    cnColor,
    enColor,
    subtitleOrder,
    status: "queued",
    stages: stages(Boolean(upload)),
    outputs: [],
    canResume: false,
    createdAt: now,
    updatedAt: now,
  };
  await writeSettings({
    ...(form.has("cnSize") ? { cnSize } : {}),
    ...(form.has("enSize") ? { enSize } : {}),
    ...(form.has("cnColor") ? { cnColor } : {}),
    ...(form.has("enColor") ? { enColor } : {}),
    ...(form.has("subtitleOrder") ? { subtitleOrder } : {}),
  });
  await writeJob(job);
  enqueueJob(id, "start", runPipeline);
  return NextResponse.json(job);
}
