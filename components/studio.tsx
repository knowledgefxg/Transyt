"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Health, JobRecord, PublicSettings } from "@/lib/types";
import { blocksFromBilingual, blocksFromSrt, cuesFromSrt, type ReadingBlock } from "@/lib/reading";
import type { CefrLevel, Lexeme, LexemeKind } from "@/lib/lexicon";
import { youtubeVideoId } from "@/lib/youtube";

const fileLabels: Record<string, string> = {
  "burned.mp4": "带字幕的视频",
  "zh.srt": "中文字幕",
  "en.srt": "英文字幕",
  "subs.ass": "ASS 字幕",
  "transcript-zh.md": "中文文稿",
  "transcript-src.md": "原文文稿",
  "lexicon.json": "词汇表",
  "source.srt": "转写字幕",
  "video.mp4": "原视频",
};

function displayTitle(item: JobRecord): string {
  const title = item.title.trim();
  const junk = !title || title.startsWith("http") || /strongly recommended|latest version|yt-dlp/i.test(title);
  if (!junk) return title;
  const id = youtubeVideoId(item.sourceUrl);
  return id ? `YouTube · ${id}` : "未命名视频";
}

function recentJobs(items: JobRecord[]): JobRecord[] {
  const rank: Record<JobRecord["status"], number> = { done: 3, running: 2, queued: 2, paused: 2, error: 1 };
  const best = new Map<string, JobRecord>();
  for (const item of items) {
    const key = youtubeVideoId(item.sourceUrl) || item.id;
    const current = best.get(key);
    if (!current || rank[item.status] > rank[current.status] || (rank[item.status] === rank[current.status] && item.createdAt > current.createdAt)) {
      best.set(key, item);
    }
  }
  return [...best.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  const time = date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return time;
  return `${date.getMonth() + 1}月${date.getDate()}日 ${time}`;
}

const HISTORY_PAGE_SIZE = 8;

const cefrLevels: CefrLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];
const lexemeKinds: { id: LexemeKind; label: string }[] = [
  { id: "word", label: "单词" },
  { id: "phrase", label: "词组" },
  { id: "collocation", label: "搭配" },
  { id: "idiom", label: "习语" },
  { id: "slang", label: "俚语" },
  { id: "usage", label: "用法" },
];
const kindLabel = Object.fromEntries(lexemeKinds.map((item) => [item.id, item.label])) as Record<LexemeKind, string>;

function pairLines(chinese: string, english: string): { start: number; end: number; zh: string; en: string }[] {
  const zh = cuesFromSrt(chinese);
  const en = cuesFromSrt(english);
  return zh.map((cue, index) => ({
    start: cue.start,
    end: cue.end,
    zh: cue.text,
    en: en[index] && Math.abs(en[index].start - cue.start) < 0.25 ? en[index].text : "",
  }));
}

function clock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function sourceSentence(item: { source?: string; note?: string }): string {
  return (item.source || item.note || "").replace(/^原文[:：]\s*/, "").trim();
}

function splitTerm(sentence: string, term: string): { before: string; hit: string; after: string } | null {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = sentence.match(new RegExp(escaped, "i"));
  if (!match || match.index === undefined) return null;
  return {
    before: sentence.slice(0, match.index),
    hit: sentence.slice(match.index, match.index + match[0].length),
    after: sentence.slice(match.index + match[0].length),
  };
}

const languages = [
  ["auto", "自动识别"],
  ["en", "英语"],
  ["ja", "日语"],
  ["ko", "韩语"],
  ["fr", "法语"],
  ["es", "西班牙语"],
  ["de", "德语"],
  ["zh", "中文"],
];

