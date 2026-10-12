export type ReadingBlock = { kind: "heading" | "paragraph"; text: string; source?: string };

export type TimedLine = { start: number; end: number; text: string };

function parseTime(value: string): number {
  const match = value.trim().match(/(\d+):(\d+):(\d+)[,.](\d+)/);
  if (!match) return 0;
  const fraction = match[4].padEnd(3, "0").slice(0, 3);
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(fraction) / 1000;
}

export function cuesFromSrt(srt: string): TimedLine[] {
  return srt
    .replace(/^\uFEFF/, "")
    .trim()
    .split(/\n\s*\n/)
    .flatMap((block) => {
      const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
      const timeIndex = lines.findIndex((line) => line.includes("-->"));
      if (timeIndex < 0 || !lines[timeIndex + 1]) return [];
      const [start, end] = lines[timeIndex].split("-->");
      return [{ start: parseTime(start), end: parseTime(end), text: lines[timeIndex + 1] }];
    });
}

function isHeading(text: string): boolean {
  const value = text.trim();
  if (value.length < 2 || value.length > 22) return false;
  if (/[\u4e00-\u9fff]/.test(value)) return false;
  if (!/[A-Za-z]/.test(value)) return false;
  return value.split(/\s+/).length <= 3;
}

function cjkCount(text: string): number {
  return [...text].filter((char) => /[\u4e00-\u9fff]/.test(char)).length;
}

function clause(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, " ")
    .replace(/([\u4e00-\u9fff]) (?=[\u4e00-\u9fff])/g, "$1，")
    .replace(/[，、；,;。！？.!?…\s]+$/g, "");
}

export function blocksFromCues(cues: TimedLine[], sources?: string[]): ReadingBlock[] {
  const blocks: ReadingBlock[] = [];
  let sentences: string[] = [];
  let english: string[] = [];
  let previousEnd = 0;

  const flush = () => {
    const text = sentences
      .filter(Boolean)
      .join("，")
      .replace(/([\u4e00-\u9fff])(?=[A-Z]{2,})/g, "$1。");
    const source = english.join(" ").replace(/\s+/g, " ").trim();
    sentences = [];
    english = [];
    if (!text && !source) return;
    blocks.push({
      kind: "paragraph",
      text: text ? (/[。！？.!?]$/.test(text) ? text : `${text}。`) : "",
      source: source || undefined,
    });
  };

  cues.forEach((cue, index) => {
    const raw = cue.text.trim();
    const paired = (sources?.[index] || "").replace(/\s+/g, " ").trim();
    if (!raw && !paired) return;
    if (raw && isHeading(raw)) {
      flush();
      blocks.push({ kind: "heading", text: raw, source: paired || undefined });
      previousEnd = cue.end;
      return;
    }
    const line = raw ? clause(raw) : "";
    if (!line && !paired) return;
    const short = cjkCount(line) > 0 && cjkCount(line) <= 2;
    const length = sentences.join("").length;
    const gap = sentences.length ? cue.start - previousEnd : 0;
    if (sentences.length && !short && (gap > 0.9 || length >= 88 || sentences.length >= 3)) flush();
    if (sentences.length && line && (short || cjkCount(sentences[sentences.length - 1]) <= 2)) {
      sentences[sentences.length - 1] += line;
      if (paired) english[english.length - 1] = `${english[english.length - 1]} ${paired}`.trim();
    } else {
      sentences.push(line);
      english.push(paired);
    }
    previousEnd = cue.end;
  });
  flush();
  return blocks;
}

export function blocksFromSrt(srt: string): ReadingBlock[] {
  return blocksFromCues(cuesFromSrt(srt));
}

export function blocksFromBilingual(chinese: string, english: string): ReadingBlock[] {
  const zh = cuesFromSrt(chinese);
  const en = cuesFromSrt(english);
  const sources = zh.map((cue, index) => {
    const same = en[index];
    if (same && Math.abs(same.start - cue.start) < 0.2) return same.text;
    return en.find((line) => Math.abs(line.start - cue.start) < 0.2)?.text || "";
  });
  return blocksFromCues(zh, sources);
}

export type FoldRow = { title: string; body: string };

function firstSentence(text: string): string {
  const match = text.match(/^[^。！？.!?]+[。！？.!?]?/);
  const sentence = (match?.[0] || text).trim();
  return sentence || text;
}

export function foldRows(blocks: ReadingBlock[]): FoldRow[] {
  const rows: FoldRow[] = [];
  let index = 0;
  while (index < blocks.length) {
    const block = blocks[index];
    if (block.kind === "heading") {
      const parts: string[] = [];
      index += 1;
      while (index < blocks.length && blocks[index].kind !== "heading") {
        parts.push(blocks[index].text);
        index += 1;
      }
      rows.push({ title: block.text, body: parts.join("\n\n") });
      continue;
    }
    rows.push({ title: firstSentence(block.text), body: block.text });
    index += 1;
  }
  return rows;
}
