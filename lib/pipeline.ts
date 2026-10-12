import fs from "fs/promises";
import path from "path";
import { probeMedia, runCommand, escapeFilterValue, ensureBurnFfmpeg, pythonCommand } from "./media";
import { readSettings } from "./settings";
import { mergeWordsToSegments, type RawSegment } from "./segment";
import { jobDir, readJob, updateJob } from "./store";
import {
  isChineseLanguage,
  paragraphsFromCues,
  toAss,
  toMarkdown,
  toSrt,
  toSubtitleZh,
  expandBilingualCues,
  defaultSubtitleLook,
  type Cue,
} from "./subtitles";
import { blocksFromCues } from "./reading";
import { translateLines } from "./translate";
import { PauseError, clearPause, isPauseRequested } from "./control";

const scriptPath = path.join(process.cwd(), "scripts", "transcribe.py");

async function fileExists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

function stopIfPaused(id: string) {
  if (isPauseRequested(id)) throw new PauseError();
}

function setStage(id: string, stageId: string, status: "pending" | "active" | "done" | "skipped" | "error", detail?: string) {
  return updateJob(id, (job) => {
    const stage = job.stages.find((item) => item.id === stageId);
    if (!stage) return;
    stage.status = status;
    if (detail !== undefined) stage.detail = detail.slice(0, 220);
  });
}

async function refreshOutputs(id: string) {
  const dir = jobDir(id);
  const names = await fs.readdir(dir);
  const useful = [
    "video.mp4",
    "zh.srt",
    "en.srt",
    "subs.ass",
    "burned.mp4",
    "transcript-zh.md",
    "transcript-src.md",
    "lexicon.json",
  ];
  const upload = names.includes("video.mp4") ? "" : names.find((name) => name.startsWith("upload.")) || "";
  await updateJob(id, (job) => {
    job.outputs = [...useful.filter((name) => names.includes(name)), ...(upload ? [upload] : [])];
    job.canResume = names.includes("cues.json");
  });
}

export async function runPipeline(id: string, from: "start" | "translate") {
  await updateJob(id, (job) => {
    job.status = "running";
    job.error = undefined;
  });

  try {
    clearPause(id);
    if (from === "start") await prepare(id);
    stopIfPaused(id);
    await translateAndFinish(id);
    await refreshOutputs(id);
    await updateJob(id, (job) => {
      job.status = "done";
    });
  } catch (error) {
    if (error instanceof PauseError || isPauseRequested(id)) {
      await markPaused(id);
      return;
    }
    const message = error instanceof Error ? error.message : "处理失败";
    await refreshOutputs(id).catch(() => undefined);
    const job = await readJob(id);
    const active = job.stages.find((stage) => stage.status === "active");
    if (active) await setStage(id, active.id, "error", message);
    await updateJob(id, (record) => {
      record.status = "error";
      record.error = message;
    });
  }
}

async function markPaused(id: string) {
  const job = await readJob(id).catch(() => null);
  const active = job?.stages.find((stage) => stage.status === "active");
  const dir = jobDir(id);
  if (active?.id === "download") {
    const names = await fs.readdir(dir).catch(() => [] as string[]);
    await Promise.all(
      names.filter((name) => name.startsWith("video.")).map((name) => fs.rm(path.join(dir, name), { force: true })),
    );
  }
  if (active?.id === "burn") {
    await fs.rm(path.join(dir, "burned.mp4"), { force: true });
    await fs.rm(path.join(dir, "burned.next.mp4"), { force: true });
  }
  if (active?.id === "audio") await fs.rm(path.join(dir, "audio.mp3"), { force: true });
  if (active?.id === "transcribe") await fs.rm(path.join(dir, "whisper.json"), { force: true });
  if (active) await setStage(id, active.id, "pending", "已暂停");
  await updateJob(id, (record) => {
    record.status = "paused";
    record.error = undefined;
  });
}

