import path from "path";

/**
 * 任务、设置、一键安装出的工具都放在这里。
 * 默认是项目下的 `data/`，Docker 里可挂载卷并设置 `TRANSYT_DATA_ROOT=/data`。
 */
export const dataMount = process.env.TRANSYT_DATA_ROOT?.trim()
  ? path.resolve(process.env.TRANSYT_DATA_ROOT)
  : path.join(process.cwd(), "data");

/** 转写脚本随应用打包，始终在运行目录下。 */
export const transcribeScriptPath = path.join(process.cwd(), "scripts", "transcribe.py");
