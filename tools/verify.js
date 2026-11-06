// Step 7: checks on the published archive.
const fs = require('fs');
const path = require('path');
const { WORK, launch, newContext } = require('./common');
const BASE = 'https://armadaresidence.github.io/armada-old-site/';
const pages = JSON.parse(fs.readFileSync(path.join(WORK, 'assemble.json'), 'utf8')).pages;
const urls = [...pages.map((p) => BASE + p.dir.split('/').map(encodeURIComponent).join('/')), BASE + 'archive-index.html'];
(async () => {
  const problems = []; const foreign = new Map(); const linkTargets = new Set();
  for (const u of urls) {
    const r = await fetch(u); const t = await r.text();
    if (r.status !== 200) problems.push(`${u} HTTP ${r.status}`);
    if (!/<meta name="robots" content="noindex, nofollow">/.test(t)) problems.push(`${u} no noindex`);
    if (!/id="archive-bar"[^>]*>نسخة أرشيفية من الموقع القديم — للمقارنة فقط/.test(t)) problems.push(`${u} no top bar`);
    if (/<script/i.test(t)) problems.push(`${u} has <script>`);
    if (/\son[a-z]+=/i.test(t.replace(/<style[\s\S]*?<\/style>/g, '').replace(/"[^"]*"/g, '""'))) problems.push(`${u} inline handler?`);
  }
  const b = await launch();
  const ctx = await newContext(b, 'desktop', { noBlock: true });
  for (const u of urls) {
    const p = await ctx.newPage();
    const reqs = [];
    p.on('request', (q) => reqs.push(q.method() + ' ' + q.url()));
    await p.goto(u, { waitUntil: 'load' });
    await p.evaluate(async () => { for (let y = 0; y < document.documentElement.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); } });
    await p.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    const f = await p.evaluate(() => {
      const forms = [...document.querySelectorAll('form')];
      const enabled = forms.flatMap((fm) => [...fm.querySelectorAll('input,select,textarea,button')].filter((c) => !c.disabled)).length;
      const withAction = forms.filter((fm) => fm.hasAttribute('action')).length;
      const bar = document.getElementById('archive-bar'); const br = bar && bar.getBoundingClientRect();
      const links = [...document.querySelectorAll('a[href]')].map((a) => a.href);
      return { forms: forms.length, enabled, withAction, bar: !!bar && br.height > 0 && br.top === 0, links, scripts: document.scripts.length };
    });
    // try to submit: click every submit button (disabled → nothing must happen)
    const before = reqs.length; const urlBefore = p.url();
    for (const btn of await p.$$('form button, form input[type=submit]')) await btn.click({ force: true, timeout: 2000 }).catch(() => {});
    await p.waitForTimeout(500);
    if (p.url() !== urlBefore || reqs.length !== before) problems.push(`${u} form click caused navigation/request: ${reqs.slice(before).join(', ')}`);
    if (f.enabled || f.withAction) problems.push(`${u} forms: ${f.enabled} enabled controls, ${f.withAction} with action`);
    if (!f.bar) problems.push(`${u} bar not visible at top`);
    if (f.scripts) problems.push(`${u} ${f.scripts} scripts`);
    f.links.forEach((l) => { if (l.startsWith(BASE)) linkTargets.add(l.split('#')[0]); });
    for (const q of reqs) { const o = new URL(q.split(' ')[1]).origin; if (o !== 'https://armadaresidence.github.io') foreign.set(o, (foreign.get(o) || 0) + 1); }
    const bad = reqs.filter((q) => /armadaresidence\.com/.test(q));
    if (bad.length) problems.push(`${u} requests to armadaresidence.com: ${bad.slice(0, 3).join(', ')}`);
    await p.close();
  }
  await b.close();
  for (const l of linkTargets) { const r = await fetch(l); if (r.status !== 200) problems.push(`internal link ${l} HTTP ${r.status}`); }
  console.log('pages checked', urls.length, '| internal link targets', linkTargets.size);
  console.log('non-archive origins requested:', JSON.stringify([...foreign]));
  console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'no problems');
})();
