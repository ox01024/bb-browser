/**
 * bb-browser Content Script
 *
 * 负责：
 * - 接收 Background 的指令
 * - 执行 DOM 操作（click, fill 等）
 * - 生成页面快照
 */

// 监听来自 Background 的消息
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  console.log('[bb-browser] Content received:', message);

  switch (message.type) {
    case 'snapshot':
      // 返回页面信息
      sendResponse({
        success: true,
        data: {
          title: document.title,
          url: location.href,
          // TODO: 可交互元素提取
        },
      });
      break;

    case 'ping':
      sendResponse({ success: true, data: 'pong' });
      break;

    default:
      sendResponse({ success: false, error: `Unknown message type: ${message.type}` });
  }

  return true; // 保持消息通道开放
});

console.log('[bb-browser] Content script loaded on:', location.href);
