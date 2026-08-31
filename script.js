/**
 * script.js
 *
 * Interactive downloader for McGraw-Hill textbooks.
 * Based on the gist by jimmckeeth, forked from 101arrowz.
 *
 * 2026 update:
 * - Uses the current Reader LTI endpoint.
 * - Adds clearer initialization/API errors.
 *
 * Features:
 * - Intelligent absolute URL resolution.
 * - Multi-panel UI for categorized logging.
 * - Automatic retry mechanism + a final retry pass.
 * - User selection for download format (EPUB or ZIP).
 * - Enhanced error logging for troubleshooting transfer issues.
 */
(async function () {
  'use strict';

  const LTI_URL = 'https://prod.reader.prod.mheducation.com/v1/lti';

  const overlay = createUiOverlay();

  function createUiOverlay() {
    const overlayElement = document.createElement('div');
    Object.assign(overlayElement.style, {
      background: 'white', color: 'black', position: 'fixed', width: '100vw', height: '100vh',
      top: '0', left: '0', zIndex: '1000000', overflow: 'hidden', padding: '20px',
      fontFamily: 'sans-serif', fontSize: '16px', boxSizing: 'border-box', display: 'flex',
      flexDirection: 'column'
    });
    document.body.appendChild(overlayElement);
    return overlayElement;
  }

  function createLogPanel(title, borderColor) {
    const panel = document.createElement('div');
    panel.style.flex = '1';
    panel.style.display = 'flex';
    panel.style.flexDirection = 'column';
    panel.style.minHeight = '0';

    const header = document.createElement('h4');
    header.textContent = title;
    header.style.margin = '5px 0';

    const logArea = document.createElement('div');
    Object.assign(logArea.style, {
      border: `1px solid ${borderColor}`, borderRadius: '5px', padding: '10px', overflowY: 'auto',
      fontFamily: 'monospace', fontSize: '12px', flex: '1', lineHeight: '1.4'
    });

    panel.appendChild(header);
    panel.appendChild(logArea);
    return { panel, logArea };
  }

  function buildLoggingUI() {
    overlay.innerHTML = '';
    overlay.style.padding = '10px';

    const title = document.createElement('h2');
    title.textContent = 'Download Progress';
    title.style.margin = '0 0 10px 0';
    overlay.appendChild(title);

    const panelsContainer = document.createElement('div');
    panelsContainer.style.display = 'flex';
    panelsContainer.style.gap = '10px';
    panelsContainer.style.flex = '1';
    panelsContainer.style.minHeight = '0';
    overlay.appendChild(panelsContainer);

    const successPanel = createLogPanel('Success', 'green');
    const skippedPanel = createLogPanel('Skipped', 'orange');
    const failuresPanel = createLogPanel('Failures', 'red');
    panelsContainer.appendChild(successPanel.panel);
    panelsContainer.appendChild(skippedPanel.panel);
    panelsContainer.appendChild(failuresPanel.panel);

    const overallStatus = document.createElement('div');
    overallStatus.style.fontFamily = 'monospace';
    overallStatus.style.marginTop = '10px';
    overlay.appendChild(overallStatus);

    return { success: successPanel.logArea, skipped: skippedPanel.logArea, failures: failuresPanel.logArea, status: overallStatus };
  }

  const logToPanel = (logArea, message, isHtml = false) => {
    const entry = document.createElement('div');
    if (isHtml) entry.innerHTML = message;
    else entry.textContent = message;
    logArea.appendChild(entry);
    logArea.scrollTop = logArea.scrollHeight;
  };

  function loadScript(url) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = url;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Failed to load script: ${url}`));
      document.head.appendChild(script);
    });
  }

  async function fetchWithRetries(url, options, retries = 3, delay = 1000) {
    for (let i = 0; i < retries; i++) {
      try {
        const response = await fetch(url, options);
        if (!response.ok && response.status < 500) return response;
        if (!response.ok) throw new Error(`Server error: HTTP status ${response.status}`);
        return response;
      } catch (error) {
        if (i === retries - 1) throw error;
        await new Promise((resolve) => setTimeout(resolve, delay * (i + 1)));
      }
    }
    throw new Error(`Failed to fetch ${url}`);
  }

  function buildSelectionUI(manifestItems, onStart) {
    overlay.innerHTML = '';
    const fileExtensions = [...new Set(manifestItems.map((item) =>
      (item.getAttribute('href') || '').split('.').pop().toLowerCase()
    ))].filter(Boolean).sort();

    const uiContainer = document.createElement('div');
    uiContainer.innerHTML = '<h2 style="margin-top:0;">Textbook Downloader</h2><p>Select the file types and final format for your download.</p>';

    const checkboxContainer = document.createElement('div');
    Object.assign(checkboxContainer.style, {
      display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '10px',
      marginBottom: '20px', padding: '10px', border: '1px solid #ccc', borderRadius: '5px'
    });
    checkboxContainer.innerHTML = '<h3 style="margin: 0 0 10px 0; grid-column: 1 / -1;">1. Select File Types to Include</h3>';
    fileExtensions.forEach((ext) => {
      checkboxContainer.innerHTML += `<div><input type="checkbox" id="ext-${ext}" value="${ext}" checked><label for="ext-${ext}" style="margin-left:5px">.${ext}</label></div>`;
    });

    const formatContainer = document.createElement('div');
    formatContainer.style.marginTop = '20px';
    formatContainer.innerHTML = `
      <h3 style="margin: 0 0 10px 0;">2. Select Download Format</h3>
      <div><input type="radio" id="format-epub" name="download-format" value="epub" checked>
      <label for="format-epub"><b>EPUB</b> (.epub) - Best for e-readers.</label></div>
      <div style="margin-top: 5px;"><input type="radio" id="format-zip" name="download-format" value="zip">
      <label for="format-zip"><b>ZIP</b> (.zip) - A standard archive of all raw files.</label></div>`;

    const startButton = document.createElement('button');
    startButton.textContent = 'Start Download';
    startButton.style.cssText = 'padding:10px 20px; font-size:16px; cursor:pointer; border:none; border-radius:5px; background:#007bff; color:white; margin-top:20px;';

    uiContainer.appendChild(checkboxContainer);
    uiContainer.appendChild(formatContainer);
    uiContainer.appendChild(startButton);
    overlay.appendChild(uiContainer);

    startButton.addEventListener('click', () => {
      const selectedExtensions = new Set(Array.from(checkboxContainer.querySelectorAll('input:checked')).map((cb) => cb.value));
      const selectedFormat = uiContainer.querySelector('input[name="download-format"]:checked').value;
      onStart(selectedExtensions, selectedFormat);
    });
  }

  async function executeDownload(manifestItems, selectedExtensions, epubBaseUrl, contentDoc, downloadFormat) {
    const logAreas = buildLoggingUI();
    const zip = new JSZip();
    const failedDownloads = [];
    const contentOpfUrl = `${epubBaseUrl}OPS/content.opf`;

    const containerResponse = await fetch(`${epubBaseUrl}META-INF/container.xml`, { credentials: 'include' });
    if (!containerResponse.ok) throw new Error(`Could not fetch META-INF/container.xml: HTTP ${containerResponse.status}`);
    zip.folder('META-INF').file('container.xml', await containerResponse.text());
    zip.folder('OPS').file('content.opf', new XMLSerializer().serializeToString(contentDoc));

    const totalFiles = manifestItems.length;
    logAreas.status.textContent = 'Starting initial download pass...';

    for (let i = 0; i < totalFiles; i++) {
      const item = manifestItems[i];
      const href = item.getAttribute('href');
      if (!href) continue;
      const extension = (href.split('.').pop() || '').toLowerCase();
      const progress = `(${i + 1} of ${totalFiles})`;

      if (!selectedExtensions.has(extension)) {
        logToPanel(logAreas.skipped, `${href} ${progress}`);
        continue;
      }

      const fileUrl = new URL(href, contentOpfUrl);
      try {
        const fileResponse = await fetchWithRetries(fileUrl.href, { credentials: 'include' });
        if (!fileResponse.ok) throw new Error(`Download failed with HTTP status: ${fileResponse.status}`);
        zip.file(`OPS/${href}`, await fileResponse.arrayBuffer());
        logToPanel(logAreas.success, `Downloaded: ${href} ${progress}`);
      } catch (error) {
        failedDownloads.push({ href, fileUrl, progress });
        let errorMessage = error.message;
        if (error.message.includes('Failed to fetch')) {
          errorMessage += ' <br><i style="padding-left:10px; color:#555;">(Hint: This may be a CORS error. Check the Developer Console (F12) Network tab for details.)</i>';
        }
        logToPanel(logAreas.failures, `<div><strong>FAIL:</strong> ${href} ${progress}</div><div style="padding-left: 10px;"><strong>URL:</strong> <a href="${fileUrl.href}" target="_blank">${fileUrl.href}</a></div><div style="padding-left: 10px;"><strong>Error:</strong> ${errorMessage}</div>`, true);
      }
    }

    if (failedDownloads.length > 0) {
      logAreas.status.textContent = `Initial pass complete. Retrying ${failedDownloads.length} failed downloads...`;
      logToPanel(logAreas.failures, '--- STARTING FINAL RETRY PASS ---');
      for (const { href, fileUrl, progress } of failedDownloads) {
        try {
          const fileResponse = await fetch(fileUrl.href, { credentials: 'include' });
          if (!fileResponse.ok) throw new Error(`Retry failed with HTTP status: ${fileResponse.status}`);
          zip.file(`OPS/${href}`, await fileResponse.arrayBuffer());
          logToPanel(logAreas.success, `✅ RETRY SUCCESS: ${href} ${progress}`);
          logToPanel(logAreas.failures, `✅ Resolved: ${href}`);
        } catch (error) {
          logToPanel(logAreas.failures, `<div><strong>❌ FINAL FAIL:</strong> ${href} ${progress}</div><div style="padding-left: 10px;"><strong>Final Error:</strong> ${error.message}</div>`, true);
        }
      }
    }

    logAreas.status.textContent = 'All files processed. Compressing into archive...';
    const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'STORE' }, (metadata) => {
      logAreas.status.textContent = `Compressing... ${Math.floor(metadata.percent)}%`;
    });

    const blobUrl = URL.createObjectURL(zipBlob);
    const downloadLink = document.createElement('a');
    const titleElement = contentDoc.querySelector('metadata title');
    const safeTitle = (titleElement ? titleElement.textContent : 'textbook').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'textbook';
    const fileName = `${safeTitle}.${downloadFormat}`;
    downloadLink.href = blobUrl;
    downloadLink.download = fileName;
    downloadLink.click();
    URL.revokeObjectURL(blobUrl);
    logAreas.status.textContent = `Download of "${fileName}" has started! You can now refresh the page.`;
  }

  async function initialize() {
    try {
      overlay.innerHTML = 'Initializing downloader...';
      const ltiResponse = await fetch(LTI_URL, { credentials: 'include' });
      if (!ltiResponse.ok) throw new Error(`LTI API failed: HTTP ${ltiResponse.status} ${ltiResponse.statusText || ''}`.trim());

      let ltiData;
      try { ltiData = await ltiResponse.json(); }
      catch (error) { throw new Error(`LTI API returned invalid JSON: ${error.message}`); }

      const epubBaseUrl = ltiData.custom_epub_url;
      if (!epubBaseUrl) {
        console.error('Unexpected LTI API response:', ltiData);
        throw new Error('LTI response did not contain custom_epub_url.');
      }

      const contentResponse = await fetch(`${epubBaseUrl}OPS/content.opf`, { credentials: 'include' });
      if (!contentResponse.ok) throw new Error(`Could not fetch content.opf: HTTP ${contentResponse.status}`);
      const contentDoc = new DOMParser().parseFromString(await contentResponse.text(), 'application/xml');
      if (contentDoc.querySelector('parsererror')) throw new Error('Could not parse content.opf as XML.');

      const manifestItems = Array.from(contentDoc.querySelectorAll('manifest item'));
      if (manifestItems.length === 0) throw new Error('No manifest items were found in content.opf.');

      buildSelectionUI(manifestItems, (selectedExtensions, selectedFormat) => {
        executeDownload(manifestItems, selectedExtensions, epubBaseUrl, contentDoc, selectedFormat).catch((error) => {
          overlay.innerHTML = '';
          logToPanel(overlay, `A critical download error occurred: ${error.message}`);
        });
      });
    } catch (error) {
      overlay.innerHTML = '';
      logToPanel(overlay, `A critical initialization error occurred: ${error.message}`);
      logToPanel(overlay, 'Please try refreshing the page and running the script again.');
    }
  }

  try {
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.1.5/jszip.min.js');
    await initialize();
  } catch (error) {
    alert(`Fatal Error: Could not load the JSZip library. Error: ${error.message}`);
  }
})();
