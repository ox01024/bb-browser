/**
 * CDP Service for bb-browser Extension
 * 
 * 封装 chrome.debugger API，提供统一的 CDP 调用接口。
 * 所有 DOM 操作、输入模拟、脚本执行都通过这个服务层进行。
 */

// ============================================================================
// 类型定义
// ============================================================================

/** CDP 命令结果的基础类型 */
interface CDPResult {
  [key: string]: unknown;
}

/** Runtime.evaluate 的结果 */
interface RuntimeEvaluateResult {
  result?: {
    type: string;
    value?: unknown;
    objectId?: string;
    description?: string;
    subtype?: string;
  };
  exceptionDetails?: {
    exception?: { description?: string };
    text?: string;
  };
}

/** DOM.getDocument 的结果 */
interface DOMGetDocumentResult {
  root: {
    nodeId: number;
    backendNodeId: number;
    nodeType: number;
    nodeName: string;
    childNodeCount?: number;
    children?: DOMNode[];
  };
}

/** DOM 节点类型 */
interface DOMNode {
  nodeId: number;
  backendNodeId: number;
  nodeType: number;
  nodeName: string;
  localName?: string;
  nodeValue?: string;
  childNodeCount?: number;
  children?: DOMNode[];
  attributes?: string[];
  frameId?: string;
  contentDocument?: DOMNode;
  shadowRoots?: DOMNode[];
}

/** DOM.querySelector 的结果 */
interface DOMQuerySelectorResult {
  nodeId: number;
}

/** DOM.getBoxModel 的结果 */
interface DOMGetBoxModelResult {
  model: {
    content: number[];  // [x1, y1, x2, y2, x3, y3, x4, y4]
    padding: number[];
    border: number[];
    margin: number[];
    width: number;
    height: number;
  };
}

/** DOM.resolveNode 的结果 */
interface DOMResolveNodeResult {
  object: {
    type: string;
    objectId?: string;
    className?: string;
    description?: string;
  };
}

/** Page.captureScreenshot 的结果 */
interface PageCaptureScreenshotResult {
  data: string;  // base64 encoded
}

/** Accessibility.getFullAXTree 的结果 */
interface AccessibilityGetFullAXTreeResult {
  nodes: AXNode[];
}

/** 可访问性树节点 */
export interface AXNode {
  nodeId: string;
  ignored: boolean;
  role?: { type: string; value?: string };
  name?: { type: string; value?: string; sources?: unknown[] };
  description?: { type: string; value?: string };
  value?: { type: string; value?: unknown };
  properties?: Array<{
    name: string;
    value: { type: string; value?: unknown };
  }>;
  childIds?: string[];
  backendDOMNodeId?: number;
  frameId?: string;
}

/** Dialog 信息 */
export interface DialogInfo {
  url: string;
  message: string;
  type: 'alert' | 'confirm' | 'prompt' | 'beforeunload';
  defaultPrompt?: string;
  hasBrowserHandler: boolean;
}

// ============================================================================
// 状态管理
// ============================================================================

/** 已 attach 的 tab 集合 */
const attachedTabs = new Set<number>();

/** 待处理的 dialog 信息 */
const pendingDialogs = new Map<number, DialogInfo>();

// ============================================================================
// 核心 CDP 调用
// ============================================================================

/**
 * 确保 debugger 已附加到指定 tab
 */
export async function ensureAttached(tabId: number): Promise<void> {
  if (attachedTabs.has(tabId)) {
    return;
  }

  try {
    await chrome.debugger.attach({ tabId }, '1.3');
    attachedTabs.add(tabId);
    
    // 启用必要的 CDP 域
    await chrome.debugger.sendCommand({ tabId }, 'Page.enable');
    await chrome.debugger.sendCommand({ tabId }, 'DOM.enable');
    await chrome.debugger.sendCommand({ tabId }, 'Runtime.enable');
    
    console.log('[CDPService] Attached to tab:', tabId);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    // 如果已经 attached，忽略错误
    if (msg.includes('Another debugger is already attached')) {
      attachedTabs.add(tabId);
      return;
    }
    throw error;
  }
}

/**
 * 从 tab 分离 debugger
 */
export async function detach(tabId: number): Promise<void> {
  if (!attachedTabs.has(tabId)) {
    return;
  }

  try {
    await chrome.debugger.detach({ tabId });
    attachedTabs.delete(tabId);
    pendingDialogs.delete(tabId);
    console.log('[CDPService] Detached from tab:', tabId);
  } catch (error) {
    // 忽略 detach 错误
    attachedTabs.delete(tabId);
  }
}

/**
 * 发送 CDP 命令
 */
export async function sendCommand<T = CDPResult>(
  tabId: number,
  method: string,
  params?: object
): Promise<T> {
  await ensureAttached(tabId);
  const result = await chrome.debugger.sendCommand({ tabId }, method, params);
  return result as T;
}

