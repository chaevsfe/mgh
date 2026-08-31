// Pearson+ Fast ZIP policy v2026.08.31.3
// Loaded before pearson.js by the console loader/userscript.
// It keeps already-compressed/big binary resources uncompressed in the ZIP and
// uses light DEFLATE only where it is useful.
(() => {
  'use strict';

  const KEY = '__PEARSON_FASTZIP_PATCH__';
  const VERSION = '2026.08.31.3';
  const STORE_EXTENSIONS = new Set([
    'jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'heic', 'heif',
    'woff', 'woff2', 'ttf', 'otf',
    'mp3', 'm4a', 'aac', 'ogg', 'opus', 'wav',
    'mp4', 'm4v', 'webm', 'mov',
    'pdf', 'zip', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar'
  ]);
  const TEXT_EXTENSIONS = new Set([
    'html', 'htm', 'xhtml', 'css', 'js', 'mjs', 'json', 'xml', 'opf', 'ncx',
    'svg', 'txt', 'md', 'csv', 'vtt', 'smil'
  ]);

  if (window[KEY]?.version === VERSION) return;

  const state = window[KEY] = {
    version: VERSION,
    patched: false,
    stats: { storeFiles: 0, deflateFiles: 0 },
    patch: null
  };

  function extension(name) {
    const clean = String(name || '').split(/[?#]/)[0];
    const leaf = clean.slice(clean.lastIndexOf('/') + 1);
    const i = leaf.lastIndexOf('.');
    return i >= 0 ? leaf.slice(i + 1).toLowerCase() : '';
  }

  function byteLength(data) {
    if (typeof data === 'string') return data.length;
    if (data instanceof ArrayBuffer) return data.byteLength;
    if (ArrayBuffer.isView(data)) return data.byteLength;
    if (typeof Blob !== 'undefined' && data instanceof Blob) return data.size;
    return 0;
  }

  function chooseCompression(name, data) {
    const ext = extension(name);
    if (STORE_EXTENSIONS.has(ext)) return 'STORE';
    if (TEXT_EXTENSIONS.has(ext) || typeof data === 'string') return 'DEFLATE';

    // Large unknown binary files are much safer to store as-is. Recompressing
    // them in JavaScript can consume a lot of CPU and transient memory.
    if (byteLength(data) >= 512 * 1024) return 'STORE';
    return 'DEFLATE';
  }

  function patch(JSZip) {
    if (!JSZip?.prototype || JSZip.prototype.__pearsonFastZipPatched) return false;

    const originalFile = JSZip.prototype.file;
    const originalGenerateAsync = JSZip.prototype.generateAsync;

    JSZip.prototype.file = function(name, data, options) {
      // Getter form: zip.file(name)
      if (arguments.length < 2 || data == null) return originalFile.apply(this, arguments);

      const opts = { ...(options || {}) };
      if (!opts.compression) {
        opts.compression = chooseCompression(name, data);
        if (opts.compression === 'DEFLATE') {
          opts.compressionOptions = { ...(opts.compressionOptions || {}), level: 3 };
          state.stats.deflateFiles++;
        } else {
          delete opts.compressionOptions;
          state.stats.storeFiles++;
        }
      }
      return originalFile.call(this, name, data, opts);
    };

    JSZip.prototype.generateAsync = function(options, onUpdate) {
      const opts = { ...(options || {}), streamFiles: true };
      if (opts.compression === 'DEFLATE') {
        opts.compressionOptions = { ...(opts.compressionOptions || {}), level: 3 };
      }

      // pearson.js uses this callback for its visible build percentage. Send an
      // immediate update so the UI does not sit on a bare “Building archive…”.
      if (typeof onUpdate === 'function') {
        try { onUpdate({ percent: 0, currentFile: 'Preparing ZIP' }); } catch (_) {}
      }

      console.info(
        `[Pearson FastZIP ${VERSION}] Building with light compression. ` +
        `STORE=${state.stats.storeFiles}, DEFLATE=${state.stats.deflateFiles}`
      );
      return originalGenerateAsync.call(this, opts, onUpdate);
    };

    Object.defineProperty(JSZip.prototype, '__pearsonFastZipPatched', {
      value: VERSION, configurable: true
    });
    state.patched = true;
    console.info(`[Pearson FastZIP ${VERSION}] JSZip patched.`);
    return true;
  }

  state.patch = patch;
  if (window.JSZip) patch(window.JSZip);

  // The console loader runs this helper before pearson.js. pearson.js may load
  // JSZip a little later, so watch briefly and patch as soon as it appears.
  const started = Date.now();
  const timer = setInterval(() => {
    if (window.JSZip && patch(window.JSZip)) clearInterval(timer);
    else if (window.JSZip?.prototype?.__pearsonFastZipPatched || Date.now() - started > 120000) clearInterval(timer);
  }, 100);
})();