async function prepare(id: string) {
  const job = await readJob(id);
  const dir = jobDir(id);
  if (!job.sourceUrl && !job.sourceName) throw new Error("贴一条 YouTube 链接，或上传一个视频");
  stopIfPaused(id);
  const videoPath = path.join(dir, "video.mp4");
  let video = videoPath;
  if (await fileExists(videoPath)) {
    await setStage(id, "download", "done", job.sourceUrl ? "视频已下载" : "视频已导入");
  } else if (job.sourceUrl) {
    await setStage(id, "download", "active", "正在下载");
    video = await downloadVideo(id, job.sourceUrl);
    await setStage(id, "download", "done", "视频已下载");
  } else {
    await setStage(id, "download", "active", "正在导入");
    video = await importUpload(id);
    await setStage(id, "download", "done", "视频已导入");
  }

  const info = await probeMedia(video);
  await updateJob(id, (record) => {
    record.stages.find((stage) => stage.id === "audio")!.detail = info.hasVideo
      ? `${Math.round(info.duration)} 秒`
      : "音频文件";
  });

  const audio = path.join(dir, "audio.mp3");
  if (await fileExists(audio)) {
    await setStage(id, "audio", "done");
  } else {
    stopIfPaused(id);
    await setStage(id, "audio", "active", "正在提取音频");
    await runCommand("ffmpeg", ["-y", "-i", video, "-vn", "-acodec", "libmp3lame", "-q:a", "2", audio], undefined, id);
    await setStage(id, "audio", "done");
  }

  const whisperPath = path.join(dir, "whisper.json");
  const cuesPath = path.join(dir, "cues.json");
  if (await fileExists(cuesPath)) {
    if (await fileExists(whisperPath)) {
      const whisper = JSON.parse(await fs.readFile(whisperPath, "utf8")) as { language?: string };
      await updateJob(id, (record) => {
        record.detectedLanguage = record.detectedLanguage || whisper.language || "";
      });
    }
    await setStage(id, "transcribe", "done", "沿用已有转写");
    await refreshOutputs(id);
    return;
  }

  stopIfPaused(id);
  await setStage(
    id,
    "transcribe",
    "active",
    job.quality === "fast" ? "快速模型，首次会下载" : "精确模型，首次约 1.5GB",
  );
  let lastLine = "";
  let lastWrite = 0;
  const language = job.language === "auto" ? "" : job.language;
  const python = await pythonCommand();
  await runCommand(
    python,
    [scriptPath, audio, "--output", whisperPath, "--quality", job.quality, ...(language ? ["--language", language] : [])],
    (line) => {
      lastLine = line;
      const now = Date.now();
      if (now - lastWrite > 800) {
        lastWrite = now;
        void setStage(id, "transcribe", "active", line);
      }
    },
    id,
  );
  const whisper = JSON.parse(await fs.readFile(whisperPath, "utf8")) as {
    language?: string;
    segments: RawSegment[];
  };
  const pieces = mergeWordsToSegments(whisper.segments || []);
  if (pieces.length === 0) throw new Error("没有转写出可用的字幕");
  const cues: Cue[] = pieces.map((piece) => ({ ...piece, zh: "" }));
  await fs.writeFile(path.join(dir, "cues.json"), JSON.stringify(cues, null, 2));
  await fs.writeFile(
    path.join(dir, "source.srt"),
    toSrt(cues.map((cue) => ({ start: cue.start, end: cue.end, lines: [cue.text] }))),
  );
  await updateJob(id, (record) => {
    record.detectedLanguage = whisper.language || "";
  });
  await setStage(id, "transcribe", "done", `${cues.length} 条 · ${whisper.language || "自动"} ${lastLine ? "" : ""}`.trim());
  await refreshOutputs(id);
}

async function importUpload(id: string): Promise<string> {
  const dir = jobDir(id);
  const videoPath = path.join(dir, "video.mp4");
  const names = await fs.readdir(dir);
  const upload = names.find((name) => /^upload\.(mp4|mov|mkv|webm|m4v)$/.test(name));
  if (!upload) throw new Error("没有找到上传的视频");
  const source = path.join(dir, upload);
  if (upload.endsWith(".mp4")) {
    try {
      await fs.link(source, videoPath);
    } catch {
      await fs.copyFile(source, videoPath);
    }
    return videoPath;
  }
  const note = (line: string) => {
    if (/time=|Duration:/.test(line)) void setStage(id, "download", "active", line.slice(0, 80));
  };
  try {
    await runCommand("ffmpeg", ["-y", "-i", source, "-c", "copy", "-movflags", "+faststart", videoPath], note, id);
  } catch (error) {
    if (error instanceof PauseError) throw error;
    await fs.rm(videoPath, { force: true });
    await runCommand(
      "ffmpeg",
      ["-y", "-i", source, "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-c:a", "aac", "-movflags", "+faststart", videoPath],
      note,
      id,
    );
  }
  return videoPath;
}

