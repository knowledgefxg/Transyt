import fs from "fs/promises";
import path from "path";
import type { PublicSettings, Settings } from "./types";

const file = path.join(process.cwd(), "data", "settings.json");

const defaults: Settings = {
  apiBase: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4o-mini",
  proxy: "",
  cnSize: 20,
  enSize: 16,
  cnColor: "#FFFFFF",
  enColor: "#FFE08A",
  subtitleOrder: "zh-top",
};

function clampSize(value: unknown, fallback: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(64, Math.max(12, Math.round(number)));
}

function hexColor(value: unknown, fallback: string): string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value.toUpperCase() : fallback;
}

export async function readSettings(): Promise<Settings> {
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...defaults, ...parsed };
  } catch {
    return { ...defaults };
  }
}

export async function writeSettings(next: Partial<Settings>): Promise<Settings> {
  const current = await readSettings();
  let apiBase = (next.apiBase ?? current.apiBase).trim() || defaults.apiBase;
  let apiKey = next.apiKey === undefined ? current.apiKey : next.apiKey.trim();
  let model = (next.model ?? current.model).trim() || defaults.model;
  if (/^sk-/i.test(model)) {
    if (!apiKey) apiKey = model;
    model = /deepseek/i.test(apiBase) ? "deepseek-chat" : defaults.model;
  }
  const merged: Settings = {
    apiBase,
    apiKey,
    model,
    proxy: (next.proxy ?? current.proxy).trim(),
    cnSize: clampSize(next.cnSize ?? current.cnSize, defaults.cnSize),
    enSize: clampSize(next.enSize ?? current.enSize, defaults.enSize),
    cnColor: hexColor(next.cnColor ?? current.cnColor, defaults.cnColor),
    enColor: hexColor(next.enColor ?? current.enColor, defaults.enColor),
    subtitleOrder: (next.subtitleOrder ?? current.subtitleOrder) === "en-top" ? "en-top" : "zh-top",
  };
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(merged, null, 2));
  return merged;
}

export function toPublicSettings(settings: Settings): PublicSettings {
  return {
    apiBase: settings.apiBase,
    model: settings.model,
    proxy: settings.proxy,
    hasKey: Boolean(settings.apiKey),
    cnSize: settings.cnSize,
    enSize: settings.enSize,
    cnColor: settings.cnColor,
    enColor: settings.enColor,
    subtitleOrder: settings.subtitleOrder,
  };
}
