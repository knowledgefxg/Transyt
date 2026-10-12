import { NextResponse } from "next/server";
import { readSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function chatUrl(base: string): string {
  const trimmed = base.replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) return trimmed;
  return `${trimmed}/chat/completions`;
}

export async function POST(request: Request) {
  let text = "";
  try {
    const body = (await request.json()) as { text?: string };
    text = String(body.text || "").replace(/\s+/g, " ").trim().slice(0, 400);
  } catch {
    return NextResponse.json({ error: "没有句子" }, { status: 400 });
  }
  if (!text) return NextResponse.json({ error: "没有句子" }, { status: 400 });

  const settings = await readSettings();
  if (!settings.apiKey) return NextResponse.json({ error: "还没有填写翻译接口" }, { status: 400 });

  const response = await fetch(chatUrl(settings.apiBase), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model,
      temperature: 0.2,
      max_tokens: 300,
      thinking: { type: "disabled" },
      messages: [
        { role: "system", content: "把这句英语译成自然中文。只返回译文，不要引号，不要解释。" },
        { role: "user", content: text },
      ],
    }),
  });
  const raw = await response.text();
  if (!response.ok) return NextResponse.json({ error: `翻译接口返回 ${response.status}` }, { status: 502 });
  const payload = JSON.parse(raw) as { choices?: { message?: { content?: string | null } }[] };
  const zh = (payload.choices?.[0]?.message?.content || "").replace(/^["“]|["”]$/g, "").trim();
  if (!zh) return NextResponse.json({ error: "没有译出来" }, { status: 502 });
  return NextResponse.json({ zh });
}
