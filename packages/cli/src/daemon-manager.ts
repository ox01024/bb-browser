/**
 * Daemon 管理器 - 检测、启动和停止 Daemon
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { DAEMON_BASE_URL } from "@bb-browser/shared";

/** 获取 daemon dist 路径 */
function getDaemonPath(): string {
  // CLI dist 在 packages/cli/dist/index.js
  // Daemon dist 在 packages/daemon/dist/index.js
  const currentFile = fileURLToPath(import.meta.url);
  const currentDir = dirname(currentFile);
  // 从 cli/dist 回到 packages/，再进入 daemon/dist
  return resolve(currentDir, "../../daemon/dist/index.js");
}

/** Daemon 启动超时时间（毫秒） */
const DAEMON_START_TIMEOUT = 5000;

/** 轮询间隔（毫秒） */
const POLL_INTERVAL = 200;

/**
 * 检查 Daemon 是否正在运行
 */
export async function isDaemonRunning(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);

    const response = await fetch(`${DAEMON_BASE_URL}/status`, {
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * 等待 Daemon 就绪
 */
async function waitForDaemon(timeoutMs: number): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    if (await isDaemonRunning()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
  }

  return false;
}

/**
 * 启动 Daemon 后台进程
 */
function spawnDaemon(): void {
  const daemonPath = getDaemonPath();
  
  const daemonProcess = spawn(process.execPath, [daemonPath], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env },
  });

  // 让进程在后台运行
  daemonProcess.unref();
}

/**
 * 确保 Daemon 正在运行
 * 如果未运行，自动启动并等待就绪
 */
export async function ensureDaemonRunning(): Promise<void> {
  if (await isDaemonRunning()) {
    return;
  }

  // 启动 Daemon
  spawnDaemon();

  // 等待 Daemon 就绪
  const ready = await waitForDaemon(DAEMON_START_TIMEOUT);

  if (!ready) {
    throw new Error(
      "无法启动 Daemon。请手动运行 bb-browser daemon 或 bb-daemon 启动服务"
    );
  }
}

/**
 * 停止 Daemon
 */
export async function stopDaemon(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`${DAEMON_BASE_URL}/shutdown`, {
      method: "POST",
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    return response.ok;
  } catch {
    return false;
  }
}
