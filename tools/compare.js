// Phase C: render archive copy vs live old page at 1440 and 375, pixel-diff full-page shots.
// usage: node compare.js <archiveBase e.g. https://armadaresidence.github.io/armada-old-site/> [filter]
const fs = require('fs');
const path = require('path');
const { PNG } = require('F:/Armada Website/node_modules/pngjs');
const { ORIGIN, WORK, launch, newContext, settle, slowScroll, toEnglish, slugOf } = require('./common');

const BASE = process.argv[2].replace(/\/?$/, '/');
const FILTER = process.argv[3] ? new RegExp(process.argv[3]) : null;
const DIFF = path.join(WORK, 'diff'); fs.mkdirSync(DIFF, { recursive: true });
const pages = JSON.parse(fs.readFileSync(path.join(WORK, 'assemble.json'), 'utf8')).pages.filter((p) => !FILTER || FILTER.test(p.dir + ' ' + p.lang));
const HIDE = '#archive-bar{display:none!important} html{padding-top:0!important} [data-arch-shift]{top:0!important}';

function diff(a, b) {
  const A = PNG.sync.read(a); const B = PNG.sync.read(b);
  const W = Math.min(A.width, B.width); const H = Math.max(A.height, B.height); const h = Math.min(A.height, B.height);
  const out = new PNG({ width: W, height: H });
  let n = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4;
    let d = true;
    if (y < h) {
      const ia = (y * A.width + x) * 4; const ib = (y * B.width + x) * 4;
      d = Math.max(Math.abs(A.data[ia] - B.data[ib]), Math.abs(A.data[ia + 1] - B.data[ib + 1]), Math.abs(A.data[ia + 2] - B.data[ib + 2])) > 32;
      const g = (A.data[ia] + A.data[ia + 1] + A.data[ia + 2]) / 3;
      out.data[o] = d ? 255 : g * 0.3 + 178; out.data[o + 1] = d ? 0 : g * 0.3 + 178; out.data[o + 2] = d ? 0 : g * 0.3 + 178; out.data[o + 3] = 255;
    } else { out.data[o] = 255; out.data[o + 1] = 0; out.data[o + 2] = 255; out.data[o + 3] = 255; }
    if (d) n++;
  }
  // which bands differ (in 10 % slices of height)
  const bands = [];
  for (let s = 0; s < 10; s++) {
    let c = 0; const y0 = Math.floor(H * s / 10); const y1 = Math.floor(H * (s + 1) / 10);
    for (let y = y0; y < y1; y++) for (let x = 0; x < W; x += 2) if (out.data[(y * W + x) * 4 + 1] === 0) c++;
    bands.push(Math.round(c * 2 * 100 / ((y1 - y0) * W)));
  }
  return { pct: +(n * 100 / (W * H)).toFixed(2), hA: A.height, hB: B.height, png: PNG.sync.write(out), bands };
}

async function shoot(ctx, url, { archive, en }) {
  const page = await ctx.newPage();
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 90000 });
    if (archive) await page.addStyleTag({ content: HIDE });
    await settle(page, 1500);
    if (en && !archive) await toEnglish(page);
    await slowScroll(page);
    if (archive) {
      const missing = await page.evaluate(() => [...document.images].filter((i) => i.complete && i.naturalWidth === 0 && i.getAttribute('src') !== 'data:,').map((i) => i.currentSrc || i.src));
      if (missing.length) console.log('   broken images', url, missing.slice(0, 5));
    }
    try { return await page.screenshot({ fullPage: true, timeout: 180000 }); }
    catch (e) {
      // very tall pages: capture in tiles and stitch
      const { w, h } = await page.evaluate(() => ({ w: document.documentElement.clientWidth, h: document.documentElement.scrollHeight }));
      const out = new PNG({ width: w, height: h }); const T = 4000;
      for (let y = 0; y < h; y += T) {
        const buf = await page.screenshot({ fullPage: true, clip: { x: 0, y, width: w, height: Math.min(T, h - y) }, timeout: 180000 });
        const t = PNG.sync.read(buf);
        for (let r = 0; r < t.height && y + r < h; r++) t.data.copy(out.data, (y + r) * w * 4, r * t.width * 4, r * t.width * 4 + Math.min(t.width, w) * 4);
      }
      console.log('   tiled screenshot', url, h);
      return PNG.sync.write(out);
    }
  } finally { await page.close().catch(() => {}); }
}

(async () => {
  const browser = await launch();
  const results = []; let i = 0;
  await Promise.all(Array.from({ length: +(process.env.CONC || 3) }, async () => {
    const ctx = { desktop: await newContext(browser, 'desktop'), mobile: await newContext(browser, 'mobile') };
    while (i < pages.length) {
      const pg = pages[i++];
      const live = ORIGIN + (pg.path === '/' ? '/' : encodeURI(pg.path));
      const arch = BASE + pg.dir.split('/').map(encodeURIComponent).join('/');
      for (const kind of (process.env.KINDS || 'desktop,mobile').split(',')) {
        try {
          let a, l, d, tries = 0;
          for (;;) {
            tries++;
            try {
              if (process.env.SEQ) { a = await shoot(ctx[kind], arch, { archive: true, en: pg.lang === 'en' }); l = await shoot(ctx[kind], live, { archive: false, en: pg.lang === 'en' }); }
              else [a, l] = await Promise.all([shoot(ctx[kind], arch, { archive: true, en: pg.lang === 'en' }), shoot(ctx[kind], live, { archive: false, en: pg.lang === 'en' })]);
              d = diff(a, l);
            } catch (e) { if (tries < 3) continue; throw e; }
            if (d.pct <= 1 || tries >= 2) break;
          }
          d.tries = tries;
          const name = `${slugOf(pg.path)}-${pg.lang}-${kind}`;
          fs.writeFileSync(path.join(DIFF, name + '-diff.png'), d.png);
          fs.writeFileSync(path.join(DIFF, name + '-archive.png'), a);
          fs.writeFileSync(path.join(DIFF, name + '-live.png'), l);
          results.push({ dir: pg.dir, lang: pg.lang, kind, tries: d.tries, pct: d.pct, hArchive: d.hA, hLive: d.hB, bands: d.bands });
          console.log(`${d.pct.toFixed(2).padStart(6)}%  ${kind.padEnd(7)} /${pg.dir}  h ${d.hA}/${d.hB}  bands ${d.bands.join(',')}`);
        } catch (e) { console.log('ERR', pg.dir, kind, e.message.split('\n')[0]); results.push({ dir: pg.dir, lang: pg.lang, kind, error: e.message.split('\n')[0] }); }
      }
    }
  }));
  await browser.close();
  fs.writeFileSync(path.join(WORK, 'compare.json'), JSON.stringify(results, null, 1));
  console.log('over 1%:', results.filter((r) => r.pct > 1 || r.error).length, 'of', results.length);
})();
