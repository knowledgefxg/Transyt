const hosts = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "www.youtu.be",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);

export function isYouTubeUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  if (!hosts.has(host)) return false;
  if (host.endsWith("youtu.be")) return url.pathname.length > 1;
  if (url.searchParams.get("v")) return true;
  return /^\/(shorts|live|embed|v)\/[^/]+/.test(url.pathname);
}

export function youtubeVideoId(value: string): string {
  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase();
    if (host.endsWith("youtu.be")) return url.pathname.replace(/^\//, "").split("/")[0] || "";
    const id = url.searchParams.get("v");
    if (id) return id;
    const match = url.pathname.match(/\/(?:shorts|live|embed|v)\/([^/]+)/);
    return match?.[1] || "";
  } catch {
    return "";
  }
}
