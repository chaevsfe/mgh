# McGraw Hill eTextbook Downloader

Updated browser-side downloader based on the earlier jimmckeeth / 101arrowz scripts.

This version is intended to run on a McGraw Hill Reader page where you are already signed in and authorized to access the book. It packages the resources exposed to that authenticated session into EPUB or ZIP format.

## What changed in the 2026 rewrite

The previous script depended heavily on:

```text
https://player-api.mheducation.com/lti
```

The current Reader flow uses:

```text
https://prod.reader.prod.mheducation.com/v1/lti
```

The new `script.js` goes further than changing that one URL:

- Tries the current Reader LTI endpoint and a fallback endpoint.
- Can discover a loaded book from the Reader's resource/network history.
- Reads `META-INF/container.xml` instead of assuming the OPF is always `OPS/content.opf`.
- Resolves manifest asset paths relative to the real OPF location.
- Uses JSZip 3.10.1 with two CDN fallbacks.
- Downloads several resources concurrently instead of strictly one at a time.
- Retries failed resources.
- Preserves EPUB paths in the generated archive.
- Includes the required EPUB `mimetype` and container/package files.
- Supports EPUB or ZIP output.
- Shows a selection UI, progress log, counts, cancellation, and clearer errors.
- Safely closes/replaces a previous running instance if the script is launched twice.

## Recommended usage

1. Sign in to McGraw Hill and open the actual textbook in the Reader.
2. Wait until the book content has loaded.
3. Open DevTools → Console.
4. Paste the contents of `loader.js` and run it.
5. The loader fetches the newest `script.js` from this public repository.
6. Select the resource types you want and choose EPUB or ZIP.
7. Click **Start download**.

If the loader is blocked by the site's Content Security Policy, copy and paste `script.js` directly into the Console instead.

## One-line loader

You can also paste this directly into the Console:

```javascript
fetch('https://raw.githubusercontent.com/chaevsfe/mgh/main/script.js?t='+Date.now(),{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.text()}).then(s=>(0,eval)(s)).catch(console.error)
```

Because browser security policies can change, direct pasting of `script.js` remains the most reliable fallback.

## Files

- `script.js` — full downloader.
- `loader.js` — small public loader that always fetches the current `script.js`.
- `README.md` — setup and troubleshooting notes.

## Troubleshooting

### "Could not locate the open textbook"

Make sure you are on the page where the actual Reader/book is open, not just the Connect assignment or course page. Refresh the Reader, let a chapter load, then run the script again.

### Loader is blocked

Some pages block remote script loading or dynamic evaluation with Content Security Policy. Open `script.js` on GitHub, copy it, and paste it directly into DevTools Console.

### Some resources fail

The script performs an automatic retry pass. If resources still fail, the archive may be incomplete. Reload the book and try again; the Reader may not have granted access to those resources in the current session.

### EPUB opens but looks incomplete

Leave all resource types selected when generating EPUB. Deselecting CSS, fonts, images, XHTML, SVG, or other manifest resources can produce a technically valid but visually incomplete EPUB.

## Authorization and copyright

Use this only for books and resources you are authorized to access. Do not use it to bypass account permissions, DRM/access controls, or to redistribute copyrighted textbook content.

## Attribution

Derived from the McGraw Hill downloader work published by jimmckeeth and 101arrowz, with a substantial 2026 rewrite for the current Reader flow.
