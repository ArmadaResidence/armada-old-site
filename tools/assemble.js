// Phase B: download assets, rewrite tokens and links, write the static archive into OUT.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ORIGIN, OUT, WORK, slugOf } = require('./common');

const RAW = path.join(WORK, 'raw');
const CAPTURE_DATE = '2026-11-06';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36';
const crawl = JSON.parse(fs.readFileSync(path.join(WORK, 'crawl.json'), 'utf8'));

const pages = []; // {path, lang, raw}
for (const [p, rec] of Object.entries(crawl.results)) {
  if (rec.blank) continue;
  for (const lang of ['ar', 'en']) {
    const f = path.join(RAW, `${slugOf(p)}-${lang}.json`);
    if (fs.existsSync(f)) pages.push({ path: p, lang, raw: JSON.parse(fs.readFileSync(f, 'utf8')) });
  }
}
const archived = { ar: new Set(), en: new Set() };
pages.forEach((pg) => archived[pg.lang].add(pg.path));

const archDir = (p, lang) => (lang === 'en' ? 'en/' : '') + (p === '/' ? '' : p.slice(1) + '/');
const depth = (p, lang) => archDir(p, lang).split('/').filter(Boolean).length;
const enc = (d) => d.split('/').map((s) => encodeURIComponent(s)).join('/');

