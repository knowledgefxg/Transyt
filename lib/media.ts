import { spawn } from "child_process";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import zlib from "zlib";
import { PauseError, attachProcess, detachProcess, isPauseRequested } from "./control";

let pythonName: Promise<string> | null = null;

export function pythonCommand(): Promise<string> {
  if (!pythonName) {
    pythonName = (async () => {
      if (await commandExists("python3", ["--version"])) return "python3";
      if (await commandExists("python", ["--version"])) return "python";
      return process.platform === "win32" ? "python" : "python3";
    })();
  }
  return pythonName;
}

export function commandExists(command: string, args: string[] = ["-version"]): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: "ignore", windowsHide: true });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

export function runCommand(
  command: string,
  args: string[],
  onLine?: (line: string) => void,
  jobId?: string,
): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    if (jobId && isPauseRequested(jobId)) {
      reject(new PauseError());
      return;
    }
    const child = spawn(command, args, {
      detached: true,
      windowsHide: true,
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    });
    if (jobId) attachProcess(jobId, child);
    let stdout = "";
    let stderr = "";
    let buffer = "";

    const push = (chunk: string) => {
      buffer += chunk;
      const parts = buffer.split(/\r?\n|\r/);
      buffer = parts.pop() || "";
      for (const part of parts) {
        const line = part.trim();
        if (line) onLine?.(line);
      }
    };

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      push(text);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      push(text);
    });
    child.on("error", (error) => {
      if (jobId) detachProcess(jobId, child);
      reject(error);
    });
    child.on("close", (code, signal) => {
      if (jobId) detachProcess(jobId, child);
      if (buffer.trim()) onLine?.(buffer.trim());
      if (jobId && (isPauseRequested(jobId) || signal === "SIGTERM")) {
        reject(new PauseError());
        return;
      }
      if (code === 0) resolve({ stdout });
      else {
        const tail = (stderr || stdout).trim().split("\n").slice(-8).join("\n");
        reject(new Error(tail || `${command} 退出码 ${code}`));
      }
    });
  });
}

export type Probe = {
  duration: number;
  width: number;
  height: number;
  hasVideo: boolean;
};

export async function probeMedia(file: string): Promise<Probe> {
  const { stdout } = await runCommand("ffprobe", [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    file,
  ]);
  const payload = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: { codec_type?: string; width?: number; height?: number }[];
  };
  const video = payload.streams?.find((stream) => stream.codec_type === "video");
  return {
    duration: Number(payload.format?.duration || 0),
    width: video?.width || 0,
    height: video?.height || 0,
    hasVideo: Boolean(video),
  };
}

export function escapeFilterValue(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/,/g, "\\,")
    .replace(/%/g, "\\%")
    .replace(/ /g, "\\ ");
}

const burnBinary = path.join(process.cwd(), "data", "bin", "ffmpeg");
const burnDownload =
  "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-darwin-arm64.gz";

async function supportsAss(bin: string): Promise<boolean> {
  try {
    const { stdout } = await runCommand(bin, ["-hide_banner", "-filters"]);
    return /\bass\b/.test(stdout);
  } catch {
    return false;
  }
}

/** 烧字幕需要 libass。Mac 上系统 ffmpeg 没有时，下载一份已验证过的静态构建。 */
export async function ensureBurnFfmpeg(onStatus?: (line: string) => void): Promise<string> {
  if (await supportsAss("ffmpeg")) return "ffmpeg";
  if (fs.existsSync(burnBinary) && (await supportsAss(burnBinary))) return burnBinary;
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    const hint =
      process.platform === "win32"
        ? "请安装带 libass 的完整版 ffmpeg，并确认 ffmpeg 在 PATH 里。"
        : "请安装带 libass 的 ffmpeg 后再试。";
    throw new Error(`当前 ffmpeg 不能烧字幕。${hint}`);
  }
  onStatus?.("正在下载带字幕功能的 ffmpeg");
  await fsp.mkdir(path.dirname(burnBinary), { recursive: true });
  const response = await fetch(burnDownload);
  if (!response.ok) throw new Error("下载烧录组件失败");
  const temp = `${burnBinary}.download`;
  await fsp.writeFile(temp, zlib.gunzipSync(Buffer.from(await response.arrayBuffer())));
  await fsp.chmod(temp, 0o755);
  await fsp.rename(temp, burnBinary);
  return burnBinary;
}
