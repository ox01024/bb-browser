/**
 * open 命令 - 打开指定 URL
 * 用法：bb-browser open <url>
 */

import { generateId, type Request, type Response } from "@bb-browser/shared";
import { sendCommand } from "../client.js";
import { ensureDaemonRunning } from "../daemon-manager.js";

export interface OpenOptions {
  json?: boolean;
}

export async function openCommand(
  url: string,
  options: OpenOptions = {}
): Promise<void> {
  // 验证 URL
  if (!url) {
    throw new Error("缺少 URL 参数");
  }

  // 确保 Daemon 运行
  await ensureDaemonRunning();

  // 补全 URL 协议
  let normalizedUrl = url;
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    normalizedUrl = "https://" + url;
  }

  // 构造请求
  const request: Request = {
    id: generateId(),
    action: "open",
    url: normalizedUrl,
  };

  // 发送请求
  const response: Response = await sendCommand(request);

  // 输出结果
  if (options.json) {
    console.log(JSON.stringify(response, null, 2));
  } else {
    if (response.success) {
      console.log(`已打开: ${response.data?.url ?? normalizedUrl}`);
      if (response.data?.title) {
        console.log(`标题: ${response.data.title}`);
      }
    } else {
      console.error(`错误: ${response.error}`);
      process.exit(1);
    }
  }
}
