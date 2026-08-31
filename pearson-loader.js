/**
 * Pearson+ downloader loader
 * Run this on plus.pearson.com while the eText Reader is open.
 */
(async () => {
  const url = `https://raw.githubusercontent.com/chaevsfe/mgh/main/pearson.js?t=${Date.now()}`;
  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const source = await response.text();
    (0, eval)(`${source}\n//# sourceURL=pearson-downloader.js`);
  } catch (error) {
    console.error('[Pearson Downloader loader]', error);
    alert(`Pearson Downloader could not load pearson.js: ${error.message}\n\nOpen the GitHub repository and paste pearson.js directly into DevTools as a fallback.`);
  }
})();
