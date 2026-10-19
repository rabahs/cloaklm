// End-to-end test of the sharing gate through the real UI, engine, local Ollama and
// MCP server. Uses a fictional W-2.
//
// Prereqs:
//   cd sidecar && CLOAKLM_DEV=1 CLOAKLM_TOKEN=dev CLOAKLM_TOOLS_TOKEN=devtools uvicorn server:app --port 4321
//   npx vite --port 5199
//   ollama serve   (with the model below pulled)
//   npm run build:mcp
// Usage: node scripts/e2e_sharing_gate.mjs [ollama-model]
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODEL = process.argv[2] || 'gemma4:e4b';
let failures = 0;
const check = (ok, label) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) failures++; };

// The Tauri shell, mocked: the store starts with Ollama settings, and every
// command the page calls is recorded.
function mockTauri(model) {
  const store = { settings: { provider: 'ollama', apiKeys: {}, ollamaUrl: 'http://localhost:11434', deepScan: { enabled: false, model } } };
  window.__calls = [];
  window.__TAURI_INTERNALS__ = {
    transformCallback: () => 0,
    unregisterCallback: () => {},
    invoke: async (cmd, args) => {
      window.__calls.push({ cmd, args });
      if (cmd === 'get_sidecar_auth') return 'dev';
      if (cmd === 'get_sidecar_port') return 4321;
      if (cmd === 'store_get') return store[args.key] ?? null;
      if (cmd === 'store_set') { store[args.key] = args.value; return null; }
      if (cmd === 'export_transcript') return true;
      if (cmd === 'plugin:event|listen') return 0;
      if (cmd === 'plugin:path|resolve_directory') return `/Applications/CloakLM.app/Contents/Resources/${args.path}`;
      throw new Error(`not mocked: ${cmd}`);
    },
  };
}

