// ==UserScript==
// @name         Pearson+ eText Downloader (Media Bridge)
// @namespace    https://github.com/chaevsfe/mgh
// @version      2026.08.31.4
// @description  Launches the Pearson exporter, recovers public Pearson media across CORS, and uses a direct STORE-only ZIP writer.
// @match        https://plus.pearson.com/*
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @connect      raw.githubusercontent.com
// @connect      cite-media.pearson.com
// @connect      media.pearsoncmg.com
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js
// @require      https://raw.githubusercontent.com/chaevsfe/mgh/main/pearson-fastzip.js?v=2026.08.31.4
// ==/UserScript==

(() => {
  'use strict';

  const MAIN_URL = 'https://raw.githubusercontent.com/chaevsfe/mgh/main/pearson.js';
  const PAGE = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  let launching = false;
  let lastProductPath = '';

  try {
    if (typeof JSZip !== 'undefined' && !PAGE.JSZip) PAGE.JSZip = JSZip;
    PAGE.__PEARSON_FASTZIP_PATCH__?.patch?.(PAGE.JSZip);
  } catch (_) {}

  // Deliberately anonymous. No Pearson cookies, authorization header, or other
  // Reader credentials are sent to the cross-origin media hosts.
  PAGE.__PEARSON_MEDIA_FETCH__ = function(url) {
    const u = new URL(String(url), PAGE.location.href);
    if (!['cite-media.pearson.com', 'media.pearsoncmg.com'].includes(u.hostname.toLowerCase())) {
      return Promise.reject(new Error(`Media bridge does not allow host: ${u.hostname}`));
    }
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url: u.href,
        responseType: 'arraybuffer',
        anonymous: true,
        timeout: 45000,
        onload: (r) => resolve({ status: r.status, responseHeaders: r.responseHeaders || '', bytes: r.response }),
        onerror: () => reject(new Error(`Network error fetching ${u.href}`)),
        ontimeout: () => reject(new Error(`Timed out fetching ${u.href}`)),
        onabort: () => reject(new Error(`Aborted fetching ${u.href}`))
      });
    });
  };

  function gmText(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET', url, responseType: 'text', anonymous: true, timeout: 30000,
        onload: (r) => r.status >= 200 && r.status < 300 ? resolve(r.responseText) : reject(new Error(`HTTP ${r.status} loading pearson.js`)),
        onerror: () => reject(new Error('Network error loading pearson.js')),
        ontimeout: () => reject(new Error('Timed out loading pearson.js'))
      });
    });
  }

  async function launch(force = false) {
    if (launching) return;
    const productPath = PAGE.location.pathname.match(/\/products\/[^/]+/)?.[0] || '';
    if (!force && !productPath) return;
    if (!force && productPath && productPath === lastProductPath && PAGE.__PEARSON_DOWNLOADER__) return;
    launching = true;
    try {
      try { PAGE.__PEARSON_FASTZIP_PATCH__?.patch?.(PAGE.JSZip); } catch (_) {}
      const source = await gmText(`${MAIN_URL}?t=${Date.now()}`);
      PAGE.eval(`${source}\n//# sourceURL=pearson-downloader.js`);
      lastProductPath = productPath;
    } catch (e) {
      console.error('[Pearson Media Userscript]', e);
      alert(`Pearson Downloader could not start: ${e.message}`);
    } finally {
      launching = false;
    }
  }

  try { GM_registerMenuCommand('Launch Pearson Downloader', () => launch(true)); } catch (_) {}

  // Pearson+ is an SPA, so detect navigation into another book without relying
  // on a full browser refresh.
  setInterval(() => {
    const productPath = PAGE.location.pathname.match(/\/products\/[^/]+/)?.[0] || '';
    if (productPath && productPath !== lastProductPath && !PAGE.__PEARSON_DOWNLOADER__) launch(false);
  }, 1200);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => launch(false), { once: true });
  } else {
    launch(false);
  }
})();
