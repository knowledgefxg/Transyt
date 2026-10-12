import type { Settings } from "./types";

export const cefrLevels = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
export const lexemeKinds = ["word", "phrase", "collocation", "idiom", "slang", "usage"] as const;

export type CefrLevel = (typeof cefrLevels)[number];
export type LexemeKind = (typeof lexemeKinds)[number];

export type Lexeme = {
  text: string;
  kind: LexemeKind;
  level: CefrLevel;
  zh: string;
  ipa: string;
  source: string;
  note: string;
  start?: number;
};

export function levelSpan(from: string, to: string): CefrLevel[] {
  const start = cefrLevels.indexOf(from as CefrLevel);
  const end = cefrLevels.indexOf(to as CefrLevel);
  if (start < 0 || end < 0) return [...cefrLevels];
  const low = Math.min(start, end);
  const high = Math.max(start, end);
  return cefrLevels.slice(low, high + 1);
}
const levelSet = new Set<string>(cefrLevels);
const kindSet = new Set<string>(lexemeKinds);
const skipWords = new Set([
  "the", "a", "an", "and", "or", "but", "if", "to", "of", "in", "on", "for", "with", "at", "from", "by",
  "is", "are", "was", "were", "be", "been", "being", "it", "this", "that", "these", "those",
  "i", "you", "he", "she", "we", "they", "my", "your", "his", "her", "our", "their",
]);

function chatUrl(base: string): string {
  const trimmed = base.replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) return trimmed;
  return `${trimmed}/chat/completions`;
}

function extractJson(content: string): unknown {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : content;
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch {
      // 后面再尽量捡出已经写完的对象。
    }
  }
  const objects = salvageObjects(start >= 0 ? raw.slice(start) : raw);
  if (objects.length) return objects;
  throw new Error("词汇结果里没有 JSON");
}

function salvageObjects(raw: string): unknown[] {
  const objects: unknown[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    if (raw[index] !== "{") continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let cursor = index; cursor < raw.length; cursor += 1) {
      const char = raw[cursor];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === "{") depth += 1;
      else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          try {
            objects.push(JSON.parse(raw.slice(index, cursor + 1)));
          } catch {
            // 跳过没写完的一项。
          }
          index = cursor;
          break;
        }
      }
    }
  }
  return objects;
}

