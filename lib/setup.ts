import fs from "fs";
import fsp from "fs/promises";
import {
  canDownloadFfmpeg,
  commandExists,
  downloadFfmpeg,
  runCommand,
  supportsAss,
  systemPython,
  tool,
  venvDir,
  venvPython,
  whisperPython,
} from "./media";
import { readSettings } from "./settings";

export type SetupState = {
  status: "idle" | "running" | "done" | "error";
  step: string;
  error: string;
  hint: string;
  log: string[];
};

const runtime = globalThis as typeof globalThis & { __transytSetup?: SetupState };

function state(): SetupState {
  if (!runtime.__transytSetup) {
    runtime.__transytSetup = { status: "idle", step: "", error: "", hint: "", log: [] };
  }
  return runtime.__transytSetup;
}

export function setupState(): SetupState {
  return state();
}

class SetupError extends Error {
  constructor(message: string, readonly hint: string) {
    super(message);
  }
}

function log(line: string) {
  const current = state();
  current.log.push(line);
  if (current.log.length > 300) current.log.splice(0, current.log.length - 300);
}

function step(text: string) {
  state().step = text;
  log(`== ${text}`);
}

function explainPip(output: string, version: string): string {
  if (/No space left|Errno 28/i.test(output)) return "磁盘空间不够。清出至少 3GB 后重试。";
  if (/ProxyError|ConnectionError|timed out|Temporary failure|Name or service|Could not fetch URL|SSLError|getaddrinfo/i.test(output)) {
    return "连不上 Python 软件源。在右上角设置里填好代理，或者换个网络后重试。";
  }
  if (/No matching distribution|requires a different Python|Could not find a version/i.test(output)) {
    return `当前 Python ${version} 没有对应的安装包。装 Python 3.11 或 3.12 后重试。`;
  }
  if (/DLL load failed|vcruntime|MSVCP/i.test(output)) {
    return "Windows 缺少 VC++ 运行库。安装 Microsoft Visual C++ 2015–2022 Redistributable（x64）后重试。";
  }
  return "展开安装日志查看具体原因，处理后点重试。";
}

async function run(command: string, args: string[]): Promise<string> {
  let output = "";
  try {
    await runCommand(command, args, (line) => {
      output += `${line}\n`;
      log(line);
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw Object.assign(new Error(message), { output: `${output}\n${message}` });
  }
  return output;
}

async function pythonVersion(python: string): Promise<[number, number]> {
  const output = await run(python, ["-c", "import sys; print('%d.%d' % sys.version_info[:2])"]);
  const [major, minor] = output.trim().split(/\s+/).pop()!.split(".").map(Number);
  return [major, minor];
}

async function installPython(packages: string[]) {
  step("检查 Python");
  const base = await systemPython();
  if (!base) {
    throw new SetupError(
      "没有找到 Python。",
      process.platform === "win32"
        ? "从 python.org 安装 Python 3.11 或 3.12，安装时勾选 Add python.exe to PATH，然后重启 npm run dev。"
        : "安装 Python 3.11 或 3.12（例如 brew install python@3.12），然后重启 npm run dev。",
    );
  }
  const [major, minor] = await pythonVersion(base);
  const version = `${major}.${minor}`;
  if (major < 3 || (major === 3 && minor < 9)) {
    throw new SetupError(`Python ${version} 版本太旧。`, "装 Python 3.11 或 3.12 后重试。");
  }

  if (!fs.existsSync(venvPython)) {
    step("在 data/venv 建虚拟环境");
    await fsp.rm(venvDir, { recursive: true, force: true });
    try {
      await run(base, ["-m", "venv", venvDir]);
    } catch {
      throw new SetupError(
        "建虚拟环境失败。",
        process.platform === "linux"
          ? "先安装 python3-venv（例如 sudo apt install python3-venv），再重试。"
          : "确认 Python 是完整安装版，然后重试。",
      );
    }
  }

  const settings = await readSettings();
  const pip = ["-m", "pip", "install", "--upgrade", "--disable-pip-version-check", "--progress-bar", "off"];
  if (settings.proxy) pip.push("--proxy", settings.proxy);

  step("更新 pip");
  await run(venvPython, [...pip, "pip"]).catch(() => log("pip 沿用现有版本"));

  step(`安装 ${packages.join("、")}`);
  try {
    await run(venvPython, [...pip, ...packages]);
  } catch (error) {
    const output = (error as { output?: string }).output || "";
    throw new SetupError(`安装 ${packages.join("、")} 失败。`, explainPip(output, version));
  }

  if (packages.includes("faster-whisper")) {
    if (process.platform === "darwin" && process.arch === "arm64") {
      step("安装 mlx-whisper（苹果芯片加速）");
      await run(venvPython, [...pip, "mlx-whisper"]).catch(() => log("mlx-whisper 没装上，改用 faster-whisper 转写"));
    }
    step("检查转写库");
    try {
      await run(venvPython, ["-c", "import faster_whisper; print('faster-whisper ok')"]);
    } catch (error) {
      const output = (error as { output?: string }).output || "";
      throw new SetupError("转写库装好了，但加载失败。", explainPip(output, version));
    }
  }
}

async function installFfmpeg() {
  if (!canDownloadFfmpeg()) {
    throw new SetupError("这个系统需要手动安装 ffmpeg。", "用系统包管理器安装带 libass 的 ffmpeg，例如 sudo apt install ffmpeg。");
  }
  for (const name of ["ffmpeg", "ffprobe"] as const) {
    step(`下载 ${name}`);
    try {
      await downloadFfmpeg(name);
    } catch (error) {
      log(error instanceof Error ? error.message : String(error));
      throw new SetupError(`下载 ${name} 失败。`, "确认能访问 github.com，或者换个网络后重试。");
    }
  }
}

async function runSetup() {
  const current = state();
  const [ffmpeg, ffprobe, ytdlp, whisper] = await Promise.all([
    supportsAss(tool("ffmpeg")),
    commandExists(tool("ffprobe")),
    commandExists(tool("yt-dlp"), ["--version"]),
    whisperPython().then(Boolean),
  ]);
  const packages = [...(whisper ? [] : ["faster-whisper"]), ...(ytdlp ? [] : ["yt-dlp"])];
  if (packages.length > 0) await installPython(packages);
  if (!ffmpeg || !ffprobe) await installFfmpeg();
  current.status = "done";
  current.step = "安装完成";
  log("== 安装完成");
}

export function startSetup(): SetupState {
  const current = state();
  if (current.status === "running") return current;
  Object.assign(current, { status: "running", step: "准备安装", error: "", hint: "", log: [] });
  runSetup().catch((error) => {
    current.status = "error";
    current.error = error instanceof Error ? error.message : String(error);
    current.hint = error instanceof SetupError ? error.hint : "展开安装日志查看具体原因，处理后点重试。";
    log(`!! ${current.error}`);
  });
  return current;
}