// ============================================================================
// Runtime 域 - JavaScript 执行
// ============================================================================

/**
 * 在页面中执行 JavaScript 表达式
 */
export async function evaluate(
  tabId: number,
  expression: string,
  options: {
    returnByValue?: boolean;
    awaitPromise?: boolean;
  } = {}
): Promise<unknown> {
  const result = await sendCommand<RuntimeEvaluateResult>(tabId, 'Runtime.evaluate', {
    expression,
    returnByValue: options.returnByValue ?? true,
    awaitPromise: options.awaitPromise ?? true,
  });

  if (result.exceptionDetails) {
    const errorMsg = result.exceptionDetails.exception?.description
      || result.exceptionDetails.text
      || 'Unknown error';
    throw new Error(`Eval error: ${errorMsg}`);
  }

  return result.result?.value;
}

/**
 * 调用对象上的函数
 */
export async function callFunctionOn(
  tabId: number,
  objectId: string,
  functionDeclaration: string,
  args: unknown[] = []
): Promise<unknown> {
  const result = await sendCommand<RuntimeEvaluateResult>(tabId, 'Runtime.callFunctionOn', {
    objectId,
    functionDeclaration,
    arguments: args.map(arg => ({ value: arg })),
    returnByValue: true,
    awaitPromise: true,
  });

  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || 'Call failed');
  }

  return result.result?.value;
}

// ============================================================================
// DOM 域 - DOM 操作
// ============================================================================

/**
 * 获取文档根节点
 */
export async function getDocument(
  tabId: number,
  options: { depth?: number; pierce?: boolean } = {}
): Promise<DOMNode> {
  const result = await sendCommand<DOMGetDocumentResult>(tabId, 'DOM.getDocument', {
    depth: options.depth ?? -1,  // -1 表示获取整个树
    pierce: options.pierce ?? true,  // 穿透 shadow DOM 和 iframe
  });
  return result.root;
}

/**
 * 使用选择器查询元素
 */
export async function querySelector(
  tabId: number,
  nodeId: number,
  selector: string
): Promise<number> {
  const result = await sendCommand<DOMQuerySelectorResult>(tabId, 'DOM.querySelector', {
    nodeId,
    selector,
  });
  return result.nodeId;
}

/**
 * 获取元素的盒模型（用于计算点击位置）
 */
export async function getBoxModel(tabId: number, nodeId: number): Promise<DOMGetBoxModelResult['model']> {
  const result = await sendCommand<DOMGetBoxModelResult>(tabId, 'DOM.getBoxModel', {
    nodeId,
  });
  return result.model;
}

/**
 * 获取元素的盒模型（通过 backendNodeId）
 */
export async function getBoxModelByBackendId(
  tabId: number,
  backendNodeId: number
): Promise<DOMGetBoxModelResult['model']> {
  const result = await sendCommand<DOMGetBoxModelResult>(tabId, 'DOM.getBoxModel', {
    backendNodeId,
  });
  return result.model;
}

/**
 * 将 nodeId 解析为 Runtime 对象
 */
export async function resolveNode(tabId: number, nodeId: number): Promise<string | undefined> {
  const result = await sendCommand<DOMResolveNodeResult>(tabId, 'DOM.resolveNode', {
    nodeId,
  });
  return result.object.objectId;
}

/**
 * 将 backendNodeId 解析为 Runtime 对象
 */
export async function resolveNodeByBackendId(
  tabId: number,
  backendNodeId: number
): Promise<string | undefined> {
  const result = await sendCommand<DOMResolveNodeResult>(tabId, 'DOM.resolveNode', {
    backendNodeId,
  });
  return result.object.objectId;
}

/**
 * 聚焦到指定元素
 */
export async function focusElement(tabId: number, nodeId: number): Promise<void> {
  await sendCommand(tabId, 'DOM.focus', { nodeId });
}

/**
 * 聚焦到指定元素（通过 backendNodeId）
 */
export async function focusElementByBackendId(tabId: number, backendNodeId: number): Promise<void> {
  await sendCommand(tabId, 'DOM.focus', { backendNodeId });
}

/**
 * 滚动元素到可视区域
 */
export async function scrollIntoViewIfNeeded(tabId: number, nodeId: number): Promise<void> {
  await sendCommand(tabId, 'DOM.scrollIntoViewIfNeeded', { nodeId });
}

/**
 * 滚动元素到可视区域（通过 backendNodeId）
 */
export async function scrollIntoViewIfNeededByBackendId(
  tabId: number,
  backendNodeId: number
): Promise<void> {
  await sendCommand(tabId, 'DOM.scrollIntoViewIfNeeded', { backendNodeId });
}

