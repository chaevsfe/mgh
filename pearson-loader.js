/**
 * Pearson+ downloader loader
 * Run this on plus.pearson.com while the eText Reader is open.
 */
(async () => {
  const url = `https://raw.githubusercontent.com/chaevsfe/mgh/main/pearson.js?t=${Date.now()}`;

  function enhanceWaitingScreen() {
    const app = window.__PEARSON_DOWNLOADER__;
    const root = app?.root;
    if (!root || !/Waiting for Pearson table of contents/i.test(root.textContent || '')) return;
    if (root.querySelector('[data-pearson-clipboard-toc]')) return;

    const buttons = [...root.querySelectorAll('button')];
    const tryAgain = buttons.find((b) => /^Try again$/i.test((b.textContent || '').trim()));
    const pasteButton = buttons.find((b) => /^Paste TOC JSON$/i.test((b.textContent || '').trim()));
    if (!tryAgain || !pasteButton) return;

    const clipboardButton = document.createElement('button');
    clipboardButton.type = 'button';
    clipboardButton.dataset.pearsonClipboardToc = '1';
    clipboardButton.textContent = 'Use copied TOC JSON';
    Object.assign(clipboardButton.style, {
      padding: '9px 14px',
      borderRadius: '7px',
      border: '1px solid #cbd0d8',
      background: '#fff',
      color: '#17191d',
      fontWeight: '650',
      cursor: 'pointer'
    });

    clipboardButton.addEventListener('click', async () => {
      const originalText = clipboardButton.textContent;
      try {
        if (!navigator.clipboard?.readText) throw new Error('Clipboard reading is not available in this browser context.');
        clipboardButton.disabled = true;
        clipboardButton.textContent = 'Reading clipboard…';

        const text = await navigator.clipboard.readText();
        const data = JSON.parse(text.trim());
        const id = String(data?.bookId || data?.productId || data?.id || '');
        const pageUrl = String(location.href);
        const pageId = pageUrl.match(/\/products\/([^/?#]+)/i)?.[1] || '';

        if (!data || typeof data !== 'object' || !Array.isArray(data.children) || !data.children.length) {
          throw new Error('Clipboard JSON does not look like a Pearson contenttoc response.');
        }
        if (pageId && id && pageId !== id) {
          throw new Error(`Clipboard TOC is for a different Pearson book (${id}).`);
        }

        let narrativeCount = 0;
        const stack = [...data.children];
        while (stack.length) {
          const node = stack.pop();
          if (!node || typeof node !== 'object') continue;
          if (typeof node.uri === 'string' && /(?:^|\/)narrative\/.+\.html(?:$|[?#])/i.test(node.uri)) narrativeCount++;
          if (Array.isArray(node.children)) stack.push(...node.children);
        }
        if (!narrativeCount) throw new Error('Clipboard TOC contains no Pearson narrative pages.');

        app.capturedToc = data;
        app.capturedTocSource = `clipboard (${narrativeCount} narrative pages)`;
        console.info(`[Pearson Downloader] Imported TOC from clipboard: ${narrativeCount} narrative pages.`);
        tryAgain.click();
      } catch (error) {
        console.error('[Pearson Downloader] Clipboard TOC import failed:', error);
        alert(`Could not use the copied Pearson TOC JSON: ${error.message}\n\nUse “Paste TOC JSON” and paste the response manually instead.`);
        clipboardButton.disabled = false;
        clipboardButton.textContent = originalText;
      }
    });

    pasteButton.insertAdjacentElement('afterend', clipboardButton);

    const note = document.createElement('p');
    note.textContent = 'If you already copied the JSON response from Pearson’s /api/contenttoc/v1/assets request, click “Use copied TOC JSON”. No auth headers or tokens are needed.';
    note.style.color = '#667085';
    note.style.marginBottom = '0';
    pasteButton.parentElement?.parentElement?.append(note);
  }

  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const source = await response.text();
    const result = (0, eval)(`${source}\n//# sourceURL=pearson-downloader.js`);
    if (result && typeof result.then === 'function') await result;
    enhanceWaitingScreen();
  } catch (error) {
    console.error('[Pearson Downloader loader]', error);
    alert(`Pearson Downloader could not load pearson.js: ${error.message}\n\nOpen the GitHub repository and paste pearson.js directly into DevTools as a fallback.`);
  }
})();
