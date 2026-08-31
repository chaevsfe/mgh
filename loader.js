/**
 * Loader for the McGraw Hill downloader.
 * Run this on the Reader page with the book open.
 */
(async () => {
  const url = `https://raw.githubusercontent.com/chaevsfe/mgh/main/script.js?t=${Date.now()}`;
  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const source = await response.text();
    // Indirect eval runs the downloaded script in the page's global scope.
    (0, eval)(`${source}\n//# sourceURL=mgh-downloader-script.js`);
  } catch (error) {
    console.error('[MGH Downloader loader]', error);
    alert(`MGH Downloader could not load script.js: ${error.message}\n\nYou can still open the GitHub repository and paste script.js directly into DevTools.`);
  }
})();