async function downloadVideo(id: string, url: string): Promise<string> {
  const settings = await readSettings();
  const dir = jobDir(id);
  const output = path.join(dir, "video.mp4");
  const args = [
    "--no-playlist",
    "--no-simulate",
    "--newline",
    "--progress",
    "-f",
    "bv*[height<=1080]+ba/b[height<=1080]/b",
    "--merge-output-format",
    "mp4",
    "-o",
    output,
    "--print",
    "after_move:%(title)s",
  ];
  if (settings.proxy) args.push("--proxy", settings.proxy);

  const attempt = async (extra: string[]) => {
    let title = "";
    await runCommand("yt-dlp", [...args, ...extra, url], (line) => {
      const notice = /WARNING|ERROR|Deprecated|strongly recommended|yt-dlp/i.test(line);
      if (!notice && !line.startsWith("[") && line.length > 0 && line.length < 180) title = line;
      if (line.startsWith("[download]") || line.startsWith("[Merger]")) {
        void setStage(id, "download", "active", line.replace(/^\[[^\]]+\]\s*/, "").trim());
      }
    }, id);
    if (title) {
      await updateJob(id, (job) => {
        job.title = title.slice(0, 120);
      });
    }
  };

  try {
    await attempt([]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!/403|SABR|Sign in|bot|cookies|Forbidden/i.test(message)) throw error;
    const leftovers = await fs.readdir(dir);
    await Promise.all(
      leftovers.filter((name) => name.startsWith("video.")).map((name) => fs.unlink(path.join(dir, name))),
    );
    await setStage(id, "download", "active", "改用浏览器登录态重试");
    await attempt(["--cookies-from-browser", "chrome"]);
  }

  return finalizeDownload(dir, output, id);
}

async function finalizeDownload(dir: string, output: string, id: string): Promise<string> {
  try {
    await fs.access(output);
    return output;
  } catch {
    // yt-dlp 有时会把画面和声音分成两个文件。
  }
  const names = (await fs.readdir(dir)).filter(
    (name) => name.startsWith("video.") && !name.endsWith(".part") && !name.endsWith(".ytdl"),
  );
  const merged = names.find((name) => name === "video.mp4" || name === "video.mkv" || name === "video.webm");
  if (merged) return path.join(dir, merged);
  const streams = names.filter((name) => /\.(mp4|mkv|webm|m4a)$/i.test(name));
  const picture = streams.find((name) => /\.(mp4|mkv|webm)$/i.test(name));
  const audio = streams.find((name) => name !== picture);
  if (picture && audio) {
    await runCommand("ffmpeg", [
      "-y",
      "-i",
      path.join(dir, picture),
      "-i",
      path.join(dir, audio),
      "-c",
      "copy",
      output,
    ], undefined, id);
    return output;
  }
  if (picture) return path.join(dir, picture);
  throw new Error("下载结束了，但没有写出视频文件");
}

