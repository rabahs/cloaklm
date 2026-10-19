// Captures the screenshots for docs/ai-subscriptions.md by running a fictional W-2
// through the real redaction flow, sharing it, and calling the real MCP server.
//
// Prereqs:
//   cd sidecar && CLOAKLM_DEV=1 CLOAKLM_TOKEN=dev CLOAKLM_TOOLS_TOKEN=devtools uvicorn server:app --port 4321
//   npx vite --port 5199
//   npm run build:mcp
// Usage: node scripts/capture_mcp_docs.mjs
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'docs', 'images');
const BASE_URL = 'http://localhost:5199';
const SIDECAR_PORT = 4321;
const VIEWPORT = { width: 1280, height: 800 };

// All data below is fictional.
const W2_HTML = `<html><body style="font-family:Helvetica,Arial;font-size:13px;padding:30px">
<h2>Form W-2 Wage and Tax Statement 2025</h2>
<p><b>Employee's social security number:</b> 123-45-6789</p>
<p><b>Employer's name and address:</b> Brightwater Logistics Inc., 450 Harbor Avenue, Portland, OR 97209</p>
<p><b>Employee's name:</b> Jordan Whitaker</p>
<p><b>Employee's address:</b> 1827 Maple Ridge Drive, Beaverton, OR 97005</p>
<table border="1" cellpadding="6" style="border-collapse:collapse;margin-top:12px">
<tr><td>1 Wages, tips, other compensation</td><td>$84,250.00</td></tr>
<tr><td>2 Federal income tax withheld</td><td>$11,320.00</td></tr>
<tr><td>17 State income tax (OR)</td><td>$6,410.00</td></tr>
</table>
</body></html>`;

// Outside Tauri there is no native side; answer the calls the app makes.
function mockTauri() {
  const store = {};
  window.__TAURI_INTERNALS__ = {
    transformCallback: () => 0,
    unregisterCallback: () => {},
    invoke: async (cmd, args) => {
      if (cmd === 'get_sidecar_auth') return 'dev';
      if (cmd === 'get_sidecar_port') return 4321;
      if (cmd === 'store_get') return store[args.key] ?? null;
      if (cmd === 'store_set') { store[args.key] = args.value; return null; }
      if (cmd === 'plugin:event|listen') return 0;
      if (cmd === 'plugin:path|resolve_directory' && args?.path) {
        return `/Applications/CloakLM.app/Contents/Resources/${args.path}`;
      }
      throw new Error(`not mocked: ${cmd}`);
    },
  };
}

async function callMcp(connectionFile) {
  const transport = new StdioClientTransport({
    command: 'node',
    args: [path.join(ROOT, 'src-tauri', 'resources', 'mcp', 'server.cjs')],
    env: { ...process.env, CLOAKLM_CONNECTION_FILE: connectionFile },
  });
  const client = new Client({ name: 'docs-capture', version: '1' });
  await client.connect(transport);
  const list = (await client.callTool({ name: 'list_documents', arguments: {} })).content[0].text;
  const id = list.match(/id: (\S+)/)[1];
  const doc = (await client.callTool({ name: 'read_document', arguments: { id } })).content[0].text;
  await client.close();
  return { list, doc };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cloaklm-docs-'));
  const browser = await chromium.launch({ headless: true });

  const pdfPage = await browser.newPage();
  await pdfPage.setContent(W2_HTML);
  const pdfPath = path.join(tmp, 'w2.pdf');
  await pdfPage.pdf({ path: pdfPath, format: 'Letter' });
  await pdfPage.close();

  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, colorScheme: 'dark' });
  await context.addInitScript(mockTauri);
  const page = await context.newPage();
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // ===== 1. Settings → Connect AI tools =====
  console.log('1. Settings: Connect AI tools');
  await page.locator('button[title^="Settings"]').click();
  const section = page.locator('h2', { hasText: 'Connect AI tools' }).locator('..');
  await section.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await section.screenshot({ path: path.join(OUT_DIR, 'mcp_settings.png') });

  // ===== 2. Project with a redacted document, shared =====
  console.log('2. Project shared with AI tools');
  await page.locator('button[title="Chat"]').click().catch(() => {});
  await page.waitForTimeout(500);
  await page.locator('button', { hasText: 'New project' }).first().click();
  await page.waitForTimeout(500);
  await page.locator('input[type="file"][accept=".pdf"]').setInputFiles(pdfPath);
  await page.locator('text=/\\d+ PII/').first().waitFor({ timeout: 180000 });
  await page.locator('button', { hasText: 'Share with AI tools' }).click();
  await page.waitForTimeout(500);

  // ===== 2b. Clear the document: read the raw output, then approve =====
  console.log('2b. Review panel sharing gate');
  await page.locator('button', { hasText: 'Not shared yet' }).click();
  await page.locator('button', { hasText: 'Raw Output to AI' }).click();
  await page.waitForTimeout(400);
  await page.locator('button', { hasText: 'Identified PII' }).click();
  await page.locator('button', { hasText: "I've read the raw output" }).click();
  await page.waitForTimeout(400);
  const gate = page.locator('h3', { hasText: 'Sharing with AI tools' }).locator('../..');
  await gate.screenshot({ path: path.join(OUT_DIR, 'mcp_review_gate.png') });
  // The Review panel's own close button (document cards have a ✕ "Remove" button too).
  await page.locator('h2', { hasText: 'Redaction Review' }).locator('xpath=../..').locator('button', { hasText: '✕' }).click();
  await page.waitForTimeout(2500); // let the app push the shared set to the sidecar
  await page.screenshot({ path: path.join(OUT_DIR, 'mcp_share_toggle.png'), clip: { x: 0, y: 0, width: 1280, height: 330 } });

  // ===== 3. What the AI app receives =====
  console.log('3. MCP tool output');
  const connectionFile = path.join(tmp, 'connection.json');
  fs.writeFileSync(connectionFile, JSON.stringify({ port: SIDECAR_PORT, token: 'devtools', pid: process.pid }));
  const { list, doc } = await callMcp(connectionFile);
  fs.writeFileSync(path.join(tmp, 'mcp_output.txt'), `${list}\n\n=====\n\n${doc}`);
  console.log(`${list}\n\n${doc}`);

  // ===== 4. Rehydrate an answer =====
  console.log('4. Rehydrate panel');
  const placeholders = [...new Set(doc.match(/\[[A-Z_]+(?:_\d+)?\]/g) || [])];
  // The employee's name, as placeholders (e.g. "[PERSON_2] [PERSON_1]").
  const person = doc.match(/Employee's name:\s*((?:\[PERSON_\d+\]\s*)+)/)?.[1].trim();
  if (!person) throw new Error("no redacted employee name in the sample document");
  const org = placeholders.find((p) => p.startsWith('[ORG')) || placeholders[1];
  const answer =
    `Based on Document 1 (Form W-2), ${person} earned $84,250.00 in wages from ${org} in 2025. ` +
    `Federal income tax withheld was $11,320.00 and Oregon state tax withheld was $6,410.00.`;
  await page.locator('button', { hasText: 'Rehydrate' }).click();
  await page.locator('textarea').fill(answer);
  await page.waitForTimeout(500);
  await page.locator('div.max-w-2xl').first().screenshot({ path: path.join(OUT_DIR, 'mcp_rehydrate.png') });

  await browser.close();
  console.log('Done →', OUT_DIR, '| tool output in', path.join(tmp, 'mcp_output.txt'));
}

main().catch((e) => { console.error(e); process.exit(1); });