function normalizeIpa(value: string): string {
  const bare = value.replace(/\s+/g, " ").trim().replace(/^[/[]+/, "").replace(/[/[\]]+$/, "").trim();
  if (!bare || bare.length > 90) return "";
  return `/${bare}/`;
}

export function parseLexemes(parsed: unknown): Lexeme[] {
  if (!Array.isArray(parsed)) return [];
  const items: Lexeme[] = [];
  for (const value of parsed) {
    if (!value || typeof value !== "object") continue;
    const row = value as { text?: unknown; kind?: unknown; level?: unknown; zh?: unknown; ipa?: unknown; source?: unknown; note?: unknown };
    const kind = String(row.kind || "");
    const level = String(row.level || "").toUpperCase();
    const text = String(row.text || "").replace(/\s+/g, " ").trim();
    const zh = String(row.zh || "").replace(/\s+/g, " ").trim();
    const ipa = normalizeIpa(String(row.ipa || ""));
    let source = String(row.source || "").replace(/\s+/g, " ").trim().replace(/^原文[:：]\s*/, "");
    let note = String(row.note || "").replace(/\s+/g, " ").trim().replace(/^原文[:：]\s*/, "");
    if (!source && note) {
      source = note;
      note = "";
    }
    if (!kindSet.has(kind) || !levelSet.has(level) || text.length < 2 || text.length > 80 || !zh) continue;
    if (kind === "word" && skipWords.has(text.toLowerCase())) continue;
    items.push({
      text,
      kind: kind as LexemeKind,
      level: level as CefrLevel,
      zh: zh.slice(0, 40),
      ipa,
      source: source.slice(0, 240),
      note: note.slice(0, 140),
    });
  }
  return items;
}

function dedupe(items: Lexeme[]): Lexeme[] {
  const seen = new Set<string>();
  const unique: Lexeme[] = [];
  for (const item of items) {
    const key = item.text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  const levelOrder = Object.fromEntries(cefrLevels.map((level, index) => [level, index]));
  const kindOrder = Object.fromEntries(lexemeKinds.map((kind, index) => [kind, index]));
  return unique.sort(
    (a, b) => levelOrder[a.level] - levelOrder[b.level] || kindOrder[a.kind] - kindOrder[b.kind] || a.text.localeCompare(b.text),
  );
}

function chunks(text: string, size = 7000): string[] {
  const parts: string[] = [];
  let rest = text.trim();
  while (rest.length > size) {
    let cut = rest.lastIndexOf("\n", size);
    if (cut < size * 0.5) cut = size;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

async function ask(chunk: string, settings: Settings, levels: CefrLevel[]): Promise<Lexeme[]> {
  const high = cefrLevels.indexOf(levels[0]) >= cefrLevels.indexOf("B2");
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(chatUrl(settings.apiBase), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify({
        model: settings.model,
        temperature: 0.2,
        max_tokens: 4096,
        thinking: { type: "disabled" },
        messages: [
          {
            role: "system",
            content: [
              "你从视频原文里挑值得学的语言点，只要原文里真正出现过的。",
              "类型只能是 word 单词、phrase 词组、collocation 搭配、idiom 习语、slang 俚语、usage 用法。",
              `这次只收录等级 ${levels.join("、")}。等级按欧洲语言共同参考框架如实估计，不能把更简单的表达改标到更高等级。`,
              high
                ? "这个区间偏高。只有原文里确实达到该难度的单词、词组、搭配、习语、俚语或用法才能收录。日常词和基础句式不要收，也不要硬凑。对不上就返回 []。"
                : "原文里没有达到所选等级的表达时，返回 []，不要硬凑。",
              "不要收录 the、a、and、is 这类功能词，也不要专有名词。同一表达只留一次。有多少算多少。",
              "每条都要带国际音标，放在 ipa 里，用斜杠包住，按单词或整条表达的实际读音标注。",
              "source 必须是原文里包含 text 的那一句，逐字摘录，不要改写，让 text 能在句子里原样找到。",
              `每项是 {"text":"原文中的表达","kind":"word","level":"真实等级","ipa":"/音标/","zh":"简短中文","source":"包含该表达的原文句子"}。只返回 JSON 数组，不要思考过程。`,
            ].join(""),
          },
          { role: "user", content: chunk },
        ],
      }),
    });
    const body = await response.text();
    if (!response.ok) {
      lastError = new Error(`翻译接口返回 ${response.status}：${body.slice(0, 180)}`);
      continue;
    }
    try {
      const payload = JSON.parse(body) as {
        choices?: { message?: { content?: string | null; reasoning_content?: string | null } }[];
      };
      const message = payload.choices?.[0]?.message;
      const content = (message?.content || "").trim() || (message?.reasoning_content || "").trim();
      if (!content) throw new Error("词汇结果是空的");
      const items = parseLexemes(extractJson(content)).filter((item) => levels.includes(item.level));
      return items;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("词汇结果读不出来");
    }
  }
  throw lastError || new Error("没有从文稿里认出词汇");
}

export async function extractLexicon(
  transcript: string,
  settings: Settings,
  range: { from: CefrLevel; to: CefrLevel } = { from: "A1", to: "C2" },
  shouldStop?: () => void,
): Promise<Lexeme[]> {
  if (!settings.apiKey) throw new Error("还没有填写翻译接口");
  const text = transcript.replace(/\s+\n/g, "\n").trim();
  if (text.length < 20) return [];
  const levels = levelSpan(range.from, range.to);
  const found: Lexeme[] = [];
  for (const chunk of chunks(text)) {
    shouldStop?.();
    found.push(...(await ask(chunk, settings, levels)));
  }
  return dedupe(found).slice(0, 160);
}

function loose(value: string): string {
  return value
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function attachCueTimes<T extends { text: string; source?: string; note?: string; start?: number }>(
  items: T[],
  cues: { start?: number; text?: string }[],
): T[] {
  const rows = cues
    .map((cue) => ({ start: Number(cue.start), text: loose(cue.text || "") }))
    .filter((cue) => Number.isFinite(cue.start) && cue.text);
  return items.map((item) => {
    const term = loose(item.text);
    const sentence = loose(item.source || item.note || "");
    if (!term) return item;
    const containing = rows.filter((cue) => cue.text.includes(term));
    const aligned = sentence
      ? containing.filter((cue) => sentence.includes(cue.text) || cue.text.includes(sentence))
      : [];
    const chosen = aligned[0] || containing[0];
    if (!chosen) return item;
    return { ...item, start: chosen.start };
  });
}
