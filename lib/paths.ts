import fs from "fs";
import path from "path";

const windows = process.platform === "win32";

/**
 * 任务、设置、一键安装出的工具都放在这里。
 * 默认是项目下的 `data/`，Docker 里可挂载卷并设置 `TRANSYT_DATA_ROOT=/data`。
 */
export const dataMount = process.env.TRANSYT_DATA_ROOT?.trim()
  ? path.resolve(process.env.TRANSYT_DATA_ROOT)
  : path.join(process.cwd(), "data");

/**
 * 镜像里预装的 venv（例如 Docker 的 `/opt/transyt-venv`）。
 * 若设置且目录存在，会优先用这里的 Python 和 yt-dlp，再在 `data/venv` 与系统 PATH 里找。
 */
const bundledEnv = process.env.TRANSYT_BUNDLED_VENV?.trim() ?? "";
const bundledRoot = bundledEnv ? path.resolve(bundledEnv) : "";

/** 预装环境中的 python 可执行文件路径，未配置或不存在时为 null。 */
export function bundledVenvPython(): string | null {
  if (!bundledRoot || !fs.existsSync(bundledRoot)) return null;
  const candidates = windows
    ? [path.join(bundledRoot, "Scripts", "python.exe")]
    : [path.join(bundledRoot, "bin", "python3"), path.join(bundledRoot, "bin", "python")];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/** 预装环境中的 yt-dlp 路径，未配置或不存在时为 null。 */
export function bundledYtDlp(): string | null {
  if (!bundledRoot || !fs.existsSync(bundledRoot)) return null;
  const bin = windows
    ? path.join(bundledRoot, "Scripts", "yt-dlp.exe")
    : path.join(bundledRoot, "bin", "yt-dlp");
  return fs.existsSync(bin) ? bin : null;
}

/** 转写脚本随应用打包，始终在运行目录下。 */
export const transcribeScriptPath = path.join(process.cwd(), "scripts", "transcribe.py");
