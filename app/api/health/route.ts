import { NextResponse } from "next/server";
import { commandExists, tool, whisperPython } from "@/lib/media";
import { readSettings } from "@/lib/settings";
import type { Health } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const settings = await readSettings();
  const [ffmpeg, ffprobe, ytdlp, whisper] = await Promise.all([
    commandExists(tool("ffmpeg")),
    commandExists(tool("ffprobe")),
    commandExists(tool("yt-dlp"), ["--version"]),
    whisperPython().then(Boolean),
  ]);
  const health: Health = {
    ffmpeg,
    ffprobe,
    ytdlp,
    whisper,
    hasKey: Boolean(settings.apiKey),
  };
  return NextResponse.json(health);
}
