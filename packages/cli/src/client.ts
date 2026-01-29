/**
 * HTTP 客户端 - 与 Daemon 通信
 */

import type { Request, Response } from "@bb-browser/shared";
import { DAEMON_BASE_URL, COMMAND_TIMEOUT } from "@bb-browser/shared";

/**
 * 发送命令到 Daemon 并等待响应
 */
export async function sendCommand(request: Request): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), COMMAND_TIMEOUT);

  try {
    const res = await fetch(`${DAEMON_BASE_URL}/command`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      // 根据 HTTP 状态码返回错误
      if (res.status === 408) {
        return {
          id: request.id,
          success: false,
          error: "命令执行超时",
        };
      }
      if (res.status === 503) {
        return {
          id: request.id,
          success: false,
          error: "扩展未连接",
        };
      }
      return {
        id: request.id,
        success: false,
        error: `HTTP 错误: ${res.status} ${res.statusText}`,
      };
    }

    return (await res.json()) as Response;
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error) {
      if (error.name === "AbortError") {
        return {
          id: request.id,
          success: false,
          error: "请求超时",
        };
      }
      // 连接错误
      if (
        error.message.includes("fetch failed") ||
        error.message.includes("ECONNREFUSED")
      ) {
        throw new Error("无法连接到 Daemon，请确保 Daemon 正在运行");
      }
      throw error;
    }
    throw error;
  }
}
