import type { ChildProcess } from "child_process";
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";

type ControlState = {
  processes: Map<string, ChildProcess>;
  paused: Set<string>;
};

const globalState = globalThis as typeof globalThis & { __transytControl?: ControlState };

function state(): ControlState {
  if (!globalState.__transytControl) {
    globalState.__transytControl = { processes: new Map(), paused: new Set() };
  }
  return globalState.__transytControl;
}

export class PauseError extends Error {
  constructor() {
    super("已暂停");
    this.name = "PauseError";
  }
}

export function isPauseRequested(id: string): boolean {
  return state().paused.has(id);
}

export function clearPause(id: string) {
  state().paused.delete(id);
}

function pidPath(id: string): string {
  return path.join(process.cwd(), "data", "jobs", id, "active.pid");
}

export function attachProcess(id: string, child: ChildProcess) {
  state().processes.set(id, child);
  if (child.pid) fs.writeFileSync(pidPath(id), String(child.pid));
}

export function detachProcess(id: string, child: ChildProcess) {
  const current = state();
  if (current.processes.get(id) === child) current.processes.delete(id);
  fs.rmSync(pidPath(id), { force: true });
}

function killPid(pid: number) {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // The process has already exited.
    }
  }
}

export function requestPause(id: string) {
  state().paused.add(id);
  const child = state().processes.get(id);
  if (child?.pid) killPid(child.pid);
  try {
    const pid = Number(fs.readFileSync(pidPath(id), "utf8"));
    if (pid) killPid(pid);
  } catch {
    // No pid file yet.
  }
}
