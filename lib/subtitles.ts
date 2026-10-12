import type { Piece } from "./segment";

export type Cue = Piece & { zh: string };

const SIZE_TABLE: Record<number, [number, number]> = {
  360: [22, 13],
  720: [22, 13],
  1080: [20, 12],
  2160: [20, 12],
};

export function srtTimestamp(seconds: number): string {
  const total = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor((total % 3_600_000) / 60_000);
  const secs = Math.floor((total % 60_000) / 1000);
  const millis = total % 1000;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)},${String(millis).padStart(3, "0")}`;
}

export function assTimestamp(seconds: number): string {
  const total = Math.max(0, Math.round(seconds * 100));
  const hours = Math.floor(total / 360_000);
  const minutes = Math.floor((total % 360_000) / 6_000);
  const secs = Math.floor((total % 6_000) / 100);
  const centis = total % 100;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${hours}:${pad(minutes)}:${pad(secs)}.${pad(centis)}`;
}

export function toSubtitleZh(text: string): string {
  return text
    .replace(/[，。！？、；：,.!?;:“”"「」]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function assText(text: string): string {
  return text.replace(/[{}]/g, "").replace(/\\N/g, "").replace(/\s*\n\s*/g, " ").replace(/\s+/g, " ").trim();
}

const FIT_AT = 32;

function wordChunks(text: string, max: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (current && next.length > max) {
      lines.push(current);
      current = word;
      continue;
    }
    current = next;
  }
  if (current) lines.push(current);
  return lines.length ? lines : [text];
}

function splitEnglish(text: string): string[] {
  if (text.length <= 64) return [text];
  const clauses = text
    .split(/(?<=,)|(?=\b(?:because|and|but|when|if|so|which|while)\b)/i)
    .map((part) => part.trim())
    .filter(Boolean);
  return clauses.length > 1 ? clauses : [text];
}

function splitChineseClauses(text: string): string[] {
  const parts = text
    .split(/(?<=[，,、；;。！？])/)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length ? parts : [text.trim()];
}

function alignParts(english: string[], chinese: string[]): { english: string[]; chinese: string[] } {
  const en = english.length ? [...english] : [""];
  const zh = chinese.length ? [...chinese] : [""];
  while (en.length > zh.length) {
    const last = en.pop() || "";
    en[en.length - 1] = `${en[en.length - 1]} ${last}`.trim();
  }
  while (zh.length > en.length && zh.length > 1) {
    const last = zh.pop() || "";
    zh[zh.length - 1] = `${zh[zh.length - 1]}${last}`.trim();
  }
  return { english: en, chinese: zh };
}

function burstLong(english: string[], chinese: string[]): { english: string[]; chinese: string[] } {
  const en: string[] = [];
  const zh: string[] = [];
  english.forEach((part, index) => {
    if (part.length <= 90) {
      en.push(part);
      zh.push(chinese[index] || "");
      return;
    }
    const chunks = wordChunks(part, 46);
    const pieces = splitChineseEvenly(chinese[index] || "", chunks.length);
    chunks.forEach((chunk, chunkIndex) => {
      en.push(chunk);
      zh.push(pieces[chunkIndex] || pieces[pieces.length - 1] || "");
    });
  });
  return { english: en, chinese: zh };
}

function isSafeCut(chars: string[], index: number): boolean {
  const previous = chars[index - 1];
  const next = chars[index];
  if (!previous || !next) return false;
  if (/\s/.test(previous) || /\s/.test(next)) return true;
  return /[\u4e00-\u9fff，。！？、]/.test(previous) && /[\u4e00-\u9fff，。！？、]/.test(next);
}

function splitChineseEvenly(text: string, count: number): string[] {
  const clauses = text
    .split(/(?<=[，,、；;。！？])/)
    .map((part) => part.trim())
    .filter(Boolean);
  const parts = clauses.length ? [...clauses] : [text.trim()];
  if (count <= 1) return [parts.join("")];
  while (parts.length > count) {
    let joinAt = 0;
    let shortest = Infinity;
    for (let index = 0; index < parts.length - 1; index += 1) {
      const length = parts[index].length + parts[index + 1].length;
      if (length < shortest) {
        shortest = length;
        joinAt = index;
      }
    }
    parts.splice(joinAt, 2, `${parts[joinAt]}${parts[joinAt + 1]}`);
  }
  while (parts.length < count) {
    let longest = 0;
    for (let index = 1; index < parts.length; index += 1) {
      if (parts[index].length > parts[longest].length) longest = index;
    }
    const chars = [...parts[longest]];
    if (chars.length < 4) break;
    const middle = Math.floor(chars.length / 2);
    let cut = middle;
    for (let distance = 0; distance < chars.length; distance += 1) {
      if (middle - distance > 1 && isSafeCut(chars, middle - distance)) {
        cut = middle - distance;
        break;
      }
      if (middle + distance < chars.length - 1 && isSafeCut(chars, middle + distance)) {
        cut = middle + distance;
        break;
      }
    }
    const left = chars.slice(0, cut).join("").trim();
    const right = chars.slice(cut).join("").trim();
    if (!left || !right) break;
    parts.splice(longest, 1, left, right);
  }
  return parts.filter(Boolean);
}

export function expandBilingualCues<T extends { start: number; end: number; zh: string; source?: string }>(
  cues: T[],
): T[] {
  const expanded: T[] = [];
  for (const cue of cues) {
    const english = assText(cue.source || "");
    const chinese = assText(cue.zh);
    const aligned = alignParts(english ? splitEnglish(english) : [], splitChineseClauses(chinese));
    const fitted = burstLong(aligned.english, aligned.chinese);
    if (fitted.english.length <= 1) {
      expanded.push({ ...cue, zh: fitted.chinese[0] || chinese, source: fitted.english[0] || english });
      continue;
    }
    const weights = fitted.english.map((part) => Math.max(part.split(/\s+/).length, 1));
    const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
    const duration = Math.max(cue.end - cue.start, 0.4);
    let cursor = cue.start;
    fitted.english.forEach((part, index) => {
      const end = index === fitted.english.length - 1 ? cue.end : cursor + (duration * weights[index]) / weightTotal;
      expanded.push({
        ...cue,
        start: cursor,
        end: Math.max(end, cursor + 0.35),
        zh: fitted.chinese[index] || chinese,
        source: part,
      });
      cursor = end;
    });
  }
  return expanded;
}

export function pickSizes(height: number): { cn: number; en: number } {
  const key = Object.keys(SIZE_TABLE)
    .map(Number)
    .reduce((best, item) =>
      Math.abs(item - (height || 720)) < Math.abs(best - (height || 720)) ? item : best,
    );
  const [cn, en] = SIZE_TABLE[key];
  return { cn, en };
}

export function toSrt(cues: { start: number; end: number; lines: string[] }[]): string {
  return cues
    .map((cue, index) => {
      const body = cue.lines.filter(Boolean).join("\n");
      return `${index + 1}\n${srtTimestamp(cue.start)} --> ${srtTimestamp(cue.end)}\n${body}\n`;
    })
    .join("\n");
}

export type SubtitleLook = {
  cnSize: number;
  enSize: number;
  cnColor: string;
  enColor: string;
  order: "zh-top" | "en-top";
};

export const defaultSubtitleLook: SubtitleLook = {
  cnSize: 20,
  enSize: 16,
  cnColor: "#FFFFFF",
  enColor: "#FFE08A",
  order: "zh-top" as const,
};

function assColor(hex: string): string {
  const raw = hex.replace("#", "").padStart(6, "0");
  return `&H00${raw.slice(4, 6)}${raw.slice(2, 4)}${raw.slice(0, 2)}&`;
}

function outlineFor(hex: string): string {
  const raw = hex.replace("#", "");
  const red = Number.parseInt(raw.slice(0, 2), 16);
  const green = Number.parseInt(raw.slice(2, 4), 16);
  const blue = Number.parseInt(raw.slice(4, 6), 16);
  const luma = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;
  return luma > 0.6 ? "&H00000000&" : "&H00FFFFFF&";
}

function paint(text: string, size: number, color: string): string {
  return `{\\fs${size}\\c${assColor(color)}\\3c${outlineFor(color)}}${text}`;
}

export function toAss(
  cues: { start: number; end: number; zh: string; source?: string }[],
  height: number,
  track: "zh" | "en" | "bilingual",
  style: SubtitleLook = defaultSubtitleLook,
): string {
  const margin = track === "bilingual" ? 16 : 30;
  const header = `[Script Info]
ScriptType: v4.00+
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${process.platform === "win32" ? "Microsoft YaHei" : "PingFang SC"},${style.cnSize},&H00FFFFFF,&H000000FF,&H64000000,&H00000000,1,0,0,0,100,100,0,0,1,1.2,0,2,20,20,${margin},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const rows = track === "bilingual" ? expandBilingualCues(cues) : cues;
  const lines = rows.map((cue) => {
    const chinese = paint(assText(cue.zh), style.cnSize, style.cnColor);
    const english = cue.source ? paint(assText(cue.source), style.enSize, style.enColor) : "";
    const linesOfText =
      track === "bilingual" && english
        ? style.order === "en-top"
          ? [english, chinese]
          : [chinese, english]
        : track === "en" && english
          ? [english]
          : [chinese];
    const text = linesOfText.join("\\N");
    return `Dialogue: 0,${assTimestamp(cue.start)},${assTimestamp(cue.end)},Default,,0,0,0,,${text}`;
  });
  return `${header}${lines.join("\n")}\n`;
}

function yamlQuote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function toMarkdown(title: string, sourceUrl: string, paragraphs: string[]): string {
  const body = paragraphs.map((paragraph) => paragraph.trim()).filter(Boolean).join("\n\n");
  return `---\ntitle: ${yamlQuote(title)}\nsource_url: ${yamlQuote(sourceUrl)}\n---\n\n${body}\n`;
}

export function paragraphsFromCues(cues: Cue[], field: "text" | "zh"): string[] {
  const paragraphs: string[] = [];
  let bucket: string[] = [];
  let previousEnd = 0;

  const flush = () => {
    const text = bucket.join(field === "zh" ? "" : " ").replace(/\s+/g, " ").trim();
    if (text) paragraphs.push(text);
    bucket = [];
  };

  cues.forEach((cue, index) => {
    const value = (field === "zh" ? cue.zh : cue.text).trim();
    if (!value) return;
    if (bucket.length && cue.start - previousEnd > 1.4) flush();
    bucket.push(value);
    previousEnd = cue.end;
    if (index === cues.length - 1) flush();
  });
  if (bucket.length) flush();
  return paragraphs;
}

export function isChineseLanguage(code: string | undefined): boolean {
  return (code || "").toLowerCase().startsWith("zh");
}
