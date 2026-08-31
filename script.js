/**
 * MGH Downloader v2026.08.31
 * https://github.com/chaevsfe/mgh
 *
 * Packages resources already available to your authenticated McGraw Hill
 * Reader session into an EPUB or ZIP. Use only for content you may access.
 */
(async () => {
  'use strict';

  const VERSION = '2026.08.31';
  const KEY = '__MGH_DOWNLOADER__';
  const LTI_ENDPOINTS = [
    'https://prod.reader.prod.mheducation.com/v1/lti',
    'https://player-api.mheducation.com/v1/lti'
  ];
  const JSZIP_URLS = [
    'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
    'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js'
  ];

  if (window[KEY]?.close) window[KEY].close();

  let controller = new AbortController();
  const app = { root: null, close() { controller.abort(); app.root?.remove(); delete window[KEY]; } };
  window[KEY] = app;

  const el = (tag, text) => {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    return node;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function mount() {
    const root = el('div');
    root.id = 'mgh-downloader';
    Object.assign(root.style, {
      position: 'fixed', inset: 0, zIndex: 2147483647, overflow: 'auto',
      background: '#f5f7fa', color: '#17191d', font: '14px/1.45 system-ui,sans-serif'
    });
    const box = el('div');
    Object.assign(box.style, { maxWidth: '1050px', margin: '0 auto', padding: '24px' });
    root.append(box);
    document.documentElement.append(root);
    app.root = root;
    return box;
  }

  const box = mount();

  function clear(title = `MGH Downloader ${VERSION}`, subtitle = '') {
    box.replaceChildren();
    const head = el('div');
    Object.assign(head.style, { display: 'flex', justifyContent: 'space-between', gap: '16px', alignItems: 'start' });
    const text = el('div');
    const h1 = el('h1', title);
    h1.style.margin = '0';
    h1.style.fontSize = '26px';
    text.append(h1);
    if (subtitle) {
      const p = el('p', subtitle);
      p.style.margin = '4px 0 0';
      p.style.color = '#667085';
      text.append(p);
    }
    const close = button('Close');
    close.onclick = () => app.close();
    head.append(text, close);
    box.append(head);
    return box;
  }

  function button(text, primary = false) {
    const b = el('button', text);
    Object.assign(b.style, {
      padding: '9px 14px', borderRadius: '7px', border: '1px solid #cbd0d8',
      background: primary ? '#1769d2' : '#fff', color: primary ? '#fff' : '#17191d',
      fontWeight: 650, cursor: 'pointer'
    });
    return b;
  }

  function card() {
    const c = el('div');
    Object.assign(c.style, { background: '#fff', border: '1px solid #d8dde5', borderRadius: '10px', padding: '16px', marginTop: '18px' });
    return c;
  }

  function status(message) {
    clear();
    const c = card();
    c.append(el('strong', message));
    box.append(c);
  }

  function fail(title, error) {
    clear();
    const c = card();
    const h = el('h2', title);
    h.style.marginTop = '0';
    const pre = el('pre', error?.stack || error?.message || String(error));
    pre.style.whiteSpace = 'pre-wrap';
    pre.style.color = '#b42318';
    c.append(h, pre);
    box.append(c);
    console.error('[MGH Downloader]', error);
  }

  async function fetchRetry(url, retries = 3) {
    let last;
    for (let i = 1; i <= retries; i++) {
      try {
        const r = await fetch(url, { credentials: 'include', cache: 'no-store', signal: controller.signal });
        if (r.ok || (r.status >= 400 && r.status < 500 && ![408, 429].includes(r.status))) return r;
        last = new Error(`HTTP ${r.status} for ${url}`);
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        last = e;
      }
      if (i < retries) await sleep(i * 500);
    }
    throw last || new Error(`Failed to fetch ${url}`);
  }

  async function loadJSZip() {
    if (window.JSZip) return window.JSZip;
    let last;
    for (const src of JSZIP_URLS) {
      try {
        await new Promise((resolve, reject) => {
          const s = el('script');
          s.src = src;
          s.onload = resolve;
          s.onerror = () => reject(new Error(`Could not load ${src}`));
          (document.head || document.documentElement).append(s);
        });
        if (window.JSZip) return window.JSZip;
      } catch (e) { last = e; }
    }
    throw last || new Error('JSZip could not be loaded.');
  }

  function xml(text, name) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error(`${name} is not valid XML.`);
    return doc;
  }

  function deepFind(obj, keys, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 8) return null;
    if (!Array.isArray(obj)) {
      for (const k of keys) if (typeof obj[k] === 'string' && obj[k]) return obj[k];
    }
    for (const value of Object.values(obj)) {
      const hit = deepFind(value, keys, depth + 1);
      if (hit) return hit;
    }
    return null;
  }

  function baseFromPerformance() {
    const entries = performance.getEntriesByType?.('resource') || [];
    for (let i = entries.length - 1; i >= 0; i--) {
      try {
        const u = new URL(entries[i].name);
        for (const marker of ['/META-INF/container.xml', '/OPS/content.opf']) {
          const at = u.pathname.indexOf(marker);
          if (at >= 0) {
            u.pathname = `${u.pathname.slice(0, at)}/`;
            u.search = '';
            u.hash = '';
            return u.href;
          }
        }
      } catch (_) {}
    }
    return null;
  }

  async function discoverBook() {
    const seen = baseFromPerformance();
    if (seen) return { base: seen, via: 'reader network history' };

    const errors = [];
    for (const endpoint of LTI_ENDPOINTS) {
      try {
        const r = await fetchRetry(endpoint, 2);
        if (!r.ok) { errors.push(`${endpoint}: HTTP ${r.status}`); continue; }
        let data;
        try { data = await r.json(); } catch (_) { errors.push(`${endpoint}: invalid JSON`); continue; }
        const found = deepFind(data, ['custom_epub_url', 'epub_url', 'epubUrl', 'customEpubUrl']);
        if (found) {
          const u = new URL(found, location.href);
          u.search = ''; u.hash = '';
          if (!u.pathname.endsWith('/')) u.pathname += '/';
          return { base: u.href, via: endpoint };
        }
        errors.push(`${endpoint}: EPUB URL field missing`);
      } catch (e) { errors.push(`${endpoint}: ${e.message}`); }
    }
    throw new Error(`Could not locate the open textbook. Open the actual book reader, then run the script again.\n\n${errors.join('\n')}`);
  }

  async function readPackage(base) {
    const containerUrl = new URL('META-INF/container.xml', base).href;
    let containerText;
    let rootPath;
    const cr = await fetchRetry(containerUrl, 2);

    if (cr.ok) {
      containerText = await cr.text();
      const cdoc = xml(containerText, 'container.xml');
      const root = [...cdoc.getElementsByTagNameNS('*', 'rootfile')].find((n) => n.hasAttribute('full-path'));
      if (!root) throw new Error('container.xml has no rootfile.');
      rootPath = root.getAttribute('full-path').replace(/^\/+/, '');
    } else {
      rootPath = 'OPS/content.opf';
      containerText = '<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>';
    }

    const packageUrl = new URL(rootPath, base).href;
    const pr = await fetchRetry(packageUrl, 3);
    if (!pr.ok) throw new Error(`Could not fetch ${rootPath}: HTTP ${pr.status}`);
    const packageText = await pr.text();
    const doc = xml(packageText, 'package document');
    const manifest = [...doc.getElementsByTagNameNS('*', 'manifest')][0];
    const items = manifest ? [...manifest.children].filter((n) => n.localName === 'item' && n.getAttribute('href')) : [];
    if (!items.length) throw new Error('The package manifest is empty.');
    const title = [...doc.getElementsByTagNameNS('*', 'title')][0]?.textContent?.trim() || 'textbook';
    return { containerText, rootPath, packageUrl, packageText, items, title };
  }

  function extension(href) {
    const path = new URL(href, 'https://epub.local/').pathname;
    const name = path.split('/').pop() || '';
    const dot = name.lastIndexOf('.');
    return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '(none)';
  }

  function zipPath(rootPath, href) {
    const dir = rootPath.includes('/') ? rootPath.slice(0, rootPath.lastIndexOf('/') + 1) : '';
    const u = new URL(href, `https://epub.local/${dir}`);
    let path = u.pathname.replace(/^\//, '');
    try { path = decodeURIComponent(path); } catch (_) {}
    return path.replace(/\\/g, '/');
  }

  function safeName(name) {
    return (name || 'textbook').replace(/[\u0000-\u001f\\/:*?"<>|]+/g, '_').replace(/[. ]+$/g, '').trim().slice(0, 180) || 'textbook';
  }

  function choose(pkg, via, onStart) {
    clear(`MGH Downloader ${VERSION}`, pkg.title);
    const c = card();
    const p = el('p', `Found ${pkg.items.length} resources via ${via}. All resource types are selected by default.`);
    p.style.marginTop = '0';
    c.append(p);

    const exts = [...new Set(pkg.items.map((i) => extension(i.getAttribute('href'))))].sort();
    const grid = el('div');
    Object.assign(grid.style, { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(130px,1fr))', gap: '8px', margin: '16px 0' });
    const checks = new Map();
    exts.forEach((ext, i) => {
      const label = el('label');
      Object.assign(label.style, { padding: '8px', border: '1px solid #dde1e7', borderRadius: '7px' });
      const cb = el('input'); cb.type = 'checkbox'; cb.checked = true; cb.id = `mgh-${i}`;
      checks.set(ext, cb);
      label.append(cb, document.createTextNode(` ${ext === '(none)' ? '(no extension)' : '.' + ext}`));
      grid.append(label);
    });
    c.append(grid);

    const row = el('div');
    Object.assign(row.style, { display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' });
    const format = el('select');
    format.innerHTML = '<option value="epub">EPUB (.epub)</option><option value="zip">ZIP (.zip)</option>';
    format.style.padding = '8px';
    const all = button('Select all'); all.onclick = () => checks.forEach((cb) => { cb.checked = true; });
    const none = button('Select none'); none.onclick = () => checks.forEach((cb) => { cb.checked = false; });
    const start = button('Start download', true);
    start.onclick = () => {
      const selected = new Set([...checks].filter(([, cb]) => cb.checked).map(([ext]) => ext));
      if (!selected.size) return alert('Select at least one resource type.');
      onStart(selected, format.value);
    };
    row.append(format, all, none, start);
    c.append(row);
    box.append(c);
  }

  async function eachLimit(items, limit, fn) {
    let next = 0;
    async function worker() {
      while (next < items.length) {
        const i = next++;
        await fn(items[i], i);
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  }

  async function download(JSZip, pkg, selected, format) {
    controller = new AbortController();
    clear(`MGH Downloader ${VERSION}`, pkg.title);

    const stat = card();
    const statusLine = el('strong', 'Preparing download…');
    const counts = el('div', 'Downloaded 0 • Skipped 0 • Failed 0');
    counts.style.marginTop = '6px';
    stat.append(statusLine, counts);
    box.append(stat);

    const log = el('div');
    Object.assign(log.style, {
      marginTop: '12px', height: '55vh', overflow: 'auto', background: '#101217', color: '#e8eaed',
      borderRadius: '10px', padding: '12px', font: '12px/1.5 ui-monospace,monospace'
    });
    box.append(log);
    const cancel = button('Cancel');
    cancel.style.marginTop = '12px';
    cancel.onclick = () => controller.abort();
    box.append(cancel);

    const line = (text, color) => {
      const d = el('div', text); if (color) d.style.color = color; log.append(d); log.scrollTop = log.scrollHeight;
    };
    let ok = 0, skipped = 0, failed = 0;
    const update = () => { counts.textContent = `Downloaded ${ok} • Skipped ${skipped} • Failed ${failed}`; };

    const zip = new JSZip();
    zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
    zip.file('META-INF/container.xml', pkg.containerText);
    zip.file(pkg.rootPath, pkg.packageText);

    const todo = [];
    pkg.items.forEach((item, i) => {
      const href = item.getAttribute('href');
      if (!selected.has(extension(href))) { skipped++; line(`[${i + 1}/${pkg.items.length}] skip ${href}`, '#ffd37a'); }
      else todo.push({ href, i });
    });
    update();
    const retry = [];
    statusLine.textContent = `Downloading ${todo.length} resources…`;

    await eachLimit(todo, 6, async ({ href, i }) => {
      const url = new URL(href, pkg.packageUrl).href;
      try {
        const r = await fetchRetry(url, 3);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        zip.file(zipPath(pkg.rootPath, href), await r.arrayBuffer());
        ok++; line(`[${i + 1}/${pkg.items.length}] ok ${href}`, '#8de1a6');
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        failed++; retry.push({ href, i, url }); line(`[${i + 1}/${pkg.items.length}] fail ${href}: ${e.message}`, '#ff9b95');
      }
      update();
    });

    if (retry.length) {
      statusLine.textContent = `Retrying ${retry.length} failed resources…`;
      for (const item of retry) {
        try {
          const r = await fetchRetry(item.url, 2);
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          zip.file(zipPath(pkg.rootPath, item.href), await r.arrayBuffer());
          ok++; failed--; line(`retry ok ${item.href}`, '#8de1a6');
        } catch (e) {
          if (e.name === 'AbortError') throw e;
          line(`final fail ${item.href}: ${e.message}`, '#ff9b95');
        }
        update();
      }
    }

    statusLine.textContent = 'Building archive…';
    const blob = await zip.generateAsync({
      type: 'blob', mimeType: format === 'epub' ? 'application/epub+zip' : 'application/zip',
      compression: 'DEFLATE', compressionOptions: { level: 6 }
    }, (m) => { statusLine.textContent = `Building archive… ${Math.floor(m.percent)}%`; });

    const name = `${safeName(pkg.title)}.${format}`;
    const url = URL.createObjectURL(blob);
    const a = el('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    statusLine.textContent = `Finished: ${name}`;
    cancel.textContent = 'Close';
    cancel.onclick = () => app.close();
  }

  try {
    status('Loading JSZip…');
    const JSZip = await loadJSZip();
    status('Finding the open McGraw Hill textbook…');
    const book = await discoverBook();
    status('Reading EPUB metadata…');
    const pkg = await readPackage(book.base);
    choose(pkg, book.via, (selected, format) => {
      download(JSZip, pkg, selected, format).catch((e) => {
        if (e.name === 'AbortError') fail('Download cancelled', new Error('The download was cancelled.'));
        else fail('Download failed', e);
      });
    });
  } catch (e) {
    if (e.name === 'AbortError') app.close();
    else fail('Initialization failed', e);
  }
})();
