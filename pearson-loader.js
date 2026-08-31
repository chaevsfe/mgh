/**
 * Loader for the Pearson+ downloader.
 * Run this on plus.pearson.com with the book open.
 * Use pearson-media.user.js instead if you want the blocked images.
 */
(async () => {
  const base = 'https://raw.githubusercontent.com/chaevsfe/mgh/main/';
  const stamp = Date.now();

  async function loadText(path) {
    const response = await fetch(`${base}${path}?t=${stamp}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status} loading ${path}`);
    return response.text();
  }

  try {
    // Install the ZIP policy first. It polls briefly for JSZip, so it also works
    // when pearson.js has to load JSZip after the downloader starts.
    const fastZip = await loadText('pearson-fastzip.js');
    (0, eval)(`${fastZip}\n//# sourceURL=pearson-fastzip.js`);

    const source = await loadText('pearson.js');
    (0, eval)(`${source}\n//# sourceURL=pearson-downloader.js`);
  } catch (error) {
    console.error('[Pearson Downloader loader]', error);
    alert(`Pearson Downloader could not start: ${error.message}\n\nOpen the GitHub repository and paste pearson.js directly into DevTools, or use pearson-media.user.js with Tampermonkey/Violentmonkey.`);
  }
})();
