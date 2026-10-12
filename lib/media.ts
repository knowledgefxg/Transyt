import { spawn } from "child_process";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import zlib from "zlib";
import { PauseError, attachProcess, detachProcess, isPauseRequested } from "./control";

const windows = process.platform === "win32";
export const binDir = path.join(process.cwd(), "data", "bin");
export const venvDir = path.join(process.cwd(), "data", "venv");

export const venvPython = path.join(venvDir, windows ? "Scripts/python.exe" : "bin/python");

/** 项目里装过的工具优先，其次用系统 PATH 里的。 */
export function tool(name: "ffmpeg" | "ffprobe" | "yt-dlp"): string {
  const file = windows ? `${name}.exe` : name;
  const local =
    name === "yt-dlp" ? path.join(venvDir, windows ? "Scripts" : "bin", file) : path.join(binDir, file);
  return fs.existsSync(local) ? local : name;
}

/** 系统自带的 Python，用来建项目虚拟环境。 */
export async function systemPython(): Promise<string | null> {
  for (const name of ["python3", "python"]) {
    if (await commandExists(name, ["--version"])) return name;
  }
  return null;
}

function hasWhisper(python: string): Promise<boolean> {
  return commandExists(python, [
    "-c",
    "import importlib.util as u; raise SystemExit(0 if u.find_spec('mlx_whisper') or u.find_spec('faster_whisper') else 1)",
  ]);
}

/** 找一个装了转写库的 Python：项目虚拟环境优先。 */
export async function whisperPython(): Promise<string | null> {
  const candidates = fs.existsSync(venvPython) ? [venvPython, "python3", "python"] : ["python3", "python"];
  for (const python of candidates) {
    if (await hasWhisper(python)) return python;
  }
  return null;
}

export async function pythonCommand(): Promise<string> {
  return (await whisperPython()) || (await systemPython()) || (windows ? "python" : "python3");
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
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PYTHONUNBUFFERED: "1",
      HF_HOME: path.join(process.cwd(), "data", "models"),
    };
    // MLX 和 yt-dlp 的子进程用裸命令调用 ffmpeg，也需要能找到项目内的安装。
    // Windows 的环境变量名不区分大小写，沿用现有 PATH 键，避免 PATH/Path 重复。
    const pathKey = Object.keys(env).find((key) => windows ? key.toLowerCase() === "path" : key === "PATH") || "PATH";
    env[pathKey] = [binDir, env[pathKey]].filter(Boolean).join(path.delimiter);
    const child = spawn(command, args, {
      detached: true,
      windowsHide: true,
      env,
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
  const { stdout } = await runCommand(tool("ffprobe"), [
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

const staticPlatforms: Record<string, string> = {
  "darwin-arm64": "darwin-arm64",
  "darwin-x64": "darwin-x64",
  "win32-x64": "win32-x64",
};

export function canDownloadFfmpeg(): boolean {
  return Boolean(staticPlatforms[`${process.platform}-${process.arch}`]);
}

/** 下载已验证带 libass 的静态构建，放进 data/bin。 */
export async function downloadFfmpeg(name: "ffmpeg" | "ffprobe"): Promise<string> {
  const target = staticPlatforms[`${process.platform}-${process.arch}`];
  if (!target) throw new Error("这个系统没有现成的 ffmpeg 下载包");
  const url = `https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/${name}-${target}.gz`;
  const file = path.join(binDir, windows ? `${name}.exe` : name);
  await fsp.mkdir(binDir, { recursive: true });
  const response = await fetch(url);
  if (!response.ok) throw new Error(`下载 ${name} 失败（${response.status}）`);
  const temp = `${file}.download`;
  await fsp.writeFile(temp, zlib.gunzipSync(Buffer.from(await response.arrayBuffer())));
  await fsp.chmod(temp, 0o755);
  await fsp.rename(temp, file);
  return file;
}

export async function supportsAss(bin: string): Promise<boolean> {
  try {
    const { stdout } = await runCommand(bin, ["-hide_banner", "-filters"]);
    return /\bass\b/.test(stdout);
  } catch {
    return false;
  }
}

/** 烧字幕需要 libass。现有 ffmpeg 都不支持时，下载一份静态构建。 */
export async function ensureBurnFfmpeg(onStatus?: (line: string) => void): Promise<string> {
  for (const bin of new Set([tool("ffmpeg"), "ffmpeg"])) {
    if (await supportsAss(bin)) return bin;
  }
  if (!canDownloadFfmpeg()) throw new Error("当前 ffmpeg 不能烧字幕。请安装带 libass 的 ffmpeg 后再试。");
  onStatus?.("正在下载带字幕功能的 ffmpeg");
  return downloadFfmpeg("ffmpeg");
}
