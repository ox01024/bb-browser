import { execFileSync } from "node:child_process";
import { parseOpenClawJson } from "./openclaw-json.js";

export interface OCTab {
  targetId: string;
  url: string;
  title: string;
  type: string;
}

function runOpenClaw(args: string[], timeout: number): string {
  return execFileSync("npx", ["openclaw", "browser", ...args], {
    encoding: "utf-8",
    timeout,
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

export function ocGetTabs(): OCTab[] {
  const raw = runOpenClaw(["tabs", "--json"], 15000);
  const data = parseOpenClawJson<{ tabs?: OCTab[] }>(raw);
  return (data.tabs || []).filter((tab: OCTab) => tab.type === "page");
}

export function ocFindTabByDomain(tabs: OCTab[], domain: string): OCTab | undefined {
  return tabs.find((tab) => {
    try {
      const hostname = new URL(tab.url).hostname;
      return hostname === domain || hostname.endsWith(`.${domain}`);
    } catch {
      return false;
    }
  });
}

export function ocOpenTab(url: string): string {
  const raw = runOpenClaw(["open", url, "--json"], 30000);
  const data = parseOpenClawJson<{ id?: string; targetId?: string }>(raw);
  return data.id || data.targetId;
}

export function ocEvaluate(targetId: string, fn: string): unknown {
  const raw = runOpenClaw(["evaluate", "--fn", fn, "--target-id", targetId], 30000);
  return parseOpenClawJson(raw);
}
