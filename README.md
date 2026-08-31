# McGraw Hill eTextbook Downloader

Updated browser-side downloader based on the earlier jimmckeeth / 101arrowz scripts.

This version is intended to run on a McGraw Hill Reader page where you are already signed in and authorized to access the book. It packages the resources exposed to that authenticated session into EPUB or ZIP format.

## Current version

`script.js` is currently **v2026.08.31.2**.

The older scripts depended heavily on:

```text
https://player-api.mheducation.com/lti
```

The current Reader flow uses:

```text
https://prod.reader.prod.mheducation.com/v1/lti
```

The current rewrite does substantially more than changing the LTI URL.

## Improvements over the older downloader

- Tries the current Reader LTI endpoint and a fallback endpoint.
- Can discover a loaded book from the Reader's resource/network history.
- Reads `META-INF/container.xml` instead of assuming the OPF is always `OPS/content.opf`.
- Resolves manifest asset paths relative to the real OPF location.
- Uses JSZip 3.10.1 with two CDN fallbacks.
- Preserves the textbook resources byte-for-byte when they are successfully retrieved.
- Retries transient HTTP/network failures with exponential backoff.
- Honors `Retry-After` when the server supplies it.
- Starts at six concurrent resource downloads and automatically reduces concurrency after `429`/`503` rate limiting, then gradually raises it again after clean batches.
- If an asset URL fails and its pathname contains duplicate slashes such as `fonts//proxima-nova/...`, retries a normalized-path version without changing the EPUB manifest itself.
- Detects fake-success responses such as HTML/XML `AccessDenied` documents returned in place of fonts or other binary resources.
- Validates WOFF, WOFF2, TTF, and OTF signatures before accepting font files.
- Uses safer archive-path handling that does not broadly decode encoded `/` or `\` characters into new path separators.
- Detects unsafe paths and duplicate resolved archive paths.
- Checks manifest/spine references before packaging.
- Produces a final integrity report showing downloaded, repaired, skipped, failed, and missing resources.
- For EPUB output, creates the required `mimetype` file first and uncompressed.
- After building the EPUB, inspects the generated ZIP header to verify that `mimetype` really is the first entry, uses STORE compression, and contains exactly `application/epub+zip`.
- ZIP mode is treated as a raw source archive and does **not** add the EPUB-only `mimetype` entry.
- Shows a selection UI, progress log, adaptive-network messages, cancellation, and clearer errors.
- Safely closes/replaces a previous running instance if the script is launched twice.

## Recommended usage

1. Sign in to McGraw Hill and open the actual textbook in the Reader.
2. Wait until the book content has loaded.
3. Open DevTools → Console.
4. Paste the contents of `loader.js` and run it.
5. The loader fetches the newest `script.js` from this public repository.
6. Leave all resource types selected for the most complete EPUB, or choose a subset for a raw ZIP/export.
7. Choose EPUB or ZIP and click **Start download**.
8. Review the validation report shown before closing the downloader.

If the loader is blocked by the site's Content Security Policy, copy and paste `script.js` directly into the Console instead.

## One-line loader

```javascript
fetch('https://raw.githubusercontent.com/chaevsfe/mgh/main/script.js?t='+Date.now(),{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.text()}).then(s=>(0,eval)(s)).catch(console.error)
```

Because browser security policies can change, direct pasting of `script.js` remains the most reliable fallback.

## Files

- `script.js` — full downloader.
- `loader.js` — small public loader that always fetches the current `script.js`.
- `README.md` — setup, behavior, and troubleshooting notes.

## Validation report

At the end of a run, the downloader checks and reports:

- Total manifest resources.
- Selected/downloaded/skipped/failed resources.
- How many failed URLs were recovered by normalized-path fallback.
- Missing selected resources.
- Missing manifest resources for EPUB output.
- Broken OPF spine `idref` values.
- Unsafe or unresolved archive paths.
- Duplicate resolved archive paths.
- Whether `container.xml` resolves to the package document used.
- For EPUB output, whether the generated archive actually begins with an uncompressed `mimetype` entry containing `application/epub+zip`.

A warning does not necessarily mean the entire book is unusable. For example, an inaccessible optional font may cause a warning while the book still renders using a fallback font. The report is intended to make those cases visible instead of silently saving an error document as if it were a valid asset.

The most recent report is also available in the page console as:

```javascript
window.__MGH_DOWNLOADER__.lastReport
```

while the downloader UI remains open.

## Troubleshooting

### "Could not locate the open textbook"

Make sure you are on the page where the actual Reader/book is open, not just the Connect assignment or course page. Refresh the Reader, let a chapter load, then run the script again.

### Loader is blocked

Some pages block remote loading or dynamic evaluation with Content Security Policy. Open `script.js` on GitHub, copy it, and paste it directly into DevTools Console.

### A resource says `repaired`

The original manifest URL failed, but the downloader successfully retrieved the same asset after normalizing duplicate `/` characters in the URL pathname. The original manifest entry is left untouched inside the EPUB.

### A resource returns AccessDenied or an invalid font

The downloader rejects known HTML/XML error payloads and invalid WOFF/WOFF2/TTF/OTF signatures instead of placing them into the archive as corrupted assets. The final validation report will list the resource as failed if no valid fallback can be retrieved.

### The server rate-limits the download

The downloader honors `Retry-After`, backs off, and automatically reduces concurrent requests after `429` or `503` responses. Concurrency can rise again after several clean batches.

### EPUB opens but looks incomplete

Leave all resource types selected when generating EPUB. Deselecting CSS, fonts, images, XHTML, SVG, or other manifest resources can produce an incomplete EPUB, and the final report will warn about the omitted manifest resources.

## Authorization and copyright

Use this only for books and resources you are authorized to access. Do not use it to bypass account permissions, DRM/access controls, or to redistribute copyrighted textbook content.

## Attribution

Derived from the McGraw Hill downloader work published by jimmckeeth and 101arrowz, with a substantial 2026 rewrite for the current Reader flow.