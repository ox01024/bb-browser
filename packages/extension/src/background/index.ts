/**
 * bb-browser Background Service Worker
 *
 * 负责：
 * - 通过 SSE 连接 Daemon 接收命令
 * - 协调 Content Scripts
 * - 管理扩展状态
 */

import { SSEClient } from './sse-client';
import { handleCommand } from './command-handler';

// 创建 SSE 客户端
const sseClient = new SSEClient();

// 注册命令处理器
sseClient.onCommand(handleCommand);

// 监听来自 Content Script 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[bb-browser] Message from content script:', message, 'sender:', sender.tab?.id);
  sendResponse({ received: true });
  return true;
});

// 扩展安装/更新事件
chrome.runtime.onInstalled.addListener((details) => {
  console.log('[bb-browser] Extension installed/updated:', details.reason);
  // 安装后自动连接
  sseClient.connect();
});

// Service Worker 启动时连接
chrome.runtime.onStartup.addListener(() => {
  console.log('[bb-browser] Browser started, connecting to daemon...');
  sseClient.connect();
});

// 立即尝试连接（处理扩展重载的情况）
console.log('[bb-browser] Background service worker started, connecting to daemon...');
sseClient.connect();