export default function Studio() {
  const [health, setHealth] = useState<Health | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const backdropPressed = useRef(false);
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [draft, setDraft] = useState({ apiBase: "", apiKey: "", model: "", proxy: "" });
  const [url, setUrl] = useState("");
  const [source, setSource] = useState<"youtube" | "file">("youtube");
  const [file, setFile] = useState<File | null>(null);
  const [formFolded, setFormFolded] = useState(false);
  const [studyMode, setStudyMode] = useState(false);
  const [sideFolded, setSideFolded] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [folders, setFolders] = useState<{ id: string; name: string }[]>([]);
  const [folderName, setFolderName] = useState("");
  const [activeFolder, setActiveFolder] = useState("all");
  const [libraryView, setLibraryView] = useState<"projects" | "saved">("projects");
  const [libraryQuery, setLibraryQuery] = useState("");
  const [librarySaved, setLibrarySaved] = useState<{
    sentences: { start: number; end: number; zh: string; en: string; jobId: string; title: string }[];
    words: (Lexeme & { jobId: string; title: string })[];
  }>({ sentences: [], words: [] });
  const [stagesFolded, setStagesFolded] = useState(false);
  const [uploadPercent, setUploadPercent] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"burn" | "doc">("burn");
  const [subtitle, setSubtitle] = useState<"zh" | "en" | "bilingual">("zh");
  const [quality, setQuality] = useState<"precise" | "fast">("precise");
  const [language, setLanguage] = useState("auto");
  const [cnSize, setCnSize] = useState(20);
  const [enSize, setEnSize] = useState(16);
  const [cnColor, setCnColor] = useState("#FFFFFF");
  const [enColor, setEnColor] = useState("#FFE08A");
  const [subtitleOrder, setSubtitleOrder] = useState<"zh-top" | "en-top">("zh-top");
  const [job, setJob] = useState<JobRecord | null>(null);
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [historyPage, setHistoryPage] = useState(0);
  const [transcript, setTranscript] = useState<ReadingBlock[]>([]);
  const [lines, setLines] = useState<{ start: number; end: number; zh: string; en: string }[]>([]);
  const [studyPane, setStudyPane] = useState<"subs" | "words" | "saved">("subs");
  const [playhead, setPlayhead] = useState(0);
  const [captionTrack, setCaptionTrack] = useState<"off" | "zh" | "en">("off");
  const [savedOpen, setSavedOpen] = useState("");
  const [saved, setSaved] = useState<{ sentences: { start: number; end: number; zh: string; en: string }[]; words: Lexeme[] }>({
    sentences: [],
    words: [],
  });
  const [lexicon, setLexicon] = useState<Lexeme[] | null>(null);
  const [lexiconLoaded, setLexiconLoaded] = useState(false);
  const [lexiconBusy, setLexiconBusy] = useState(false);
  const [lexiconError, setLexiconError] = useState("");
  const [fromLevel, setFromLevel] = useState<CefrLevel>("A1");
  const [toLevel, setToLevel] = useState<CefrLevel>("C2");
  const [kindsOn, setKindsOn] = useState<LexemeKind[]>(lexemeKinds.map((item) => item.id));
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [watch, setWatch] = useState(false);
  const [pausing, setPausing] = useState(false);
  const [speaking, setSpeaking] = useState("");
  const [activeCue, setActiveCue] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const sideRef = useRef<HTMLDivElement>(null);
  const [lineZh, setLineZh] = useState<Record<string, string>>({});
  const [lineBusy, setLineBusy] = useState("");

  async function loadJobs() {
    const response = await fetch("/api/jobs");
    if (response.ok) setJobs(await response.json());
  }

  function chooseFrom(level: CefrLevel) {
    if (cefrLevels.indexOf(level) <= cefrLevels.indexOf(toLevel)) setFromLevel(level);
    else {
      setFromLevel(toLevel);
      setToLevel(level);
    }
  }

  function chooseTo(level: CefrLevel) {
    if (cefrLevels.indexOf(level) >= cefrLevels.indexOf(fromLevel)) setToLevel(level);
    else {
      setToLevel(fromLevel);
      setFromLevel(level);
    }
  }

  function toggleKind(kind: LexemeKind) {
    setKindsOn((current) => (current.includes(kind) ? current.filter((item) => item !== kind) : [...current, kind]));
  }

  function jumpTo(start: number | undefined, cue: string) {
    const video = videoRef.current;
    if (!video || typeof start !== "number" || !Number.isFinite(start)) return;
    const at = Math.max(0, start);
    const seek = () => {
      video.currentTime = at;
      void video.play().catch(() => undefined);
    };
    if (video.readyState >= 1) seek();
    else video.addEventListener("loadedmetadata", seek, { once: true });
    setActiveCue(cue);
  }

  function speak(text: string) {
    const synth = window.speechSynthesis;
    if (!synth) return;
    if (speaking === text) {
      synth.cancel();
      setSpeaking("");
      return;
    }
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.rate = 0.92;
    const voices = synth.getVoices();
    const voice =
      voices.find((item) => item.lang === "en-US" && /samantha|aria|jenny/i.test(item.name)) ||
      voices.find((item) => item.lang === "en-US") ||
      voices.find((item) => item.lang.startsWith("en"));
    if (voice) utterance.voice = voice;
    utterance.onend = () => setSpeaking((current) => (current === text ? "" : current));
    utterance.onerror = () => setSpeaking((current) => (current === text ? "" : current));
    setSpeaking(text);
    synth.speak(utterance);
  }

  async function translateLine(key: string, sentence: string) {
    if (lineZh[key]) {
      setLineZh((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      return;
    }
    setLineBusy(key);
    setLexiconError("");
    try {
      const response = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: sentence }),
      });
      const data = (await response.json()) as { zh?: string; error?: string };
      if (!response.ok) throw new Error(data.error || "没有译出来");
      setLineZh((current) => ({ ...current, [key]: data.zh || "" }));
    } catch (error) {
      setLexiconError(error instanceof Error ? error.message : "没有译出来");
    } finally {
      setLineBusy("");
    }
  }

  async function pullLexicon(force = false) {
    if (!job || lexiconBusy) return;
    setLexiconBusy(true);
    setLexiconError("");
    try {
      const response = await fetch(`/api/jobs/${job.id}/lexicon${force ? "?force=1" : ""}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: fromLevel, to: toLevel }),
      });
      const data = (await response.json()) as { items?: Lexeme[]; error?: string };
      if (!response.ok) throw new Error(data.error || "没有提取出来");
      setLexicon(data.items || []);
      setLexiconLoaded(true);
      setJob((current) =>
        current && current.id === job.id && !current.outputs.includes("lexicon.json")
          ? { ...current, outputs: [...current.outputs, "lexicon.json"] }
          : current,
      );
      void loadJobs();
    } catch (error) {
      setLexiconError(error instanceof Error ? error.message : "没有提取出来");
    } finally {
      setLexiconBusy(false);
    }
  }

  const activeLine = lines.findIndex((line) => playhead + 0.05 >= line.start && playhead < line.end);
  const liveCaption = activeLine < 0 ? "" : captionTrack === "zh" ? lines[activeLine].zh : captionTrack === "en" ? lines[activeLine].en : "";
  const shownLexicon = (lexicon || []).filter((item) => kindsOn.includes(item.kind));

  useEffect(() => {
    const box = sideRef.current;
    const row = box?.querySelector<HTMLElement>(".cue-line.current");
    if (!studyMode || studyPane !== "subs" || !box || !row) return;
    const top = row.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
    if (top < box.scrollTop + 36 || top > box.scrollTop + box.clientHeight - 80) {
      box.scrollTop = Math.max(0, top - box.clientHeight / 3);
    }
  }, [activeLine, studyMode, studyPane]);
  const rangeLabel = fromLevel === toLevel ? fromLevel : `${fromLevel}–${toLevel}`;

  async function loadLibrarySaved() {
    const response = await fetch("/api/saved");
    if (!response.ok) return;
    const data = await response.json();
    setLibrarySaved({ sentences: data.sentences || [], words: data.words || [] });
  }

  useEffect(() => {
    if (!libraryOpen) return;
    void fetch("/api/folders")
      .then((response) => (response.ok ? response.json() : []))
      .then((data) => setFolders(Array.isArray(data) ? data : []));
  }, [libraryOpen]);

  useEffect(() => {
    if (libraryOpen && libraryView === "saved") void loadLibrarySaved();
  }, [libraryOpen, libraryView]);

  useEffect(() => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.getVoices();
    const prime = () => window.speechSynthesis.getVoices();
    window.speechSynthesis.addEventListener("voiceschanged", prime);
    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", prime);
      window.speechSynthesis.cancel();
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== "Space" && event.key !== " ") return;
      const target = event.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) return;
      }
      const video = videoRef.current;
      if (!video) return;
      event.preventDefault();
      if (video.paused) void video.play().catch(() => undefined);
      else video.pause();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    void fetch("/api/health").then(async (response) => {
      if (response.ok) setHealth(await response.json());
    });
    void fetch("/api/settings").then(async (response) => {
      if (!response.ok) return;
      const data = (await response.json()) as PublicSettings;
      setSettings(data);
      setDraft({ apiBase: data.apiBase, apiKey: "", model: data.model, proxy: data.proxy });
      setCnSize(data.cnSize || 20);
      setEnSize(data.enSize || 16);
      setCnColor(data.cnColor || "#FFFFFF");
      setEnColor(data.enColor || "#FFE08A");
      setSubtitleOrder(data.subtitleOrder === "en-top" ? "en-top" : "zh-top");
    });
    void loadJobs();
  }, []);

  useEffect(() => {
    if (!job) return;
    const running = watch || job.status === "queued" || job.status === "running";
    if (!running) return;
    const timer = setInterval(async () => {
      const response = await fetch(`/api/jobs/${job.id}`);
      if (!response.ok) return;
      const next = (await response.json()) as JobRecord;
      setJob(next);
      if (next.status === "paused") setPausing(false);
      if (next.status === "done" || next.status === "error" || next.status === "paused") {
        setWatch(false);
        void loadJobs();
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [job, watch]);

  const outputKey = job?.outputs.join(",") ?? "";

  useEffect(() => {
    const id = job?.id;
    const names = outputKey.split(",").filter(Boolean);
    const hasSrt = names.includes("zh.srt");
    const hasEnglish = names.includes("en.srt");
    const hasMarkdown = names.includes("transcript-zh.md");
    if (!id || (!hasSrt && !hasMarkdown)) {
      setTranscript([]);
      setLines([]);
      return;
    }
    let cancel = false;
    const load = hasSrt && hasEnglish
      ? Promise.all([
          fetch(`/api/jobs/${id}/file?name=zh.srt`).then((response) => (response.ok ? response.text() : "")),
          fetch(`/api/jobs/${id}/file?name=en.srt`).then((response) => (response.ok ? response.text() : "")),
        ]).then(([chinese, english]) => {
          if (cancel || !chinese) return;
          setLines(english ? pairLines(chinese, english) : cuesFromSrt(chinese).map((cue) => ({ start: cue.start, end: cue.end, zh: cue.text, en: "" })));
          setTranscript(english ? blocksFromBilingual(chinese, english) : blocksFromSrt(chinese));
        })
      : fetch(`/api/jobs/${id}/file?name=${hasSrt ? "zh.srt" : "transcript-zh.md"}`)
          .then((response) => (response.ok ? response.text() : ""))
          .then((text) => {
            if (cancel || !text) return;
            if (hasSrt) {
              setLines(cuesFromSrt(text).map((cue) => ({ start: cue.start, end: cue.end, zh: cue.text, en: "" })));
              setTranscript(blocksFromSrt(text));
              return;
            }
            setLines([]);
            const body = text.replace(/^---[\s\S]*?---\s*/, "").trim();
            setTranscript(body ? [{ kind: "paragraph", text: body }] : []);
          });
    void load;
    return () => {
      cancel = true;
    };
  }, [job?.id, outputKey]);

  useEffect(() => {
    const id = job?.id;
    if (!id) {
      setLexicon(null);
      setLexiconLoaded(false);
      return;
    }
    let cancel = false;
    setLexicon(null);
    setLexiconLoaded(false);
    setLexiconError("");
    void fetch(`/api/jobs/${id}/lexicon`)
      .then(async (response) => {
        if (cancel) return;
        if (!response.ok) {
          setLexicon(null);
          return;
        }
        const data = (await response.json()) as { from?: CefrLevel; to?: CefrLevel; items?: Lexeme[] } | Lexeme[];
        if (cancel) return;
        if (Array.isArray(data)) {
          setLexicon(data);
          return;
        }
        setLexicon(Array.isArray(data.items) ? data.items : null);
        if (data.from && cefrLevels.includes(data.from)) setFromLevel(data.from);
        if (data.to && cefrLevels.includes(data.to)) setToLevel(data.to);
      })
      .catch(() => {
        if (!cancel) setLexicon(null);
      })
      .finally(() => {
        if (!cancel) setLexiconLoaded(true);
      });
    return () => {
      cancel = true;
    };
  }, [job?.id, outputKey]);

  useEffect(() => {
    const id = job?.id;
    if (!id) {
      setSaved({ sentences: [], words: [] });
      return;
    }
    void fetch(`/api/jobs/${id}/saved`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!data) return;
        setSaved({ sentences: data.sentences || [], words: data.words || [] });
      });
  }, [job?.id]);

  async function toggleSaved(type: "sentence" | "word", item: object) {
    if (!job) return;
    const response = await fetch(`/api/jobs/${job.id}/saved`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, item }),
    });
    if (!response.ok) return;
    const data = await response.json();
    setSaved({ sentences: data.sentences || [], words: data.words || [] });
  }

  const missing = useMemo(() => {
    if (!health) return [];
    const items: string[] = [];
    if (!health.ffmpeg || !health.ffprobe) items.push("ffmpeg");
    if (!health.ytdlp) items.push("yt-dlp");
    if (!health.whisper) items.push("Whisper");
    return items;
  }, [health]);

  function postJob(body: FormData, onProgress?: (percent: number) => void): Promise<JobRecord> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let sent = false;
    const report = (percent: number) => {
      if (!onProgress || sent) return;
      const next = Math.max(0, Math.min(100, percent));
      if (next >= 100) sent = true;
      onProgress(next);
    };
    xhr.open("POST", "/api/jobs");
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || event.total <= 0) return;
      report(Math.round((event.loaded / event.total) * 100));
    };
    xhr.upload.onload = () => report(100);
    xhr.onload = () => {
      let data: { error?: string } = {};
      try {
        data = JSON.parse(xhr.responseText) as { error?: string };
      } catch {
        data = {};
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        report(100);
        resolve(data as JobRecord);
      } else reject(new Error(data.error || "没有开始"));
    };
    xhr.onerror = () => reject(new Error("上传中断了"));
    xhr.send(body);
  });
}

async function submit(event: React.FormEvent) {
    event.preventDefault();
    setFormError("");
    setBusy(true);
    try {
      if (source === "file") {
        if (!file || file.size === 0) throw new Error("先选择一个视频文件");
        const ext = file.name.split(".").pop()?.toLowerCase() || "";
        if (!["mp4", "mov", "mkv", "webm", "m4v"].includes(ext)) {
          throw new Error("请上传 mp4、mov、mkv、webm 或 m4v");
        }
        if (file.size > 2 * 1024 * 1024 * 1024) throw new Error("视频不能超过 2GB");
        setUploadPercent(0);
      } else if (!url.trim()) {
        throw new Error("贴一条 YouTube 链接");
      }
      const body = new FormData();
      if (source === "file" && file) body.set("file", file);
      else body.set("url", url.trim());
      body.set("mode", mode);
      body.set("subtitle", subtitle);
      body.set("quality", quality);
      body.set("language", language);
      body.set("cnSize", String(cnSize));
      body.set("enSize", String(enSize));
      body.set("cnColor", cnColor);
      body.set("enColor", enColor);
      body.set("subtitleOrder", subtitleOrder);
      const data = await postJob(body, source === "file" ? (percent) => setUploadPercent((current) => (current !== null && percent < current ? current : percent)) : undefined);
      if (source === "file") setUploadPercent(100);
      setJob(data);
      setWatch(true);
      void loadJobs();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "没有开始");
      if (source === "file") setUploadPercent(null);
    } finally {
      setBusy(false);
    }
  }

  async function saveSettings(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiBase: draft.apiBase,
        model: draft.model,
        proxy: draft.proxy,
        ...(draft.apiKey ? { apiKey: draft.apiKey } : {}),
      }),
    });
    if (!response.ok) return;
    const data = (await response.json()) as PublicSettings;
    setSettings(data);
    setHealth((current) => (current ? { ...current, hasKey: data.hasKey } : current));
    setSettingsOpen(false);
  }

  async function pause() {
    if (!job || pausing) return;
    setPausing(true);
    const response = await fetch(`/api/jobs/${job.id}/pause`, { method: "POST" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setPausing(false);
      window.alert(data.error || "暂停失败");
      return;
    }
    setWatch(true);
  }

  async function resume() {
    if (!job) return;
    setWatch(true);
    await fetch(`/api/jobs/${job.id}/continue`, { method: "POST" });
  }

  async function unsaveFromLibrary(jobId: string, type: "sentence" | "word", item: object) {
    const response = await fetch(`/api/jobs/${jobId}/saved`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, item }),
    });
    if (!response.ok) return;
    const data = await response.json();
    if (job?.id === jobId) setSaved({ sentences: data.sentences || [], words: data.words || [] });
    void loadLibrarySaved();
  }

  async function moveToFolder(item: JobRecord, folderId: string) {
    const response = await fetch(`/api/jobs/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderId }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      window.alert(data.error || "没有放进去");
      return;
    }
    setJobs((current) => current.map((entry) => (entry.id === data.id ? data : entry)));
    setJob((current) => (current?.id === data.id ? data : current));
  }

  async function addFolder(event: React.FormEvent) {
    event.preventDefault();
    const name = folderName.trim();
    if (!name) return;
    const response = await fetch("/api/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      window.alert(data.error || "没有建成");
      return;
    }
    setFolders((current) => [...current, data]);
    setFolderName("");
    setActiveFolder(data.id);
  }

  async function deleteFolder(id: string, name: string) {
    if (!window.confirm(`删掉收藏夹「${name}」？里面的项目会回到未分类。`)) return;
    const response = await fetch(`/api/folders/${id}`, { method: "DELETE" });
    if (!response.ok) return;
    setFolders((current) => current.filter((folder) => folder.id !== id));
    setJobs((current) => current.map((entry) => (entry.folderId === id ? { ...entry, folderId: "" } : entry)));
    if (activeFolder === id) setActiveFolder("all");
  }

  async function removeHistory(item: JobRecord) {
    if (!window.confirm(`删除「${displayTitle(item)}」，以及下载的视频和字幕？`)) return;
    const response = await fetch(`/api/jobs/${item.id}`, { method: "DELETE" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      window.alert(data.error || "没有删掉");
      return;
    }
    const key = youtubeVideoId(item.sourceUrl) || item.id;
    if (job && (youtubeVideoId(job.sourceUrl) || job.id) === key) {
      setJob(null);
      setWatch(false);
    }
    await loadJobs();
  }

  function goHome() {
    setJob(null);
    setLibraryOpen(false);
    setWatch(false);
    setPausing(false);
    setBusy(false);
    setFormError("");
    setUrl("");
    setSource("youtube");
    setFile(null);
    setUploadPercent(null);
    if (fileRef.current) fileRef.current.value = "";
    setMode("burn");
    setSubtitle("zh");
    setQuality("precise");
    setLanguage("auto");
    setCnSize(20);
    setEnSize(16);
    setCnColor("#FFFFFF");
    setEnColor("#FFE08A");
    setSubtitleOrder("zh-top");
    window.scrollTo({ top: 0 });
    void fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cnSize: 20,
        enSize: 16,
        cnColor: "#FFFFFF",
        enColor: "#FFE08A",
        subtitleOrder: "zh-top",
      }),
    }).then(async (response) => {
      if (!response.ok) return;
      const data = (await response.json()) as PublicSettings;
      setSettings(data);
    });
  }

  const videoName = (studyMode ? ["video.mp4", "burned.mp4"] : ["burned.mp4", "video.mp4"]).find((name) => job?.outputs.includes(name)) || "";
  const history = recentJobs(jobs);
  const historyPages = Math.max(1, Math.ceil(history.length / HISTORY_PAGE_SIZE));
  const historyPageIndex = Math.min(historyPage, historyPages - 1);
  const historyVisible = history.slice(historyPageIndex * HISTORY_PAGE_SIZE, historyPageIndex * HISTORY_PAGE_SIZE + HISTORY_PAGE_SIZE);
  const libraryQueryText = libraryQuery.trim().toLowerCase();
  const libraryItems = history.filter((item) => {
    if (activeFolder === "none") {
      if (item.folderId) return false;
    } else if (activeFolder !== "all" && item.folderId !== activeFolder) {
      return false;
    }
    if (!libraryQueryText) return true;
    return displayTitle(item).toLowerCase().includes(libraryQueryText);
  });

  return (
    <div className="app">
      <header className="slate">
        <div className="sprocket" />
        <div className="topbar">
          <button className="home" type="button" onClick={goHome}>
            <span className="brand">TRANSYT</span>
            <span className="tagline">
              下载 YouTube 视频并加上字幕，按
              <span className="cefr" tabIndex={0}>
                CEFR框架
                <span className="tip">欧洲语言共同参考框架，用来给英语划分难度。A1、A2 是入门，B1、B2 是中级，C1、C2 是高级。这里的等级是按这个框架估计的大致难度。</span>
              </span>
              A1 到 C2 抽出单词、词组、搭配和句子进行学习
            </span>
          </button>
          <div className="top-actions">
          <button
            className="ghost"
            type="button"
            onClick={() => {
              setLibraryOpen(true);
              setStudyMode(false);
            }}
          >
            管理项目
          </button>
          <button className="ghost" type="button" onClick={() => setSettingsOpen(true)}>
            {settings?.hasKey ? "翻译接口已填写" : "填写翻译接口"}
          </button>
        </div>
        </div>
      </header>

      {missing.length > 0 && (
        <div className="banner">这台电脑还缺 {missing.join("、")}，装好之后刷新页面。</div>
      )}

      {libraryOpen ? (
        <main className="main library">
          <section className="card library-card">
            <div className="job-head">
              <h2>管理项目</h2>
              <button className="fold" type="button" onClick={() => setLibraryOpen(false)}>
                返回
              </button>
            </div>
            <div className="choice kinds">
              <button type="button" aria-pressed={libraryView === "projects"} onClick={() => setLibraryView("projects")}>
                项目
              </button>
              <button type="button" aria-pressed={libraryView === "saved"} onClick={() => setLibraryView("saved")}>
                我的学习收藏
              </button>
            </div>
            {libraryView === "saved" ? (
              <div className="saved-list">
                {librarySaved.sentences.length === 0 && librarySaved.words.length === 0 ? (
                  <p className="fine">还没有收藏。在学习模式里给句子或词汇点星标即可。</p>
                ) : (
                  <>
                    {librarySaved.sentences.length > 0 && <p className="saved-label">句子</p>}
                    <ul className="cue-list">
                      {librarySaved.sentences.map((line) => (
                        <li key={`${line.jobId}-${line.start}-${line.zh}`}>
                          <div className="cue-row">
                            <button
                              className="cue-line"
                              type="button"
                              onClick={() => {
                                const target = jobs.find((entry) => entry.id === line.jobId);
                                if (!target) return;
                                setJob(target);
                                setLibraryOpen(false);
                                setStudyMode(true);
                                setFormFolded(true);
                                setStudyPane("saved");
                              }}
                            >
                              <span className="zh">{line.zh}</span>
                              {line.en && <span className="en">{line.en}</span>}
                              <span className="en">{line.title}</span>
                            </button>
                            <button className="keep on" type="button" aria-label="取消收藏句子" onClick={() => void unsaveFromLibrary(line.jobId, "sentence", line)}>
                              ★
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                    {librarySaved.words.length > 0 && <p className="saved-label">词汇</p>}
                    <ul className="cue-list">
                      {librarySaved.words.map((item) => (
                        <li key={`${item.jobId}-${item.text}`}>
                          <div className="cue-row">
                            <button
                              className="cue-line"
                              type="button"
                              onClick={() => {
                                const target = jobs.find((entry) => entry.id === item.jobId);
                                if (!target) return;
                                setJob(target);
                                setLibraryOpen(false);
                                setStudyMode(true);
                                setFormFolded(true);
                                setStudyPane("saved");
                              }}
                            >
                              <span className="zh">{item.text}</span>
                              <span className="en">{item.zh}</span>
                              <span className="en">{item.title}</span>
                            </button>
                            <button className="keep on" type="button" aria-label="取消收藏词汇" onClick={() => void unsaveFromLibrary(item.jobId, "word", item)}>
                              ★
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            ) : (
            <>
            <div className="library-tools">
              <input
                className="library-search"
                type="search"
                placeholder="按标题搜索"
                value={libraryQuery}
                onChange={(event) => setLibraryQuery(event.target.value)}
              />
              <div className="choice kinds">
                <button type="button" aria-pressed={activeFolder === "all"} onClick={() => setActiveFolder("all")}>
                  全部
                </button>
                <button type="button" aria-pressed={activeFolder === "none"} onClick={() => setActiveFolder("none")}>
                  未分类
                </button>
                {folders.map((folder) => (
                  <button key={folder.id} type="button" aria-pressed={activeFolder === folder.id} onClick={() => setActiveFolder(folder.id)}>
                    {folder.name}
                  </button>
                ))}
              </div>
              <form className="folder-create" onSubmit={(event) => void addFolder(event)}>
                <input
                  type="text"
                  maxLength={16}
                  placeholder="新收藏夹"
                  value={folderName}
                  onChange={(event) => setFolderName(event.target.value)}
                />
                <button className="fold" type="submit">
                  添加
                </button>
                {activeFolder !== "all" && activeFolder !== "none" && (
                  <button className="history-delete" type="button" onClick={() => void deleteFolder(activeFolder, folders.find((folder) => folder.id === activeFolder)?.name || "")}>
                    删除此收藏夹
                  </button>
                )}
              </form>
            </div>
            {libraryItems.length === 0 ? (
              <p className="fine">
                {history.length === 0 ? "还没有处理过的视频。" : libraryQueryText ? "没有标题对得上的视频。" : "这个收藏夹是空的。"}
              </p>
            ) : (
              <div className="history library-list">
                {libraryItems.map((item) => (
                  <div key={item.id} className={job?.id === item.id ? "history-row current" : "history-row"}>
                    <button
                      type="button"
                      className="history-open"
                      onClick={() => {
                        setJob(item);
                        setWatch(item.status === "queued" || item.status === "running");
                        setLibraryOpen(false);
                        setStudyMode(false);
                        setFormFolded(false);
                      }}
                    >
                      <span className="history-title">{displayTitle(item)}</span>
                      <span className="history-meta">
                        {formatWhen(item.createdAt)}
                        {item.folderId ? ` · ${folders.find((folder) => folder.id === item.folderId)?.name || ""}` : ""}
                      </span>
                    </button>
                    <select
                      className={item.folderId ? "folder-select" : "folder-select empty"}
                      aria-label="放入收藏夹"
                      value={item.folderId || ""}
                      onChange={(event) => void moveToFolder(item, event.target.value)}
                    >
                      <option value="">未分类</option>
                      {folders.map((folder) => (
                        <option key={folder.id} value={folder.id}>
                          {folder.name}
                        </option>
                      ))}
                    </select>
                    <span className={`pill ${item.status}`}>
                      {item.status === "done" ? "完成" : item.status === "paused" ? "已暂停" : item.status === "error" ? "中断" : "处理中"}
                    </span>
                    <button type="button" className="history-delete" onClick={() => void removeHistory(item)}>
                      删除
                    </button>
                  </div>
                ))}
              </div>
            )}
            </>
            )}
          </section>
        </main>
      ) : (
      <main className={formFolded ? "main folded" : "main"}>
        <form className="card composer" onSubmit={submit}>
          <div className="composer-head">
            {!formFolded && <h2>视频来源</h2>}
            <button
              className="fold"
              type="button"
              aria-expanded={!formFolded}
              aria-label={formFolded || studyMode ? "展开设置" : "收起设置"}
              onClick={() => {
                if (studyMode) {
                  setStudyMode(false);
                  setFormFolded(false);
                  return;
                }
                setFormFolded((open) => !open);
              }}
            >
              <span className="fold-chevron" />
              {!formFolded && !studyMode && <span className="tip">收起设置</span>}
              <span className="fold-label">{formFolded || studyMode ? "展开" : "收起"}</span>
            </button>
          </div>
          {!formFolded && (
          <>
          <div className="choice">
            <button type="button" aria-pressed={source === "youtube"} onClick={() => setSource("youtube")}>
              YouTube 链接
            </button>
            <button type="button" aria-pressed={source === "file"} onClick={() => setSource("file")}>
              本地视频
            </button>
          </div>
          {source === "youtube" ? (
            <input
              type="url"
              placeholder="https://www.youtube.com/watch?v=..."
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              required
            />
          ) : (
            <label className={`drop${uploadPercent === 100 ? " done" : ""}${busy ? " locked" : ""}`}>
              <input
                ref={fileRef}
                type="file"
                accept=".mp4,.mov,.mkv,.webm,.m4v,video/mp4,video/quicktime,video/webm,video/x-matroska"
                onChange={(event) => {
                  const next = event.target.files?.[0] || null;
                  setFile(next);
                  setUploadPercent(null);
                }}
              />
              {file ? (
                <span>
                  <strong>{file.name}</strong>
                  <br />
                  {formatSize(file.size)}
                  {uploadPercent !== null && (
                    <>
                      <span
                        className="meter"
                        role="progressbar"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={uploadPercent}
                      >
                        <span style={{ width: `${uploadPercent}%` }} />
                      </span>
                      <em>{uploadPercent === 100 ? "上传完成" : `正在上传 ${uploadPercent}%`}</em>
                    </>
                  )}
                </span>
              ) : (
                <span>
                  选择一个视频
                  <br />
                  mp4、mov、mkv、webm，最大 2GB
                </span>
              )}
            </label>
          )}

          <label>做成什么</label>
          <div className="choice">
            <button type="button" aria-pressed={mode === "burn"} onClick={() => setMode("burn")}>
              烧进视频
            </button>
            <button type="button" aria-pressed={mode === "doc"} onClick={() => setMode("doc")}>
              只要文稿
            </button>
          </div>

          <label>字幕</label>
          <div className="choice">
            <button type="button" aria-pressed={subtitle === "zh"} onClick={() => setSubtitle("zh")}>
              纯中文
            </button>
            <button type="button" aria-pressed={subtitle === "en"} onClick={() => setSubtitle("en")}>
              纯英文
            </button>
            <button type="button" aria-pressed={subtitle === "bilingual"} onClick={() => setSubtitle("bilingual")}>
              中英双语
            </button>
          </div>
          {subtitle === "bilingual" && (
            <>
              <label>上下位置</label>
              <div className="choice">
                <button type="button" aria-pressed={subtitleOrder === "zh-top"} onClick={() => setSubtitleOrder("zh-top")}>
                  中文在上
                </button>
                <button type="button" aria-pressed={subtitleOrder === "en-top"} onClick={() => setSubtitleOrder("en-top")}>
                  英文在上
                </button>
              </div>
            </>
          )}

          <div className="style-grid">
            {subtitle !== "en" && (
              <>
                <label htmlFor="cnSize">中文字号</label>
                <input id="cnSize" type="number" min={12} max={64} value={cnSize} onChange={(event) => setCnSize(Number(event.target.value))} />
                <label htmlFor="cnColor">中文颜色</label>
                <input id="cnColor" type="color" value={cnColor} onChange={(event) => setCnColor(event.target.value)} />
              </>
            )}
            {subtitle !== "zh" && (
              <>
                <label htmlFor="enSize">英文字号</label>
                <input id="enSize" type="number" min={12} max={64} value={enSize} onChange={(event) => setEnSize(Number(event.target.value))} />
                <label htmlFor="enColor">英文颜色</label>
                <input id="enColor" type="color" value={enColor} onChange={(event) => setEnColor(event.target.value)} />
              </>
            )}
          </div>
          <p className="style-preview" style={{ fontSize: 16 }}>
            {subtitle === "en" ? (
              <span style={{ color: enColor, fontSize: `${Math.max(12, enSize / 1.1)}px` }}>English subtitle</span>
            ) : subtitleOrder === "en-top" && subtitle === "bilingual" ? (
              <>
                <span style={{ color: enColor, fontSize: `${Math.max(12, enSize / 1.1)}px` }}>English subtitle</span>
                <span style={{ color: cnColor, fontSize: `${Math.max(14, cnSize / 1.1)}px` }}>中文字幕</span>
              </>
            ) : (
              <>
                <span style={{ color: cnColor, fontSize: `${Math.max(14, cnSize / 1.1)}px` }}>中文字幕</span>
                {subtitle === "bilingual" ? (
                  <span style={{ color: enColor, fontSize: `${Math.max(12, enSize / 1.1)}px` }}>English subtitle</span>
                ) : null}
              </>
            )}
          </p>

          <label>转写</label>
          <div className="choice">
            <button type="button" aria-pressed={quality === "precise"} onClick={() => setQuality("precise")}>
              精确
            </button>
            <button type="button" aria-pressed={quality === "fast"} onClick={() => setQuality("fast")}>
              快速
            </button>
          </div>

          <label htmlFor="language">原语言</label>
          <select id="language" value={language} onChange={(event) => setLanguage(event.target.value)}>
            {languages.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>

          <p className="picked">
            已选 {mode === "burn" ? "烧进视频" : "只要文稿"} ·{" "}
            {subtitle === "zh" ? "纯中文" : subtitle === "en" ? "纯英文" : subtitleOrder === "en-top" ? "英文在上" : "中文在上"} ·{" "}
            {quality === "precise" ? "精确转写" : "快速转写"}
          </p>

          <button className="primary" type="submit" disabled={busy}>
            {busy ? (source === "file" ? (uploadPercent === 100 ? "上传完成" : `正在上传 ${uploadPercent ?? 0}%`) : "正在提交") : "开始处理"}
          </button>
          {formError && <div className="error">{formError}</div>}
          <p className="fine">
            处理 YouTube 链接和你上传的视频。转写在这台设备上用 Whisper 完成，本地转录烧录字幕。翻译走你自己的接口。精确模型第一次大约要下 1.5GB。
          </p>
          </>
          )}
        </form>

        <section className={studyMode && job ? `card study${sideFolded ? " side-folded" : ""}` : "card"}>
          {!job && (
            <>
              <p className="empty-title">一条流水线</p>
              <ol className="stages">
                {[
                  "从 YouTube 下载，或使用上传的视频",
                  "抽出音频，用词级时间戳转写",
                  "按句子和停顿切开，再译成中文",
                  "双语字幕上下各一行，一次烧进画面",
                  "同时留下一份 Markdown 文稿",
                  "按 A1 到 C2 抽出单词、词组、搭配和句子，对着画面学",
                ].map((item, index) => (
                  <li className="stage" key={item}>
                    <div className="index">{index + 1}</div>
                    <strong>{item}</strong>
                  </li>
                ))}
              </ol>
            </>
          )}

          {job && (
            <>
              <div className="progress">
              <div className="job-head">
                <h2>{job.title}</h2>
                <div className="head-actions">
                  {videoName && job.status === "done" && (
                    <button className="primary study-enter" type="button" onClick={() => { setStudyMode(true); setFormFolded(true); }}>
                      进入学习模式
                    </button>
                  )}
                  {(job.status === "queued" || job.status === "running" || job.status === "paused" || job.status === "error" || pausing) && (
                  <button
                    className={stagesFolded ? "fold closed" : "fold"}
                    type="button"
                    aria-expanded={!stagesFolded}
                    aria-label={stagesFolded ? "展开进度" : "收起进度"}
                    onClick={() => setStagesFolded((open) => !open)}
                  >
                    <span className="fold-chevron" />
                    <span className="fold-label">{stagesFolded ? "展开" : "收起"}</span>
                  </button>
                  )}
                </div>
              </div>
              {(job.status === "queued" || job.status === "running" || job.status === "paused" || job.status === "error" || pausing) && !stagesFolded && (
                <ol className="stages">
                  {job.stages.map((stage, index) => (
                    <li className={`stage ${stage.status}`} key={stage.id}>
                      <div className="index">{index + 1}</div>
                      <div>
                        <strong>{stage.label}</strong>
                        {stage.detail && <span>{stage.detail}</span>}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
              {job.error && <div className="error">{job.error}</div>}
              {(job.status === "running" || job.status === "queued" || pausing) && (
                <button className="quiet" type="button" onClick={() => void pause()} disabled={pausing}>
                  {pausing ? "正在暂停" : "暂停"}
                </button>
              )}
              {job.status === "paused" && (
                <button className="primary" type="button" onClick={() => void resume()}>
                  继续处理
                </button>
              )}
              {job.status === "error" && job.canResume && (
                <button className="primary" type="button" onClick={() => void resume()}>
                  继续翻译和烧录
                </button>
              )}
              </div>
              {videoName && (
                <div className="player-block">
                  <div className="screen">
                    <video
                      key={videoName}
                      ref={videoRef}
                      controls
                      src={`/api/jobs/${job.id}/file?name=${videoName}`}
                      onTimeUpdate={(event) => setPlayhead(event.currentTarget.currentTime)}
                    />
                  </div>
                  {studyMode && captionTrack !== "off" && <p className="live-caption">{liveCaption}</p>}
                  {studyMode && (
                    <div className="downloads">
                      <button type="button" aria-pressed={captionTrack === "off"} onClick={() => setCaptionTrack("off")}>
                        无字幕
                      </button>
                      <button type="button" aria-pressed={captionTrack === "zh"} onClick={() => setCaptionTrack("zh")}>
                        中文字幕
                      </button>
                      <button type="button" aria-pressed={captionTrack === "en"} onClick={() => setCaptionTrack("en")}>
                        英文字幕
                      </button>
                    </div>
                  )}
                </div>
              )}
              {!studyMode && (
              <div className="downloads">
                {job.outputs.map((name) => (
                  <a key={name} href={`/api/jobs/${job.id}/file?name=${name}`} download>
                    <span className="tip">下载{fileLabels[name] || name}</span>
                    {fileLabels[name] || name}
                  </a>
                ))}
              </div>
              )}
              <div className={studyMode ? "study-side" : undefined} ref={studyMode ? sideRef : undefined}>
              {studyMode && (
                <div className="study-tabs-row">
                  {!sideFolded && (
                    <div className="choice study-tabs">
                      <button type="button" aria-pressed={studyPane === "subs"} onClick={() => setStudyPane("subs")}>
                        字幕
                      </button>
                      <button type="button" aria-pressed={studyPane === "words"} onClick={() => setStudyPane("words")}>
                        词汇
                      </button>
                      <button type="button" aria-pressed={studyPane === "saved"} onClick={() => setStudyPane("saved")}>
                        收藏
                      </button>
                    </div>
                  )}
                  <button
                    className={sideFolded ? "fold closed" : "fold"}
                    type="button"
                    aria-expanded={!sideFolded}
                    aria-label={sideFolded ? "展开字幕和词汇" : "收起字幕和词汇"}
                    onClick={() => setSideFolded((open) => !open)}
                  >
                    <span className="fold-chevron" />
                    <span className="fold-label">{sideFolded ? "展开" : "收起"}</span>
                  </button>
                </div>
              )}
              {studyMode && !sideFolded && studyPane === "subs" && (
                <ul className="cue-list">
                  {lines.length === 0 ? (
                    <li className="fine">字幕还没好。</li>
                  ) : (
                    lines.map((line, index) => (
                      <li key={`${line.start}-${index}`} className="cue-row">
                        <button
                          className={index === activeLine ? "cue-line current" : "cue-line"}
                          type="button"
                          onClick={() => jumpTo(line.start, `line-${index}`)}
                        >
                          <span className="zh">{line.zh}</span>
                          {line.en && <span className="en">{line.en}</span>}
                        </button>
                        <button
                          className={saved.sentences.some((row) => row.start === line.start && row.zh === line.zh) ? "keep on" : "keep"}
                          type="button"
                          aria-label="收藏句子"
                          onClick={() => void toggleSaved("sentence", line)}
                        >
                          ★
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              )}
              {studyMode && !sideFolded && studyPane === "saved" && (
                <div className="saved-list">
                  {saved.sentences.length === 0 && saved.words.length === 0 ? (
                    <p className="fine">还没有收藏。在字幕或词汇旁边点星标即可。</p>
                  ) : (
                    <>
                      {saved.sentences.length > 0 && <p className="saved-label">句子</p>}
                      <ul className="cue-list">
                        {saved.sentences.map((line) => {
                          const key = `sentence-${line.start}-${line.zh}`;
                          const open = savedOpen === key;
                          return (
                            <li key={key}>
                              <div className="cue-row">
                                <button className={open ? "cue-line current" : "cue-line"} type="button" onClick={() => setSavedOpen(open ? "" : key)}>
                                  <span className="zh">{line.zh}</span>
                                  {line.en && <span className="en">{line.en}</span>}
                                </button>
                                <button className="keep on" type="button" aria-label="取消收藏句子" onClick={() => void toggleSaved("sentence", line)}>
                                  ★
                                </button>
                              </div>
                              {open && (
                                <div className="saved-detail">
                                  <p>{clock(line.start)}</p>
                                  <button className="fold" type="button" onClick={() => jumpTo(line.start, key)}>
                                    跳转到对应时间轴
                                  </button>
                                </div>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                      {saved.words.length > 0 && <p className="saved-label">词汇</p>}
                      <ul className="cue-list">
                        {saved.words.map((item) => {
                          const key = `word-${item.text}`;
                          const open = savedOpen === key;
                          const sentence = sourceSentence(item);
                          const parts = sentence ? splitTerm(sentence, item.text) : null;
                          return (
                            <li key={key}>
                              <div className="cue-row">
                                <button className={open ? "cue-line current" : "cue-line"} type="button" onClick={() => setSavedOpen(open ? "" : key)}>
                                  <span className="zh">{item.text}</span>
                                  <span className="en">{item.zh}</span>
                                </button>
                                <button className="keep on" type="button" aria-label="取消收藏词汇" onClick={() => void toggleSaved("word", item)}>
                                  ★
                                </button>
                              </div>
                              {open && (
                                <div className="saved-detail">
                                  <div className="lexeme-meta">
                                    {item.level && <span>{item.level}</span>}
                                    {item.kind && <span>{kindLabel[item.kind]}</span>}
                                  </div>
                                  {item.ipa && <span className="ipa">{item.ipa}</span>}
                                  {sentence && (
                                    <p>
                                      原文{" "}
                                      {parts ? (
                                        <>
                                          {parts.before}
                                          <mark>{parts.hit}</mark>
                                          {parts.after}
                                        </>
                                      ) : (
                                        sentence
                                      )}
                                    </p>
                                  )}
                                  <div className="saved-actions">
                                    <button className="speak" type="button" aria-label="播放语音" onClick={() => speak(item.text)}>
                                      <svg viewBox="0 0 16 16" aria-hidden="true">
                                        <path d="M2.5 6.2h2.1L8 3.4v9.2L4.6 9.8H2.5V6.2z" fill="currentColor" />
                                        <path d="M10 5.6a2.8 2.8 0 0 1 0 4.8" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                                      </svg>
                                    </button>
                                    {typeof item.start === "number" && (
                                      <button className="fold" type="button" onClick={() => jumpTo(item.start, key)}>
                                        跳转到对应时间轴
                                      </button>
                                    )}
                                  </div>
                                </div>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </>
                  )}
                </div>
              )}
              {!studyMode && transcript.length > 0 && (
                <details className="transcript">
                  <summary>文稿</summary>
                  <div className="transcript-body">
                    {transcript.map((block, index) =>
                      block.kind === "heading" ? (
                        <h3 key={`${block.text}-${index}`}>{block.text}</h3>
                      ) : (
                        <p key={index}>
                          {block.text}
                          {block.source && <span className="source">{block.source}</span>}
                        </p>
                      ),
                    )}
                  </div>
                </details>
              )}
              {transcript.length > 0 && (!studyMode || (studyPane === "words" && !sideFolded)) && (
                <details className="transcript" open={studyMode || undefined}>
                  <summary>词汇</summary>
                  <div className="transcript-body lexicon-body">
                    {!lexiconLoaded ? (
                      <p className="fine">正在读取词汇。</p>
                    ) : (
                      <>
                        <p className="fine">按等级提取原文里的单词、词组、搭配、习语、俚语和用法。</p>
                        <div className="lexicon-bar">
                          <span className="range-label">从</span>
                          <div className="choice levels">
                            {cefrLevels.map((level) => (
                              <button key={level} type="button" aria-pressed={fromLevel === level} onClick={() => chooseFrom(level)}>
                                {level}
                              </button>
                            ))}
                          </div>
                          <span className="range-label">到</span>
                          <div className="choice levels">
                            {cefrLevels.map((level) => (
                              <button key={`to-${level}`} type="button" aria-pressed={toLevel === level} onClick={() => chooseTo(level)}>
                                {level}
                              </button>
                            ))}
                          </div>
                          <button
                            className="primary lexicon-extract"
                            type="button"
                            onClick={() => void pullLexicon(false)}
                            disabled={lexiconBusy || !settings?.hasKey}
                          >
                            {lexiconBusy ? "正在提取" : `提取 ${rangeLabel}`}
                          </button>
                        </div>
                        {!settings?.hasKey && <p className="fine">先在右上角填写翻译接口。</p>}
                        {lexicon && (
                          <>
                            <div className="choice kinds">
                              {lexemeKinds.map((item) => (
                                <button key={item.id} type="button" aria-pressed={kindsOn.includes(item.id)} onClick={() => toggleKind(item.id)}>
                                  {item.label}
                                </button>
                              ))}
                            </div>
                            <div className="lexicon-count">
                              <span>{shownLexicon.length} 条</span>
                              <button className="text-button" type="button" onClick={() => void pullLexicon(true)} disabled={lexiconBusy}>
                                {lexiconBusy ? "正在提取" : "重新提取"}
                              </button>
                            </div>
                            {shownLexicon.length === 0 ? (
                              <p className="fine">原文里没有达到这个等级的表达。</p>
                            ) : (
                              <ul className="lexicon-list">
                                {shownLexicon.map((item) => (
                                  <li className={activeCue === `${item.level}-${item.text}` ? "lexeme current" : "lexeme"} key={`${item.level}-${item.kind}-${item.text}`}>
                                    <div className="lexeme-meta">
                                      <span>{item.level}</span>
                                      <span>{kindLabel[item.kind]}</span>
                                    </div>
                                    <div className="lexeme-head">
                                      <strong>
                                        <button
                                          className="lexeme-jump"
                                          type="button"
                                          disabled={typeof item.start !== "number"}
                                          onClick={() => jumpTo(item.start, `${item.level}-${item.text}`)}
                                        >
                                          {typeof item.start === "number" && <span className="tip">跳转到对应时间轴</span>}
                                          {item.text}
                                        </button>
                                      </strong>
                                      <button
                                        className={speaking === item.text ? "speak playing" : "speak"}
                                        type="button"
                                        aria-label="播放语音"
                                        onClick={() => speak(item.text)}
                                      >
                                        <span className="tip">播放语音</span>
                                        <svg viewBox="0 0 16 16" aria-hidden="true">
                                          <path d="M2.5 6.2h2.1L8 3.4v9.2L4.6 9.8H2.5V6.2z" fill="currentColor" />
                                          <path d="M10 5.6a2.8 2.8 0 0 1 0 4.8" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                                          <path d="M11.6 4.1a5 5 0 0 1 0 7.8" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                                        </svg>
                                      </button>
                                      <button
                                        className={saved.words.some((row) => row.text.toLowerCase() === item.text.toLowerCase()) ? "keep on" : "keep"}
                                        type="button"
                                        aria-label="收藏词汇"
                                        onClick={() =>
                                          void toggleSaved("word", {
                                            text: item.text,
                                            zh: item.zh,
                                            ipa: item.ipa,
                                            level: item.level,
                                            kind: item.kind,
                                            source: sourceSentence(item),
                                            start: item.start,
                                          })
                                        }
                                      >
                                        ★
                                      </button>
                                    </div>
                                    {item.ipa && <span className="ipa">{item.ipa}</span>}
                                    <p>{item.zh}</p>
                                    {sourceSentence(item) && (
                                      <button
                                        className="source-line"
                                        type="button"
                                        onClick={() => void translateLine(`${item.text}|${sourceSentence(item)}`, sourceSentence(item))}
                                      >
                                        <span className="tip">点击翻译成中文</span>
                                        <span>原文</span>
                                        {(() => {
                                          const sentence = sourceSentence(item);
                                          const parts = splitTerm(sentence, item.text);
                                          if (!parts) return sentence;
                                          return (
                                            <>
                                              {parts.before}
                                              <mark>{parts.hit}</mark>
                                              {parts.after}
                                            </>
                                          );
                                        })()}
                                      </button>
                                    )}
                                    {lineBusy === `${item.text}|${sourceSentence(item)}` && <p className="source-zh">正在翻译</p>}
                                    {lineZh[`${item.text}|${sourceSentence(item)}`] && (
                                      <p className="source-zh">{lineZh[`${item.text}|${sourceSentence(item)}`]}</p>
                                    )}
                                    {item.source && item.note && <p className="note">{item.note}</p>}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </>
                        )}
                      </>
                    )}
                    {lexiconError && <div className="error">{lexiconError}</div>}
                  </div>
                </details>
              )}
              </div>
            </>
          )}

          {!studyMode && history.length > 0 && (
            <div className="history">
              <div className="history-head">最近</div>
              <div className="history-list">
                {historyVisible.map((item) => (
                  <div key={item.id} className={job?.id === item.id ? "history-row current" : "history-row"}>
                    <button
                      type="button"
                      className="history-open"
                      onClick={() => {
                        setJob(item);
                        setWatch(item.status === "queued" || item.status === "running");
                      }}
                    >
                      <span className="history-title">{displayTitle(item)}</span>
                      <span className="history-meta">{formatWhen(item.createdAt)}</span>
                    </button>
                    <span className={`pill ${item.status}`}>
                      {item.status === "done" ? "完成" : item.status === "paused" ? "已暂停" : item.status === "error" ? "中断" : "处理中"}
                    </span>
                    <button type="button" className="history-delete" onClick={() => void removeHistory(item)}>
                      删除
                    </button>
                  </div>
                ))}
              </div>
              {historyPages > 1 && (
                <div className="history-pager">
                  <button type="button" disabled={historyPageIndex === 0} onClick={() => setHistoryPage(historyPageIndex - 1)}>
                    上一页
                  </button>
                  {Array.from({ length: historyPages }, (_, index) => (
                    <button
                      key={index}
                      type="button"
                      aria-current={index === historyPageIndex ? "page" : undefined}
                      onClick={() => setHistoryPage(index)}
                    >
                      {index + 1}
                    </button>
                  ))}
                  <button type="button" disabled={historyPageIndex >= historyPages - 1} onClick={() => setHistoryPage(historyPageIndex + 1)}>
                    下一页
                  </button>
                </div>
              )}
            </div>
          )}
        </section>
      </main>
      )}

      {settingsOpen && (
        <div
          className="overlay"
          onMouseDown={(event) => {
            backdropPressed.current = event.target === event.currentTarget;
          }}
          onMouseUp={(event) => {
            if (backdropPressed.current && event.target === event.currentTarget) setSettingsOpen(false);
            backdropPressed.current = false;
          }}
        >
          <form className="panel" onSubmit={saveSettings}>
            <h3>翻译接口</h3>
            <p className="hint">填写兼容 OpenAI 对话接口的地址、模型名和密钥。模型名按服务商文档填写，密钥不要填进模型名。</p>
            <label htmlFor="apiBase">接口地址</label>
            <input
              id="apiBase"
              type="url"
              placeholder="https://api.openai.com/v1"
              value={draft.apiBase}
              onChange={(event) => setDraft({ ...draft, apiBase: event.target.value })}
              required
            />
            <label htmlFor="model">模型名</label>
            <input
              id="model"
              type="text"
              placeholder="gpt-4o-mini"
              value={draft.model}
              onChange={(event) => setDraft({ ...draft, model: event.target.value })}
              required
            />
            <label htmlFor="apiKey">密钥{settings?.hasKey ? "（留空则保留原来的）" : ""}</label>
            <input
              id="apiKey"
              type="password"
              placeholder={settings?.hasKey ? "已保存" : "服务商发放的密钥"}
              value={draft.apiKey}
              onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })}
            />
            <label htmlFor="proxy">下载代理，可留空</label>
            <input
              id="proxy"
              type="text"
              placeholder="http://127.0.0.1:7890"
              value={draft.proxy}
              onChange={(event) => setDraft({ ...draft, proxy: event.target.value })}
            />
            <div className="actions">
              <button className="ghost" type="button" onClick={() => setSettingsOpen(false)}>
                取消
              </button>
              <button className="primary" type="submit" style={{ width: "auto", marginTop: 0 }}>
                保存
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
