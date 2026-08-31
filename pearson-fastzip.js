// Pearson+ ZIP writer v2026.08.31.6
// Loads before pearson.js.
// Keeps the bytes handed to JSZip.file() and writes a plain stored ZIP itself,
// so JSZip never tries to recompress a few hundred images and stall.
(() => {
  'use strict';

  const KEY = '__PEARSON_FASTZIP_PATCH__';
  const VERSION = '2026.08.31.6';
  if (window[KEY]?.version === VERSION) return;

  const encoder = new TextEncoder();
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const payloads = new WeakMap();
  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
    return table;
  })();

  const state = window[KEY] = {
    version: VERSION,
    patched: false,
    patch: null,
    capturedFiles: 0,
    fallbackReads: 0,
    currentFile: null,
    finalization: null
  };

  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
  function u16(view, offset, value) { view.setUint16(offset, value & 0xffff, true); }
  function u32(view, offset, value) { view.setUint32(offset, value >>> 0, true); }

  function remember(zip, name, data, options) {
    let map = payloads.get(zip);
    if (!map) { map = new Map(); payloads.set(zip, map); }
    map.set(String(name), { data, options: { ...(options || {}) } });
    state.capturedFiles++;
  }

  async function toBytes(value, options = {}) {
    if (value == null) return new Uint8Array(0);
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    if (typeof Blob !== 'undefined' && value instanceof Blob) return new Uint8Array(await value.arrayBuffer());
    if (typeof value === 'string') {
      if (options.base64) {
        const binary = atob(value.replace(/\s+/g, ''));
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i) & 255;
        return bytes;
      }
      return encoder.encode(value);
    }
    if (Array.isArray(value)) return Uint8Array.from(value);
    throw new Error(`Unsupported ZIP payload type: ${Object.prototype.toString.call(value)}`);
  }

  async function payloadText(saved) {
    if (!saved) return '';
    if (typeof saved.data === 'string' && !saved.options?.base64) return saved.data;
    return decoder.decode(await toBytes(saved.data, saved.options));
  }

  function isRemoteUrl(value) {
    return /^https?:\/\//i.test(String(value || '').trim());
  }

  function analyzeXhtml(text) {
    const embedded = new Set();
    const links = new Set();
    try {
      const doc = new DOMParser().parseFromString(String(text || ''), 'text/html');
      for (const a of doc.querySelectorAll('a[href]')) {
        const href = a.getAttribute('href');
        if (isRemoteUrl(href)) links.add(href.trim());
      }

      const attrs = [
        ['img', 'src'], ['source', 'src'], ['video', 'src'], ['video', 'poster'], ['audio', 'src'],
        ['script', 'src'], ['iframe', 'src'], ['embed', 'src'], ['object', 'data'], ['input', 'src'],
        ['image', 'href'], ['image', 'xlink:href'], ['use', 'href'], ['use', 'xlink:href']
      ];
      for (const [selector, attr] of attrs) {
        for (const node of doc.querySelectorAll(`${selector}[${CSS.escape(attr)}]`)) {
          const value = node.getAttribute(attr);
          if (isRemoteUrl(value)) embedded.add(value.trim());
        }
      }

      for (const node of doc.querySelectorAll('link[href]')) {
        const href = node.getAttribute('href');
        const rel = String(node.getAttribute('rel') || '').toLowerCase();
        if (isRemoteUrl(href) && /(?:stylesheet|icon|preload)/.test(rel)) embedded.add(href.trim());
      }

      for (const node of doc.querySelectorAll('[srcset]')) {
        for (const part of String(node.getAttribute('srcset') || '').split(',')) {
          const candidate = part.trim().split(/\s+/)[0];
          if (isRemoteUrl(candidate)) embedded.add(candidate);
        }
      }

      const cssRemote = /url\(\s*['"]?(https?:\/\/[^)'"\s]+)[^)]*\)/gi;
      for (const node of doc.querySelectorAll('[style]')) {
        const style = node.getAttribute('style') || '';
        let m; while ((m = cssRemote.exec(style))) embedded.add(m[1]);
        cssRemote.lastIndex = 0;
      }
      for (const node of doc.querySelectorAll('style')) {
        const style = node.textContent || '';
        let m; while ((m = cssRemote.exec(style))) embedded.add(m[1]);
        cssRemote.lastIndex = 0;
      }
    } catch (e) {
      console.warn(`[Pearson DirectZIP ${VERSION}] XHTML remote-resource analysis failed:`, e);
    }
    return { embedded, links };
  }

  function removeRemoteResourcesProperty(tag) {
    return tag.replace(/\sproperties="([^"]*)"/i, (whole, value) => {
      const tokens = value.split(/\s+/).filter(Boolean).filter((x) => x !== 'remote-resources');
      return tokens.length ? ` properties="${tokens.join(' ')}"` : '';
    });
  }

  async function finalizeEpubPayloads(captured) {
    const opfSaved = captured.get('OEBPS/content.opf');
    if (!opfSaved) return null;

    const perPage = new Map();
    const embeddedAll = new Set();
    const linksAll = new Set();

    for (const [name, saved] of captured) {
      if (!/\.x?html$/i.test(name)) continue;
      const info = analyzeXhtml(await payloadText(saved));
      perPage.set(name, info);
      info.embedded.forEach((u) => embeddedAll.add(u));
      info.links.forEach((u) => linksAll.add(u));
    }

    let opf = await payloadText(opfSaved);
    let removedProperties = 0;
    opf = opf.replace(/<item\b[^>]*>/gi, (tag) => {
      if (!/\bremote-resources\b/.test(tag)) return tag;
      const href = tag.match(/\bhref="([^"]+)"/i)?.[1];
      if (!href) return tag;
      const fullPath = `OEBPS/${href}`.replace(/\/\.\//g, '/');
      const info = perPage.get(fullPath);
      if (info && info.embedded.size === 0) {
        removedProperties++;
        return removeRemoteResourcesProperty(tag);
      }
      return tag;
    });
    opfSaved.data = opf;
    opfSaved.options = {};

    const reportSaved = captured.get('OEBPS/pearson-download-report.json');
    let validation = null;
    if (reportSaved) {
      try {
        const report = JSON.parse(await payloadText(reportSaved));
        report.remoteResourceCount = embeddedAll.size;
        report.remoteResourceUrls = [...embeddedAll];
        report.remoteEmbeddedResourceCount = embeddedAll.size;
        report.remoteEmbeddedResourceUrls = [...embeddedAll];
        report.externalHyperlinkCount = linksAll.size;
        report.externalHyperlinkUrls = [...linksAll];
        report.remoteResourcesPropertiesRemoved = removedProperties;

        validation = {
          pass: Number(report.missingNarrativePages || 0) === 0 && Number(report.failed || 0) === 0,
          narrativePages: `${report.spinePages || 0}/${report.narrativePages || 0}`,
          failedDownloads: Number(report.failed || 0),
          missingNarrativePages: Number(report.missingNarrativePages || 0),
          remoteEmbeddedResources: embeddedAll.size,
          externalHyperlinks: linksAll.size,
          invalidXmlCharactersRemoved: Number(report.invalidXmlCharsRemoved || 0),
          webScriptsRemoved: Number(report.scriptsRemoved || 0),
          coverRecovered: !!report.coverImagePath
        };
        report.epubValidation = validation;
        reportSaved.data = JSON.stringify(report, null, 2);
        reportSaved.options = {};
      } catch (e) {
        console.warn(`[Pearson DirectZIP ${VERSION}] Could not update packaged report:`, e);
      }
    }

    const result = {
      remoteEmbeddedResources: embeddedAll.size,
      externalHyperlinks: linksAll.size,
      remoteResourcesPropertiesRemoved: removedProperties,
      validation
    };
    state.finalization = result;
    console.info(
      `[Pearson DirectZIP ${VERSION}] EPUB metadata finalized: ` +
      `embeddedRemote=${embeddedAll.size}, externalLinks=${linksAll.size}, ` +
      `remote-resources removed=${removedProperties}, ` +
      `validation=${validation?.pass ? 'PASS' : 'CHECK'}.`
    );
    return result;
  }

  async function crc32Async(bytes) {
    let c = 0xffffffff;
    const STEP = 4 * 1024 * 1024;
    for (let start = 0; start < bytes.length; start += STEP) {
      const end = Math.min(bytes.length, start + STEP);
      for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
      if (end < bytes.length) await tick();
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  function dosDateTime(date) {
    const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
    const year = Math.min(2107, Math.max(1980, d.getFullYear()));
    return {
      time: ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | (Math.floor(d.getSeconds() / 2) & 31),
      date: ((year - 1980) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31)
    };
  }

  function localHeader(nameBytes, crc, size, dt) {
    const out = new Uint8Array(30 + nameBytes.length), v = new DataView(out.buffer);
    u32(v, 0, 0x04034b50); u16(v, 4, 20); u16(v, 6, 0x0800); u16(v, 8, 0);
    u16(v, 10, dt.time); u16(v, 12, dt.date); u32(v, 14, crc); u32(v, 18, size); u32(v, 22, size);
    u16(v, 26, nameBytes.length); u16(v, 28, 0); out.set(nameBytes, 30);
    return out;
  }

  function centralHeader(nameBytes, crc, size, dt, offset, isDir) {
    const out = new Uint8Array(46 + nameBytes.length), v = new DataView(out.buffer);
    u32(v, 0, 0x02014b50); u16(v, 4, 0x0314); u16(v, 6, 20); u16(v, 8, 0x0800); u16(v, 10, 0);
    u16(v, 12, dt.time); u16(v, 14, dt.date); u32(v, 16, crc); u32(v, 20, size); u32(v, 24, size);
    u16(v, 28, nameBytes.length); u16(v, 30, 0); u16(v, 32, 0); u16(v, 34, 0); u16(v, 36, 0);
    u32(v, 38, isDir ? 0x10 : 0); u32(v, 42, offset); out.set(nameBytes, 46);
    return out;
  }

  function endOfCentralDirectory(count, centralSize, centralOffset) {
    const out = new Uint8Array(22), v = new DataView(out.buffer);
    u32(v, 0, 0x06054b50); u16(v, 4, 0); u16(v, 6, 0); u16(v, 8, count); u16(v, 10, count);
    u32(v, 12, centralSize); u32(v, 16, centralOffset); u16(v, 20, 0);
    return out;
  }

  async function directStoreBlob(zip, options, onUpdate) {
    const entries = Object.values(zip.files || {});
    if (entries.length > 65535) throw new Error('Direct ZIP writer does not support more than 65,535 entries.');

    const captured = payloads.get(zip) || new Map();
    if (captured.has('OEBPS/content.opf')) await finalizeEpubPayloads(captured);

    const chunks = [], central = [];
    let offset = 0, completed = 0;

    if (typeof onUpdate === 'function') {
      try { onUpdate({ percent: 0, currentFile: 'Preparing direct STORE archive' }); } catch (_) {}
    }
    console.info(`[Pearson DirectZIP ${VERSION}] Starting ${entries.length} entries; captured payloads=${captured.size}.`);

    for (const file of entries) {
      const name = String(file.name || '');
      state.currentFile = name;
      const isDir = !!file.dir || name.endsWith('/');

      if (typeof onUpdate === 'function') {
        try { onUpdate({ percent: 1 + (completed / Math.max(1, entries.length)) * 93, currentFile: name }); } catch (_) {}
      }
      await tick();

      let data;
      if (isDir) {
        data = new Uint8Array(0);
      } else if (captured.has(name)) {
        const saved = captured.get(name);
        data = await toBytes(saved.data, saved.options);
      } else {
        state.fallbackReads++;
        console.warn(`[Pearson DirectZIP ${VERSION}] Falling back to ZipObject.async for ${name}`);
        data = await file.async('uint8array');
      }

      if (data.byteLength > 0xffffffff || offset > 0xffffffff) {
        throw new Error('Archive exceeds classic ZIP limits; ZIP64 is not implemented in the direct writer.');
      }

      const crc = isDir ? 0 : await crc32Async(data);
      const nameBytes = encoder.encode(name), dt = dosDateTime(file.date);
      const local = localHeader(nameBytes, crc, data.byteLength, dt), start = offset;
      chunks.push(local); offset += local.byteLength;
      if (data.byteLength) { chunks.push(data); offset += data.byteLength; }
      central.push(centralHeader(nameBytes, crc, data.byteLength, dt, start, isDir));
      completed++;

      if (typeof onUpdate === 'function') {
        try { onUpdate({ percent: 1 + (completed / Math.max(1, entries.length)) * 93, currentFile: name }); } catch (_) {}
      }
      if ((completed & 7) === 0) await tick();
    }

    const centralOffset = offset;
    let centralSize = 0;
    for (const c of central) { chunks.push(c); centralSize += c.byteLength; offset += c.byteLength; }
    chunks.push(endOfCentralDirectory(entries.length, centralSize, centralOffset));

    if (typeof onUpdate === 'function') {
      try { onUpdate({ percent: 100, currentFile: 'Finalizing archive' }); } catch (_) {}
    }
    state.currentFile = null;
    console.info(`[Pearson DirectZIP ${VERSION}] Complete: ${entries.length} entries, fallbackReads=${state.fallbackReads}.`);
    return new Blob(chunks, { type: options?.mimeType || 'application/zip' });
  }

  function patch(JSZip) {
    if (!JSZip?.prototype) return false;
    if (JSZip.prototype.__pearsonDirectZipPatched === VERSION) return true;

    const originalFile = JSZip.prototype.file;
    const originalGenerateAsync = JSZip.prototype.generateAsync;

    JSZip.prototype.file = function(name, data, options) {
      if (arguments.length >= 2 && data != null) remember(this, name, data, options);
      return originalFile.apply(this, arguments);
    };

    JSZip.prototype.generateAsync = function(options, onUpdate) {
      const opts = options || {};
      if ((opts.type || 'blob') === 'blob') {
        console.info(`[Pearson DirectZIP ${VERSION}] Using captured-payload STORE writer.`);
        return directStoreBlob(this, opts, onUpdate);
      }
      return originalGenerateAsync.call(this, options, onUpdate);
    };

    Object.defineProperty(JSZip.prototype, '__pearsonDirectZipPatched', { value: VERSION, configurable: true });
    state.patched = true;
    console.info(`[Pearson DirectZIP ${VERSION}] JSZip file/generate hooks patched.`);
    return true;
  }

  state.patch = patch;
  if (window.JSZip) patch(window.JSZip);

  const started = Date.now();
  const timer = setInterval(() => {
    if (window.JSZip && patch(window.JSZip)) clearInterval(timer);
    else if (Date.now() - started > 120000) clearInterval(timer);
  }, 100);
})();
