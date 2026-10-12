import { createReadStream } from "fs";
import fs from "fs/promises";
import path from "path";
import { Readable } from "stream";
import { jobDir } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const allowed = new Set([
  "video.mp4",
  "source.srt",
  "zh.srt",
  "en.srt",
  "subs.ass",
  "burned.mp4",
  "transcript-zh.md",
  "transcript-src.md",
  "lexicon.json",
]);

const types: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".srt": "application/x-subrip; charset=utf-8",
  ".ass": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function isAllowed(name: string): boolean {
  return allowed.has(name) || /^upload\.(mp4|mov|mkv|webm|m4v|mp3|wav|m4a|aac)$/.test(name);
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const name = new URL(request.url).searchParams.get("name") || "";
  if (!isAllowed(name)) {
    return new Response("不能下载这个文件", { status: 400 });
  }

  let file: string;
  try {
    file = path.join(jobDir(id), name);
  } catch {
    return new Response("没有这个任务", { status: 404 });
  }

  let stat;
  try {
    stat = await fs.stat(file);
  } catch {
    return new Response("文件还没有生成", { status: 404 });
  }

  const contentType = types[path.extname(name)] || "application/octet-stream";
  const range = request.headers.get("range");
  if (range && contentType.startsWith("video/")) {
    const [startText, endText] = range.replace(/bytes=/, "").split("-");
    const start = Number(startText);
    const end = endText ? Number(endText) : stat.size - 1;
    if (Number.isNaN(start) || Number.isNaN(end) || start > end) {
      return new Response("范围不正确", { status: 416 });
    }
    const stream = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream;
    return new Response(stream, {
      status: 206,
      headers: {
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": String(end - start + 1),
        "Content-Type": contentType,
      },
    });
  }

  const stream = Readable.toWeb(createReadStream(file)) as ReadableStream;
  return new Response(stream, {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(stat.size),
      "Accept-Ranges": "bytes",
      "Content-Disposition": `inline; filename="${name}"`,
    },
  });
}
