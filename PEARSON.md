# Pearson+ eText Downloader

The recommended Pearson+ exporter stack is **v2026.08.31.6**:

- `pearson.js` — Pearson Vega/Sanvan content discovery, cleanup, crawling, and EPUB construction.
- `pearson-fastzip.js` — final EPUB metadata correction plus the direct STORE-only ZIP writer.
- `pearson-loader.js` — console loader that loads the finalizer before `pearson.js`.
- `pearson-media.user.js` — recommended Tampermonkey/Violentmonkey launcher with anonymous public-media recovery.

Use it only with books and resources you are authorized to access. The downloader does not read, print, save, or ask for Pearson cookies, bearer tokens, passwords, or request authorization headers.

## Status

This implementation is considered stable for the Pearson+ Vega Reader / Sanvan flow tested here. The final Consumer Behavior validation reached the full ordered reading set, local media packaging, valid XHTML, valid OPF/spine references, recovered cover art, and a clean STORE-only EPUB archive.

Different Pearson titles can still contain author-specific interactive widgets or other content models, so a new title may expose an edge case even when the core Reader architecture is the same.

## Why Pearson is different from McGraw Hill

Pearson's current Vega Reader exposes the book as a nested `contenttoc` structure plus individual Sanvan resources such as:

```text
/eps/sanvan/api/item/<item-id>/<version>/file/narrative/<uuid>.html
```

It does not expose the same ready-made EPUB `container.xml`/OPF package used by the McGraw Hill flow. EPUB mode therefore constructs an EPUB 3 package from Pearson's ordered narrative pages and the resources those pages reference.

## Recommended: media userscript

Install `pearson-media.user.js` in Tampermonkey or Violentmonkey and open the Pearson+ book normally.

The userscript:

- Preloads JSZip so Pearson Content Security Policy cannot block it.
- Loads `pearson-fastzip.js` before the main exporter.
- Launches the current `pearson.js` automatically on `/products/...` Reader routes.
- Watches Pearson's SPA navigation so moving from the library into a book can launch without a full refresh.
- Adds an anonymous media bridge for `cite-media.pearson.com` and `media.pearsoncmg.com`.
- Sends **no Pearson cookies or authorization credentials** through that bridge. It is only intended to retrieve public media whose bytes are hidden from ordinary page JavaScript by browser CORS rules.
- Exposes a userscript menu command named **Launch Pearson Downloader**.

If you do not want a userscript, use `pearson-loader.js` in DevTools instead. The console version still exports all narrative pages it can access; media blocked by CORS remains at its original HTTPS URL instead of being rewritten to a broken local path.

## TOC step

Pearson often requests `/api/contenttoc/v1/assets` before a console-loaded script can observe the response body. If the downloader says it is waiting for the TOC:

1. Open DevTools → Network.
2. Filter for `contenttoc`.
3. Select `/api/contenttoc/v1/assets` — **not** the `page-mapping` request.
4. Open **Response** and copy the entire JSON body.
5. Click **Use copied TOC JSON** in the downloader.

The same screen also has **Paste TOC JSON** as a fallback. Only the JSON response body is needed; never paste request headers or tokens.

## EPUB behavior

EPUB mode:

- Sorts narrative pages by Pearson `playOrder`.
- Builds a hierarchical `nav.xhtml` from the original Pearson chapter/module/section tree.
- Downloads referenced images, CSS, fonts, JSON, and other supported Pearson resources.
- Uses the optional userscript media bridge for public Pearson image hosts that browser CORS prevents page JavaScript from reading directly.
- Rewrites a reference to a local EPUB path only after that resource was downloaded successfully.
- Removes XML-invalid control characters from narrative XHTML.
- Strips Pearson/web `<script>` elements, iframes, objects, embeds, refresh metadata, preconnect/prefetch hints, and inline event handlers from normal EPUB pages.
- Detects and marks a recovered cover image with the EPUB 3 `cover-image` manifest property.
- Uses `remote-resources` only when an XHTML content document actually embeds a remote HTTP(S) resource.
- Does **not** mark a page `remote-resources` merely because it contains a normal external `<a href="https://...">` hyperlink.
- Keeps ordinary external hyperlinks intact and reports them separately from embedded remote resources.
- Verifies the generated EPUB starts with an uncompressed `mimetype` entry containing `application/epub+zip`.

## Direct STORE ZIP writer

Large Pearson books can contain hundreds of already-compressed images. Recompressing those files in browser JavaScript caused JSZip generation to stall on large exports.

`pearson-fastzip.js` therefore captures each original `zip.file(...)` payload and writes a classic STORE-only ZIP directly. It does not ask JSZip workers to recompress or re-materialize those resources during final archive generation.

The direct writer:

- Keeps the EPUB `mimetype` entry stored as required.
- Emits per-entry build progress.
- Computes CRC-32 values directly.
- Writes local headers, central-directory records, and the end-of-central-directory record itself.
- Supports classic ZIP limits; ZIP64 is intentionally not implemented.
- Records `currentFile`, `capturedFiles`, and `fallbackReads` under `window.__PEARSON_FASTZIP_PATCH__` for diagnostics.

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

### Raw ZIP

Raw ZIP is for debugging or preserving more web-oriented source material. It does not add EPUB package files. If **Include JavaScript/interactive assets** is enabled, the crawler may retain resources that a normal EPUB reader would ignore.

## Final report

`OEBPS/pearson-download-report.json` now distinguishes:

- Narrative pages found and successfully placed in the spine.
- Downloaded and failed resources.
- Media-bridge download count.
- **Embedded remote resources** that require EPUB `remote-resources` metadata.
- **External hyperlinks** that do not require that metadata.
- XML-invalid control characters removed.
- Web scripts and interactive embeds stripped from EPUB pages.
- Cover image recovery.
- A final EPUB preflight PASS/CHECK object.

The runtime report is also available while the UI is open at:

```javascript
window.__PEARSON_DOWNLOADER__.lastReport
```

The archive finalizer exposes its own diagnostics at:

```javascript
window.__PEARSON_FASTZIP_PATCH__
```

## Authorization and copyright

Use this only with material you are authorized to access. Do not use it to bypass Pearson account permissions, DRM/access controls, or to redistribute copyrighted textbook content.
