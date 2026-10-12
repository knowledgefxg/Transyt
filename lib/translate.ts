import type { Settings } from "./types";

function chatUrl(base: string): string {
  const trimmed = base.replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) return trimmed;
  return `${trimmed}/chat/completions`;
}

function extractJson(content: string): unknown {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : content;
  const start = Math.min(
    ...["[", "{"].map((mark) => {
      const index = raw.indexOf(mark);
      return index < 0 ? Number.POSITIVE_INFINITY : index;
    }),
  );
  const end = Math.max(raw.lastIndexOf("]"), raw.lastIndexOf("}"));
  if (!Number.isFinite(start) || end < start) throw new Error("翻译结果里没有 JSON");
  return JSON.parse(raw.slice(start, end + 1));
}

function align(count: number, parsed: unknown): string[] | null {
  if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string") && parsed.length === count) {
    return parsed;
  }
  if (!Array.isArray(parsed)) return null;
  const translated = new Array<string>(count).fill("");
  let filled = 0;
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const row = item as { i?: unknown; zh?: unknown };
    const index = Number(row.i);
    if (!Number.isInteger(index) || index < 0 || index >= count || typeof row.zh !== "string") continue;
    if (!translated[index]) filled += 1;
    translated[index] = row.zh.trim();
  }
  return filled === count && translated.every(Boolean) ? translated : null;
}

async function requestTranslation(lines: string[], settings: Settings): Promise<unknown> {
  const response = await fetch(chatUrl(settings.apiBase), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "你在给视频写中文字幕。逐条翻译，不能合并，不能漏掉。每条中文只写一行，不要换行。去掉句末标点。产品名、协议名、人名保留英文。只返回 JSON 数组，每项是 {\"i\":序号,\"zh\":\"译文\"}，i 必须和输入一致。",
        },
        {
          role: "user",
          content: JSON.stringify(lines.map((text, index) => ({ i: index, text }))),
        },
      ],
    }),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`翻译接口返回 ${response.status}：${body.slice(0, 280)}`);
  const payload = JSON.parse(body) as { choices?: { message?: { content?: string } }[] };
  return extractJson(payload.choices?.[0]?.message?.content || "");
}

async function translateBatch(lines: string[], settings: Settings): Promise<string[]> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const aligned = align(lines.length, await requestTranslation(lines, settings));
    if (aligned) return aligned;
  }
  if (lines.length === 1) throw new Error("有一条字幕没有译出来");
  const middle = Math.ceil(lines.length / 2);
  const [left, right] = await Promise.all([
    translateBatch(lines.slice(0, middle), settings),
    translateBatch(lines.slice(middle), settings),
  ]);
  return [...left, ...right];
}

export async function translateLines(
  lines: string[],
  settings: Settings,
  shouldStop?: () => void,
): Promise<string[]> {
  if (!settings.apiKey) {
    throw new Error("还没有填写翻译接口。转写结果已保存，可以在右上角补上密钥后继续。");
  }
  const size = 12;
  const batches: string[][] = [];
  for (let index = 0; index < lines.length; index += size) {
    batches.push(lines.slice(index, index + size));
  }
  const translated: string[][] = new Array(batches.length);
  let cursor = 0;

  async function worker() {
    while (cursor < batches.length) {
      shouldStop?.();
      const index = cursor;
      cursor += 1;
      translated[index] = await translateBatch(batches[index], settings);
    }
  }

  await Promise.all(Array.from({ length: Math.min(3, batches.length) }, () => worker()));
  return translated.flat();
}