/**
 * 设置元素属性值（用于 input）
 */
export async function setAttributeValue(
  tabId: number,
  nodeId: number,
  name: string,
  value: string
): Promise<void> {
  await sendCommand(tabId, 'DOM.setAttributeValue', { nodeId, name, value });
}

// ============================================================================
// Input 域 - 输入模拟
// ============================================================================

/**
 * 分发鼠标事件
 */
export async function dispatchMouseEvent(
  tabId: number,
  type: 'mousePressed' | 'mouseReleased' | 'mouseMoved' | 'mouseWheel',
  x: number,
  y: number,
  options: {
    button?: 'left' | 'right' | 'middle' | 'none';
    clickCount?: number;
    deltaX?: number;
    deltaY?: number;
    modifiers?: number;  // 1=Alt, 2=Ctrl, 4=Meta, 8=Shift
  } = {}
): Promise<void> {
  await sendCommand(tabId, 'Input.dispatchMouseEvent', {
    type,
    x,
    y,
    button: options.button ?? 'left',
    clickCount: options.clickCount ?? 1,
    deltaX: options.deltaX ?? 0,
    deltaY: options.deltaY ?? 0,
    modifiers: options.modifiers ?? 0,
  });
}

/**
 * 点击指定坐标
 */
export async function click(tabId: number, x: number, y: number): Promise<void> {
  await dispatchMouseEvent(tabId, 'mousePressed', x, y, { button: 'left', clickCount: 1 });
  await dispatchMouseEvent(tabId, 'mouseReleased', x, y, { button: 'left', clickCount: 1 });
}

/**
 * 双击指定坐标
 */
export async function doubleClick(tabId: number, x: number, y: number): Promise<void> {
  await dispatchMouseEvent(tabId, 'mousePressed', x, y, { button: 'left', clickCount: 1 });
  await dispatchMouseEvent(tabId, 'mouseReleased', x, y, { button: 'left', clickCount: 1 });
  await dispatchMouseEvent(tabId, 'mousePressed', x, y, { button: 'left', clickCount: 2 });
  await dispatchMouseEvent(tabId, 'mouseReleased', x, y, { button: 'left', clickCount: 2 });
}

/**
 * 移动鼠标到指定坐标（用于 hover）
 */
export async function moveMouse(tabId: number, x: number, y: number): Promise<void> {
  await dispatchMouseEvent(tabId, 'mouseMoved', x, y);
}

/**
 * 滚动鼠标滚轮
 */
export async function scroll(
  tabId: number,
  x: number,
  y: number,
  deltaX: number,
  deltaY: number
): Promise<void> {
  await dispatchMouseEvent(tabId, 'mouseWheel', x, y, { deltaX, deltaY });
}

/**
 * 分发键盘事件
 */
export async function dispatchKeyEvent(
  tabId: number,
  type: 'keyDown' | 'keyUp' | 'rawKeyDown' | 'char',
  options: {
    key?: string;
    code?: string;
    text?: string;
    modifiers?: number;
    windowsVirtualKeyCode?: number;
    nativeVirtualKeyCode?: number;
  } = {}
): Promise<void> {
  await sendCommand(tabId, 'Input.dispatchKeyEvent', {
    type,
    ...options,
  });
}

/**
 * 按下并释放一个键
 */
export async function pressKey(
  tabId: number,
  key: string,
  options: { modifiers?: number } = {}
): Promise<void> {
  // 特殊键的虚拟键码映射
  const keyCodeMap: Record<string, number> = {
    Enter: 13,
    Tab: 9,
    Backspace: 8,
    Escape: 27,
    ArrowUp: 38,
    ArrowDown: 40,
    ArrowLeft: 37,
    ArrowRight: 39,
    Delete: 46,
    Home: 36,
    End: 35,
    PageUp: 33,
    PageDown: 34,
  };

  const keyCode = keyCodeMap[key] || key.charCodeAt(0);

  await dispatchKeyEvent(tabId, 'rawKeyDown', {
    key,
    code: key,
    windowsVirtualKeyCode: keyCode,
    nativeVirtualKeyCode: keyCode,
    modifiers: options.modifiers,
  });

  // 对于可打印字符，发送 char 事件
  if (key.length === 1) {
    await dispatchKeyEvent(tabId, 'char', {
      text: key,
      key,
      modifiers: options.modifiers,
    });
  }

  await dispatchKeyEvent(tabId, 'keyUp', {
    key,
    code: key,
    windowsVirtualKeyCode: keyCode,
    nativeVirtualKeyCode: keyCode,
    modifiers: options.modifiers,
  });
}

/**
 * 输入文本（逐字符）
 */
export async function insertText(tabId: number, text: string): Promise<void> {
  await sendCommand(tabId, 'Input.insertText', { text });
}

