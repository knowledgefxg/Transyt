import { NextResponse } from "next/server";
import { commandExists, pythonCommand } from "@/lib/media";
import { readSettings } from "@/lib/settings";
import { spawn } from "child_process";
import type { Health } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function whisperInstalled(): Promise<boolean> {
  const python = await pythonCommand();
  return new Promise((resolve) => {
    const child = spawn(
      python,
      [
        "-c",
        "import importlib.util as u; raise SystemExit(0 if u.find_spec('mlx_whisper') or u.find_spec('faster_whisper') else 1)",
      ],
      { windowsHide: true },
    );
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

export async function GET() {
  const settings = await readSettings();
  const [ffmpeg, ffprobe, ytdlp, whisper] = await Promise.all([
    commandExists("ffmpeg"),
    commandExists("ffprobe"),
    commandExists("yt-dlp", ["--version"]),
    whisperInstalled(),
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
