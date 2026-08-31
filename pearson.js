/**
 * Pearson+ eText Downloader v2026.08.31.2
 * https://github.com/chaevsfe/mgh
 *
 * Packages resources already available to an authenticated Pearson+ Reader
 * session into EPUB or ZIP. It never reads, prints, or persists auth tokens.
 * Optional userscript support can fetch public Pearson media across CORS without
 * sending Pearson credentials to those media hosts.
 */
(async () => {
  'use strict';

  const VERSION = '2026.08.31.2';
  const KEY = '__PEARSON_DOWNLOADER__';
  const JSZIP_URLS = [
    'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
    'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js'
  ];
  const MAX_CRAWL = 6000;
  const START_CONCURRENCY = 6;
  const MEDIA_BRIDGE_HOSTS = new Set(['cite-media.pearson.com', 'media.pearsoncmg.com']);

  if (window[KEY]?.close) window[KEY].close();

  let controller = new AbortController();
  const app = {
    root: null,
    capturedToc: null,
    capturedTocSource: null,
    lastReport: null,
    originalFetch: window.fetch,
    originalXHROpen: XMLHttpRequest.prototype.open,
    originalXHRSend: XMLHttpRequest.prototype.send,
    close() {
      controller.abort();
      try { if (window.fetch.__pearsonDownloaderWrapped) window.fetch = app.originalFetch; } catch (_) {}
      try {
        XMLHttpRequest.prototype.open = app.originalXHROpen;
        XMLHttpRequest.prototype.send = app.originalXHRSend;
      } catch (_) {}
      app.root?.remove();
      delete window[KEY];
    }
  };
  window[KEY] = app;

  const el = (tag, text) => {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    return node;
  };
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
    Object.assign(c.style, {
      background: '#fff', border: '1px solid #d8dde5', borderRadius: '10px',
      padding: '16px', marginTop: '18px'
    });
    return c;
  }

  function mount() {
    const root = el('div');
    root.id = 'pearson-downloader';
    Object.assign(root.style, {
      position: 'fixed', inset: 0, zIndex: 2147483647, overflow: 'auto',
      background: '#f5f7fa', color: '#17191d', font: '14px/1.45 system-ui,sans-serif'
    });
    const box = el('div');
    Object.assign(box.style, { maxWidth: '1080px', margin: '0 auto', padding: '24px' });
    root.append(box);
    document.documentElement.append(root);
    app.root = root;
    return box;
  }

  const box = mount();

  function clear(title = `Pearson Downloader ${VERSION}`, subtitle = '') {
    box.replaceChildren();
    const head = el('div');
    Object.assign(head.style, { display: 'flex', justifyContent: 'space-between', gap: '16px', alignItems: 'start' });
    const text = el('div');
    const h1 = el('h1', title);
    h1.style.margin = '0'; h1.style.fontSize = '26px';
    text.append(h1);
    if (subtitle) {
      const p = el('p', subtitle);
      p.style.margin = '4px 0 0'; p.style.color = '#667085';
      text.append(p);
    }
    const close = button('Close');
    close.onclick = () => app.close();
    head.append(text, close); box.append(head);
  }

  function status(message, detail = '') {
    clear();
    const c = card(); c.append(el('strong', message));
    if (detail) {
      const p = el('div', detail); p.style.marginTop = '6px'; p.style.color = '#667085'; c.append(p);
    }
    box.append(c);
  }

  function fail(title, error) {
    clear();
    const c = card();
    const h = el('h2', title); h.style.marginTop = '0';
    const pre = el('pre', error?.stack || error?.message || String(error));
    pre.style.whiteSpace = 'pre-wrap'; pre.style.color = '#b42318';
    c.append(h, pre); box.append(c);
    console.error('[Pearson Downloader]', error);
  }

  function normalizeUrlInput(input) {
    if (typeof input === 'string') return input;
    if (input && typeof input.url === 'string') return input.url;
    return '';
  }

  function looksLikeToc(value, productId = null) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const id = value.bookId || value.productId || value.id;
    if (productId && id && String(id) !== String(productId)) return false;
    if (!Array.isArray(value.children) || !value.children.length) return false;
    let hits = 0;
    const stack = value.children.slice(0, 100);
    let checked = 0;
    while (stack.length && checked++ < 1500) {
      const n = stack.pop();
      if (!n || typeof n !== 'object') continue;
      if (typeof n.uri === 'string' && /(?:^|\/)narrative\/.+\.html(?:$|[?#])/i.test(n.uri) && ++hits >= 2) return true;
      if (Array.isArray(n.children)) stack.push(...n.children.slice(0, 150));
    }
    return false;
  }

  function countTocUris(toc) {
    let count = 0;
    const stack = [toc];
    while (stack.length) {
      const n = stack.pop();
      if (!n || typeof n !== 'object') continue;
      if (typeof n.uri === 'string') count++;
      if (Array.isArray(n.children)) stack.push(...n.children);
    }
    return count;
  }

  function maybeCaptureToc(value, source) {
    try {
      if (!looksLikeToc(value)) return false;
      if (!app.capturedToc || countTocUris(value) > countTocUris(app.capturedToc)) {
        app.capturedToc = value;
        app.capturedTocSource = source;
        console.info(`[Pearson Downloader] Captured TOC from ${source}: ${countTocUris(value)} URI entries.`);
      }
      return true;
    } catch (_) { return false; }
  }

  function installCaptureHooks() {
    if (!window.fetch.__pearsonDownloaderWrapped) {
      const original = app.originalFetch;
      const wrapped = function(input, init) {
        const promise = original.apply(this, arguments);
        try {
          const url = normalizeUrlInput(input);
          if (/\/api\/contenttoc\/v1\/assets(?:[/?]|$)/i.test(url)) {
            promise.then(async (response) => {
              try {
                if (response.ok) maybeCaptureToc(await response.clone().json(), 'Pearson contenttoc fetch');
              } catch (_) {}
            });
          }
        } catch (_) {}
        return promise;
      };
      wrapped.__pearsonDownloaderWrapped = true;
      window.fetch = wrapped;
    }

    XMLHttpRequest.prototype.open = function(method, url) {
      try { this.__pearsonDownloaderUrl = String(url || ''); } catch (_) {}
      return app.originalXHROpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function() {
      try {
        if (/\/api\/contenttoc\/v1\/assets(?:[/?]|$)/i.test(this.__pearsonDownloaderUrl || '')) {
          this.addEventListener('load', () => {
            try {
              if (this.status < 200 || this.status >= 300) return;
              let data = this.response;
              if (this.responseType === '' || this.responseType === 'text') data = JSON.parse(this.responseText);
              else if (this.responseType !== 'json' && typeof data === 'string') data = JSON.parse(data);
              maybeCaptureToc(data, 'Pearson contenttoc XHR');
            } catch (_) {}
          }, { once: true });
        }
      } catch (_) {}
      return app.originalXHRSend.apply(this, arguments);
    };
  }
  installCaptureHooks();

  function allSameOriginWindows() {
    const out = [], seen = new Set();
    const walk = (w) => {
      if (!w || seen.has(w)) return;
      seen.add(w);
      try {
        void w.location.href;
        out.push(w);
        for (let i = 0; i < w.frames.length; i++) walk(w.frames[i]);
      } catch (_) {}
    };
    walk(window.top || window);
    return out;
  }

  function allPerformanceUrls() {
    const urls = [];
    for (const w of allSameOriginWindows()) {
      try {
        for (const e of w.performance.getEntriesByType('resource') || []) if (e.name) urls.push(e.name);
        urls.push(w.location.href);
      } catch (_) {}
    }
    return [...new Set(urls)];
  }

  function discoverProductId() {
    const candidates = [location.href, ...allPerformanceUrls()];
    const patterns = [
      /\/products\/([0-9a-f]{8}-[0-9a-f-]{27,})/i,
      /page-mapping\/([0-9a-f-]{30,})(?:[/?#]|$)/i,
      /\/marin\/api\/1\.0\/products\/([0-9a-f-]{30,})(?:[/?#]|$)/i
    ];
    for (const raw of candidates) for (const re of patterns) {
      const m = String(raw).match(re); if (m) return m[1];
    }
    return null;
  }

  function discoverSanvan() {
    for (const raw of allPerformanceUrls().reverse()) {
      const m = String(raw).match(/^(https?:\/\/[^/]+)\/eps\/sanvan\/api\/item\/([^/]+)\/([^/]+)\/file\//i);
      if (m) return {
        origin: m[1], itemId: decodeURIComponent(m[2]), itemVersion: decodeURIComponent(m[3]),
        base: `${m[1]}/eps/sanvan/api/item/${m[2]}/${m[3]}/file/`
      };
    }
    return null;
  }

  const safeJsonParse = (text) => { try { return JSON.parse(text); } catch (_) { return null; } };

  function findTocInObject(start, productId, maxObjects = 50000) {
    if (!start || typeof start !== 'object') return null;
    const queue = [start], seen = new WeakSet();
    let inspected = 0;
    while (queue.length && inspected < maxObjects) {
      const value = queue.shift();
      if (!value || typeof value !== 'object' || seen.has(value)) continue;
      seen.add(value); inspected++;
      try { if (looksLikeToc(value, productId)) return value; } catch (_) {}
      let keys;
      try { keys = Object.keys(value); } catch (_) { continue; }
      let pushed = 0;
      for (const key of keys) {
        if (pushed > 150) break;
        if (/^(?:window|document|ownerDocument|parentNode|childNodes|nextSibling|previousSibling|return)$/.test(key)) continue;
        let child;
        try { child = value[key]; } catch (_) { continue; }
        if (!child || typeof child !== 'object') continue;
        if (typeof Window !== 'undefined' && child instanceof Window) continue;
        if (typeof Document !== 'undefined' && child instanceof Document) continue;
        if (typeof Element !== 'undefined' && child instanceof Element) continue;
        queue.push(child); pushed++;
      }
    }
    return null;
  }

  function findTocInStorage(productId) {
    for (const w of allSameOriginWindows()) for (const storageName of ['localStorage', 'sessionStorage']) {
      try {
        const storage = w[storageName];
        for (let i = 0; i < storage.length; i++) {
          const key = storage.key(i), raw = storage.getItem(key);
          if (!raw || raw.length < 200 || !/narrative\//i.test(raw)) continue;
          const hit = findTocInObject(safeJsonParse(raw), productId, 15000);
          if (hit) return { toc: hit, source: `${storageName}:${key}` };
        }
      } catch (_) {}
    }
    return null;
  }

  function findTocInScripts(productId) {
    for (const w of allSameOriginWindows()) {
      try {
        for (const script of w.document.querySelectorAll('script[type="application/json"],script#__NEXT_DATA__')) {
          const raw = script.textContent || '';
          if (!/narrative\//i.test(raw)) continue;
          const hit = findTocInObject(safeJsonParse(raw), productId, 30000);
          if (hit) return { toc: hit, source: 'embedded JSON' };
        }
      } catch (_) {}
    }
    return null;
  }

  function findTocInReact(productId) {
    for (const w of allSameOriginWindows()) {
      let nodes = [];
      try { nodes = [w.document.documentElement, w.document.body, ...w.document.querySelectorAll('#root,[id*=root],[data-reactroot],main')]; } catch (_) {}
      for (const node of nodes) {
        if (!node) continue;
        let keys = [];
        try { keys = Object.keys(node); } catch (_) {}
        for (const k of keys) if (/^__react(?:Fiber|Container|Props)/i.test(k)) {
          try {
            const hit = findTocInObject(node[k], productId, 90000);
            if (hit) return { toc: hit, source: 'React reader state' };
          } catch (_) {}
        }
      }
    }
    return null;
  }

  function discoverToc(productId) {
    if (app.capturedToc && looksLikeToc(app.capturedToc, productId)) {
      return { toc: app.capturedToc, source: app.capturedTocSource || 'captured network response' };
    }
    return findTocInStorage(productId) || findTocInScripts(productId) || findTocInReact(productId);
  }

  function collectEntries(toc) {
    const entries = [], stack = [{ node: toc, parents: [] }];
    while (stack.length) {
      const { node, parents } = stack.pop();
      if (!node || typeof node !== 'object') continue;
      const nextParents = node.title ? [...parents, node.title] : parents;
      if (typeof node.uri === 'string' && node.uri.trim()) entries.push({
        id: node.id || '', versionId: node.versionId || '', title: node.title || node.uri,
        type: node.type || 'resource', sectionType: node.sectionType || '', uri: node.uri.trim(),
        playOrder: Number.parseInt(node.playOrder, 10), audio: Array.isArray(node.audio) ? node.audio.slice() : [],
        parents
      });
      if (Array.isArray(node.children)) for (let i = node.children.length - 1; i >= 0; i--) stack.push({ node: node.children[i], parents: nextParents });
    }
    entries.sort((a, b) => {
      const ap = Number.isFinite(a.playOrder) ? a.playOrder : 1e9;
      const bp = Number.isFinite(b.playOrder) ? b.playOrder : 1e9;
      return ap - bp || a.title.localeCompare(b.title);
    });
    return entries;
  }

  async function loadJSZip() {
    if (window.JSZip) return window.JSZip;
    let last;
    for (const src of JSZIP_URLS) {
      try {
        await new Promise((resolve, reject) => {
          const s = el('script'); s.src = src; s.onload = resolve; s.onerror = () => reject(new Error(`Could not load ${src}`));
          (document.head || document.documentElement).append(s);
        });
        if (window.JSZip) return window.JSZip;
      } catch (e) { last = e; }
    }
    throw last || new Error('JSZip could not be loaded.');
  }

  function retryAfterMs(response) {
    const value = response?.headers?.get?.('retry-after');
    if (!value) return 0;
    const seconds = Number(value);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const when = Date.parse(value);
    return Number.isFinite(when) ? Math.max(0, when - Date.now()) : 0;
  }

  async function fetchRetry(url, retries = 3) {
    let last;
    for (let i = 1; i <= retries; i++) {
      try {
        const r = await app.originalFetch.call(window, url, { credentials: 'include', cache: 'no-store', signal: controller.signal });
        if (r.ok) return r;
        const error = Object.assign(new Error(`HTTP ${r.status} for ${url}`), { status: r.status, retryAfter: retryAfterMs(r) });
        if (![408, 425, 429, 500, 502, 503, 504].includes(r.status)) return r;
        last = error;
        if (i < retries) await sleep(error.retryAfter || Math.min(6000, 500 * (2 ** (i - 1))));
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        last = e;
        if (i < retries) await sleep(Math.min(6000, 500 * (2 ** (i - 1))));
      }
    }
    throw last || new Error(`Failed to fetch ${url}`);
  }

  function parseHeaderBlock(raw = '') {
    const map = new Map();
    String(raw).split(/\r?\n/).forEach((line) => {
      const at = line.indexOf(':');
      if (at > 0) map.set(line.slice(0, at).trim().toLowerCase(), line.slice(at + 1).trim());
    });
    return map;
  }

  function canUseMediaBridge(url) {
    try { return MEDIA_BRIDGE_HOSTS.has(new URL(url).hostname.toLowerCase()) && typeof window.__PEARSON_MEDIA_FETCH__ === 'function'; }
    catch (_) { return false; }
  }

  async function fetchResource(url, retries = 3) {
    if (canUseMediaBridge(url)) {
      let last;
      for (let i = 1; i <= retries; i++) {
        try {
          const result = await window.__PEARSON_MEDIA_FETCH__(url);
          const headers = parseHeaderBlock(result?.responseHeaders || '');
          const status = Number(result?.status || 0);
          if (status >= 200 && status < 300 && result?.bytes) {
            return {
              ok: true, status, via: 'userscript-media-bridge',
              contentType: headers.get('content-type') || '', bytes: new Uint8Array(result.bytes)
            };
          }
          const error = Object.assign(new Error(`HTTP ${status || 'error'} for ${url}`), { status });
          if (![408, 425, 429, 500, 502, 503, 504].includes(status)) throw error;
          last = error;
        } catch (e) { last = e; }
        if (i < retries) await sleep(Math.min(6000, 500 * (2 ** (i - 1))));
      }
      throw last || new Error(`Media bridge failed for ${url}`);
    }

    const r = await fetchRetry(url, retries);
    if (!r.ok) return { ok: false, status: r.status, via: 'page-fetch', contentType: r.headers.get('content-type') || '', response: r };
    return {
      ok: true, status: r.status, via: 'page-fetch', contentType: r.headers.get('content-type') || '',
      bytes: new Uint8Array(await r.arrayBuffer())
    };
  }

  function isLikelyErrorBody(bytes, contentType = '') {
    const type = String(contentType).toLowerCase();
    if (!/(?:html|xml|json|text)/.test(type) && bytes.byteLength > 512) return false;
    const sample = new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(0, Math.min(bytes.byteLength, 4096))).toLowerCase();
    return /<code>accessdenied<\/code>|<message>access denied<\/message>|\baccess denied\b|<title>\s*(?:error|access denied)|"(?:error|message)"\s*:\s*"(?:unauthorized|forbidden|access denied)/i.test(sample);
  }

  function mediaTypeFrom(url, responseType = '') {
    const cleanType = String(responseType).split(';')[0].trim().toLowerCase();
    if (cleanType && cleanType !== 'application/octet-stream') return cleanType;
    let ext = '';
    try {
      const name = new URL(url).pathname.split('/').pop() || '';
      ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
    } catch (_) {}
    return ({
      html: 'application/xhtml+xml', htm: 'application/xhtml+xml', xhtml: 'application/xhtml+xml', css: 'text/css',
      js: 'text/javascript', mjs: 'text/javascript', json: 'application/json', xml: 'application/xml',
      jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
      woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
      mp3: 'audio/mpeg', m4a: 'audio/mp4', mp4: 'video/mp4', webm: 'video/webm', pdf: 'application/pdf'
    })[ext] || 'application/octet-stream';
  }

  function safeSegment(segment) {
    let decoded = String(segment);
    try { decoded = decodeURIComponent(decoded); } catch (_) {}
    decoded = decoded.replace(/[\u0000-\u001f<>:"|?*\\]/g, '_');
    if (!decoded || decoded === '.' || decoded === '..') return '_';
    return decoded.slice(0, 180);
  }

  function safeArchivePathFromUrl(url, sanvanBase) {
    const u = new URL(url), base = new URL(sanvanBase);
    let prefix, path;
    if (u.origin === base.origin && u.pathname.startsWith(base.pathname)) {
      prefix = 'OEBPS/source'; path = u.pathname.slice(base.pathname.length);
    } else {
      prefix = `OEBPS/external/${safeSegment(u.hostname)}`; path = u.pathname.replace(/^\/+/, '');
    }
    const segments = path.split('/').filter(Boolean).map(safeSegment);
    if (!segments.length) segments.push('resource');
    return `${prefix}/${segments.join('/')}`;
  }

  const dirname = (path) => path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
  function relativePath(fromFile, toFile) {
    const from = dirname(fromFile).split('/').filter(Boolean), to = toFile.split('/').filter(Boolean);
    let i = 0; while (i < from.length && i < to.length && from[i] === to[i]) i++;
    return `${'../'.repeat(from.length - i)}${to.slice(i).join('/')}` || './';
  }

  function isDownloadableProtocol(url) {
    try { return ['http:', 'https:'].includes(new URL(url).protocol); } catch (_) { return false; }
  }

  function shouldCrawl(url, sanvanBase) {
    try {
      const u = new URL(url), base = new URL(sanvanBase);
      if (u.origin === base.origin) return true;
      const h = u.hostname.toLowerCase();
      return h === 'cite-media.pearson.com' || h === 'media.pearsoncmg.com' || h.endsWith('.pearsoncmg.com') ||
        h.endsWith('.pearson.com') || h.endsWith('.pearsoned.com') || h.endsWith('.pearsonprd.tech');
    } catch (_) { return false; }
  }

  function splitUrlRef(raw) {
    const match = String(raw).match(/^([^#]*)(#.*)?$/);
    return { base: match?.[1] || '', hash: match?.[2] || '' };
  }

  function stripInvalidXmlChars(text) {
    let removed = 0;
    const clean = String(text).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, () => { removed++; return ''; });
    return { text: clean, removed };
  }

  function cssRefs(text, baseUrl) {
    const refs = [], re = /url\(\s*(["']?)(.*?)\1\s*\)|@import\s+(?:url\()?\s*(["'])(.*?)\3/gi;
    let m;
    while ((m = re.exec(text))) {
      const raw = (m[2] || m[4] || '').trim();
      if (!raw || /^(?:data:|blob:|#|javascript:)/i.test(raw)) continue;
      try { refs.push(new URL(raw, baseUrl).href); } catch (_) {}
    }
    return refs;
  }

  function rewriteCss(text, baseUrl, currentPath, successfulPaths) {
    return text.replace(/url\(\s*(["']?)(.*?)\1\s*\)/gi, (whole, quote, raw) => {
      if (!raw || /^(?:data:|blob:|#|javascript:)/i.test(raw)) return whole;
      try {
        const parts = splitUrlRef(raw), abs = new URL(parts.base, baseUrl).href, target = successfulPaths.get(abs);
        return target ? `url(${quote || ''}${relativePath(currentPath, target)}${parts.hash}${quote || ''})` : whole;
      } catch (_) { return whole; }
    }).replace(/@import\s+(["'])(.*?)\1/gi, (whole, quote, raw) => {
      try {
        const abs = new URL(raw, baseUrl).href, target = successfulPaths.get(abs);
        return target ? `@import ${quote}${relativePath(currentPath, target)}${quote}` : whole;
      } catch (_) { return whole; }
    });
  }

  const CORE_ATTRS = [
    ['img', 'src'], ['source', 'src'], ['video', 'src'], ['video', 'poster'], ['audio', 'src'],
    ['link', 'href'], ['input', 'src'], ['image', 'href'], ['image', 'xlink:href'], ['use', 'href'], ['use', 'xlink:href']
  ];
  const INTERACTIVE_ATTRS = [['script', 'src'], ['object', 'data'], ['iframe', 'src'], ['embed', 'src']];

  function htmlRefs(text, baseUrl, includeScripts) {
    const clean = stripInvalidXmlChars(text).text;
    const doc = new DOMParser().parseFromString(clean, 'text/html'), refs = [];
    const attrs = includeScripts ? [...CORE_ATTRS, ...INTERACTIVE_ATTRS] : CORE_ATTRS;
    for (const [selector, attr] of attrs) for (const node of doc.querySelectorAll(`${selector}[${CSS.escape(attr)}]`)) {
      const raw = node.getAttribute(attr);
      if (!raw || /^(?:data:|blob:|#|javascript:|mailto:|tel:)/i.test(raw)) continue;
      try { refs.push(new URL(splitUrlRef(raw).base, baseUrl).href); } catch (_) {}
    }
    for (const node of doc.querySelectorAll('[srcset]')) for (const part of (node.getAttribute('srcset') || '').split(',')) {
      const raw = part.trim().split(/\s+/)[0];
      if (!raw || /^data:/i.test(raw)) continue;
      try { refs.push(new URL(raw, baseUrl).href); } catch (_) {}
    }
    for (const node of doc.querySelectorAll('[style]')) refs.push(...cssRefs(node.getAttribute('style') || '', baseUrl));
    for (const node of doc.querySelectorAll('style')) refs.push(...cssRefs(node.textContent || '', baseUrl));
    return [...new Set(refs)];
  }

  function countRemoteRefs(doc) {
    const urls = new Set();
    const attrs = [...CORE_ATTRS, ...INTERACTIVE_ATTRS, ['a', 'href']];
    for (const [selector, attr] of attrs) for (const node of doc.querySelectorAll(`${selector}[${CSS.escape(attr)}]`)) {
      const raw = node.getAttribute(attr);
      if (/^https?:\/\//i.test(raw || '')) urls.add(raw);
    }
    for (const node of doc.querySelectorAll('[srcset]')) for (const part of (node.getAttribute('srcset') || '').split(',')) {
      const raw = part.trim().split(/\s+/)[0]; if (/^https?:\/\//i.test(raw || '')) urls.add(raw);
    }
    return [...urls];
  }

  function rewriteHtml(text, baseUrl, currentPath, successfulPaths, cleanEpub) {
    const stripped = stripInvalidXmlChars(text);
    const doc = new DOMParser().parseFromString(stripped.text, 'text/html');
    let scriptsRemoved = 0, embedsRemoved = 0;

    if (cleanEpub) {
      for (const node of doc.querySelectorAll('script')) { node.remove(); scriptsRemoved++; }
      for (const node of doc.querySelectorAll('iframe,object,embed')) { node.remove(); embedsRemoved++; }
      for (const node of doc.querySelectorAll('meta[http-equiv="refresh" i],link[rel="preconnect" i],link[rel="dns-prefetch" i],link[rel="prefetch" i]')) node.remove();
      for (const node of doc.querySelectorAll('[onclick],[onload],[onerror],[onmouseover],[onfocus],[onblur]')) {
        for (const attr of [...node.attributes]) if (/^on/i.test(attr.name)) node.removeAttribute(attr.name);
      }
    }

    const rewriteAttr = (node, attr) => {
      const raw = node.getAttribute(attr);
      if (!raw || /^(?:data:|blob:|#|javascript:|mailto:|tel:)/i.test(raw)) return;
      try {
        const parts = splitUrlRef(raw);
        if (!parts.base) return;
        const abs = new URL(parts.base, baseUrl).href, target = successfulPaths.get(abs);
        if (target) node.setAttribute(attr, `${relativePath(currentPath, target)}${parts.hash}`);
      } catch (_) {}
    };

    for (const [selector, attr] of [...CORE_ATTRS, ...INTERACTIVE_ATTRS]) {
      for (const node of doc.querySelectorAll(`${selector}[${CSS.escape(attr)}]`)) rewriteAttr(node, attr);
    }
    for (const node of doc.querySelectorAll('a[href]')) rewriteAttr(node, 'href');
    for (const node of doc.querySelectorAll('[srcset]')) {
      const rewritten = (node.getAttribute('srcset') || '').split(',').map((part) => {
        const bits = part.trim().split(/\s+/), raw = bits.shift();
        try {
          const abs = new URL(raw, baseUrl).href, target = successfulPaths.get(abs);
          bits.unshift(target ? relativePath(currentPath, target) : raw);
        } catch (_) { bits.unshift(raw); }
        return bits.join(' ');
      }).join(', ');
      node.setAttribute('srcset', rewritten);
    }
    for (const node of doc.querySelectorAll('[style]')) node.setAttribute('style', rewriteCss(node.getAttribute('style') || '', baseUrl, currentPath, successfulPaths));
    for (const node of doc.querySelectorAll('style')) node.textContent = rewriteCss(node.textContent || '', baseUrl, currentPath, successfulPaths);

    const remoteUrls = countRemoteRefs(doc);
    let html = new XMLSerializer().serializeToString(doc.documentElement);
    if (!/xmlns=/.test(html.slice(0, 300))) html = html.replace(/^<html\b/i, '<html xmlns="http://www.w3.org/1999/xhtml"');
    html = stripInvalidXmlChars(html).text;
    return {
      text: `<?xml version="1.0" encoding="UTF-8"?>\n${html}`,
      invalidXmlCharsRemoved: stripped.removed,
      scriptsRemoved, embedsRemoved, remoteUrls
    };
  }

  function xmlEscape(value) {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }
  function safeName(name) {
    return (name || 'Pearson eText').replace(/[\u0000-\u001f\\/:*?"<>|]+/g, '_').replace(/[. ]+$/g, '').trim().slice(0, 180) || 'Pearson eText';
  }
  function buildContainer() {
    return '<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>';
  }

  function normalizeResourceKey(url) {
    const u = new URL(url); u.hash = ''; return u.href;
  }

  function buildHierarchicalNav(title, toc, sanvanBase, successfulPaths) {
    const renderNode = (node) => {
      if (!node || typeof node !== 'object') return '';
      const children = Array.isArray(node.children) ? node.children.map(renderNode).filter(Boolean) : [];
      let path = null;
      if (typeof node.uri === 'string' && node.uri.trim()) {
        try { path = successfulPaths.get(normalizeResourceKey(new URL(node.uri, sanvanBase).href)) || null; } catch (_) {}
      }
      if (!path && !children.length) return '';
      const label = xmlEscape(node.title || 'Untitled');
      const head = path ? `<a href="${xmlEscape(relativePath('OEBPS/nav.xhtml', path))}">${label}</a>` : `<span>${label}</span>`;
      return `<li>${head}${children.length ? `<ol>${children.join('')}</ol>` : ''}</li>`;
    };
    const items = (toc.children || []).map(renderNode).filter(Boolean).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><meta charset="utf-8"/><title>${xmlEscape(title)}</title></head><body><nav epub:type="toc" id="toc"><h1>${xmlEscape(title)}</h1><ol>${items}</ol></nav></body></html>`;
  }

  function findCoverImagePath(meta, resources, successfulPaths) {
    const coverEntry = meta.narratives.find((e) => /^cover$/i.test(e.title || '')) || meta.narratives[0];
    if (coverEntry) {
      try {
        const pageUrl = normalizeResourceKey(new URL(coverEntry.uri, meta.sanvan.base).href);
        const page = resources.get(pageUrl);
        if (page?.ok && page.originalText) {
          const doc = new DOMParser().parseFromString(stripInvalidXmlChars(page.originalText).text, 'text/html');
          const img = doc.querySelector('img[src],image[href],image[xlink\\:href]');
          const raw = img?.getAttribute('src') || img?.getAttribute('href') || img?.getAttribute('xlink:href');
          if (raw) {
            const abs = normalizeResourceKey(new URL(raw, pageUrl).href);
            const path = successfulPaths.get(abs);
            const res = resources.get(abs);
            if (path && res?.ok && /^image\//i.test(res.mediaType || '')) return path;
          }
        }
      } catch (_) {}
    }
    for (const r of resources.values()) if (r.ok && /^image\//i.test(r.mediaType || '') && /cover/i.test(r.url)) return r.path;
    return null;
  }

  function buildOpf(title, productId, resources, spine, coverImagePath) {
    const manifest = ['<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>'];
    const idByPath = new Map();
    let n = 0;
    for (const r of resources) {
      if (!r.ok || !r.path.startsWith('OEBPS/')) continue;
      const href = r.path.slice(6);
      if (href === 'content.opf' || href === 'nav.xhtml') continue;
      const id = `res${++n}`; idByPath.set(r.path, id);
      const props = [];
      if (r.path === coverImagePath) props.push('cover-image');
      if ((r.remoteUrls?.length || 0) > 0 && /xhtml\+xml/i.test(r.mediaType || '')) props.push('remote-resources');
      manifest.push(`<item id="${id}" href="${xmlEscape(href)}" media-type="${xmlEscape(r.mediaType === 'text/html' ? 'application/xhtml+xml' : r.mediaType)}"${props.length ? ` properties="${props.join(' ')}"` : ''}/>`);
    }
    const spineXml = spine.filter((x) => idByPath.has(x.path)).map((x) => `<itemref idref="${idByPath.get(x.path)}"/>`).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="bookid">urn:pearson:${xmlEscape(productId || 'unknown')}</dc:identifier><dc:title>${xmlEscape(title)}</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')}</meta></metadata><manifest>${manifest.join('\n')}</manifest><spine>${spineXml}</spine></package>`;
  }

  async function useClipboardToc(productId, retry) {
    try {
      if (!navigator.clipboard?.readText) throw new Error('Clipboard API is unavailable in this browser/page.');
      const text = await navigator.clipboard.readText();
      const data = safeJsonParse(text);
      if (!data || !looksLikeToc(data, productId)) throw new Error('Clipboard text is not the full Pearson contenttoc JSON for this book.');
      app.capturedToc = data; app.capturedTocSource = 'clipboard TOC JSON';
      alert(`Pearson TOC imported: ${collectEntries(data).filter((e) => /(?:^|\/)narrative\/.+\.html/i.test(e.uri)).length} narrative pages.`);
      retry();
    } catch (e) { alert(`Could not import copied TOC JSON: ${e.message}`); }
  }

  function showNeedToc(productId, sanvan, retry) {
    clear(`Pearson Downloader ${VERSION}`, productId ? `Book ${productId}` : 'Pearson+ Reader');
    const c = card();
    const h = el('h2', 'Waiting for Pearson table of contents'); h.style.marginTop = '0'; c.append(h);
    c.append(el('p', 'The Reader session was found, but Pearson loaded the full TOC before this script could capture its response body.'));
    const steps = el('ol');
    for (const text of [
      'In DevTools → Network, filter for contenttoc and select /api/contenttoc/v1/assets (not page-mapping).',
      'Open the Response tab and copy the entire JSON response.',
      'Click “Use copied TOC JSON” below.'
    ]) steps.append(el('li', text));
    c.append(steps);
    const info = el('p', sanvan ? `Sanvan source detected: item ${sanvan.itemId}, version ${sanvan.itemVersion}.` : 'Turn one page first so a Sanvan narrative request appears.');
    info.style.color = '#667085'; c.append(info);
    const row = el('div'); Object.assign(row.style, { display: 'flex', gap: '10px', flexWrap: 'wrap' });
    const clip = button('Use copied TOC JSON', true); clip.onclick = () => useClipboardToc(productId, retry);
    const again = button('Try again'); again.onclick = retry;
    const paste = button('Paste TOC JSON'); paste.onclick = () => showPasteToc(productId, retry);
    row.append(clip, again, paste); c.append(row); box.append(c);
  }

  function showPasteToc(productId, retry) {
    clear(`Pearson Downloader ${VERSION}`, 'Manual TOC fallback');
    const c = card();
    c.append(el('p', 'Paste only the JSON response body from Pearson’s contenttoc request. Do not paste request headers, cookies, or tokens.'));
    const ta = el('textarea');
    Object.assign(ta.style, { width: '100%', height: '45vh', font: '12px ui-monospace,monospace', boxSizing: 'border-box' });
    c.append(ta);
    const row = el('div'); Object.assign(row.style, { marginTop: '10px', display: 'flex', gap: '10px' });
    const use = button('Use this TOC', true);
    use.onclick = () => {
      const data = safeJsonParse(ta.value);
      if (!data || !looksLikeToc(data, productId)) return alert('That JSON does not look like the Pearson contenttoc response for this book.');
      app.capturedToc = data; app.capturedTocSource = 'manual TOC JSON'; retry();
    };
    const back = button('Back'); back.onclick = retry;
    row.append(use, back); c.append(row); box.append(c);
  }

  function showOptions(meta, onStart) {
    clear(`Pearson Downloader ${VERSION}`, meta.title);
    const c = card();
    const summary = el('p', `Detected ${meta.entries.length} TOC resources (${meta.narratives.length} narrative pages) via ${meta.tocSource}.`);
    summary.style.marginTop = '0'; c.append(summary);

    const formatRow = el('div'); formatRow.innerHTML = '<strong>Output:</strong> ';
    const select = el('select'); select.innerHTML = '<option value="epub">EPUB (.epub)</option><option value="zip">Raw ZIP (.zip)</option>';
    select.style.marginLeft = '8px'; select.style.padding = '7px'; formatRow.append(select); c.append(formatRow);

    const opts = el('div'); opts.style.marginTop = '14px';
    const media = el('label'), mediaCb = el('input'); mediaCb.type = 'checkbox'; mediaCb.checked = true;
    media.append(mediaCb, document.createTextNode(' Download images, CSS, fonts, and referenced assets'));
    const scripts = el('label'), scriptsCb = el('input'); scripts.style.display = 'block'; scripts.style.marginTop = '8px'; scriptsCb.type = 'checkbox'; scriptsCb.checked = false;
    scripts.append(scriptsCb, document.createTextNode(' Include JavaScript/interactive assets in Raw ZIP mode (EPUB mode always strips web scripts)'));
    opts.append(media, scripts); c.append(opts);

    const bridge = el('p', typeof window.__PEARSON_MEDIA_FETCH__ === 'function'
      ? 'Media bridge: detected — CORS-blocked public Pearson images can be recovered.'
      : 'Media bridge: not detected — CORS-blocked images will remain as remote HTTPS references instead of broken local links.');
    bridge.style.color = typeof window.__PEARSON_MEDIA_FETCH__ === 'function' ? '#067647' : '#8a6116'; c.append(bridge);

    const start = button('Start download', true); start.style.marginTop = '18px';
    start.onclick = () => onStart({ format: select.value, crawlAssets: mediaCb.checked, includeScripts: scriptsCb.checked });
    c.append(start); box.append(c);
  }

  async function validateEpubBlob(blob) {
    const bytes = new Uint8Array(await blob.slice(0, 128).arrayBuffer());
    if (bytes.length < 40) return { pass: false, reason: 'archive header too short' };
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(0, true) !== 0x04034b50) return { pass: false, reason: 'first ZIP entry missing' };
    const method = view.getUint16(8, true), nameLen = view.getUint16(26, true), extraLen = view.getUint16(28, true);
    const name = new TextDecoder().decode(bytes.slice(30, 30 + nameLen));
    const dataStart = 30 + nameLen + extraLen;
    const content = new TextDecoder().decode(bytes.slice(dataStart, dataStart + 'application/epub+zip'.length));
    return { pass: name === 'mimetype' && method === 0 && content === 'application/epub+zip', firstEntry: name, method, content };
  }

  async function crawlAndBuild(JSZip, meta, options) {
    controller = new AbortController();
    clear(`Pearson Downloader ${VERSION}`, meta.title);

    const stat = card(), statusLine = el('strong', 'Preparing resources…'), counts = el('div', 'Downloaded 0 • Failed 0 • Queued 0');
    counts.style.marginTop = '6px'; stat.append(statusLine, counts); box.append(stat);
    const log = el('div');
    Object.assign(log.style, { marginTop: '12px', height: '55vh', overflow: 'auto', background: '#101217', color: '#e8eaed', borderRadius: '10px', padding: '12px', font: '12px/1.5 ui-monospace,monospace' });
    box.append(log);
    const cancel = button('Cancel'); cancel.style.marginTop = '12px'; cancel.onclick = () => controller.abort(); box.append(cancel);
    const line = (text, color) => { const d = el('div', text); if (color) d.style.color = color; log.append(d); log.scrollTop = log.scrollHeight; };

    const resources = new Map(), successfulPaths = new Map(), queue = [], queued = new Set();
    let ok = 0, failed = 0, concurrency = START_CONCURRENCY, cleanBatches = 0, bridged = 0;
    const enqueue = (url, kind = 'asset', title = '') => {
      if (!isDownloadableProtocol(url)) return;
      const key = normalizeResourceKey(url);
      if (queued.has(key) || queued.size >= MAX_CRAWL || !shouldCrawl(key, meta.sanvan.base)) return;
      if (!options.includeScripts && /\.(?:js|mjs)(?:$|[?#])/i.test(key)) return;
      queued.add(key);
      queue.push({ url: key, path: safeArchivePathFromUrl(key, meta.sanvan.base), kind, title });
    };

    for (const entry of meta.entries) {
      const url = new URL(entry.uri, meta.sanvan.base).href;
      enqueue(url, /narrative\/.+\.html(?:$|[?#])/i.test(entry.uri) ? 'page' : 'toc-resource', entry.title);
    }

    const update = () => { counts.textContent = `Downloaded ${ok} • Failed ${failed} • Queued ${queue.length}`; };
    update();

    async function processResource(task) {
      try {
        const r = await fetchResource(task.url, 3);
        if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status });
        const bytes = r.bytes, contentType = r.contentType || mediaTypeFrom(task.url);
        if (isLikelyErrorBody(bytes, contentType)) throw new Error('Server returned an error document instead of the requested resource');
        const mediaType = mediaTypeFrom(task.url, contentType);
        const item = { ...task, ok: true, bytes, mediaType, contentType, via: r.via };
        if (r.via === 'userscript-media-bridge') bridged++;
        if (/(?:text\/html|application\/xhtml\+xml)/i.test(mediaType)) item.originalText = new TextDecoder().decode(bytes);
        resources.set(task.url, item); successfulPaths.set(task.url, task.path); ok++;

        if (options.crawlAssets && item.originalText != null) {
          for (const ref of htmlRefs(item.originalText, task.url, options.format === 'zip' && options.includeScripts)) enqueue(ref, 'asset');
        } else if (options.crawlAssets && /text\/css/i.test(mediaType)) {
          for (const ref of cssRefs(new TextDecoder().decode(bytes), task.url)) enqueue(ref, 'asset');
        }
        line(`${r.via === 'userscript-media-bridge' ? 'bridge ' : ''}ok ${task.url}`, '#8de1a6');
        return { throttled: false };
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        resources.set(task.url, { ...task, ok: false, error: e.message, mediaType: mediaTypeFrom(task.url) });
        failed++; line(`fail ${task.url}: ${e.message}`, '#ff9b95');
        return { throttled: [429, 503].includes(e.status) };
      } finally { update(); }
    }

    while (queue.length) {
      const batch = queue.splice(0, Math.min(concurrency, queue.length));
      statusLine.textContent = `Downloading resources… concurrency ${concurrency}`;
      const results = await Promise.all(batch.map(processResource));
      if (results.some((x) => x.throttled)) {
        concurrency = Math.max(1, Math.floor(concurrency / 2)); cleanBatches = 0;
        line(`Rate limiting detected; reducing concurrency to ${concurrency}.`, '#ffd37a');
      } else if (++cleanBatches >= 4 && concurrency < START_CONCURRENCY) {
        concurrency++; cleanBatches = 0; line(`Connection stable; increasing concurrency to ${concurrency}.`, '#a8c7fa');
      }
      if (resources.size >= MAX_CRAWL) { line(`Crawl safety limit (${MAX_CRAWL}) reached.`, '#ffd37a'); break; }
    }

    statusLine.textContent = 'Cleaning pages and rewriting successful local references…';
    let invalidXmlCharsRemoved = 0, scriptsRemoved = 0, embedsRemoved = 0;
    const remoteUrls = new Set();
    for (const item of resources.values()) {
      if (!item.ok) continue;
      if (item.originalText != null) {
        const rewritten = rewriteHtml(item.originalText, item.url, item.path, successfulPaths, options.format === 'epub');
        item.outputText = rewritten.text; item.mediaType = 'application/xhtml+xml'; item.remoteUrls = rewritten.remoteUrls;
        invalidXmlCharsRemoved += rewritten.invalidXmlCharsRemoved; scriptsRemoved += rewritten.scriptsRemoved; embedsRemoved += rewritten.embedsRemoved;
        rewritten.remoteUrls.forEach((u) => remoteUrls.add(u));
      } else if (/text\/css/i.test(item.mediaType)) {
        item.outputText = rewriteCss(new TextDecoder().decode(item.bytes), item.url, item.path, successfulPaths);
        for (const match of item.outputText.match(/https?:\/\/[^\s)'"<>]+/g) || []) remoteUrls.add(match);
      }
    }

    const spine = [];
    for (const entry of meta.narratives) {
      const url = normalizeResourceKey(new URL(entry.uri, meta.sanvan.base).href), item = resources.get(url);
      if (item?.ok) spine.push({ title: entry.title, path: item.path, url });
    }

    const coverImagePath = findCoverImagePath(meta, resources, successfulPaths);
    const report = {
      version: VERSION, productId: meta.productId, title: meta.title, tocSource: meta.tocSource,
      sanvanItemId: meta.sanvan.itemId, sanvanVersion: meta.sanvan.itemVersion,
      tocResources: meta.entries.length, narrativePages: meta.narratives.length,
      downloaded: [...resources.values()].filter((r) => r.ok).length,
      failed: [...resources.values()].filter((r) => !r.ok).length,
      spinePages: spine.length, missingNarrativePages: meta.narratives.length - spine.length,
      mediaBridgeDetected: typeof window.__PEARSON_MEDIA_FETCH__ === 'function', mediaBridgeDownloads: bridged,
      remoteResourceCount: remoteUrls.size, remoteResourceUrls: [...remoteUrls],
      invalidXmlCharsRemoved, scriptsRemoved, embedsRemoved, coverImagePath,
      failedResources: [...resources.values()].filter((r) => !r.ok).map((r) => ({ url: r.url, error: r.error }))
    };
    app.lastReport = report;

    const zip = new JSZip();
    if (options.format === 'epub') {
      zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
      zip.file('META-INF/container.xml', buildContainer());
      zip.file('OEBPS/nav.xhtml', buildHierarchicalNav(meta.title, meta.toc, meta.sanvan.base, successfulPaths));
    }
    for (const item of resources.values()) if (item.ok) {
      const path = options.format === 'epub' ? item.path : item.path.replace(/^OEBPS\//, '');
      zip.file(path, item.outputText != null ? item.outputText : item.bytes);
    }
    if (options.format === 'epub') {
      zip.file('OEBPS/content.opf', buildOpf(meta.title, meta.productId, [...resources.values()].filter((r) => r.ok), spine, coverImagePath));
    }
    zip.file(options.format === 'epub' ? 'OEBPS/pearson-download-report.json' : 'pearson-download-report.json', JSON.stringify(report, null, 2));

    statusLine.textContent = 'Building archive…';
    const blob = await zip.generateAsync({
      type: 'blob', mimeType: options.format === 'epub' ? 'application/epub+zip' : 'application/zip',
      compression: 'DEFLATE', compressionOptions: { level: 6 }
    }, (m) => { statusLine.textContent = `Building archive… ${Math.floor(m.percent)}%`; });

    if (options.format === 'epub') report.epubContainerCheck = await validateEpubBlob(blob);
    const fileName = `${safeName(meta.title)}.${options.format}`;
    const objectUrl = URL.createObjectURL(blob), a = el('a'); a.href = objectUrl; a.download = fileName; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);

    statusLine.textContent = `Finished: ${fileName}`;
    const validation = card(), h = el('h2', 'Download report'); h.style.marginTop = '0'; validation.append(h);
    const pre = el('pre', [
      `Narrative pages: ${report.spinePages}/${report.narrativePages}`,
      `Resources downloaded: ${report.downloaded}`,
      `Resources failed: ${report.failed}`,
      `Media-bridge downloads: ${report.mediaBridgeDownloads}`,
      `Remote HTTPS resources left in pages: ${report.remoteResourceCount}`,
      `Invalid XML control characters removed: ${report.invalidXmlCharsRemoved}`,
      `Web scripts removed from EPUB pages: ${report.scriptsRemoved}`,
      `Interactive embeds removed from EPUB pages: ${report.embedsRemoved}`,
      `Cover image: ${report.coverImagePath || 'not recovered'}`,
      options.format === 'epub' ? `EPUB mimetype check: ${report.epubContainerCheck?.pass ? 'PASS' : 'FAIL'}` : '',
      report.missingNarrativePages === 0 ? 'Core book-page check: PASS' : 'Core book-page check: INCOMPLETE'
    ].filter(Boolean).join('\n'));
    pre.style.whiteSpace = 'pre-wrap'; validation.append(pre); box.append(validation);
    cancel.textContent = 'Close'; cancel.onclick = () => app.close();
  }

  async function initialize() {
    const productId = discoverProductId(), sanvan = discoverSanvan(), tocHit = discoverToc(productId);
    if (!productId || !sanvan || !tocHit) { showNeedToc(productId, sanvan, initialize); return; }
    const entries = collectEntries(tocHit.toc);
    const narratives = entries.filter((e) => /(?:^|\/)narrative\/.+\.html(?:$|[?#])/i.test(e.uri));
    if (!narratives.length) throw new Error('Pearson TOC was found, but it contains no narrative HTML pages.');
    const title = tocHit.toc.title || `Pearson eText ${productId}`;
    const meta = { productId, sanvan, toc: tocHit.toc, tocSource: tocHit.source, title, entries, narratives };
    status('Loading JSZip…');
    const JSZip = await loadJSZip();
    showOptions(meta, (options) => crawlAndBuild(JSZip, meta, options).catch((e) => {
      if (e.name === 'AbortError') fail('Download cancelled', new Error('The download was cancelled.'));
      else fail('Download failed', e);
    }));
  }

  try {
    status('Inspecting the open Pearson+ Reader…', 'The downloader does not read or export authentication tokens.');
    await initialize();
  } catch (e) {
    if (e.name === 'AbortError') app.close();
    else fail('Initialization failed', e);
  }
})();
