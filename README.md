<div align="center">

# bb-browser

**让 AI Agent 用你的真实浏览器**

[![npm](https://img.shields.io/npm/v/bb-browser?color=CB3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/bb-browser)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

</div>

---

你已经登录的 Gmail、Twitter、内部系统——Agent 直接能用。通过 `chrome.debugger` API 操作，绕过自动化指纹检测。

```
AI Agent (Claude, GPT, etc.)
       │ CLI 命令 / Epiral gRPC
       ▼
bb-browser CLI ──HTTP──▶ Daemon ──SSE──▶ Chrome Extension
                                              │
                                              ▼ chrome.debugger (CDP)
                                         用户浏览器
                                    (已登录的网站、Cookies)
```

## 为什么不用 Playwright / Selenium

| | Playwright / Selenium | bb-browser |
|---|---|---|
| 浏览器环境 | 独立的无头浏览器 | 用户的真实浏览器 |
| 登录态 | 没有，需要手动登录 | 复用已有的 Cookies 和会话 |
| 自动化检测 | 容易被识别和拦截 | `chrome.debugger` API，无指纹 |
| 内部系统 | 需要额外配置 VPN/代理 | 用户能访问的，它都能访问 |

## 两种使用方式

### 独立使用

作为 CLI 工具，任何 AI Agent 都可以直接调用：

```bash
bb-browser open https://example.com
bb-browser snapshot -i
bb-browser click @0
bb-browser fill @2 "search query"
```

### 接入 Epiral Agent

通过 [Epiral CLI](https://github.com/epiral/cli) 的 Browser Bridge 接入 [Epiral Agent](https://github.com/epiral/agent)，让 Agent 远程控制浏览器：

```
Epiral Agent → gRPC → Epiral CLI (Browser Bridge) → SSE → Chrome 扩展 → 浏览器
```

只需在 Chrome 扩展设置中将上游 URL 指向 Epiral CLI 的 SSE 端口即可。Agent 可以同时接入多个浏览器。

## 安装

### npm 安装（推荐）

```bash
npm install -g bb-browser
```

### 从源码构建

```bash
git clone https://github.com/yan5xu/bb-browser.git
cd bb-browser
pnpm install && pnpm build
```

### 加载 Chrome 扩展（必须）

1. 打开 Chrome → `chrome://extensions/`
2. 开启「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择扩展目录：
   - npm 安装：`node_modules/bb-browser/extension/`
   - 源码构建：`packages/extension/dist/`

## 使用

### 启动 Daemon

```bash
bb-browser daemon    # 前台启动
bb-browser start     # 别名
```

### 基本操作

```bash
# 打开网页
bb-browser open https://example.com

# 获取页面快照（可交互元素）
bb-browser snapshot -i
# 输出:
# - link "Learn more" [ref=0]
# - button "Submit" [ref=1]
# - textbox "Search" [ref=2]

# 通过 ref 操作元素
bb-browser click @0
bb-browser fill @2 "hello world"
bb-browser press Enter
```

### 命令速查

| 类别 | 命令 | 说明 |
|------|------|------|
| **导航** | `open <url>` | 打开 URL |
| | `back` / `forward` / `refresh` | 导航操作 |
| | `close` | 关闭标签页 |
| **快照** | `snapshot` | 完整 DOM 树 |
| | `snapshot -i` | 只看可交互元素 |
| **交互** | `click <ref>` | 点击 |
| | `fill <ref> <text>` | 清空后填入 |
| | `type <ref> <text>` | 逐字符追加 |
| | `hover <ref>` | 悬停 |
| | `press <key>` | 按键 |
| | `scroll <dir> [px]` | 滚动 |
| | `check` / `uncheck <ref>` | 复选框 |
| | `select <ref> <val>` | 下拉框 |
| **信息** | `get text <ref>` | 元素文本 |
| | `get url` / `get title` | 页面信息 |
| | `screenshot [path]` | 截图 |
| | `eval "<js>"` | 执行 JavaScript |
| **Tab** | `tab` | 列出标签页 |
| | `tab new <url>` | 新标签页 |
| | `tab <n>` | 切换标签页 |
| | `tab close` | 关闭标签页 |
| **Frame** | `frame "<selector>"` | 进入 iframe |
| | `frame main` | 回到主 frame |
| **对话框** | `dialog accept [text]` | 接受 |
| | `dialog dismiss` | 拒绝 |
| **网络** | `network requests [filter]` | 查看请求 |
| | `network route "<pattern>" --abort` | 拦截 |
| | `network unroute` | 取消拦截 |
| **调试** | `console` / `errors` | 控制台/错误 |
| **Daemon** | `daemon` / `start` / `stop` / `status` | 管理 |

### JSON 输出

所有命令支持 `--json` 参数：

```bash
bb-browser get url --json
# {"success":true,"data":"https://example.com"}
```

### 多 Tab 并发

每次 `open` 返回独立的 tabId，通过 `--tab` 参数隔离操作：

```bash
bb-browser open https://site-a.com    # → tabId: 123
bb-browser open https://site-b.com    # → tabId: 456
bb-browser snapshot -i --tab 123      # 操作 site-a
bb-browser click @0 --tab 456         # 操作 site-b
```

## 项目结构

```
bb-browser/
├── packages/
│   ├── cli/          # CLI 工具（参数解析、HTTP 客户端、Daemon 管理）
│   ├── daemon/       # HTTP Daemon（SSE 推送、请求-响应匹配）
│   ├── extension/    # Chrome 扩展（Manifest V3、chrome.debugger）
│   └── shared/       # 共享类型和协议定义
├── skills/           # AI Agent Skill 文档
├── dist/             # 构建产物（npm 发布）
└── extension/        # 构建好的扩展（npm 发布）
```

## 技术栈

| 层 | 技术 |
|----|------|
| CLI | TypeScript，手写参数解析 |
| Daemon | Node.js HTTP Server + SSE |
| Extension | Chrome Manifest V3 + `chrome.debugger` API |
| 构建 | pnpm monorepo + Turborepo + tsup + Vite |

## 许可证

[MIT](LICENSE)
