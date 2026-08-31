// Pearson+ Direct STORE ZIP writer v2026.08.31.4
// Loaded before pearson.js by the console loader/userscript.
// This bypasses JSZip's compression worker during final archive generation.
(() => {
  'use strict';

  const KEY = '__PEARSON_FASTZIP_PATCH__';
  const VERSION = '2026.08.31.4';
  if (window[KEY]?.version === VERSION) return;

  const state = window[KEY] = { version: VERSION, patched: false, patch: null };
  const encoder = new TextEncoder();
  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function dosDateTime(date) {
    const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
    const year = Math.min(2107, Math.max(1980, d.getFullYear()));
    const time = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((Math.floor(d.getSeconds() / 2)) & 31);
    const day = ((year - 1980) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
    return { time, date: day };
  }

  function u16(view, offset, value) { view.setUint16(offset, value & 0xffff, true); }
  function u32(view, offset, value) { view.setUint32(offset, value >>> 0, true); }

  function localHeader(nameBytes, crc, size, dt) {
    const out = new Uint8Array(30 + nameBytes.length);
    const v = new DataView(out.buffer);
    u32(v, 0, 0x04034b50);
    u16(v, 4, 20);
    u16(v, 6, 0x0800);
    u16(v, 8, 0);
    u16(v, 10, dt.time);
    u16(v, 12, dt.date);
    u32(v, 14, crc);
    u32(v, 18, size);
    u32(v, 22, size);
    u16(v, 26, nameBytes.length);
    u16(v, 28, 0);
    out.set(nameBytes, 30);
    return out;
  }

  function centralHeader(nameBytes, crc, size, dt, offset, isDir) {
    const out = new Uint8Array(46 + nameBytes.length);
    const v = new DataView(out.buffer);
    u32(v, 0, 0x02014b50);
    u16(v, 4, 0x0314);
    u16(v, 6, 20);
    u16(v, 8, 0x0800);
    u16(v, 10, 0);
    u16(v, 12, dt.time);
    u16(v, 14, dt.date);
    u32(v, 16, crc);
    u32(v, 20, size);
    u32(v, 24, size);
    u16(v, 28, nameBytes.length);
    u16(v, 30, 0);
    u16(v, 32, 0);
    u16(v, 34, 0);
    u16(v, 36, 0);
    u32(v, 38, isDir ? 0x10 : 0);
    u32(v, 42, offset);
    out.set(nameBytes, 46);
    return out;
  }

  function endOfCentralDirectory(count, centralSize, centralOffset) {
    const out = new Uint8Array(22);
    const v = new DataView(out.buffer);
    u32(v, 0, 0x06054b50);
    u16(v, 4, 0); u16(v, 6, 0);
    u16(v, 8, count); u16(v, 10, count);
    u32(v, 12, centralSize);
    u32(v, 16, centralOffset);
    u16(v, 20, 0);
    return out;
  }

  async function directStoreBlob(zip, options, onUpdate) {
    const entries = Object.values(zip.files || {});
    if (entries.length > 65535) throw new Error('Direct ZIP writer does not support more than 65,535 entries.');

    const chunks = [];
    const central = [];
    let offset = 0;
    let completed = 0;

    if (typeof onUpdate === 'function') {
      try { onUpdate({ percent: 0, currentFile: 'Preparing direct STORE archive' }); } catch (_) {}
    }

    for (const file of entries) {
      const name = String(file.name || '');
      const nameBytes = encoder.encode(name);
      const isDir = !!file.dir || name.endsWith('/');
      const data = isDir ? new Uint8Array(0) : await file.async('uint8array');
      if (data.byteLength > 0xffffffff || offset > 0xffffffff) {
        throw new Error('Archive exceeds classic ZIP limits; ZIP64 is not implemented in the direct writer.');
      }
      const crc = isDir ? 0 : crc32(data);
      const dt = dosDateTime(file.date);
      const local = localHeader(nameBytes, crc, data.byteLength, dt);
      const start = offset;
      chunks.push(local);
      offset += local.byteLength;
      if (data.byteLength) {
        chunks.push(data);
        offset += data.byteLength;
      }
      central.push(centralHeader(nameBytes, crc, data.byteLength, dt, start, isDir));
      completed++;
      if (typeof onUpdate === 'function') {
        try { onUpdate({ percent: (completed / entries.length) * 94, currentFile: name }); } catch (_) {}
      }
      if ((completed & 15) === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    }

    const centralOffset = offset;
    let centralSize = 0;
    for (const c of central) { chunks.push(c); centralSize += c.byteLength; offset += c.byteLength; }
    chunks.push(endOfCentralDirectory(entries.length, centralSize, centralOffset));

    if (typeof onUpdate === 'function') {
      try { onUpdate({ percent: 100, currentFile: 'Finalizing archive' }); } catch (_) {}
    }
    console.info(`[Pearson DirectZIP ${VERSION}] STORE-only archive complete: ${entries.length} entries.`);
    return new Blob(chunks, { type: options?.mimeType || 'application/zip' });
  }

  function patch(JSZip) {
    if (!JSZip?.prototype || JSZip.prototype.__pearsonDirectZipPatched) return false;
    const originalGenerateAsync = JSZip.prototype.generateAsync;

    JSZip.prototype.generateAsync = function(options, onUpdate) {
      const opts = options || {};
      if ((opts.type || 'blob') === 'blob') {
        console.info(`[Pearson DirectZIP ${VERSION}] Bypassing JSZip compression workers; writing STORE-only ZIP.`);
        return directStoreBlob(this, opts, onUpdate);
      }
      return originalGenerateAsync.call(this, options, onUpdate);
    };

    Object.defineProperty(JSZip.prototype, '__pearsonDirectZipPatched', {
      value: VERSION, configurable: true
    });
    state.patched = true;
    console.info(`[Pearson DirectZIP ${VERSION}] JSZip patched.`);
    return true;
  }

  state.patch = patch;
  if (window.JSZip) patch(window.JSZip);

  const started = Date.now();
  const timer = setInterval(() => {
    if (window.JSZip && patch(window.JSZip)) clearInterval(timer);
    else if (window.JSZip?.prototype?.__pearsonDirectZipPatched || Date.now() - started > 120000) clearInterval(timer);
  }, 100);
})();