async function translateAndFinish(id: string) {
  stopIfPaused(id);
  const dir = jobDir(id);
  const job = await readJob(id);
  const cues = JSON.parse(await fs.readFile(path.join(dir, "cues.json"), "utf8")) as Cue[];
  const chinese = isChineseLanguage(job.detectedLanguage);
  const alreadyTranslated = !chinese && cues.length > 0 && cues.every((cue) => cue.zh.trim());

  if (chinese) {
    for (const cue of cues) cue.zh = cue.text;
    await setStage(id, "translate", "skipped", job.subtitle === "en" ? "检测到中文，没有英文，改为纯中文" : "检测到中文，只整理断句");
  } else if (alreadyTranslated) {
    await setStage(id, "translate", "done", "沿用已有译文");
  } else {
    await setStage(id, "translate", "active", `翻译 ${cues.length} 条`);
    const settings = await readSettings();
    const translated = await translateLines(
      cues.map((cue) => cue.text),
      settings,
      () => stopIfPaused(id),
    );
    translated.forEach((line, index) => {
      cues[index].zh = line.trim();
    });
    await setStage(
      id,
      "translate",
      "done",
      job.subtitle === "bilingual" ? (job.subtitleOrder === "en-top" ? "英文在上，中文在下" : "中文在上，英文在下") : job.subtitle === "en" ? "纯英文" : "纯中文",
    );
  }

  await fs.writeFile(path.join(dir, "cues.json"), JSON.stringify(cues, null, 2));
  const visible = cues.filter((cue) => toSubtitleZh(cue.zh));
  const bilingual = job.subtitle === "bilingual" && !chinese;
  const englishOnly = job.subtitle === "en" && !chinese;
  const display = bilingual
    ? expandBilingualCues(
        visible.map((cue) => ({ start: cue.start, end: cue.end, zh: toSubtitleZh(cue.zh), source: cue.text })),
      )
    : englishOnly
      ? cues
          .filter((cue) => cue.text.trim())
          .map((cue) => ({ start: cue.start, end: cue.end, zh: toSubtitleZh(cue.zh), source: cue.text.trim() }))
      : visible.map((cue) => ({ start: cue.start, end: cue.end, zh: toSubtitleZh(cue.zh), source: cue.text }));
  const order = job.subtitleOrder === "en-top" ? "en-top" : "zh-top";
  await fs.writeFile(
    path.join(dir, "zh.srt"),
    toSrt(display.map((cue) => ({ start: cue.start, end: cue.end, lines: [cue.zh] }))),
  );
  if (!chinese) {
    await fs.writeFile(
      path.join(dir, "en.srt"),
      toSrt(display.map((cue) => ({ start: cue.start, end: cue.end, lines: [cue.source || ""] }))),
    );
  }

  const video = path.join(dir, "video.mp4");
  const info = await probeMedia(video);
  await fs.writeFile(
    path.join(dir, "subs.ass"),
    toAss(display, info.height || 1080, bilingual ? "bilingual" : englishOnly ? "en" : "zh", {
      cnSize: Number.isFinite(job.cnSize) ? job.cnSize : defaultSubtitleLook.cnSize,
      enSize: Number.isFinite(job.enSize) ? job.enSize : defaultSubtitleLook.enSize,
      cnColor: job.cnColor || defaultSubtitleLook.cnColor,
      enColor: job.enColor || defaultSubtitleLook.enColor,
      order,
    }),
  );

  if (job.mode === "doc" || !info.hasVideo) {
    await setStage(id, "burn", "skipped", info.hasVideo ? "这次只出文稿" : "没有画面，跳过烧录");
  } else if (await fileExists(path.join(dir, "burned.mp4"))) {
    await setStage(id, "burn", "done");
  } else {
    stopIfPaused(id);
    await setStage(id, "burn", "active", "正在烧录");
    const ffmpeg = await ensureBurnFfmpeg((line) => {
      void setStage(id, "burn", "active", line);
    });
    await burn(id, ffmpeg, video, path.join(dir, "subs.ass"));
    await setStage(id, "burn", "done");
  }

  await setStage(id, "document", "active");
  const sourceUrl = job.sourceUrl || job.sourceName;
  if (!chinese) {
    await fs.writeFile(
      path.join(dir, "transcript-src.md"),
      toMarkdown(job.title, sourceUrl, paragraphsFromCues(cues, "text")),
    );
  }
  await fs.writeFile(
    path.join(dir, "transcript-zh.md"),
    toMarkdown(
      chinese ? job.title : `${job.title} · 中文`,
      sourceUrl,
      blocksFromCues(cues.map((cue) => ({ start: cue.start, end: cue.end, text: cue.zh }))).map((block) =>
        block.kind === "heading" ? `## ${block.text}` : block.text,
      ),
    ),
  );
  await setStage(id, "document", "done");
}

async function burn(id: string, ffmpeg: string, video: string, ass: string) {
  const output = path.join(jobDir(id), "burned.mp4");
  let lastWrite = 0;
  await runCommand(
    ffmpeg,
    ["-y", "-i", video, "-vf", `ass=${escapeFilterValue(ass)}`, "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-c:a", "aac", "-b:a", "128k", output],
    (line) => {
      const match = line.match(/time=\s*(\d+:\d+:\d+)/);
      if (!match) return;
      const now = Date.now();
      if (now - lastWrite < 800) return;
      lastWrite = now;
      void setStage(id, "burn", "active", match[1]);
    },
    id,
  );
}
