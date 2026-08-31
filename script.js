/**
 * McGraw Hill downloader v2026.08.31.2
 * https://github.com/chaevsfe/mgh
 *
 * Saves a book you already have access to as an EPUB or ZIP.
 * Run it on the Reader page while signed in.
 */
(async () => {
  'use strict';

  const VERSION = '2026.08.31.2';
  const KEY = '__MGH_DOWNLOADER__';
  const MAX_CONCURRENCY = 6;
  const MIN_CONCURRENCY = 2;
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
  let throttleSignal = 0;
  const app = {
    root: null,
    lastReport: null,
    close() {
      controller.abort();
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

  function button(text, primary = false) {
    const b = el('button', text);
    Object.assign(b.style, {
      padding: '9px 14px', borderRadius: '7px', border: '1px solid #cbd0d8',
      background: primary ? '#1769d2' : '#fff', color: primary ? '#fff' : '#17191d',
      fontWeight: 650, cursor: 'pointer'
    });
    return b;
  }

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
  }

  function card() {
    const c = el('div');
    Object.assign(c.style, {
      background: '#fff', border: '1px solid #d8dde5', borderRadius: '10px',
      padding: '16px', marginTop: '18px'
    });
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

  function parseRetryAfter(response) {
    const value = response.headers.get('retry-after');
    if (!value) return null;
    const seconds = Number(value);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const date = Date.parse(value);
    if (Number.isFinite(date)) return Math.max(0, date - Date.now());
    return null;
  }

  async function fetchRetry(url, retries = 3) {
    let last;
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const response = await fetch(url, {
          credentials: 'include', cache: 'no-store', signal: controller.signal
        });

        if (response.ok) return response;

        const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
        if (!retryable) return response;

        if (response.status === 429 || response.status === 503) throttleSignal++;
        last = new Error(`HTTP ${response.status} for ${url}`);
        last.status = response.status;

        if (attempt < retries) {
          const retryAfter = parseRetryAfter(response);
          await sleep(retryAfter ?? Math.min(8000, 500 * (2 ** (attempt - 1))));
        }
      } catch (error) {
        if (error.name === 'AbortError') throw error;
        last = error;
        if (attempt < retries) await sleep(Math.min(8000, 500 * (2 ** (attempt - 1))));
      }
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
      } catch (error) {
        last = error;
      }
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
      for (const key of keys) {
        if (typeof obj[key] === 'string' && obj[key]) return obj[key];
      }
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
        const response = await fetchRetry(endpoint, 2);
        if (!response.ok) {
          errors.push(`${endpoint}: HTTP ${response.status}`);
          continue;
        }
        let data;
        try {
          data = await response.json();
        } catch (_) {
          errors.push(`${endpoint}: invalid JSON`);
          continue;
        }
        const found = deepFind(data, ['custom_epub_url', 'epub_url', 'epubUrl', 'customEpubUrl']);
        if (found) {
          const u = new URL(found, location.href);
          u.search = '';
          u.hash = '';
          if (!u.pathname.endsWith('/')) u.pathname += '/';
          return { base: u.href, via: endpoint };
        }
        errors.push(`${endpoint}: EPUB URL field missing`);
      } catch (error) {
        errors.push(`${endpoint}: ${error.message}`);
      }
    }

    throw new Error(
      `Could not locate the open textbook. Open the actual book reader, then run the script again.\n\n${errors.join('\n')}`
    );
  }

  function sanitizeRootPath(path) {
    const cleaned = String(path || '').replace(/^\/+/, '').replace(/\\/g, '/');
    const parts = cleaned.split('/').filter(Boolean);
    if (!parts.length || parts.some((part) => part === '.' || part === '..')) {
      throw new Error(`Unsafe EPUB package path: ${path}`);
    }
    return parts.join('/');
  }

  async function readPackage(base) {
    const containerUrl = new URL('META-INF/container.xml', base).href;
    let containerText;
    let rootPath;
    let usedFallbackContainer = false;
    const containerResponse = await fetchRetry(containerUrl, 2);

    if (containerResponse.ok) {
      containerText = await containerResponse.text();
      const cdoc = xml(containerText, 'container.xml');
      const root = [...cdoc.getElementsByTagNameNS('*', 'rootfile')]
        .find((node) => node.hasAttribute('full-path'));
      if (!root) throw new Error('container.xml has no rootfile.');
      rootPath = sanitizeRootPath(root.getAttribute('full-path'));
    } else {
      usedFallbackContainer = true;
      rootPath = 'OPS/content.opf';
      containerText = '<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>';
    }

    const packageUrl = new URL(rootPath, base).href;
    const packageResponse = await fetchRetry(packageUrl, 3);
    if (!packageResponse.ok) throw new Error(`Could not fetch ${rootPath}: HTTP ${packageResponse.status}`);
    const packageText = await packageResponse.text();
    const doc = xml(packageText, 'package document');
    const manifest = [...doc.getElementsByTagNameNS('*', 'manifest')][0];
    const items = manifest
      ? [...manifest.children].filter((node) => node.localName === 'item' && node.getAttribute('href'))
      : [];
    if (!items.length) throw new Error('The package manifest is empty.');

    const manifestIds = new Set(items.map((item) => item.getAttribute('id')).filter(Boolean));
    const spineRefs = [...doc.getElementsByTagNameNS('*', 'itemref')]
      .map((node) => node.getAttribute('idref')).filter(Boolean);
    const brokenSpineRefs = spineRefs.filter((idref) => !manifestIds.has(idref));
    const title = [...doc.getElementsByTagNameNS('*', 'title')][0]?.textContent?.trim() || 'textbook';

    return {
      base, containerText, rootPath, packageUrl, packageText, doc, items, title,
      spineRefs, brokenSpineRefs, usedFallbackContainer
    };
  }

  function extension(href) {
    const path = new URL(href, 'https://epub.local/').pathname;
    const name = path.split('/').pop() || '';
    const dot = name.lastIndexOf('.');
    return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '(none)';
  }

  function decodePathSegmentSafely(segment) {
    const protectedSegment = segment
      .replace(/%2f/ig, '%252F')
      .replace(/%5c/ig, '%255C')
      .replace(/%00/ig, '%2500');
    try {
      return decodeURIComponent(protectedSegment);
    } catch (_) {
      return segment;
    }
  }

  function archivePath(rootPath, href) {
    const dir = rootPath.includes('/') ? rootPath.slice(0, rootPath.lastIndexOf('/') + 1) : '';
    const resolved = new URL(href, `https://epub.local/${dir}`);
    const rawParts = resolved.pathname.replace(/^\/+/, '').split('/');
    const parts = rawParts.filter(Boolean).map(decodePathSegmentSafely);

    if (!parts.length) throw new Error(`Empty archive path for ${href}`);
    if (parts.some((part) => part === '.' || part === '..' || part.includes('\\') || part.includes('\0'))) {
      throw new Error(`Unsafe archive path for ${href}`);
    }

    const path = parts.join('/');
    if (path.startsWith('/') || path.includes('/../') || path.startsWith('../')) {
      throw new Error(`Unsafe archive path for ${href}`);
    }
    return path;
  }

  function normalizedUrl(url) {
    const u = new URL(url);
    const normalized = u.pathname.replace(/\/{2,}/g, '/');
    if (normalized === u.pathname) return null;
    u.pathname = normalized;
    return u.href;
  }

  function safeName(name) {
    return (name || 'textbook')
      .replace(/[\u0000-\u001f\\/:*?"<>|]+/g, '_')
      .replace(/[. ]+$/g, '')
      .trim()
      .slice(0, 180) || 'textbook';
  }

  function expectedBinary(item) {
    const mediaType = (item.getAttribute('media-type') || '').toLowerCase();
    const ext = extension(item.getAttribute('href') || '');
    if (mediaType === 'image/svg+xml' || mediaType.includes('xml') || mediaType.includes('html')) return false;
    if (mediaType.startsWith('font/') || mediaType.startsWith('image/') || mediaType.startsWith('audio/') || mediaType.startsWith('video/')) return true;
    return ['woff', 'woff2', 'ttf', 'otf', 'eot', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'mp3', 'mp4', 'm4a', 'webm'].includes(ext);
  }

  function fontSignatureValid(ext, bytes) {
    if (ext === 'woff') return bytes[0] === 0x77 && bytes[1] === 0x4f && bytes[2] === 0x46 && bytes[3] === 0x46;
    if (ext === 'woff2') return bytes[0] === 0x77 && bytes[1] === 0x4f && bytes[2] === 0x46 && bytes[3] === 0x32;
    if (ext === 'otf') return bytes[0] === 0x4f && bytes[1] === 0x54 && bytes[2] === 0x54 && bytes[3] === 0x4f;
    if (ext === 'ttf') {
      return (bytes[0] === 0x00 && bytes[1] === 0x01 && bytes[2] === 0x00 && bytes[3] === 0x00) ||
        (bytes[0] === 0x74 && bytes[1] === 0x72 && bytes[2] === 0x75 && bytes[3] === 0x65);
    }
    return true;
  }

  function validatePayload(item, response, buffer) {
    const href = item.getAttribute('href') || '';
    const ext = extension(href);
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    const bytes = new Uint8Array(buffer.slice(0, 2048));
    const preview = new TextDecoder('utf-8', { fatal: false }).decode(bytes).trimStart().toLowerCase();

    const obviousError = preview.startsWith('<error') || preview.startsWith('<?xml') && /<error[\s>]/i.test(preview) ||
      preview.includes('<code>accessdenied</code>') || preview.includes('access denied');
    if (obviousError) throw new Error('Server returned an XML/HTML access error instead of the requested asset.');

    if (expectedBinary(item)) {
      if (contentType.includes('text/html') || contentType.includes('application/xhtml+xml')) {
        throw new Error(`Server returned ${contentType} for a binary asset.`);
      }
      if (preview.startsWith('<!doctype html') || preview.startsWith('<html')) {
        throw new Error('Server returned an HTML page instead of the requested asset.');
      }
    }

    if (['woff', 'woff2', 'ttf', 'otf'].includes(ext) && !fontSignatureValid(ext, bytes)) {
      throw new Error(`Downloaded .${ext} does not have a valid font signature.`);
    }
  }

  async function fetchAsset(item, packageUrl) {
    const href = item.getAttribute('href');
    const original = new URL(href, packageUrl).href;
    const repaired = normalizedUrl(original);
    const candidates = repaired && repaired !== original ? [original, repaired] : [original];
    const errors = [];

    for (let index = 0; index < candidates.length; index++) {
      const url = candidates[index];
      try {
        const response = await fetchRetry(url, 3);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const buffer = await response.arrayBuffer();
        validatePayload(item, response, buffer);
        return { buffer, url, repaired: index > 0 };
      } catch (error) {
        if (error.name === 'AbortError') throw error;
        errors.push(`${url}: ${error.message}`);
      }
    }

    throw new Error(errors.join(' | '));
  }

  function choose(pkg, via, onStart) {
    clear(`MGH Downloader ${VERSION}`, pkg.title);
    const c = card();
    const p = el('p', `Found ${pkg.items.length} resources via ${via}. All resource types are selected by default.`);
    p.style.marginTop = '0';
    c.append(p);

    const exts = [...new Set(pkg.items.map((item) => extension(item.getAttribute('href'))))].sort();
    const grid = el('div');
    Object.assign(grid.style, {
      display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(130px,1fr))',
      gap: '8px', margin: '16px 0'
    });
    const checks = new Map();
    exts.forEach((ext, i) => {
      const label = el('label');
      Object.assign(label.style, { padding: '8px', border: '1px solid #dde1e7', borderRadius: '7px' });
      const cb = el('input');
      cb.type = 'checkbox';
      cb.checked = true;
      cb.id = `mgh-${i}`;
      checks.set(ext, cb);
      label.append(cb, document.createTextNode(` ${ext === '(none)' ? '(no extension)' : `.${ext}`}`));
      grid.append(label);
    });
    c.append(grid);

    const note = el('p', 'Tip: EPUB is most standards-compliant when all manifest resources are included. ZIP mode is a raw archive and does not add EPUB-only mimetype metadata.');
    note.style.color = '#667085';
    c.append(note);

    const row = el('div');
    Object.assign(row.style, { display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' });
    const format = el('select');
    format.innerHTML = '<option value="epub">EPUB (.epub)</option><option value="zip">ZIP (.zip)</option>';
    format.style.padding = '8px';
    const all = button('Select all');
    all.onclick = () => checks.forEach((cb) => { cb.checked = true; });
    const none = button('Select none');
    none.onclick = () => checks.forEach((cb) => { cb.checked = false; });
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

  async function processAdaptive(items, worker, onConcurrencyChange) {
    let concurrency = MAX_CONCURRENCY;
    let cleanBatches = 0;
    let cursor = 0;

    while (cursor < items.length) {
      const batch = items.slice(cursor, cursor + concurrency);
      const beforeThrottle = throttleSignal;
      await Promise.all(batch.map(worker));
      cursor += batch.length;

      if (throttleSignal > beforeThrottle) {
        const next = Math.max(MIN_CONCURRENCY, Math.floor(concurrency / 2));
        if (next !== concurrency) {
          concurrency = next;
          onConcurrencyChange?.(concurrency, 'reduced after rate limiting');
        }
        cleanBatches = 0;
      } else {
        cleanBatches++;
        if (cleanBatches >= 3 && concurrency < MAX_CONCURRENCY) {
          concurrency++;
          cleanBatches = 0;
          onConcurrencyChange?.(concurrency, 'increased after clean batches');
        }
      }
    }
  }

  function auditPackage(pkg, selectedItems, downloadedPaths, failedItems, skippedItems, format) {
    const selectedPaths = [];
    const allManifestPaths = [];
    const pathErrors = [];
    const duplicates = new Map();

    for (const item of pkg.items) {
      const href = item.getAttribute('href');
      try {
        const path = archivePath(pkg.rootPath, href);
        allManifestPaths.push(path);
        duplicates.set(path, (duplicates.get(path) || 0) + 1);
      } catch (error) {
        pathErrors.push(`${href}: ${error.message}`);
      }
    }

    for (const item of selectedItems) {
      try {
        selectedPaths.push(archivePath(pkg.rootPath, item.getAttribute('href')));
      } catch (_) {}
    }

    const missingSelected = selectedPaths.filter((path) => !downloadedPaths.has(path));
    const missingManifest = allManifestPaths.filter((path) => !downloadedPaths.has(path));
    const duplicatePaths = [...duplicates].filter(([, count]) => count > 1).map(([path]) => path);

    const warnings = [];
    if (pkg.usedFallbackContainer) warnings.push('META-INF/container.xml was reconstructed because the source container could not be read.');
    if (pkg.brokenSpineRefs.length) warnings.push(`${pkg.brokenSpineRefs.length} spine idref(s) do not resolve to manifest items.`);
    if (pathErrors.length) warnings.push(`${pathErrors.length} manifest path(s) were unsafe or could not be resolved.`);
    if (duplicatePaths.length) warnings.push(`${duplicatePaths.length} duplicate archive path(s) were detected.`);
    if (failedItems.length) warnings.push(`${failedItems.length} selected resource(s) failed to download.`);
    if (format === 'epub' && skippedItems.length) warnings.push(`${skippedItems.length} manifest resource(s) were intentionally omitted; the EPUB may be incomplete.`);
    if (format === 'epub' && missingManifest.length) warnings.push(`${missingManifest.length} manifest resource(s) are absent from the final EPUB.`);

    const report = {
      version: VERSION,
      format,
      manifestResources: pkg.items.length,
      selectedResources: selectedItems.length,
      downloadedResources: downloadedPaths.size,
      failedResources: failedItems.length,
      skippedResources: skippedItems.length,
      missingSelected: missingSelected.length,
      missingManifest: format === 'epub' ? missingManifest.length : null,
      spineReferences: pkg.spineRefs.length,
      brokenSpineReferences: pkg.brokenSpineRefs.length,
      containerPointsToPackage: true,
      mimetypeFirstAndStored: null,
      duplicateArchivePaths: duplicatePaths.length,
      pathErrors: pathErrors.length,
      warnings,
      failed: failedItems.map((item) => ({ href: item.href, error: item.error })),
      pathErrorDetails: pathErrors,
      duplicatePathDetails: duplicatePaths
    };
    report.ok = warnings.length === 0;
    return report;
  }

  async function verifyGeneratedEpub(blob) {
    const header = new Uint8Array(await blob.slice(0, 256).arrayBuffer());
    if (header.length < 30) return { ok: false, reason: 'Archive is too small to contain a ZIP local header.' };
    if (header[0] !== 0x50 || header[1] !== 0x4b || header[2] !== 0x03 || header[3] !== 0x04) {
      return { ok: false, reason: 'First ZIP entry does not begin with a local file header.' };
    }
    const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
    const compressionMethod = view.getUint16(8, true);
    const nameLength = view.getUint16(26, true);
    const extraLength = view.getUint16(28, true);
    const dataOffset = 30 + nameLength + extraLength;
    if (dataOffset > header.length) return { ok: false, reason: 'Could not inspect the first ZIP entry.' };
    const name = new TextDecoder().decode(header.slice(30, 30 + nameLength));
    const expected = 'application/epub+zip';
    const data = new TextDecoder().decode(header.slice(dataOffset, dataOffset + expected.length));
    if (name !== 'mimetype') return { ok: false, reason: `First ZIP entry is ${name || '(unnamed)'}, not mimetype.` };
    if (compressionMethod !== 0) return { ok: false, reason: `mimetype uses ZIP compression method ${compressionMethod}, expected STORE (0).` };
    if (data !== expected) return { ok: false, reason: 'mimetype payload is not application/epub+zip.' };
    return { ok: true, reason: null };
  }

  function renderReport(report, container) {
    const reportCard = card();
    const heading = el('h3', report.ok ? 'Validation: PASS' : 'Validation: completed with warnings');
    heading.style.marginTop = '0';
    heading.style.color = report.ok ? '#067647' : '#b54708';
    reportCard.append(heading);

    const summary = el('div',
      `Manifest ${report.manifestResources} | Selected ${report.selectedResources} | Downloaded ${report.downloadedResources} | Failed ${report.failedResources} | Skipped ${report.skippedResources}`
    );
    reportCard.append(summary);

    const integrity = el('div',
      `Spine errors ${report.brokenSpineReferences} | Path errors ${report.pathErrors} | Duplicate paths ${report.duplicateArchivePaths}`
    );
    integrity.style.marginTop = '4px';
    reportCard.append(integrity);

    if (report.format === 'epub') {
      const mimetypeStatus = report.mimetypeFirstAndStored === true ? 'yes' : report.mimetypeFirstAndStored === false ? 'NO' : 'pending';
      const epub = el('div',
        `EPUB checks: container->OPF yes | mimetype first/uncompressed ${mimetypeStatus} | missing manifest resources ${report.missingManifest}`
      );
      epub.style.marginTop = '4px';
      reportCard.append(epub);
    }

    if (report.warnings.length) {
      const ul = el('ul');
      for (const warning of report.warnings) ul.append(el('li', warning));
      reportCard.append(ul);
    }
    container.append(reportCard);
  }

  async function download(JSZip, pkg, selected, format) {
    controller = new AbortController();
    clear(`MGH Downloader ${VERSION}`, pkg.title);

    const stat = card();
    const statusLine = el('strong', 'Preparing download...');
    const counts = el('div', 'Downloaded 0 | Repaired 0 | Skipped 0 | Failed 0');
    counts.style.marginTop = '6px';
    stat.append(statusLine, counts);
    box.append(stat);

    const log = el('div');
    Object.assign(log.style, {
      marginTop: '12px', height: '52vh', overflow: 'auto', background: '#101217', color: '#e8eaed',
      borderRadius: '10px', padding: '12px', font: '12px/1.5 ui-monospace,monospace'
    });
    box.append(log);

    const cancel = button('Cancel');
    cancel.style.marginTop = '12px';
    cancel.onclick = () => controller.abort();
    box.append(cancel);

    const line = (text, color) => {
      const d = el('div', text);
      if (color) d.style.color = color;
      log.append(d);
      log.scrollTop = log.scrollHeight;
    };

    let ok = 0;
    let repaired = 0;
    let skipped = 0;
    let failed = 0;
    const update = () => {
      counts.textContent = `Downloaded ${ok} | Repaired ${repaired} | Skipped ${skipped} | Failed ${failed}`;
    };

    const zip = new JSZip();
    if (format === 'epub') zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
    zip.file('META-INF/container.xml', pkg.containerText);
    zip.file(pkg.rootPath, pkg.packageText);

    const todo = [];
    const selectedItems = [];
    const skippedItems = [];
    const downloadedPaths = new Set();
    const failedItems = [];

    pkg.items.forEach((item, i) => {
      const href = item.getAttribute('href');
      if (!selected.has(extension(href))) {
        skipped++;
        skippedItems.push({ href, i });
        line(`[${i + 1}/${pkg.items.length}] skip ${href}`, '#ffd37a');
      } else {
        selectedItems.push(item);
        todo.push({ item, href, i });
      }
    });
    update();
    statusLine.textContent = `Downloading ${todo.length} resources...`;

    await processAdaptive(todo, async ({ item, href, i }) => {
      try {
        const result = await fetchAsset(item, pkg.packageUrl);
        const path = archivePath(pkg.rootPath, href);
        zip.file(path, result.buffer);
        downloadedPaths.add(path);
        ok++;
        if (result.repaired) {
          repaired++;
          line(`[${i + 1}/${pkg.items.length}] repaired ${href} -> ${result.url}`, '#7dd3fc');
        } else {
          line(`[${i + 1}/${pkg.items.length}] ok ${href}`, '#8de1a6');
        }
      } catch (error) {
        if (error.name === 'AbortError') throw error;
        failed++;
        failedItems.push({ href, i, error: error.message });
        line(`[${i + 1}/${pkg.items.length}] fail ${href}: ${error.message}`, '#ff9b95');
      }
      update();
    }, (concurrency, reason) => {
      line(`network: concurrency ${concurrency} (${reason})`, '#c4b5fd');
      statusLine.textContent = `Downloading... concurrency ${concurrency}`;
    });

    statusLine.textContent = 'Running final EPUB/archive integrity audit...';
    const report = auditPackage(pkg, selectedItems, downloadedPaths, failedItems, skippedItems, format);
    console.info('[MGH Downloader] pre-build validation report', report);
    statusLine.textContent = 'Building archive...';
    const blob = await zip.generateAsync({
      type: 'blob',
      mimeType: format === 'epub' ? 'application/epub+zip' : 'application/zip',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    }, (meta) => {
      statusLine.textContent = `Building archive... ${Math.floor(meta.percent)}%`;
    });

    if (format === 'epub') {
      statusLine.textContent = 'Verifying generated EPUB container...';
      const epubCheck = await verifyGeneratedEpub(blob);
      report.mimetypeFirstAndStored = epubCheck.ok;
      if (!epubCheck.ok) report.warnings.push(`Generated EPUB mimetype check failed: ${epubCheck.reason}`);
      report.ok = report.warnings.length === 0;
    }
    app.lastReport = report;
    renderReport(report, box);

    const name = `${safeName(pkg.title)}.${format}`;
    const url = URL.createObjectURL(blob);
    const a = el('a');
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);

    statusLine.textContent = report.ok
      ? `Finished: ${name} - validation passed.`
      : `Finished: ${name} - review validation warnings above.`;
    cancel.textContent = 'Close';
    cancel.onclick = () => app.close();
  }

  try {
    status('Loading JSZip...');
    const JSZip = await loadJSZip();
    status('Finding the open McGraw Hill textbook...');
    const book = await discoverBook();
    status('Reading EPUB metadata...');
    const pkg = await readPackage(book.base);
    choose(pkg, book.via, (selected, format) => {
      download(JSZip, pkg, selected, format).catch((error) => {
        if (error.name === 'AbortError') fail('Download cancelled', new Error('The download was cancelled.'));
        else fail('Download failed', error);
      });
    });
  } catch (error) {
    if (error.name === 'AbortError') app.close();
    else fail('Initialization failed', error);
  }
})();
