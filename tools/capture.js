// Phase A: discover + snapshot every page of the old site (AR + EN), live screenshots desktop + mobile.
const fs = require('fs');
const path = require('path');
const { ORIGIN, OUT, WORK, launch, newContext, settle, slowScroll, toEnglish, slugOf } = require('./common');
const snapshot = require('./snapshot');

const CAP = 200;
const RAW = path.join(WORK, 'raw');
fs.mkdirSync(RAW, { recursive: true });
for (const d of ['desktop', 'mobile']) fs.mkdirSync(path.join(OUT, 'screenshots', d), { recursive: true });

const norm = (p) => { p = decodeURI(p.split('#')[0].split('?')[0]); if (p.length > 1) p = p.replace(/\/+$/, ''); return p || '/'; };
const skip = (p) => /^\/admin(\/|$)/.test(p) || /\.(xml|txt|json|png|jpe?g|webp|svg|pdf|ico|js|css)$/i.test(p);

const seeds = ['/', '/gallery', '/offers', '/restaurant', '/coffee-shop', '/blog',
  // known old shapes, kept only if they render something
  '/about', '/rooms', '/contact', '/our-rooms', '/armada-residence-airport-rood', '/branches'];
let busy = 0;
const queue = []; const seen = new Set(); const log = [];
const results = {}; // path -> {status, langs:{ar:{...},en:{...}}, from}
function enqueue(p, from) { p = norm(p); if (skip(p) || seen.has(p)) return; if (seen.size >= CAP) { log.push('CAP hit, dropped ' + p); return; } seen.add(p); queue.push({ p, from }); }

async function sitemap() {
  try {
    const t = await (await fetch(ORIGIN + '/sitemap.xml')).text();
    for (const m of t.matchAll(/<loc>([^<]+)<\/loc>/g)) { const u = new URL(m[1].trim()); if (/armadaresidence\.com$/.test(u.hostname)) enqueue(u.pathname, 'sitemap'); }
  } catch (e) { log.push('sitemap failed ' + e.message); }
}

function dataRoutes(page, sink) {
  page.on('response', async (r) => {
    const u = r.url();
    if (!/supabase\.co\/rest\/v1\/(rooms|blog_articles|offers|branches)\?/.test(u) || r.request().method() !== 'GET') return;
    let j; try { j = await r.json(); } catch { return; }
    const rows = Array.isArray(j) ? j : [j];
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      if (u.includes('/rooms?') && row.id && row.branch_id) sink.add(`/branches/${row.branch_id}/rooms/${row.id}`);
      if (u.includes('/blog_articles?') && row.seo_slug) sink.add(`/blog/${row.seo_slug}`);
      if (u.includes('/offers?') && row.id) sink.add(`/offers/${row.id}`);
      if (u.includes('/branches?') && row.id && row.is_active !== false) sink.add(`/branches/${row.id}`);
    }
  });
}

async function capturePage(ctxD, ctxM, item) {
  const { p } = item; const url = ORIGIN + (p === '/' ? '/' : encodeURI(p));
  const slug = slugOf(p);
  const rec = { path: p, url, from: item.from, langs: {} };
  for (const lang of ['ar', 'en']) {
    const page = await ctxD.newPage();
    const found = new Set();
    dataRoutes(page, found);
    try {
      const resp = await page.goto(url, { waitUntil: 'load', timeout: 90000 });
      rec.status = resp ? resp.status() : 0;
      await settle(page, 1500);
      let got = 'ar';
      if (lang === 'en') got = await toEnglish(page);
      await slowScroll(page);
      const links = await page.evaluate(() => [...document.querySelectorAll('a[href]')].map((a) => a.href));
      const snap = await page.evaluate(snapshot);
      if (snap.textLen < 30) { rec.blank = true; await page.close(); break; }
      for (const l of links) { try { const u = new URL(l); if (/^(www\.)?armadaresidence\.com$/.test(u.hostname)) enqueue(u.pathname, p); } catch {} }
      for (const r of found) enqueue(r, p + ' (data)');
      await page.screenshot({ path: path.join(OUT, 'screenshots', 'desktop', `${slug}-${lang}.png`), fullPage: true });
      const file = path.join(RAW, `${slug}-${lang}.json`);
      fs.writeFileSync(file, JSON.stringify({ ...snap, path: p, url, langWanted: lang, langGot: got, capturedAt: new Date().toISOString() }));
      rec.langs[lang] = { title: snap.title, langGot: got, assets: snap.assets.length, forms: snap.forms, iframes: snap.iframes, shifted: snap.shifted, hiddenAnim: snap.hiddenAnim, scripts: snap.removedScripts };
    } catch (e) { rec.langs[lang] = { error: e.message.split('\n')[0] }; }
    await page.close().catch(() => {});
    // mobile live screenshot
    if (rec.blank) break;
    const mp = await ctxM.newPage();
    try {
      await mp.goto(url, { waitUntil: 'load', timeout: 90000 });
      await settle(mp, 1500);
      if (lang === 'en') rec.langs[lang].mobileLang = await toEnglish(mp);
      await slowScroll(mp);
      await mp.screenshot({ path: path.join(OUT, 'screenshots', 'mobile', `${slug}-${lang}.png`), fullPage: true });
    } catch (e) { rec.langs[lang].mobileError = e.message.split('\n')[0]; }
    await mp.close().catch(() => {});
  }
  results[p] = rec;
  console.log(new Date().toISOString().slice(11, 19), p, rec.blank ? 'BLANK' : JSON.stringify(Object.fromEntries(Object.entries(rec.langs).map(([k, v]) => [k, v.error || `${v.langGot} a${v.assets} f${v.forms} h${v.hiddenAnim}`]))));
}

(async () => {
  await sitemap();
  seeds.forEach((s) => enqueue(s, 'seed'));
  const browser = await launch();
  const workers = Array.from({ length: 3 }, async () => {
    const ctxD = await newContext(browser, 'desktop');
    const ctxM = await newContext(browser, 'mobile');
    for (;;) {
      const item = queue.shift();
      if (!item) {
        // wait for others that may still enqueue
        await new Promise((r) => setTimeout(r, 3000));
        if (!queue.length && busy === 0) break;
        continue;
      }
      busy++;
      try { await capturePage(ctxD, ctxM, item); } catch (e) { console.log('FAIL', item.p, e.message); }
      busy--;
    }
    log.push('aborted requests sample: ' + [...new Set(ctxD._aborted.map((a) => a.split(' ')[0] + ' ' + a.split(' ')[1].slice(0, 60)))].slice(0, 20).join(' | '));
  });

  await Promise.all(workers);
  await browser.close();
  fs.writeFileSync(path.join(WORK, 'crawl.json'), JSON.stringify({ results, log, seen: [...seen] }, null, 1));
  console.log('done', Object.keys(results).length, 'paths;', log.length, 'log lines');
})();
