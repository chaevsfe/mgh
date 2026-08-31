# Pearson+ eText Downloader

`pearson.js` is the Pearson+ Vega Reader exporter. Current version: **v2026.08.31.2**.

Use it only with books and resources you are authorized to access. The downloader does not read, print, save, or ask for Pearson cookies, bearer tokens, passwords, or request authorization headers.

## Files

- `pearson.js` — main Pearson exporter.
- `pearson-loader.js` — small console loader for the main script.
- `pearson-media.user.js` — optional Tampermonkey/Violentmonkey version with an anonymous cross-origin media bridge for public Pearson image hosts.
- `PEARSON.md` — this guide.

## Why Pearson is different from McGraw Hill

Pearson's current Vega Reader exposes the book as a nested `contenttoc` structure plus individual Sanvan narrative resources such as:

```text
/eps/sanvan/api/item/<item-id>/<version>/file/narrative/<uuid>.html
```

It does not expose the same ready-made EPUB `container.xml`/OPF package used by the McGraw Hill script. EPUB mode therefore constructs an EPUB 3 package from Pearson's ordered narrative pages and the resources those pages reference.

## Recommended: media userscript

For the most complete EPUB, install `pearson-media.user.js` in Tampermonkey or Violentmonkey and open the Pearson+ book normally.

The userscript:

- Preloads JSZip so Pearson Content Security Policy cannot block it.
- Launches the current `pearson.js` automatically when a `/products/...` Reader route opens.
- Watches Pearson's SPA navigation so moving from the library into a book can launch without a full refresh.
- Adds an anonymous media bridge for `cite-media.pearson.com` and `media.pearsoncmg.com`.
- Sends **no Pearson cookies or authorization credentials** through that bridge. It is only intended to retrieve public media whose bytes are hidden from ordinary page JavaScript by browser CORS rules.
- Also exposes a userscript menu command named **Launch Pearson Downloader**.

If you do not want a userscript, use `pearson-loader.js` in DevTools instead. The console version still exports all narrative pages it can access; media blocked by CORS remains as its original remote HTTPS reference rather than being rewritten to a broken local file.

## TOC step

Pearson usually requests `/api/contenttoc/v1/assets` before a console-loaded script can observe the response body. If the downloader says it is waiting for the TOC:

1. Open DevTools → Network.
2. Filter for `contenttoc`.
3. Select `/api/contenttoc/v1/assets` — **not** the `page-mapping` request.
4. Open **Response** and copy the entire JSON body.
5. Click **Use copied TOC JSON** in the downloader.

The same screen also has **Paste TOC JSON** as a fallback. Only the JSON response body is needed; never paste request headers or tokens.

## EPUB v2 improvements

The v2 exporter was hardened against issues found in the first Consumer Behavior test EPUB:

- Keeps remote URLs untouched when an asset download fails. It no longer rewrites failed images to nonexistent local EPUB paths.
- Adds `media.pearsoncmg.com` to Pearson-owned asset crawling.
- Removes XML-invalid control characters from narrative XHTML.
- Standard EPUB mode strips web `<script>` elements, iframes, objects, embeds, refresh metadata, preconnect/prefetch hints, and inline event-handler attributes.
- JavaScript/interactive asset crawling is now only meaningful for **Raw ZIP** mode; EPUB mode is intentionally cleaned for ordinary readers.
- Builds `nav.xhtml` from Pearson's original nested chapter/module/section hierarchy instead of a flat 304-item list.
- Detects a successfully downloaded cover image and marks it with the EPUB 3 `cover-image` manifest property.
- Marks XHTML items that still contain HTTPS resources with the EPUB `remote-resources` property.
- Verifies the generated EPUB begins with an uncompressed `mimetype` entry containing `application/epub+zip`.
- Reports media-bridge downloads, remote resources left online, removed scripts/embeds, stripped XML control characters, and cover-image recovery.

## Output modes

### EPUB

EPUB mode creates:

```text
mimetype
META-INF/container.xml
OEBPS/content.opf
OEBPS/nav.xhtml
OEBPS/source/...
OEBPS/external/...
OEBPS/pearson-download-report.json
```

Narrative pages are sorted by Pearson `playOrder` and used to build the spine. The original nested TOC is used for navigation.

### Raw ZIP

Raw ZIP is for debugging or preserving more web-oriented source material. It does not add EPUB package files. If **Include JavaScript/interactive assets** is enabled, the crawler may retain resources that a normal EPUB reader would ignore.

## Final report

The completion screen and `pearson-download-report.json` include:

- Narrative pages found and successfully placed in the spine.
- Downloaded and failed resources.
- Media-bridge download count.
- Remote HTTPS resources still referenced by the exported pages.
- XML-invalid control characters removed.
- Web scripts and interactive embeds stripped from EPUB pages.
- Cover image path when recovered.
- EPUB mimetype/container-header validation.

The report is also available while the UI is open at:

```javascript
window.__PEARSON_DOWNLOADER__.lastReport
```

## Notes on remote media

Without `pearson-media.user.js`, some Pearson image servers may let the browser display an image while refusing a page-level `fetch()` because of CORS. v2 treats those as **remote resources**, not missing local resources. The EPUB may therefore need internet access for those images.

With the userscript bridge, the exporter attempts to package public images from the two known Pearson media hosts locally. If a media server itself returns an authorization or error response, the exporter still rejects it and leaves the original reference remote instead of pretending the response is a valid image.

## Authorization and copyright

Use this only with material you are authorized to access. Do not use it to bypass Pearson account permissions, DRM/access controls, or to redistribute copyrighted textbook content.
