# Pearson+ eText Downloader

`pearson.js` is a browser-side downloader/exporter for the current Pearson+ Vega Reader flow. It is separate from the McGraw Hill `script.js` because Pearson does not expose the book using the same EPUB-container layout.

Use it only for books and resources you are authorized to access. The script does not read, print, save, or ask you to paste cookies, bearer tokens, passwords, or other authentication credentials.

## What the current Pearson Reader does

From the current Reader traffic, Pearson uses several pieces:

- A product/book UUID in URLs such as `/products/<book-id>/pages/...`.
- A `contenttoc` response that contains the book title, nested chapter/section structure, `playOrder`, and content URIs such as `narrative/<uuid>.html`.
- Same-origin Sanvan resources such as `/eps/sanvan/api/item/<item-id>/<version>/file/narrative/<uuid>.html`.
- Additional referenced images, stylesheets, fonts, JSON, media, and interactive resources.

Because `contenttoc` is cross-origin and authenticated, simply re-fetching its URL from DevTools can return CORS/401 errors. `pearson.js` therefore does **not** scrape or copy Pearson auth headers. Instead it tries to find the TOC in the already-running Reader state or captures a future successful `contenttoc` response made by Pearson itself.

## Files

- `pearson.js` — full Pearson+ downloader.
- `pearson-loader.js` — small public loader that always fetches the newest `pearson.js` from this repository.
- `PEARSON.md` — this guide.

## Recommended usage

1. Sign in to Pearson+ and open the actual eText Reader on `plus.pearson.com`.
2. Turn at least one page so a normal `eps/sanvan/.../file/narrative/...` request has occurred.
3. Open DevTools → Console.
4. Paste `pearson-loader.js` and run it.
5. If the downloader finds the full TOC in Pearson/React state, it will immediately show the export options.
6. If it says it is waiting for the TOC, leave the downloader open, open Pearson's table of contents, jump to another chapter, or return to the Pearson library and reopen the book **without a full browser refresh**, then click **Try again**.
7. If Pearson still does not expose the TOC to page state, use **Paste TOC JSON** and paste only the JSON response body from the `contenttoc` request. Do not paste request headers or tokens.
8. Choose EPUB or raw ZIP and start the download.

## One-line loader

```javascript
fetch('https://raw.githubusercontent.com/chaevsfe/mgh/main/pearson.js?t='+Date.now(),{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.text()}).then(s=>(0,eval)(s)).catch(console.error)
```

If the page blocks the loader with Content Security Policy, copy `pearson.js` itself into the Console.

## EPUB mode

Pearson's current Vega content is a collection of narrative HTML/JSON resources rather than a directly exposed EPUB package. EPUB mode therefore builds a new EPUB 3 package around the resources Pearson serves to the authenticated Reader session.

It:

- Sorts narrative pages using Pearson `playOrder`.
- Downloads the narrative HTML pages.
- Crawls referenced Pearson images, CSS, fonts, and other assets when enabled.
- Rewrites successfully downloaded resource links to local EPUB paths.
- Converts downloaded HTML documents to XHTML-style serialization.
- Creates `mimetype`, `META-INF/container.xml`, `OEBPS/content.opf`, and `OEBPS/nav.xhtml`.
- Creates an EPUB spine from the narrative pages.
- Adds `OEBPS/pearson-download-report.json` with failures and completeness counts.

JavaScript/interactive assets are disabled by default because many EPUB readers ignore scripts and complex embedded Pearson widgets may depend on web services that cannot be made fully offline. You can enable them from the downloader UI for experimentation.

## Raw ZIP mode

Raw ZIP mode is useful when you want to inspect exactly what the Pearson Reader exposed. It saves downloaded resources without adding the EPUB package files.

## TOC discovery

The downloader tries these routes in order:

1. A `contenttoc` response captured after the downloader is installed.
2. Pearson data already present in local/session storage.
3. Embedded JSON in the page.
4. Pearson/React Reader state reachable from the current same-origin page/frame.
5. Manual JSON response-body paste as a fallback.

The script intentionally does not implement a token/header sniffer.

## Network behavior

- Starts with up to six concurrent downloads.
- Retries transient failures.
- Honors `Retry-After` when present.
- Reduces concurrency after `429`/`503` responses and raises it again after stable batches.
- Rejects obvious `AccessDenied`/error documents returned in place of resources.
- Restricts recursive asset crawling to Pearson-owned hosts referenced by book content.
- Stops recursive crawling at a safety limit of 6,000 unique resource URLs.

## Final report

The UI reports:

- Narrative pages found in the Pearson TOC.
- Narrative pages successfully placed into the spine.
- Total downloaded resources.
- Total failed resources.
- Missing narrative pages.

The full report remains available while the UI is open at:

```javascript
window.__PEARSON_DOWNLOADER__.lastReport
```

## Current limitations

Pearson books are not all authored the same way. Some titles contain interactive widgets, externally hosted media, dynamically generated TTS, or resources whose servers do not permit browser `fetch()` from the Reader origin. Those resources can remain online-only even when the narrative text itself exports successfully.

The first thing to evaluate after each test is the final `Narrative pages: X/Y` count. `Y/Y` means the core ordered reading pages were all retrieved; failures among optional external widgets/media may still appear separately.

## Authorization and copyright

Use this only with material you are authorized to access. Do not use it to bypass account permissions, DRM/access controls, or to redistribute copyrighted textbook content.
