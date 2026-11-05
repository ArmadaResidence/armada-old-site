// Runs inside the page: returns the rendered DOM with asset / link tokens, no scripts.
module.exports = function snapshot() {
  const SAME = ['armadaresidence.com', 'www.armadaresidence.com'];
  const assets = []; const amap = new Map();
  const tok = (u) => {
    if (!u) return u;
    u = u.trim();
    if (/^(data:|blob:|#|about:)/i.test(u)) return u;
    let abs; try { abs = new URL(u, document.baseURI).href; } catch { return u; }
    if (!/^https?:/.test(abs)) return u;
    if (!amap.has(abs)) { amap.set(abs, assets.length); assets.push(abs); }
    return `__ARCHA${amap.get(abs)}__`;
  };
  const cssUrls = (t) => (t || '').replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (m, q, u) => (/^(data:|#)/.test(u.trim()) ? m : `url("${tok(u)}")`));
  const srcset = (s) => s.split(/,(?=\s*\S)/).map((part) => { const bits = part.trim().split(/\s+/); if (!bits[0]) return part; bits[0] = tok(bits[0]); return bits.join(' '); }).join(', ');

  // live state → attributes
  document.querySelectorAll('input').forEach((i) => {
    if (i.type === 'checkbox' || i.type === 'radio') { if (i.checked) i.setAttribute('checked', ''); else i.removeAttribute('checked'); }
    else if (!['file', 'password'].includes(i.type)) i.setAttribute('value', i.value);
  });
  document.querySelectorAll('textarea').forEach((t) => { t.textContent = t.value; });
  document.querySelectorAll('select option').forEach((o) => { if (o.selected) o.setAttribute('selected', ''); else o.removeAttribute('selected'); });
  // fixed / sticky elements pinned to the top get pushed below the archive bar
  let shifted = 0;
  document.querySelectorAll('body *').forEach((el) => {
    const cs = getComputedStyle(el);
    if ((cs.position === 'fixed' || cs.position === 'sticky') && cs.top === '0px') { el.setAttribute('data-arch-shift', ''); shifted++; }
  });
  const styleTexts = [...document.querySelectorAll('style')].map((s) => {
    let t = s.textContent;
    try { if (s.sheet && s.sheet.cssRules.length && !t.trim()) t = [...s.sheet.cssRules].map((r) => r.cssText).join('\n'); } catch {}
    return t;
  });
  const hiddenAnim = [...document.querySelectorAll('[style*="opacity: 0"]')].filter((e) => e.getBoundingClientRect().height > 0).length;

  const root = document.documentElement.cloneNode(true);
  root.querySelectorAll('style').forEach((s, i) => { s.textContent = cssUrls(styleTexts[i]); });
  const removed = { scripts: 0 };
  root.querySelectorAll('script, noscript, base, link[rel~="modulepreload"], link[rel~="preload"], link[rel~="prefetch"], link[rel~="preconnect"], link[rel~="dns-prefetch"], link[rel~="canonical"], link[rel~="alternate"], link[rel~="manifest"], meta[http-equiv="refresh" i], meta[name="robots" i], meta[name="googlebot" i]').forEach((e) => { if (e.tagName === 'SCRIPT') removed.scripts++; e.remove(); });
  root.querySelectorAll('iframe').forEach((f) => { const s = f.getAttribute('src') || ''; if (/googletagmanager|facebook\.com\/tr|doubleclick/.test(s)) f.remove(); });

  const iframes = [];
  root.querySelectorAll('*').forEach((el) => {
    for (const a of [...el.attributes]) {
      if (/^on/i.test(a.name)) el.removeAttribute(a.name);
    }
    if (el.hasAttribute('style')) el.setAttribute('style', cssUrls(el.getAttribute('style')));
    const tag = el.tagName.toLowerCase();
    if (tag === 'img') {
      let src = el.getAttribute('src');
      if (!src && el.getAttribute('data-src')) src = el.getAttribute('data-src');
      if (src) el.setAttribute('src', tok(src));
      if (el.getAttribute('srcset')) el.setAttribute('srcset', srcset(el.getAttribute('srcset')));
    } else if (tag === 'source') {
      if (el.getAttribute('src')) el.setAttribute('src', tok(el.getAttribute('src')));
      if (el.getAttribute('srcset')) el.setAttribute('srcset', srcset(el.getAttribute('srcset')));
    } else if (tag === 'video' || tag === 'audio') {
      if (el.getAttribute('src')) el.setAttribute('src', tok(el.getAttribute('src')));
      if (el.getAttribute('poster')) el.setAttribute('poster', tok(el.getAttribute('poster')));
    } else if (tag === 'image' || tag === 'use' || tag === 'feimage') {
      for (const n of ['href', 'xlink:href']) { const v = el.getAttribute(n); if (v && !v.startsWith('#')) el.setAttribute(n, tok(v)); }
    } else if (tag === 'link') {
      const rel = (el.getAttribute('rel') || '').toLowerCase();
      if (/stylesheet|icon|apple-touch/.test(rel) && el.getAttribute('href')) el.setAttribute('href', tok(el.getAttribute('href')));
    } else if (tag === 'input' && el.getAttribute('type') === 'image' && el.getAttribute('src')) {
      el.setAttribute('src', tok(el.getAttribute('src')));
    } else if (tag === 'iframe') {
      iframes.push(el.getAttribute('src') || '(srcdoc)');
    } else if (tag === 'a' || tag === 'area') {
      const h = el.getAttribute('href');
      if (h != null) {
        if (/^\s*javascript:/i.test(h)) el.setAttribute('href', '#');
        else {
          try {
            const u = new URL(h, document.baseURI);
            if (/^https?:$/.test(u.protocol) && SAME.includes(u.hostname)) el.setAttribute('href', 'arch-page:' + u.pathname + u.search + u.hash);
          } catch {}
        }
      }
    }
  });
  // forms: inert
  let forms = 0;
  root.querySelectorAll('form').forEach((f) => {
    forms++;
    f.removeAttribute('action'); f.removeAttribute('method'); f.removeAttribute('target');
    f.setAttribute('data-arch-disabled', '');
    f.querySelectorAll('input, select, textarea, button').forEach((c) => {
      c.setAttribute('disabled', '');
      c.setAttribute('style', ((c.getAttribute('style') || '') + ';cursor:not-allowed;opacity:.6').replace(/^;/, ''));
    });
  });
  // controls outside forms that would submit something: buttons stay (no JS = no effect)
  return {
    html: '<!DOCTYPE html>\n' + root.outerHTML,
    assets, iframes, forms, shifted, removedScripts: removed.scripts, hiddenAnim,
    title: document.title, lang: document.documentElement.lang, dir: document.documentElement.dir,
    textLen: (document.body.innerText || '').trim().length,
  };
};
