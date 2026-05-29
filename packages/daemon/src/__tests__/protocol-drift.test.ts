/**
 * Protocol Drift Tests — verify daemon HTTP responses match protocol.ts shapes.
 *
 * These tests start a real daemon, send HTTP commands, and check that response
 * shapes match the types defined in @bb-browser/shared (protocol.ts).
 *
 * Requirements:
 *   - Chrome running with --remote-debugging-port=<CDP_PORT>
 *   - Ports CDP_PORT and DAEMON_PORT must be free
 *
 * Run:
 *   pnpm test:drift
 *
 * All tests are skipped automatically when Chrome CDP is not reachable.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Configuration — use non-standard ports to avoid conflicts
// ---------------------------------------------------------------------------

const CDP_PORT = Number(process.env.BB_TEST_CDP_PORT ?? 19222);
const DAEMON_PORT = Number(process.env.BB_TEST_DAEMON_PORT ?? 19899);
const TOKEN = "test-token-protocol-drift";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DAEMON_ENTRY = path.resolve(__dirname, "../../dist/daemon.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function isChromeAvailable(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

async function sendCommand(
  method: string,
  params: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const res = await fetch(`http://127.0.0.1:${DAEMON_PORT}/command`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({ method, ...params }),
  });
  return res.json() as Promise<Record<string, unknown>>;
}

async function getStatus(): Promise<Record<string, unknown>> {
  const res = await fetch(`http://127.0.0.1:${DAEMON_PORT}/status`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  return res.json() as Promise<Record<string, unknown>>;
}

/** Wait until the daemon HTTP server is responding. */
async function waitForDaemon(timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${DAEMON_PORT}/status`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Daemon did not start within ${timeoutMs}ms`);
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("Protocol drift tests (requires Chrome + daemon)", async () => {
  let daemon: ChildProcess | null = null;
  let chromeAvailable = false;

  before(async () => {
    chromeAvailable = await isChromeAvailable();
    if (!chromeAvailable) {
      console.log(
        `\n  ⚠ Chrome CDP not reachable at 127.0.0.1:${CDP_PORT} — all protocol drift tests will be skipped.\n` +
          `    To run these tests, start Chrome with: --remote-debugging-port=${CDP_PORT}\n`,
      );
      return;
    }

    // Spawn the daemon as a child process
    daemon = spawn(
      "node",
      [
        DAEMON_ENTRY,
        "--port",
        String(DAEMON_PORT),
        "--cdp-port",
        String(CDP_PORT),
        "--token",
        TOKEN,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );

    daemon.stderr?.on("data", (chunk: Buffer) => {
      const line = chunk.toString().trim();
      if (line) console.log(`  [daemon] ${line}`);
    });

    daemon.on("error", (err) => {
      console.error(`  [daemon] spawn error: ${err.message}`);
    });

    await waitForDaemon();
  });

  after(async () => {
    if (daemon && !daemon.killed) {
      daemon.kill("SIGTERM");
      // Give it a moment to clean up
      await new Promise((r) => setTimeout(r, 500));
      if (!daemon.killed) daemon.kill("SIGKILL");
    }
  });

  // -------------------------------------------------------------------------
  // Helper: skip if Chrome is unavailable
  // -------------------------------------------------------------------------
  function skipIfNoChrome() {
    if (!chromeAvailable) {
      return true;
    }
    return false;
  }

  // =========================================================================
  // GET /status response shape
  // =========================================================================

  it("GET /status has correct shape", { skip: false }, async (t) => {
    if (skipIfNoChrome()) { t.skip("Chrome CDP not available"); return; }

    const status = await getStatus();

    assert.equal(typeof status.running, "boolean", "running should be boolean");
    assert.equal(typeof status.cdpConnected, "boolean", "cdpConnected should be boolean");
    assert.ok(Array.isArray(status.tabs), "tabs should be an array");

    // Each tab entry shape
    if (Array.isArray(status.tabs) && status.tabs.length > 0) {
      const tab = status.tabs[0] as Record<string, unknown>;
      assert.equal(typeof tab.shortId, "string", "tab.shortId should be string");
      assert.equal(typeof tab.targetId, "string", "tab.targetId should be string");
      assert.equal(typeof tab.networkRequests, "number", "tab.networkRequests should be number");
      assert.equal(typeof tab.consoleMessages, "number", "tab.consoleMessages should be number");
      assert.equal(typeof tab.jsErrors, "number", "tab.jsErrors should be number");
      assert.equal(typeof tab.lastActionSeq, "number", "tab.lastActionSeq should be number");
    }
  });

  // =========================================================================
  // eval response shape
  // =========================================================================

  it("eval response has result.result, result.tab (string), result.seq (number)", { skip: false }, async (t) => {
    if (skipIfNoChrome()) { t.skip("Chrome CDP not available"); return; }

    const res = await sendCommand("eval", { script: "1 + 1" });

    assert.equal(res.error, undefined, "error should be absent");
    const result = res.result as Record<string, unknown>;
    assert.ok(result !== undefined, "result should be present");
    assert.ok("result" in result, "result.result should exist");
    assert.equal(typeof result.tab, "string", "result.tab should be string");
    assert.equal(typeof result.seq, "number", "result.seq should be number");
  });

  // =========================================================================
  // open response shape
  // =========================================================================

  it("open response has result.tab, result.seq, result.url", { skip: false }, async (t) => {
    if (skipIfNoChrome()) { t.skip("Chrome CDP not available"); return; }

    const res = await sendCommand("open", { url: "about:blank" });

    assert.equal(res.error, undefined, "error should be absent");
    const result = res.result as Record<string, unknown>;
    assert.equal(typeof result.tab, "string", "result.tab should be string");
    assert.equal(typeof result.seq, "number", "result.seq should be number");
    assert.equal(typeof result.url, "string", "result.url should be string");
  });

  // =========================================================================
  // tab_list response shape
  // =========================================================================

  it("tab_list response has result.tabs (array) with correct tab entries", { skip: false }, async (t) => {
    if (skipIfNoChrome()) { t.skip("Chrome CDP not available"); return; }

    const res = await sendCommand("tab_list");

    assert.equal(res.error, undefined, "error should be absent");
    const result = res.result as Record<string, unknown>;
    assert.ok(Array.isArray(result.tabs), "result.tabs should be an array");

    const tabs = result.tabs as Array<Record<string, unknown>>;
    assert.ok(tabs.length > 0, "should have at least one tab");

    for (const tab of tabs) {
      assert.equal(typeof tab.tab, "string", "tab.tab should be string (short ID)");
      assert.equal(typeof tab.url, "string", "tab.url should be string");
      assert.equal(typeof tab.title, "string", "tab.title should be string");
      assert.equal(typeof tab.index, "number", "tab.index should be number");
      assert.equal(typeof tab.active, "boolean", "tab.active should be boolean");
      assert.ok(
        typeof tab.tabId === "string" || typeof tab.tabId === "number",
        "tab.tabId should be string or number",
      );
    }
  });

  // =========================================================================
  // snapshot response shape
  // =========================================================================

  it("snap response has result.snapshotData.snapshot (string)", { skip: false }, async (t) => {
    if (skipIfNoChrome()) { t.skip("Chrome CDP not available"); return; }

    // Open a page first so snapshot has content
    await sendCommand("open", { url: "data:text/html,<h1>drift test</h1>" });
    // Wait for page to load
    await new Promise((r) => setTimeout(r, 500));

    const res = await sendCommand("snap");

    assert.equal(res.error, undefined, "error should be absent");
    const result = res.result as Record<string, unknown>;
    assert.ok(result.snapshotData !== undefined, "result.snapshotData should exist");

    const snapshotData = result.snapshotData as Record<string, unknown>;
    assert.equal(typeof snapshotData.snapshot, "string", "snapshotData.snapshot should be string");
    assert.equal(typeof result.tab, "string", "result.tab should be string");
  });

  // =========================================================================
  // network requests response shape
  // =========================================================================

  it("network requests response has result.networkRequests (array), result.cursor (number)", { skip: false }, async (t) => {
    if (skipIfNoChrome()) { t.skip("Chrome CDP not available"); return; }

    const res = await sendCommand("network", { action: "requests" });

    assert.equal(res.error, undefined, "error should be absent");
    const result = res.result as Record<string, unknown>;
    assert.ok(Array.isArray(result.networkRequests), "result.networkRequests should be an array");
    assert.equal(typeof result.cursor, "number", "result.cursor should be number");
    assert.equal(typeof result.tab, "string", "result.tab should be string");

    const requests = result.networkRequests as Array<Record<string, unknown>>;
    if (requests.length > 0) {
      const req = requests[0];
      assert.equal(typeof req.url, "string", "request.url should be string");
      assert.equal(typeof req.method, "string", "request.method should be string");
      assert.equal(typeof req.type, "string", "request.type should be string");
      assert.equal(typeof req.timestamp, "number", "request.timestamp should be number");
    }
  });

  // =========================================================================
  // console get response shape
  // =========================================================================

  it("console get response has result.consoleMessages (array), result.cursor (number)", { skip: false }, async (t) => {
    if (skipIfNoChrome()) { t.skip("Chrome CDP not available"); return; }

    const res = await sendCommand("console", { action: "get" });

    assert.equal(res.error, undefined, "error should be absent");
    const result = res.result as Record<string, unknown>;
    assert.ok(Array.isArray(result.consoleMessages), "result.consoleMessages should be an array");
    assert.equal(typeof result.cursor, "number", "result.cursor should be number");
    assert.equal(typeof result.tab, "string", "result.tab should be string");
  });

  // =========================================================================
  // errors get response shape
  // =========================================================================

  it("errors get response has result.jsErrors (array), result.cursor (number)", { skip: false }, async (t) => {
    if (skipIfNoChrome()) { t.skip("Chrome CDP not available"); return; }

    const res = await sendCommand("errors", { action: "get" });

    assert.equal(res.error, undefined, "error should be absent");
    const result = res.result as Record<string, unknown>;
    assert.ok(Array.isArray(result.jsErrors), "result.jsErrors should be an array");
    assert.equal(typeof result.cursor, "number", "result.cursor should be number");
    assert.equal(typeof result.tab, "string", "result.tab should be string");
  });

  // =========================================================================
  // Type correctness: data.tab is always string, data.seq is always number
  // =========================================================================

  it("data.tab is always a string (not number) across multiple commands", { skip: false }, async (t) => {
    if (skipIfNoChrome()) { t.skip("Chrome CDP not available"); return; }

    const commands = [
      sendCommand("eval", { script: "'hello'" }),
      sendCommand("snapshot"),
      sendCommand("network", { action: "requests" }),
      sendCommand("console", { action: "get" }),
      sendCommand("errors", { action: "get" }),
    ];

    const results = await Promise.all(commands);

    for (const res of results) {
      assert.equal(res.success, true, "command should succeed");
      const data = res.data as Record<string, unknown>;
      assert.equal(typeof data.tab, "string", `data.tab should be string, got ${typeof data.tab}`);
      assert.ok(typeof data.tab !== "number", "data.tab must not be a number");
    }
  });

  it("data.seq is always a number when present", { skip: false }, async (t) => {
    if (skipIfNoChrome()) { t.skip("Chrome CDP not available"); return; }

    const commands = [
      sendCommand("eval", { script: "42" }),
      sendCommand("open", { url: "about:blank" }),
    ];

    const results = await Promise.all(commands);

    for (const res of results) {
      assert.equal(res.success, true);
      const data = res.data as Record<string, unknown>;
      if ("seq" in data) {
        assert.equal(typeof data.seq, "number", "data.seq should be number");
      }
    }
  });

  it("data.cursor is always a number when present", { skip: false }, async (t) => {
    if (skipIfNoChrome()) { t.skip("Chrome CDP not available"); return; }

    const commands = [
      sendCommand("network", { action: "requests" }),
      sendCommand("console", { action: "get" }),
      sendCommand("errors", { action: "get" }),
    ];

    const results = await Promise.all(commands);

    for (const res of results) {
      assert.equal(res.success, true);
      const data = res.data as Record<string, unknown>;
      assert.equal(typeof data.cursor, "number", "data.cursor should be number");
    }
  });

  // =========================================================================
  // Error response shape
  // =========================================================================

  it("error response has success: false and error (string)", { skip: false }, async (t) => {
    if (skipIfNoChrome()) { t.skip("Chrome CDP not available"); return; }

    const res = await sendCommand("eval", { /* missing script */ });

    assert.equal(res.success, false, "success should be false");
    assert.equal(typeof res.error, "string", "error should be a string");
  });

  // =========================================================================
  // tabs[].tab is a string in tab_list
  // =========================================================================

  it("tabs[].tab in tab_list is always a string", { skip: false }, async (t) => {
    if (skipIfNoChrome()) { t.skip("Chrome CDP not available"); return; }

    const res = await sendCommand("tab_list");
    assert.equal(res.success, true);

    const data = res.data as Record<string, unknown>;
    const tabs = data.tabs as Array<Record<string, unknown>>;

    for (const tab of tabs) {
      assert.equal(typeof tab.tab, "string", `tab.tab should be string, got ${typeof tab.tab}: ${tab.tab}`);
    }
  });

  // =========================================================================
  // Cleanup: close tabs we opened during testing
  // =========================================================================

  after(async () => {
    if (!chromeAvailable) return;

    try {
      // Get list of tabs and close any about:blank / data: tabs we created
      const res = await sendCommand("tab_list");
      if (res.success) {
        const data = res.data as Record<string, unknown>;
        const tabs = data.tabs as Array<Record<string, unknown>>;
        for (const tab of tabs) {
          const url = tab.url as string;
          if (url === "about:blank" || url.startsWith("data:")) {
            await sendCommand("tab_close", { tabId: tab.tab }).catch(() => {});
          }
        }
      }
    } catch {
      // Best effort cleanup
    }
  });
});
