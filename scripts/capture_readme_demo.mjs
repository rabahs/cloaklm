// Captures the README demo GIF and screenshots by running a fictional W-2
// through the real redaction flow.
//
// Prereqs: sidecar on :4321 and `npx vite --port 5199` running. Needs ffmpeg.
// Usage: node scripts/capture_readme_demo.mjs
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'site', 'assets');
const BASE_URL = 'http://localhost:5199';
const VIEWPORT = { width: 1280, height: 800 };
// Stills are cropped to the 450px review panel plus a sliver of the app behind it,
// so the panel text stays readable when the image is shown small.
const PANEL_CLIP = { x: 690, y: 0, width: 590, height: 640 };

// All data below is fictional.
const W2_HTML = `<html><body style="font-family:Helvetica,Arial;font-size:13px;padding:30px">
<h2>Form W-2 Wage and Tax Statement 2025</h2>
<p><b>Employee's social security number:</b> 123-45-6789</p>
<p><b>Employer identification number (EIN):</b> 98-7654321</p>
<p><b>Employer's name and address:</b> Brightwater Logistics Inc., 450 Harbor Avenue, Portland, OR 97209</p>
<p><b>Employee's name:</b> Jordan Ellis Whitaker</p>
<p><b>Employee's address:</b> 1827 Maple Ridge Drive, Beaverton, OR 97005</p>
<p><b>Employee email:</b> jordan.whitaker@example.com &nbsp; <b>Phone:</b> (503) 555-0147</p>
<table border="1" cellpadding="6" style="border-collapse:collapse;margin-top:12px">
<tr><td>1 Wages, tips, other compensation</td><td>$84,250.00</td></tr>
<tr><td>2 Federal income tax withheld</td><td>$11,320.00</td></tr>
<tr><td>3 Social security wages</td><td>$84,250.00</td></tr>
<tr><td>4 Social security tax withheld</td><td>$5,223.50</td></tr>
<tr><td>17 State income tax (OR)</td><td>$6,410.00</td></tr>
</table>
</body></html>`;

async function makeSamplePdf(browser, dir) {
  const pdfPath = path.join(dir, 'W2_2025_Jordan_Whitaker.pdf');
  const page = await browser.newPage();
  await page.setContent(W2_HTML);
  await page.pdf({ path: pdfPath, format: 'Letter' });
  await page.close();
  return pdfPath;
}

// Uploads the PDF, waits for redaction, opens the review panel.
async function runFlow(page, pdfPath, { pause = 0 } = {}) {
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200 + pause);
  await page.locator('input[type="file"]').first().setInputFiles(pdfPath);
  const review = page.locator('button', { hasText: 'Review Redactions' }).first();
  await review.waitFor({ timeout: 120000 });
  await page.waitForTimeout(800 + pause);
  await review.click();
  await page.waitForTimeout(1500 + pause);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cloaklm-demo-'));
  const browser = await chromium.launch({ headless: true });
  const pdfPath = await makeSamplePdf(browser, tmp);

  // ===== Stills (2x) =====
  const stills = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, colorScheme: 'dark' });
  const page = await stills.newPage();
  await runFlow(page, pdfPath);
  console.log('1. Redaction review list');
  await page.screenshot({ path: path.join(OUT_DIR, 'redaction_review.png'), clip: PANEL_CLIP });
  console.log('2. Raw output sent to AI');
  await page.locator('button', { hasText: 'Raw Output to AI' }).click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT_DIR, 'raw_output.png'), clip: PANEL_CLIP });
  await stills.close();

  // ===== Demo video → GIF =====
  console.log('3. Demo GIF');
  const vidDir = path.join(tmp, 'video');
  const vid = await browser.newContext({
    viewport: VIEWPORT, colorScheme: 'dark',
    recordVideo: { dir: vidDir, size: VIEWPORT },
  });
  const vpage = await vid.newPage();
  await runFlow(vpage, pdfPath, { pause: 600 });
  await vpage.locator('button', { hasText: 'Raw Output to AI' }).click();
  await vpage.waitForTimeout(2500);
  await vid.close();
  await browser.close();

  const webm = path.join(vidDir, fs.readdirSync(vidDir)[0]);
  const gif = path.join(OUT_DIR, 'demo.gif');
  const filters = 'fps=12,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=4';
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', webm, '-vf', filters, '-loop', '0', gif]);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('Done →', OUT_DIR);
}

main().catch(e => { console.error(e); process.exit(1); });
