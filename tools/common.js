// Shared helpers for capturing the old armadaresidence.com (read only).
const { chromium } = require('F:/Armada Website/node_modules/playwright');

const ORIGIN = 'https://armadaresidence.com';
const OUT = 'F:/armada-old-site';
const WORK = 'F:/armada-old-site-work';

// Tracking / ad endpoints are never loaded during capture (no analytics hits on the live property).
const BLOCK = /googletagmanager\.com|google-analytics\.com|analytics\.google\.com|doubleclick\.net|googleadservices\.com|connect\.facebook\.net|facebook\.com\/tr|analytics\.tiktok\.com|tiktokw\.|snapchat\.com|sc-static\.net|clarity\.ms|hotjar|google\.com(\.sa)?\/(pagead|ccm|ads|rmkt)/;

const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

async function launch() { return chromium.launch({ channel: 'chrome' }); }

async function newContext(browser, kind, opts = {}) {
  const base = kind === 'mobile'
    ? { viewport: { width: 375, height: 812 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, userAgent: MOBILE_UA }
    : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };
  const ctx = await browser.newContext({ ...base, locale: 'ar-SA', serviceWorkers: 'block', ...opts });
  const aborted = [];
  if (!opts.noBlock) {
    await ctx.route('**/*', (route) => {
      const req = route.request();
      const m = req.method();
      // read only: no POST/PUT/PATCH/DELETE ever leaves the browser
      if (BLOCK.test(req.url()) || !['GET', 'HEAD', 'OPTIONS'].includes(m)) { aborted.push(m + ' ' + req.url().slice(0, 120)); return route.abort(); }
      return route.continue();
    });
  }
  ctx._aborted = aborted;
  return ctx;
}

async function settle(page, ms = 1500) {
  await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
  await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
  await page.waitForTimeout(ms);
}

async function slowScroll(page) {
  await page.evaluate(async () => {
    const sleep = (t) => new Promise((r) => setTimeout(r, t));
    let y = 0;
    for (let i = 0; i < 400; i++) {
      const H = document.documentElement.scrollHeight;
      if (y >= H) break;
      window.scrollTo(0, y);
      await sleep(110);
      y += Math.round(window.innerHeight * 0.4);
    }
    window.scrollTo(0, document.documentElement.scrollHeight);
    await sleep(800);
  });
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  // wait for every image to finish
  await page.evaluate(async () => {
    await Promise.all([...document.images].filter((i) => !i.complete).map((i) => new Promise((r) => { i.onload = i.onerror = r; setTimeout(r, 8000); })));
  }).catch(() => {});
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1200);
}

// Old site switches language in memory only (no URL, cookie or storage): click its toggle.
async function toEnglish(page) {
  const clicked = await page.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
    const btn = [...document.querySelectorAll('button')].find((b) => ['English', 'EN'].includes(b.innerText.trim()) && vis(b));
    if (btn) { btn.click(); return true; }
    return false;
  });
  if (!clicked) {
    const vp = page.viewportSize();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(500);
    await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.innerText.trim() === 'English'); if (b) b.click(); });
    await page.setViewportSize(vp);
  }
  await page.waitForFunction(() => document.documentElement.lang === 'en', null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  return page.evaluate(() => document.documentElement.lang);
}

function slugOf(p) { return p === '/' ? 'home' : p.replace(/^\//, '').replace(/[\/\\:*?"<>|]+/g, '_').replace(/^-$/, 'dash') || 'home'; }

module.exports = { ORIGIN, OUT, WORK, BLOCK, launch, newContext, settle, slowScroll, toEnglish, slugOf };