// ============================================================================
// Page 域 - 页面操作
// ============================================================================

/**
 * 截取页面截图
 */
export async function captureScreenshot(
  tabId: number,
  options: {
    format?: 'jpeg' | 'png' | 'webp';
    quality?: number;
    clip?: { x: number; y: number; width: number; height: number; scale?: number };
    fromSurface?: boolean;
    captureBeyondViewport?: boolean;
  } = {}
): Promise<string> {
  const result = await sendCommand<PageCaptureScreenshotResult>(tabId, 'Page.captureScreenshot', {
    format: options.format ?? 'png',
    quality: options.quality,
    clip: options.clip,
    fromSurface: options.fromSurface ?? true,
    captureBeyondViewport: options.captureBeyondViewport ?? false,
  });
  return result.data;  // base64 encoded
}

/**
 * 导航到 URL
 */
export async function navigate(tabId: number, url: string): Promise<void> {
  await sendCommand(tabId, 'Page.navigate', { url });
}

/**
 * 刷新页面
 */
export async function reload(tabId: number, ignoreCache = false): Promise<void> {
  await sendCommand(tabId, 'Page.reload', { ignoreCache });
}

/**
 * 处理 JavaScript 对话框（alert, confirm, prompt）
 */
export async function handleJavaScriptDialog(
  tabId: number,
  accept: boolean,
  promptText?: string
): Promise<void> {
  await sendCommand(tabId, 'Page.handleJavaScriptDialog', {
    accept,
    promptText,
  });
}

/**
 * 获取待处理的 dialog
 */
export function getPendingDialog(tabId: number): DialogInfo | undefined {
  return pendingDialogs.get(tabId);
}

// ============================================================================
// Accessibility 域 - 可访问性树
// ============================================================================

/**
 * 获取完整的可访问性树
 */
export async function getFullAccessibilityTree(
  tabId: number,
  options: { depth?: number; frameId?: string } = {}
): Promise<AXNode[]> {
  // 先启用 Accessibility 域
  await sendCommand(tabId, 'Accessibility.enable');
  
  const result = await sendCommand<AccessibilityGetFullAXTreeResult>(
    tabId,
    'Accessibility.getFullAXTree',
    {
      depth: options.depth,
      frameId: options.frameId,
    }
  );
  
  return result.nodes;
}

/**
 * 获取部分可访问性树（从指定节点开始）
 */
export async function getPartialAccessibilityTree(
  tabId: number,
  nodeId?: number,
  backendNodeId?: number,
  options: { depth?: number; fetchRelatives?: boolean } = {}
): Promise<AXNode[]> {
  await sendCommand(tabId, 'Accessibility.enable');
  
  const result = await sendCommand<AccessibilityGetFullAXTreeResult>(
    tabId,
    'Accessibility.getPartialAXTree',
    {
      nodeId,
      backendNodeId,
      fetchRelatives: options.fetchRelatives ?? true,
      depth: options.depth,
    }
  );
  
  return result.nodes;
}

// ============================================================================
// 事件处理
// ============================================================================

/**
 * 初始化 CDP 事件监听
 */
export function initEventListeners(): void {
  // 监听 debugger 事件
  chrome.debugger.onEvent.addListener((source, method, params) => {
    if (method === 'Page.javascriptDialogOpening' && source.tabId) {
      const dialogParams = params as DialogInfo;
      console.log('[CDPService] Dialog opened:', dialogParams);
      pendingDialogs.set(source.tabId, dialogParams);
    } else if (method === 'Page.javascriptDialogClosed' && source.tabId) {
      console.log('[CDPService] Dialog closed');
      pendingDialogs.delete(source.tabId);
    }
  });

  // 当 debugger 被 detach 时清理状态
  chrome.debugger.onDetach.addListener((source) => {
    if (source.tabId) {
      attachedTabs.delete(source.tabId);
      pendingDialogs.delete(source.tabId);
      console.log('[CDPService] Debugger detached from tab:', source.tabId);
    }
  });

  // 当 tab 关闭时清理状态
  chrome.tabs.onRemoved.addListener((tabId) => {
    attachedTabs.delete(tabId);
    pendingDialogs.delete(tabId);
  });
}

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 计算元素中心点坐标
 */
export function getBoxCenter(box: DOMGetBoxModelResult['model']): { x: number; y: number } {
  // content 是 [x1,y1, x2,y2, x3,y3, x4,y4] 格式的四边形顶点
  const content = box.content;
  const x = (content[0] + content[2] + content[4] + content[6]) / 4;
  const y = (content[1] + content[3] + content[5] + content[7]) / 4;
  return { x, y };
}

/**
 * 检查 tab 是否已 attach
 */
export function isAttached(tabId: number): boolean {
  return attachedTabs.has(tabId);
}