async function mcpList(connectionFile) {
  const client = new Client({ name: 'e2e', version: '1' });
  await client.connect(new StdioClientTransport({
    command: 'node', args: [path.join(ROOT, 'src-tauri/resources/mcp/server.cjs')],
    env: { ...process.env, CLOAKLM_CONNECTION_FILE: connectionFile },
  }));
  const res = await client.callTool({ name: 'list_documents', arguments: {} });
  await client.close();
  return res.content[0].text;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cloaklm-e2e-'));
const connectionFile = path.join(tmp, 'connection.json');
fs.writeFileSync(connectionFile, JSON.stringify({ port: 4321, token: 'devtools', pid: process.pid }));

const browser = await chromium.launch();
const pdfPage = await browser.newPage();
await pdfPage.setContent(`<html><body style="font-family:Helvetica;padding:30px"><h2>Form W-2 Wage and Tax Statement 2025</h2>
<p>Employee's social security number: 123-45-6789</p><p>Employer: Brightwater Logistics Inc., 450 Harbor Avenue, Portland, OR 97209</p>
<p>Employee's name: Jordan Whitaker</p><p>Employee's address: 1827 Maple Ridge Drive, Beaverton, OR 97005</p>
<p>Client: 张伟</p>
<table border="1"><tr><td>1 Wages</td><td>$84,250.00</td></tr></table></body></html>`);
const pdf = path.join(tmp, 'w2.pdf');
await pdfPage.pdf({ path: pdf });

const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.addInitScript(mockTauri, MODEL);
await page.goto('http://localhost:5199', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

// ---- Upload into a shared project ----
await page.locator('button', { hasText: 'New project' }).first().click();
await page.locator('input[type="file"][accept=".pdf"]').setInputFiles(pdf);
await page.locator('text=/\\d+ PII/').first().waitFor({ timeout: 180000 });
await page.locator('button', { hasText: 'Share with AI tools' }).click();
await page.waitForTimeout(2500);
let listing = await mcpList(connectionFile);
check(/No documents are ready/.test(listing) && /1 more document\(s\) are waiting/.test(listing), 'GLiNER alone: MCP withholds the document');

// ---- Manual approval needs the raw output first ----
await page.locator('button', { hasText: 'Not shared yet' }).click();
const approve = page.locator('button', { hasText: "I've read the raw output" });
check(await approve.isDisabled(), 'approve is disabled before opening Raw Output to AI');

// ---- Second model: Run Deep Scan ----
const runScan = page.locator('button', { hasText: 'Run Deep Scan' });
check(await runScan.isVisible(), 'Run Deep Scan button shown (local Ollama available)');
await runScan.click();
await page.locator('button', { hasText: 'Run Deep Scan again' }).waitFor({ timeout: 300000 });
const suggestions = await page.locator('text=/\\d+ suggestions? to review/').count();
const status = () => page.locator('h3', { hasText: 'Sharing with AI tools' }).locator('../..').innerText();
if (suggestions > 0) {
  check(/Not cleared/.test(await status()), 'Deep Scan found suggestions: still not cleared');
  await page.locator('button', { hasText: 'Accept All' }).click();
  await page.waitForTimeout(300);
}
check(/Checked by two models/.test(await status()), `cleared after Deep Scan (${suggestions ? 'suggestions handled' : 'no suggestions'})`);
await page.locator('h2', { hasText: 'Redaction Review' }).locator('xpath=../..').locator('button', { hasText: '✕' }).click();
await page.waitForTimeout(2500);
listing = await mcpList(connectionFile);
check(/1 shared document/.test(listing) && !/waiting/.test(listing), 'after the second model: MCP serves the document');
check(!/Jordan|Whitaker|123-45-6789|Brightwater/.test(listing), 'MCP listing contains no real values');
if (suggestions > 0) check(!/张伟/.test(listing), 'nothing the second model flagged reaches MCP before it is handled');

// ---- Export transcript goes through the shell command ----
await page.locator('button[title="Chat"]').click();
await page.locator('textarea').first().fill('Hello from the e2e test');
await page.keyboard.press('Enter');
await page.locator('button[title="Export transcript"]').waitFor({ timeout: 120000 });
await page.waitForTimeout(1000);
await page.locator('button[title="Export transcript"]').click();
await page.waitForTimeout(500);
const exported = (await page.evaluate(() => window.__calls)).find((c) => c.cmd === 'export_transcript');
check(!!exported && exported.args.contents.includes('Hello from the e2e test') && /^cloaklm_transcript_\d{4}-\d{2}-\d{2}\.md$/.test(exported.args.fileName),
  'Export sends the transcript to the shell (export_transcript)');

// ---- Pending suggestions block sharing (state Deep Scan leaves when it finds something) ----
const seeded = {
  id: 'p2', name: 'Seeded', createdAt: '', updatedAt: '', sharedWithTools: true,
  attachments: {
    'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee': {
      id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', fileName: 'letter.pdf', originalPath: 'letter.pdf', status: 'ready',
      redactionCount: 1, anonymizedContent: 'Dear [PERSON_1], your accountant Priya Raman will call.',
      redactionMap: { a: { real_value: 'Sam Lee', placeholder: '[PERSON_1]', category: 'PERSON' } },
      deepScannedAt: '2026-10-18T00:00:00Z',
      deepScanSuggestions: [{ id: 's1', text: 'Priya Raman', category: 'PERSON', status: 'pending' }],
    },
  },
};
const page2 = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page2.addInitScript(mockTauri, MODEL);
await page2.addInitScript((p) => { const orig = window.__TAURI_INTERNALS__.invoke; window.__TAURI_INTERNALS__.invoke = (cmd, args) => (cmd === 'store_get' && args.key === 'projects' ? Promise.resolve([p]) : orig(cmd, args)); }, seeded);
await page2.goto('http://localhost:5199', { waitUntil: 'networkidle' });
await page2.waitForTimeout(3000);
listing = await mcpList(connectionFile);
check(/1 more document\(s\) are waiting/.test(listing) && !/Priya/.test(listing), 'scanned with a pending suggestion: MCP withholds it');
await page2.locator('button[title="Projects"]').click();
await page2.locator('text=Seeded').first().click();
await page2.locator('button', { hasText: 'Not shared yet' }).click();
const status2 = () => page2.locator('h3', { hasText: 'Sharing with AI tools' }).locator('../..').innerText();
check(/Not cleared/.test(await status2()) && /Redact or dismiss the 1 suggestion/.test(await status2()), 'Review panel says the suggestion must be handled');
await page2.locator('button', { hasText: 'Accept All' }).click();
await page2.waitForTimeout(300);
check(/Checked by two models/.test(await status2()), 'cleared once the suggestion is redacted');
await page2.locator('h2', { hasText: 'Redaction Review' }).locator('xpath=../..').locator('button', { hasText: '✕' }).click();
await page2.waitForTimeout(2500);
const client = new Client({ name: 'e2e', version: '1' });
await client.connect(new StdioClientTransport({ command: 'node', args: [path.join(ROOT, 'src-tauri/resources/mcp/server.cjs')], env: { ...process.env, CLOAKLM_CONNECTION_FILE: connectionFile } }));
const doc = await client.callTool({ name: 'read_document', arguments: { id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' } });
await client.close();
check(!doc.isError && /\[MANUAL_1\] will call/.test(doc.content[0].text) && !/Priya|Sam Lee/.test(doc.content[0].text), 'MCP now serves it, with the flagged name redacted');

await browser.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(failures ? `${failures} check(s) failed` : 'All checks passed');
process.exit(failures ? 1 : 0);
