import { randomBytes } from "crypto";
import fs from "fs/promises";
import path from "path";

export type Folder = { id: string; name: string };

const file = path.join(process.cwd(), "data", "folders.json");

export async function listFolders(): Promise<Folder[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8")) as Folder[];
    return Array.isArray(parsed) ? parsed.filter((item) => item && item.id && item.name) : [];
  } catch {
    return [];
  }
}

async function saveFolders(folders: Folder[]) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(folders, null, 2));
}

export async function createFolder(name: string): Promise<Folder> {
  const folders = await listFolders();
  const folder = { id: randomBytes(4).toString("hex"), name: name.trim().slice(0, 16) };
  folders.push(folder);
  await saveFolders(folders);
  return folder;
}

export async function renameFolder(id: string, name: string): Promise<Folder | null> {
  const folders = await listFolders();
  const folder = folders.find((item) => item.id === id);
  if (!folder) return null;
  folder.name = name.trim().slice(0, 16);
  await saveFolders(folders);
  return folder;
}

export async function removeFolder(id: string): Promise<void> {
  const folders = (await listFolders()).filter((item) => item.id !== id);
  await saveFolders(folders);
}
