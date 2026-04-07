import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.join(__dirname, '..', 'site', 'assets');
const BASE_URL = 'http://localhost:5199';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: 'dark',
  });
  const page = await context.newPage();
  page.on('pageerror', () => {});

  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1500);

  // ===== Create some projects via the UI =====
  // Click "New Project" button on the welcome screen
  const newProjectBtn = page.locator('button', { hasText: 'New Project' }).first();
  if (await newProjectBtn.count() > 0) {
    await newProjectBtn.click();
    await page.waitForTimeout(500);
  }
  // We're now in project-detail view. Go back to welcome.
  const backBtn = page.locator('button[title="Back"]').first();
  if (await backBtn.count() > 0) {
    await backBtn.click();
    await page.waitForTimeout(300);
  }
  // Navigate to chats view
  const chatsNav = page.locator('button[title="Chats"]');
  if (await chatsNav.count() > 0) {
    await chatsNav.click();
    await page.waitForTimeout(300);
  }

  // Create a few more projects via the welcome screen "New Project"
  for (let i = 0; i < 2; i++) {
    const np = page.locator('button', { hasText: 'New Project' }).first();
    if (await np.count() > 0) {
      await np.click();
      await page.waitForTimeout(300);
      // Go back
      const bb = page.locator('button').filter({ hasText: '←' }).first();
      if (await bb.count() > 0) {
        await bb.click();
        await page.waitForTimeout(200);
      }
      // back to chats
      if (await chatsNav.count() > 0) {
        await chatsNav.click();
        await page.waitForTimeout(200);
      }
    }
  }

  // ===== Screenshot 1: Welcome Screen with recent projects =====
  console.log('1. Welcome screen with projects');
  await page.screenshot({
    path: path.join(ASSETS_DIR, 'screenshot_projects.png'),
    clip: { x: 0, y: 0, width: 1400, height: 900 }
  });

  // ===== Screenshot 2: Projects list view =====
  console.log('2. Projects list view');
  const projectsNav = page.locator('button[title="Projects"]');
  if (await projectsNav.count() > 0) {
    await projectsNav.click();
    await page.waitForTimeout(500);
  }
  await page.screenshot({
    path: path.join(ASSETS_DIR, 'screenshot_redaction.png'),
    clip: { x: 0, y: 0, width: 1400, height: 900 }
  });

  // ===== Screenshot 3: Project detail with documents tab =====
  console.log('3. Project detail');
  // Click on first project
  const projectCard = page.locator('text=Project').first();
  if (await projectCard.count() > 0) {
    await projectCard.click();
    await page.waitForTimeout(500);
  }
  await page.screenshot({
    path: path.join(ASSETS_DIR, 'screenshot_review.png'),
    clip: { x: 0, y: 0, width: 1400, height: 900 }
  });

  // ===== Screenshot 4: Settings view =====
  console.log('4. Settings view');
  const settingsNav = page.locator('button[title="Settings"]');
  if (await settingsNav.count() > 0) {
    await settingsNav.click();
    await page.waitForTimeout(500);
  }
  await page.screenshot({
    path: path.join(ASSETS_DIR, 'screenshot_settings.png'),
    clip: { x: 0, y: 0, width: 1400, height: 900 }
  });

  // ===== Screenshot 5: Chat view =====
  console.log('5. Chat view');
  if (await chatsNav.count() > 0) {
    await chatsNav.click();
    await page.waitForTimeout(500);
  }
  // Type a message to make it look active
  const textarea = page.locator('textarea');
  if (await textarea.count() > 0) {
    await textarea.fill('What deductions can I claim from my W-2 income?');
    await page.waitForTimeout(200);
  }
  await page.screenshot({
    path: path.join(ASSETS_DIR, 'screenshot_chat.png'),
    clip: { x: 0, y: 0, width: 1400, height: 900 }
  });

  // ===== Screenshot 6: History view =====
  console.log('6. History view');
  const historyNav = page.locator('button[title="History"]');
  if (await historyNav.count() > 0) {
    await historyNav.click();
    await page.waitForTimeout(500);
  }
  await page.screenshot({
    path: path.join(ASSETS_DIR, 'screenshot_history.png'),
    clip: { x: 0, y: 0, width: 1400, height: 900 }
  });

  console.log('All screenshots captured!');
  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