// ---------- assets ----------
const amap = new Map(); // url -> local path (relative to OUT, posix) | null
const failures = [];
const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/avif': '.avif', 'image/gif': '.gif', 'image/svg+xml': '.svg', 'image/x-icon': '.ico', 'image/vnd.microsoft.icon': '.ico', 'text/css': '.css', 'font/woff2': '.woff2', 'font/woff': '.woff', 'font/ttf': '.ttf', 'video/mp4': '.mp4', 'video/webm': '.webm' };
const KNOWN = /\.(jpe?g|png|webp|avif|gif|svg|ico|css|woff2?|ttf|otf|eot|mp4|webm)$/i;
function folderFor(ext) {
  if (ext === '.css') return 'assets/css';
  if (/\.(woff2?|ttf|otf|eot)$/.test(ext)) return 'assets/fonts';
  if (/\.(mp4|webm)$/.test(ext)) return 'assets/media';
  return 'assets/img';
}
async function get(url) {
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': UA, referer: ORIGIN + '/', accept: '*/*' } });
      if (!r.ok) { last = 'HTTP ' + r.status; if (r.status === 404) break; continue; }
      return { buf: Buffer.from(await r.arrayBuffer()), type: (r.headers.get('content-type') || '').split(';')[0].trim() };
    } catch (e) { last = e.message; }
    await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
  }
  throw new Error(last);
}
const inflight = new Map();
function download(url) {
  if (amap.has(url)) return Promise.resolve(amap.get(url));
  if (inflight.has(url)) return inflight.get(url);
  const pr = (async () => {
    try {
      const { buf, type } = await get(url);
      const u = new URL(url);
      let ext = (u.pathname.match(KNOWN) || [''])[0].toLowerCase();
      if (!ext) ext = EXT[type] || (type.startsWith('image/') ? '.' + type.split('/')[1] : '.bin');
      if (ext === '.jpeg') ext = '.jpg';
      if (u.hostname === 'fonts.googleapis.com') ext = '.css';
      const base = (path.posix.basename(u.pathname).replace(KNOWN, '').replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 40)) || 'file';
      const local = `${folderFor(ext)}/${base}-${crypto.createHash('sha1').update(url).digest('hex').slice(0, 8)}${ext}`;
      amap.set(url, local);
      let out = buf;
      if (ext === '.css') out = Buffer.from(await processCss(buf.toString('utf8'), url, local));
      fs.mkdirSync(path.join(OUT, path.dirname(local)), { recursive: true });
      fs.writeFileSync(path.join(OUT, local), out);
      return local;
    } catch (e) { failures.push(url + ' — ' + e.message); amap.set(url, null); return null; }
  })();
  inflight.set(url, pr);
  return pr;
}
async function processCss(text, cssUrl, cssLocal) {
  const refs = new Set();
  text.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (m, q, u) => { if (!/^(data:|#)/.test(u.trim())) refs.add(u.trim()); return m; });
  text.replace(/@import\s+(['"])([^'"]+)\1/g, (m, q, u) => { refs.add(u.trim()); return m; });
  const res = {};
  await Promise.all([...refs].map(async (r) => {
    let abs; try { abs = new URL(r, cssUrl).href; } catch { return; }
    const loc = await download(abs);
    res[r] = loc ? path.posix.relative(path.posix.dirname(cssLocal), loc) : 'data:,';
  }));
  return text
    .replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (m, q, u) => (res[u.trim()] ? `url("${res[u.trim()]}")` : m))
    .replace(/@import\s+(['"])([^'"]+)\1/g, (m, q, u) => (res[u.trim()] ? `@import "${res[u.trim()]}"` : m));
}

// ---------- page chrome ----------
const BAR_CSS = `<style id="archive-bar-style">
html{padding-top:34px!important;scroll-padding-top:34px}
[data-arch-shift]{top:34px!important}
#archive-bar{position:fixed;top:0;left:0;right:0;height:34px;z-index:2147483647;margin:0;padding:0 12px;box-sizing:border-box;background:#142A3B;color:#F3EFE7;font:14px/34px Tahoma,"Segoe UI",Arial,sans-serif;text-align:center;direction:rtl;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border-bottom:1px solid #A97C50}
#archive-bar a{color:#F3EFE7;text-decoration:underline;margin-inline-start:14px}
form[data-arch-disabled]{cursor:not-allowed}
</style>`;
function bar(pg, prefix) {
  const other = pg.lang === 'ar' ? 'en' : 'ar';
  const otherLink = archived[other].has(pg.path) ? `<a href="${prefix}${enc(archDir(pg.path, other))}" lang="${other}">${other === 'en' ? 'English' : 'العربية'}</a>` : '';
  return `<div id="archive-bar" dir="rtl" lang="ar" role="note">نسخة أرشيفية من الموقع القديم — للمقارنة فقط${otherLink}<a href="${prefix}archive-index.html">فهرس الأرشيف</a></div>`;
}
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const unent = (s) => s.replace(/&amp;/g, '&');
const normPath = (p) => { try { p = decodeURI(p); } catch {} if (p.length > 1) p = p.replace(/\/+$/, ''); return p || '/'; };

const externalLinks = new Set(); const unarchivedLinks = new Set();
(async () => {
  // assets first
  const all = new Set(); pages.forEach((pg) => pg.raw.assets.forEach((a) => all.add(a)));
  const list = [...all]; let i = 0;
  await Promise.all(Array.from({ length: 8 }, async () => { while (i < list.length) await download(list[i++]); }));
  // pages
  const index = [];
  for (const pg of pages) {
    const dir = archDir(pg.path, pg.lang);
    const prefix = '../'.repeat(depth(pg.path, pg.lang));
    let html = pg.raw.html;
    html = html.replace(/__ARCHA(\d+)__/g, (m, n) => { const loc = amap.get(pg.raw.assets[+n]); return loc ? prefix + loc : 'data:,'; });
    html = html.replace(/(href=")arch-page:([^"]*)"/g, (m, a, t) => {
      t = unent(t);
      const hi = t.indexOf('#'); const hash = hi >= 0 ? t.slice(hi) : ''; const pq = hi >= 0 ? t.slice(0, hi) : t;
      const p = normPath(pq.split('?')[0]);
      if (p === pg.path && !pq.includes('?')) return `${a}${esc(hash || './')}"`;
      if (archived[pg.lang].has(p)) return `${a}${esc((prefix + enc(archDir(p, pg.lang)) || './') + hash)}"`;
      unarchivedLinks.add(pq);
      return `${a}${esc(ORIGIN + pq + hash)}"`;
    });
    for (const m of html.matchAll(/href="(https?:\/\/[^"]+)"/g)) if (!/armadaresidence\.com\/(assets)/.test(m[1])) externalLinks.add(unent(m[1]).split('#')[0]);
    const head = `<meta name="robots" content="noindex, nofollow">\n<meta name="archive-source" content="${esc(pg.raw.url)}">\n<meta name="archive-captured" content="${pg.raw.capturedAt}">\n${BAR_CSS}`;
    html = html.replace(/<head([^>]*)>/i, (m) => `${m}\n${head}\n`);
    html = html.replace(/<body([^>]*)>/i, (m) => `${m}\n${bar(pg, prefix)}\n`);
    if (/<script/i.test(html)) throw new Error('script left in ' + dir);
    fs.mkdirSync(path.join(OUT, dir), { recursive: true });
    fs.writeFileSync(path.join(OUT, dir, 'index.html'), html);
    index.push({ dir, lang: pg.lang, url: pg.raw.url, title: pg.raw.title, at: pg.raw.capturedAt, langGot: pg.raw.langGot, path: pg.path });
  }
  index.sort((a, b) => (a.lang === b.lang ? (a.path === '/' ? -1 : b.path === '/' ? 1 : a.path.localeCompare(b.path)) : a.lang === 'ar' ? -1 : 1));
  const rows = index.map((r) => `<tr><td>${r.lang === 'ar' ? 'العربية' : 'English'}</td><td><a href="${enc(r.dir) || './'}">${esc(r.dir ? '/' + r.dir : '/')}</a></td><td dir="ltr"><code>${esc(r.url)}</code>${r.lang === 'en' ? ' <small>(English toggle)</small>' : ''}</td><td dir="auto">${esc(r.title)}</td><td dir="ltr">${esc(r.at.replace('T', ' ').slice(0, 16))} UTC</td></tr>`).join('\n');
  const idx = `<!DOCTYPE html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>فهرس الأرشيف — الموقع القديم لأرمادا ريزيدنس</title>
<style>body{margin:0;font:15px/1.6 Tahoma,"Segoe UI",Arial,sans-serif;background:#F3EFE7;color:#142A3B}main{max-width:1200px;margin:0 auto;padding:24px 16px}
#archive-bar{background:#142A3B;color:#F3EFE7;font-size:14px;line-height:34px;text-align:center}h1{font-size:22px}table{border-collapse:collapse;width:100%;background:#fff}
th,td{border:1px solid #d8cfc0;padding:6px 8px;text-align:start;vertical-align:top;font-size:14px}th{background:#142A3B;color:#F3EFE7}a{color:#8A6239}code{font-size:12px;word-break:break-all}</style></head>
<body><div id="archive-bar" role="note">نسخة أرشيفية من الموقع القديم — للمقارنة فقط</div><main>
<h1>فهرس الأرشيف — الموقع القديم (armadaresidence.com، Hostinger Horizons)</h1>
<p>التقاط: ${CAPTURE_DATE}. عدد الصفحات: ${index.length} (العربية ${index.filter((r) => r.lang === 'ar').length}، English ${index.filter((r) => r.lang === 'en').length}). الموقع القديم يبدّل اللغة داخل الصفحة دون تغيير الرابط، فالنسخة الإنجليزية محفوظة تحت <code>/en/</code>.</p>
<p dir="ltr" style="text-align:left">Archived copy of the old site, captured ${CAPTURE_DATE}, for comparison only — not for indexing. The old site switches language in place (same URL), so English pages are stored under <code>/en/</code>.</p>
<table><thead><tr><th>اللغة</th><th>الصفحة في الأرشيف</th><th>الرابط الأصلي</th><th>العنوان</th><th>وقت الالتقاط</th></tr></thead><tbody>
${rows}
</tbody></table></main></body></html>
`;
  fs.writeFileSync(path.join(OUT, 'archive-index.html'), idx);
  fs.writeFileSync(path.join(WORK, 'assemble.json'), JSON.stringify({ pages: index, assets: [...amap].length, failures, unarchivedLinks: [...unarchivedLinks], externalLinks: [...externalLinks].sort() }, null, 1));
  console.log('pages', index.length, 'assets', amap.size, 'failures', failures.length);
  failures.forEach((f) => console.log('  FAIL', f));
  console.log('unarchived internal links', [...unarchivedLinks]);
})();
