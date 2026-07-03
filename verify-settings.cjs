const { chromium } = require('./node_modules/playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const SCRATCHPAD = 'C:/Users/dpton/AppData/Local/Temp/claude/I--Projects-petshow/acc1b9b8-867f-4c04-ab80-4ecefe9ac0f6/scratchpad';

  // 1. Settings page
  await page.goto('http://localhost:4321/organiser/settings', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SCRATCHPAD}/settings-page.png`, fullPage: true });
  console.log('title:', await page.title());

  const headings = await page.$$eval('h2', els => els.map(e => e.textContent.trim()));
  console.log('headings:', JSON.stringify(headings));

  const activeNav = await page.$eval('aside a[class*="bg-brand"]', el => el.textContent.trim()).catch(() => 'none');
  console.log('active-nav:', activeNav);

  const hasTrigger = await page.$('#user-popover-trigger') !== null;
  console.log('has-popover-trigger:', hasTrigger);

  // 2. Open popover
  await page.click('#user-popover-trigger');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SCRATCHPAD}/settings-popover.png`, fullPage: true });
  const popoverVisible = await page.$eval('#user-popover', el => el.style.display !== 'none');
  console.log('popover-open:', popoverVisible);
  const popoverItems = await page.$$eval('#user-popover a, #user-popover button', els => els.map(e => e.textContent.trim()));
  console.log('popover-items:', JSON.stringify(popoverItems));

  // 3. Close popover by clicking outside
  await page.click('main');
  await page.waitForTimeout(300);
  const popoverClosed = await page.$eval('#user-popover', el => el.style.display === 'none');
  console.log('popover-closes-on-outside-click:', popoverClosed);

  // 4. Dashboard — My Show Hub should be gone from top bar
  await page.goto('http://localhost:4321/organiser', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SCRATCHPAD}/dashboard.png`, fullPage: false });
  const myShowHubInTopBar = await page.$('header #sidebar-switch-participant') !== null;
  console.log('my-show-hub-in-topbar:', myShowHubInTopBar);

  // 5. Open popover on dashboard
  await page.click('#user-popover-trigger');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SCRATCHPAD}/dashboard-popover.png`, fullPage: false });
  const dashPopover = await page.$eval('#user-popover', el => el.style.display !== 'none');
  console.log('dashboard-popover-open:', dashPopover);

  await browser.close();
  console.log('DONE');
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
