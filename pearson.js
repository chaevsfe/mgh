/**
 * Pearson+ eText Downloader v2026.08.31.1
 * https://github.com/chaevsfe/mgh
 *
 * Packages resources already available to your authenticated Pearson+ Reader
 * session into an EPUB or ZIP. It does not read, print, or persist auth tokens.
 * Use only with content you are authorized to access.
 */
(async () => {
  'use strict';

  const VERSION = '2026.08.31.1';
  const KEY = '__PEARSON_DOWNLOADER__';
  const JSZIP_URLS = [
    'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
    'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js'
  ];
  const MAX_CRAWL = 6000;
  const START_CONCURRENCY = 6;

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
      try { XMLHttpRequest.prototype.open = app.originalXHROpen; XMLHttpRequest.prototype.send = app.originalXHRSend; } catch (_) {}
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
  }

  function status(message, detail = '') {
    clear();
    const c = card();
    c.append(el('strong', message));
    if (detail) {
      const p = el('div', detail);
      p.style.marginTop = '6px';
      p.style.color = '#667085';
      c.append(p);
    }
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
    if (!Array.isArray(value.children) || value.children.length === 0) return false;
    let uriHits = 0;
    const stack = value.children.slice(0, 100);
    let checked = 0;
    while (stack.length && checked < 1000) {
      const n = stack.pop(); checked++;
      if (!n || typeof n !== 'object') continue;
      if (typeof n.uri === 'string' && /(?:^|\/)narrative\/.+\.html(?:$|[?#])/i.test(n.uri)) {
        if (++uriHits >= 2) return true;
      }
      if (Array.isArray(n.children)) stack.push(...n.children.slice(0, 100));
    }
    return false;
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
                if (!response.ok) return;
                const data = await response.clone().json();
                maybeCaptureToc(data, 'Pearson contenttoc fetch');
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
    const out = [];
    const seen = new Set();
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
      /\/products\/([0-9a-f-]{30,})(?:\/|$)/i,
      /page-mapping\/([0-9a-f-]{30,})(?:[/?#]|$)/i,
      /\/marin\/api\/1\.0\/products\/([0-9a-f-]{30,})(?:[/?#]|$)/i
    ];
    for (const raw of candidates) {
      for (const re of patterns) {
        const m = String(raw).match(re);
        if (m) return m[1];
      }
    }
    return null;
  }

  function discoverSanvan() {
    for (const raw of allPerformanceUrls().reverse()) {
      const m = String(raw).match(/^(https?:\/\/[^/]+)\/eps\/sanvan\/api\/item\/([^/]+)\/([^/]+)\/file\//i);
      if (m) {
        return {
          origin: m[1], itemId: decodeURIComponent(m[2]), itemVersion: decodeURIComponent(m[3]),
          base: `${m[1]}/eps/sanvan/api/item/${m[2]}/${m[3]}/file/`
        };
      }
    }
    return null;
  }

  function safeJsonParse(text) {
    try { return JSON.parse(text); } catch (_) { return null; }
  }

  function findTocInStorage(productId) {
    for (const w of allSameOriginWindows()) {
      for (const storageName of ['localStorage', 'sessionStorage']) {
        try {
          const storage = w[storageName];
          for (let i = 0; i < storage.length; i++) {
            const key = storage.key(i);
            const raw = storage.getItem(key);
            if (!raw || raw.length < 200 || !/narrative\//i.test(raw)) continue;
            const parsed = safeJsonParse(raw);
            const hit = findTocInObject(parsed, productId, 12000);
            if (hit) return { toc: hit, source: `${storageName}:${key}` };
          }
        } catch (_) {}
      }
    }
    return null;
  }

  function findTocInScripts(productId) {
    for (const w of allSameOriginWindows()) {
      try {
        for (const script of w.document.querySelectorAll('script[type="application/json"],script#__NEXT_DATA__')) {
          const raw = script.textContent || '';
          if (!/narrative\//i.test(raw)) continue;
          const hit = findTocInObject(safeJsonParse(raw), productId, 25000);
          if (hit) return { toc: hit, source: 'embedded JSON' };
        }
      } catch (_) {}
    }
    return null;
  }

  function findReactRoots() {
    const roots = [];
    for (const w of allSameOriginWindows()) {
      let nodes = [];
      try {
        nodes = [w.document.documentElement, w.document.body, ...w.document.querySelectorAll('#root,[id*=root],[data-reactroot],main')];
      } catch (_) {}
      for (const node of nodes) {
        if (!node) continue;
        let keys = [];
        try { keys = Object.keys(node); } catch (_) {}
        for (const k of keys) {
          if (/^__react(?:Fiber|Container|Props)\$/i.test(k) || /^__react(?:Fiber|Container|Props)/i.test(k)) {
            try { if (node[k]) roots.push(node[k]); } catch (_) {}
          }
        }
      }
    }
    return roots;
  }

  function findTocInObject(start, productId, maxObjects = 50000) {
    if (!start || typeof start !== 'object') return null;
    const queue = [start];
    const seen = new WeakSet();
    let inspected = 0;
    while (queue.length && inspected < maxObjects) {
      const value = queue.shift();
      if (!value || typeof value !== 'object') continue;
      if (seen.has(value)) continue;
      seen.add(value); inspected++;
      try {
        if (looksLikeToc(value, productId)) return value;
      } catch (_) {}

      let keys;
      try { keys = Array.isArray(value) ? value.keys() : Object.keys(value); } catch (_) { continue; }
      let pushed = 0;
      for (const key of keys) {
        if (pushed > 120) break;
        const k = String(key);
        if (/^(?:window|document|ownerDocument|parentNode|childNodes|nextSibling|previousSibling|return)$/.test(k)) continue;
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

  function findTocInReact(productId) {
    for (const root of findReactRoots()) {
      const hit = findTocInObject(root, productId, 80000);
      if (hit) return { toc: hit, source: 'React reader state' };
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
    const entries = [];
    const stack = [{ node: toc, parents: [] }];
    while (stack.length) {
      const { node, parents } = stack.pop();
      if (!node || typeof node !== 'object') continue;
      const nextParents = node.title ? [...parents, node.title] : parents;
      if (typeof node.uri === 'string' && node.uri.trim()) {
        entries.push({
          id: node.id || '', versionId: node.versionId || '', title: node.title || node.uri,
          type: node.type || 'resource', sectionType: node.sectionType || '', uri: node.uri.trim(),
          playOrder: Number.parseInt(node.playOrder, 10), audio: Array.isArray(node.audio) ? node.audio.slice() : [],
          parents
        });
      }
      if (Array.isArray(node.children)) {
        for (let i = node.children.length - 1; i >= 0; i--) stack.push({ node: node.children[i], parents: nextParents });
      }
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
        const r = await app.originalFetch.call(window, url, {
          credentials: 'include', cache: 'no-store', signal: controller.signal
        });
        if (r.ok) return r;
        const error = new Error(`HTTP ${r.status} for ${url}`);
        error.status = r.status;
        error.retryAfter = retryAfterMs(r);
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
      html: 'application/xhtml+xml', htm: 'application/xhtml+xml', xhtml: 'application/xhtml+xml',
      css: 'text/css', js: 'text/javascript', json: 'application/json', xml: 'application/xml',
      jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
      woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
      mp3: 'audio/mpeg', m4a: 'audio/mp4', mp4: 'video/mp4', webm: 'video/webm',
      pdf: 'application/pdf'
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
    const u = new URL(url);
    const base = new URL(sanvanBase);
    let prefix;
    let path;
    if (u.origin === base.origin && u.pathname.startsWith(base.pathname)) {
      prefix = 'OEBPS/source';
      path = u.pathname.slice(base.pathname.length);
    } else {
      prefix = `OEBPS/external/${safeSegment(u.hostname)}`;
      path = u.pathname.replace(/^\/+/, '');
    }
    const segments = path.split('/').filter(Boolean).map(safeSegment);
    if (!segments.length) segments.push('resource');
    return `${prefix}/${segments.join('/')}`;
  }

  function dirname(path) { return path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : ''; }
  function relativePath(fromFile, toFile) {
    const from = dirname(fromFile).split('/').filter(Boolean);
    const to = toFile.split('/').filter(Boolean);
    let i = 0;
    while (i < from.length && i < to.length && from[i] === to[i]) i++;
    return `${'../'.repeat(from.length - i)}${to.slice(i).join('/')}` || './';
  }

  function isDownloadableProtocol(url) {
    try { return ['http:', 'https:'].includes(new URL(url).protocol); } catch (_) { return false; }
  }

  function shouldCrawl(url, sanvanBase) {
    try {
      const u = new URL(url);
      const base = new URL(sanvanBase);
      if (u.origin === base.origin) return true;
      const h = u.hostname.toLowerCase();
      return h === 'cite-media.pearson.com' || h.endsWith('.pearson.com') || h.endsWith('.pearsoned.com') || h.endsWith('.pearsonprd.tech');
    } catch (_) { return false; }
  }

  function splitUrlRef(raw) {
    const match = String(raw).match(/^([^#]*)(#.*)?$/);
    return { base: match?.[1] || '', hash: match?.[2] || '' };
  }

  function cssRefs(text, baseUrl) {
    const refs = [];
    const re = /url\(\s*(["']?)(.*?)\1\s*\)|@import\s+(?:url\()?\s*(["'])(.*?)\3/gi;
    let m;
    while ((m = re.exec(text))) {
      const raw = (m[2] || m[4] || '').trim();
      if (!raw || /^(?:data:|blob:|#|javascript:)/i.test(raw)) continue;
      try { refs.push(new URL(raw, baseUrl).href); } catch (_) {}
    }
    return refs;
  }

  function rewriteCss(text, baseUrl, currentPath, urlToPath) {
    return text.replace(/url\(\s*(["']?)(.*?)\1\s*\)/gi, (whole, quote, raw) => {
      if (!raw || /^(?:data:|blob:|#|javascript:)/i.test(raw)) return whole;
      try {
        const parts = splitUrlRef(raw);
        const abs = new URL(parts.base, baseUrl).href;
        const target = urlToPath.get(abs);
        if (!target) return whole;
        return `url(${quote || ''}${relativePath(currentPath, target)}${parts.hash}${quote || ''})`;
      } catch (_) { return whole; }
    }).replace(/@import\s+(["'])(.*?)\1/gi, (whole, quote, raw) => {
      try {
        const abs = new URL(raw, baseUrl).href;
        const target = urlToPath.get(abs);
        return target ? `@import ${quote}${relativePath(currentPath, target)}${quote}` : whole;
      } catch (_) { return whole; }
    });
  }

  const ATTRS = [
    ['img', 'src'], ['source', 'src'], ['video', 'src'], ['video', 'poster'], ['audio', 'src'],
    ['script', 'src'], ['link', 'href'], ['object', 'data'], ['iframe', 'src'], ['embed', 'src'],
    ['input', 'src'], ['image', 'href'], ['image', 'xlink:href'], ['use', 'href'], ['use', 'xlink:href']
  ];

  function htmlRefs(text, baseUrl) {
    const doc = new DOMParser().parseFromString(text, 'text/html');
    const refs = [];
    for (const [selector, attr] of ATTRS) {
      for (const node of doc.querySelectorAll(`${selector}[${CSS.escape(attr)}]`)) {
        const raw = node.getAttribute(attr);
        if (!raw || /^(?:data:|blob:|#|javascript:|mailto:|tel:)/i.test(raw)) continue;
        try { refs.push(new URL(splitUrlRef(raw).base, baseUrl).href); } catch (_) {}
      }
    }
    for (const node of doc.querySelectorAll('[srcset]')) {
      for (const part of (node.getAttribute('srcset') || '').split(',')) {
        const raw = part.trim().split(/\s+/)[0];
        if (!raw || /^data:/i.test(raw)) continue;
        try { refs.push(new URL(raw, baseUrl).href); } catch (_) {}
      }
    }
    for (const node of doc.querySelectorAll('[style]')) refs.push(...cssRefs(node.getAttribute('style') || '', baseUrl));
    for (const node of doc.querySelectorAll('style')) refs.push(...cssRefs(node.textContent || '', baseUrl));
    return [...new Set(refs)];
  }

  function rewriteHtml(text, baseUrl, currentPath, urlToPath) {
    const doc = new DOMParser().parseFromString(text, 'text/html');
    const rewriteAttr = (node, attr) => {
      const raw = node.getAttribute(attr);
      if (!raw || /^(?:data:|blob:|#|javascript:|mailto:|tel:)/i.test(raw)) return;
      try {
        const parts = splitUrlRef(raw);
        if (!parts.base) return;
        const abs = new URL(parts.base, baseUrl).href;
        const target = urlToPath.get(abs);
        if (target) node.setAttribute(attr, `${relativePath(currentPath, target)}${parts.hash}`);
      } catch (_) {}
    };
    for (const [selector, attr] of ATTRS) for (const node of doc.querySelectorAll(`${selector}[${CSS.escape(attr)}]`)) rewriteAttr(node, attr);
    for (const node of doc.querySelectorAll('a[href]')) rewriteAttr(node, 'href');
    for (const node of doc.querySelectorAll('[srcset]')) {
      const rewritten = (node.getAttribute('srcset') || '').split(',').map((part) => {
        const bits = part.trim().split(/\s+/);
        const raw = bits.shift();
        try {
          const abs = new URL(raw, baseUrl).href;
          const target = urlToPath.get(abs);
          if (target) bits.unshift(relativePath(currentPath, target)); else bits.unshift(raw);
        } catch (_) { bits.unshift(raw); }
        return bits.join(' ');
      }).join(', ');
      node.setAttribute('srcset', rewritten);
    }
    for (const node of doc.querySelectorAll('[style]')) node.setAttribute('style', rewriteCss(node.getAttribute('style') || '', baseUrl, currentPath, urlToPath));
    for (const node of doc.querySelectorAll('style')) node.textContent = rewriteCss(node.textContent || '', baseUrl, currentPath, urlToPath);

    let html = new XMLSerializer().serializeToString(doc.documentElement);
    if (!/xmlns=/.test(html.slice(0, 300))) html = html.replace(/^<html\b/i, '<html xmlns="http://www.w3.org/1999/xhtml"');
    return `<?xml version="1.0" encoding="UTF-8"?>\n${html}`;
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

  function buildNav(title, spine) {
    const items = spine.map((x) => `<li><a href="${xmlEscape(relativePath('OEBPS/nav.xhtml', x.path))}">${xmlEscape(x.title)}</a></li>`).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><meta charset="utf-8"/><title>${xmlEscape(title)}</title></head><body><nav epub:type="toc" id="toc"><h1>${xmlEscape(title)}</h1><ol>${items}</ol></nav></body></html>`;
  }

  function buildOpf(title, productId, resources, spine) {
    const manifest = [
      '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>'
    ];
    const idByPath = new Map();
    let n = 0;
    for (const r of resources) {
      if (!r.ok || !r.path.startsWith('OEBPS/')) continue;
      const href = r.path.slice('OEBPS/'.length);
      if (href === 'content.opf' || href === 'nav.xhtml') continue;
      const id = `res${++n}`;
      idByPath.set(r.path, id);
      manifest.push(`<item id="${id}" href="${xmlEscape(href)}" media-type="${xmlEscape(r.mediaType === 'text/html' ? 'application/xhtml+xml' : r.mediaType)}"/>`);
    }
    const spineXml = spine.filter((x) => idByPath.has(x.path)).map((x) => `<itemref idref="${idByPath.get(x.path)}"/>`).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="bookid">urn:pearson:${xmlEscape(productId || 'unknown')}</dc:identifier><dc:title>${xmlEscape(title)}</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')}</meta></metadata><manifest>${manifest.join('\n')}</manifest><spine>${spineXml}</spine></package>`;
  }

  function showNeedToc(productId, sanvan, retry) {
    clear(`Pearson Downloader ${VERSION}`, productId ? `Book ${productId}` : 'Pearson+ Reader');
    const c = card();
    const h = el('h2', 'Waiting for Pearson table of contents');
    h.style.marginTop = '0';
    c.append(h);
    c.append(el('p', 'The downloader found the Reader session, but the full Pearson TOC is not currently exposed in page state. The capture hook is installed now.'));
    const steps = el('ol');
    for (const text of [
      'Open Pearson’s table of contents and jump to a different chapter/page.',
      'If that does not trigger it, go back to the Pearson library and reopen this book without doing a full browser refresh.',
      'Then click “Try again”.'
    ]) { const li = el('li', text); steps.append(li); }
    c.append(steps);
    const info = el('p', sanvan ? `Sanvan content source detected: item ${sanvan.itemId}, version ${sanvan.itemVersion}.` : 'No Sanvan page request has been observed yet; turn at least one page in the book.');
    info.style.color = '#667085';
    c.append(info);
    const row = el('div'); row.style.display = 'flex'; row.style.gap = '10px';
    const again = button('Try again', true); again.onclick = retry;
    const paste = button('Paste TOC JSON');
    paste.onclick = () => showPasteToc(productId, retry);
    row.append(again, paste); c.append(row); box.append(c);
  }

  function showPasteToc(productId, retry) {
    clear(`Pearson Downloader ${VERSION}`, 'Manual TOC fallback');
    const c = card();
    c.append(el('p', 'Paste the JSON response from Pearson’s contenttoc request. Auth headers/tokens are not needed and should not be pasted.'));
    const ta = el('textarea');
    Object.assign(ta.style, { width: '100%', height: '45vh', font: '12px ui-monospace,monospace', boxSizing: 'border-box' });
    c.append(ta);
    const row = el('div'); row.style.marginTop = '10px'; row.style.display = 'flex'; row.style.gap = '10px';
    const use = button('Use this TOC', true);
    use.onclick = () => {
      const data = safeJsonParse(ta.value);
      if (!data || !looksLikeToc(data, productId)) return alert('That JSON does not look like a Pearson contenttoc response for this book.');
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

    const formatRow = el('div');
    formatRow.innerHTML = '<strong>Output:</strong> ';
    const select = el('select');
    select.innerHTML = '<option value="epub">EPUB (.epub)</option><option value="zip">Raw ZIP (.zip)</option>';
    select.style.marginLeft = '8px'; select.style.padding = '7px';
    formatRow.append(select); c.append(formatRow);

    const opts = el('div'); opts.style.marginTop = '14px';
    const media = el('label'); const mediaCb = el('input'); mediaCb.type = 'checkbox'; mediaCb.checked = true; media.append(mediaCb, document.createTextNode(' Download page images, CSS, fonts, and other referenced assets'));
    const scripts = el('label'); scripts.style.display = 'block'; scripts.style.marginTop = '8px'; const scriptsCb = el('input'); scriptsCb.type = 'checkbox'; scriptsCb.checked = false; scripts.append(scriptsCb, document.createTextNode(' Include referenced JavaScript/interactive assets (larger; many EPUB readers ignore scripts)'));
    opts.append(media, scripts); c.append(opts);

    const start = button('Start download', true); start.style.marginTop = '18px';
    start.onclick = () => onStart({ format: select.value, crawlAssets: mediaCb.checked, includeScripts: scriptsCb.checked });
    c.append(start); box.append(c);
  }

  async function crawlAndBuild(JSZip, meta, options) {
    controller = new AbortController();
    clear(`Pearson Downloader ${VERSION}`, meta.title);

    const stat = card();
    const statusLine = el('strong', 'Preparing resources…');
    const counts = el('div', 'Downloaded 0 • Failed 0 • Queued 0'); counts.style.marginTop = '6px';
    stat.append(statusLine, counts); box.append(stat);
    const log = el('div');
    Object.assign(log.style, { marginTop: '12px', height: '55vh', overflow: 'auto', background: '#101217', color: '#e8eaed', borderRadius: '10px', padding: '12px', font: '12px/1.5 ui-monospace,monospace' });
    box.append(log);
    const cancel = button('Cancel'); cancel.style.marginTop = '12px'; cancel.onclick = () => controller.abort(); box.append(cancel);

    const line = (text, color) => { const d = el('div', text); if (color) d.style.color = color; log.append(d); log.scrollTop = log.scrollHeight; };

    const resources = new Map();
    const urlToPath = new Map();
    const queue = [];
    const queued = new Set();
    let ok = 0, failed = 0;
    let concurrency = START_CONCURRENCY;
    let cleanBatches = 0;

    const normalizeKey = (url) => { const u = new URL(url); u.hash = ''; return u.href; };
    const enqueue = (url, kind = 'asset', title = '') => {
      if (!isDownloadableProtocol(url)) return;
      const key = normalizeKey(url);
      if (queued.has(key) || queued.size >= MAX_CRAWL) return;
      if (!shouldCrawl(key, meta.sanvan.base)) return;
      if (!options.includeScripts && /\.(?:js|mjs)(?:$|[?#])/i.test(key)) return;
      queued.add(key);
      const path = safeArchivePathFromUrl(key, meta.sanvan.base);
      urlToPath.set(key, path);
      queue.push({ url: key, path, kind, title });
    };

    for (const entry of meta.entries) {
      const url = new URL(entry.uri, meta.sanvan.base).href;
      enqueue(url, /narrative\/.+\.html(?:$|[?#])/i.test(entry.uri) ? 'page' : 'toc-resource', entry.title);
    }

    const update = () => { counts.textContent = `Downloaded ${ok} • Failed ${failed} • Queued ${queue.length}`; };
    update();

    async function processResource(task) {
      try {
        const r = await fetchRetry(task.url, 3);
        if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status });
        const bytes = new Uint8Array(await r.arrayBuffer());
        const contentType = r.headers.get('content-type') || mediaTypeFrom(task.url);
        if (isLikelyErrorBody(bytes, contentType)) throw new Error('Server returned an error document instead of the requested resource');
        const mediaType = mediaTypeFrom(task.url, contentType);
        const item = { ...task, ok: true, bytes, mediaType, contentType };
        resources.set(task.url, item); ok++;

        if (options.crawlAssets && /(?:text\/html|application\/xhtml\+xml)/i.test(mediaType)) {
          const text = new TextDecoder().decode(bytes);
          for (const ref of htmlRefs(text, task.url)) enqueue(ref, 'asset');
        } else if (options.crawlAssets && /text\/css/i.test(mediaType)) {
          const text = new TextDecoder().decode(bytes);
          for (const ref of cssRefs(text, task.url)) enqueue(ref, 'asset');
        }
        line(`ok ${task.url}`, '#8de1a6');
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

    statusLine.textContent = 'Rewriting local references…';
    for (const item of resources.values()) {
      if (!item.ok) continue;
      if (/(?:text\/html|application\/xhtml\+xml)/i.test(item.mediaType)) {
        const text = new TextDecoder().decode(item.bytes);
        item.outputText = rewriteHtml(text, item.url, item.path, urlToPath);
        item.mediaType = 'application/xhtml+xml';
      } else if (/text\/css/i.test(item.mediaType)) {
        item.outputText = rewriteCss(new TextDecoder().decode(item.bytes), item.url, item.path, urlToPath);
      }
    }

    const spine = [];
    for (const entry of meta.narratives) {
      const url = normalizeKey(new URL(entry.uri, meta.sanvan.base).href);
      const item = resources.get(url);
      if (item?.ok) spine.push({ title: entry.title, path: item.path, url });
    }

    const report = {
      version: VERSION, productId: meta.productId, title: meta.title, tocSource: meta.tocSource,
      sanvanItemId: meta.sanvan.itemId, sanvanVersion: meta.sanvan.itemVersion,
      tocResources: meta.entries.length, narrativePages: meta.narratives.length,
      downloaded: [...resources.values()].filter((r) => r.ok).length,
      failed: [...resources.values()].filter((r) => !r.ok).length,
      spinePages: spine.length,
      missingNarrativePages: meta.narratives.length - spine.length,
      failedResources: [...resources.values()].filter((r) => !r.ok).map((r) => ({ url: r.url, error: r.error }))
    };
    app.lastReport = report;

    const zip = new JSZip();
    if (options.format === 'epub') {
      zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
      zip.file('META-INF/container.xml', buildContainer());
      zip.file('OEBPS/nav.xhtml', buildNav(meta.title, spine));
    }

    for (const item of resources.values()) {
      if (!item.ok) continue;
      const path = options.format === 'epub' ? item.path : item.path.replace(/^OEBPS\//, '');
      zip.file(path, item.outputText != null ? item.outputText : item.bytes);
    }

    if (options.format === 'epub') {
      const okResources = [...resources.values()].filter((r) => r.ok);
      zip.file('OEBPS/content.opf', buildOpf(meta.title, meta.productId, okResources, spine));
    }
    zip.file(options.format === 'epub' ? 'OEBPS/pearson-download-report.json' : 'pearson-download-report.json', JSON.stringify(report, null, 2));

    statusLine.textContent = 'Building archive…';
    const blob = await zip.generateAsync({
      type: 'blob', mimeType: options.format === 'epub' ? 'application/epub+zip' : 'application/zip',
      compression: 'DEFLATE', compressionOptions: { level: 6 }
    }, (m) => { statusLine.textContent = `Building archive… ${Math.floor(m.percent)}%`; });

    const fileName = `${safeName(meta.title)}.${options.format}`;
    const objectUrl = URL.createObjectURL(blob);
    const a = el('a'); a.href = objectUrl; a.download = fileName; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);

    statusLine.textContent = `Finished: ${fileName}`;
    const validation = card();
    const h = el('h2', 'Download report'); h.style.marginTop = '0'; validation.append(h);
    const pre = el('pre', [
      `Narrative pages: ${report.spinePages}/${report.narrativePages}`,
      `Resources downloaded: ${report.downloaded}`,
      `Resources failed: ${report.failed}`,
      `Missing narrative pages: ${report.missingNarrativePages}`,
      report.missingNarrativePages === 0 ? 'Core book-page check: PASS' : 'Core book-page check: INCOMPLETE'
    ].join('\n'));
    pre.style.whiteSpace = 'pre-wrap'; validation.append(pre); box.append(validation);
    cancel.textContent = 'Close'; cancel.onclick = () => app.close();
  }

  async function initialize() {
    const productId = discoverProductId();
    const sanvan = discoverSanvan();
    const tocHit = discoverToc(productId);

    if (!productId || !sanvan || !tocHit) {
      showNeedToc(productId, sanvan, initialize);
      return;
    }

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
