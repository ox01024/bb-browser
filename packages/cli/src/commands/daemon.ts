/**
 * daemon 命令 - Daemon 管理
 * 用法：
 *   bb-browser daemon    前台启动 Daemon
 *   bb-browser start     前台启动 Daemon（别名）
 *   bb-browser stop      停止 Daemon
 */

import { pathToFileURL } from "node:url";
import { getDaemonPath, isDaemonRunning, stopDaemon } from "../daemon-manager.js";

export interface DaemonOptions {
  json?: boolean;
}

interface DaemonModule {
  startDaemon: (args?: string[]) => Promise<void>;
}

/** 前台启动 Daemon */
export async function daemonCommand(
  options: DaemonOptions = {}
): Promise<void> {
  // 检查是否已经运行
  if (await isDaemonRunning()) {
    if (options.json) {
      console.log(JSON.stringify({ success: false, error: "Daemon 已在运行" }));
    } else {
      console.log("Daemon 已在运行");
    }
    return;
  }

  // 加载 daemon 入口文件并在当前进程启动
  try {
    const daemonPath = getDaemonPath();

    if (options.json) {
      console.log(JSON.stringify({ success: true, message: "Daemon 启动中..." }));
    } else {
      console.log("Daemon 启动中...");
    }

    const daemonModule = (await import(
      pathToFileURL(daemonPath).href
    )) as Partial<DaemonModule>;

    if (typeof daemonModule.startDaemon !== "function") {
      throw new Error(`Daemon 模块未导出 startDaemon: ${daemonPath}`);
    }

    await daemonModule.startDaemon([]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    
    if (options.json) {
      console.log(JSON.stringify({ success: false, error: message }));
    } else {
      console.error(`启动失败: ${message}`);
    }
    process.exit(1);
  }
}

/**
 * 停止 Daemon
 */
export async function stopCommand(options: DaemonOptions = {}): Promise<void> {
  // 检查是否运行中
  if (!(await isDaemonRunning())) {
    if (options.json) {
      console.log(JSON.stringify({ success: false, error: "Daemon 未运行" }));
    } else {
      console.log("Daemon 未运行");
    }
    return;
  }

  // 发送停止信号
  const stopped = await stopDaemon();

  if (stopped) {
    if (options.json) {
      console.log(JSON.stringify({ success: true, message: "Daemon 已停止" }));
    } else {
      console.log("Daemon 已停止");
    }
  } else {
    if (options.json) {
      console.log(JSON.stringify({ success: false, error: "无法停止 Daemon" }));
    } else {
      console.error("无法停止 Daemon");
    }
    process.exit(1);
  }
}

/**
 * 状态命令
 */
export async function statusCommand(
  options: DaemonOptions = {}
): Promise<void> {
  const running = await isDaemonRunning();

  if (options.json) {
    console.log(JSON.stringify({ running }));
  } else {
    console.log(running ? "Daemon 运行中" : "Daemon 未运行");
  }
}
