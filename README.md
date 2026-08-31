# McGraw Hill eTextbook Downloader

Saves a McGraw Hill book you already have access to as an EPUB or ZIP.

Run it on the Reader page while you are signed in. It only packages what your own
session can already load. There is a Pearson+ version too, see [PEARSON.md](PEARSON.md).

`script.js` is v2026.08.31.2.

### Usage

1. Sign in and open the actual book in the Reader
2. Wait for a chapter to load
3. Open DevTools and go to the Console
4. Paste `loader.js` and run it
5. Leave every resource type selected for a complete EPUB, or pick a subset for a raw ZIP
6. Choose EPUB or ZIP and click Start download
7. Read the report before closing the window

If the page blocks the loader, open `script.js` on GitHub and paste it into the
Console instead. That always works.

### One-line loader

```javascript
fetch('https://raw.githubusercontent.com/chaevsfe/mgh/main/script.js?t='+Date.now(),{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.text()}).then(s=>(0,eval)(s)).catch(console.error)
```

### Files

- `script.js` - the downloader
- `loader.js` - fetches the current `script.js` from this repo

### What changed from the old scripts

The jimmckeeth and 101arrowz scripts used `https://player-api.mheducation.com/lti`.
The Reader now uses `https://prod.reader.prod.mheducation.com/v1/lti`, but swapping
the endpoint was the smallest part of it.

- Reads `META-INF/container.xml` instead of assuming the OPF is `OPS/content.opf`
- Resolves asset paths against wherever the OPF actually lives
- Retries failed downloads with backoff, and waits when the server sends `Retry-After`
- Starts at six downloads at once, drops after a 429 or 503, climbs back after clean batches
- Retries a normalized URL when a path has doubled slashes like `fonts//proxima-nova/...`
- Rejects HTML AccessDenied pages served in place of a font or image
- Checks WOFF, WOFF2, TTF and OTF signatures before saving a font
- Writes `mimetype` first and uncompressed for EPUB, then reopens the ZIP to confirm it
- Refuses unsafe archive paths and duplicate paths
- Prints a report at the end instead of failing quietly

### The report

When the run finishes it tells you how many resources were downloaded, repaired,
skipped, failed and missing, plus any broken spine references, bad archive paths
and duplicate paths. For EPUB it also confirms the archive really starts with an
uncompressed `mimetype` entry.

A warning does not always mean the book is broken. A font you cannot reach will
warn while the book still reads fine with a fallback. The point is that you see
it instead of getting an error page saved as if it were a real font.

While the window is open the same report sits at:

```javascript
window.__MGH_DOWNLOADER__.lastReport
```

### Troubleshooting

**Could not locate the open textbook.** You are probably on the Connect assignment
or course page rather than the Reader. Open the book, let a chapter load, run it again.

**The loader is blocked.** The page's Content Security Policy is stopping remote
code. Paste `script.js` into the Console directly.

**A resource says repaired.** The URL in the manifest failed, but the same file
came back after the doubled slashes were cleaned out of the path. The manifest
entry inside the EPUB is left alone.

**A resource says AccessDenied or invalid font.** The server sent an error page
instead of the file. It gets rejected rather than saved, and the report lists it
as failed.

**The download gets rate limited.** It backs off on its own and lowers how many
files it pulls at once. Leave it running.

**The EPUB opens but looks incomplete.** Leave every resource type selected when
you build an EPUB. Turning off CSS, fonts, images or XHTML gives you an incomplete
book, and the report warns about what was left out.

### Authorization

Only use this for books you are allowed to read. Do not use it to get around
account permissions or DRM, and do not redistribute what it saves.

### Credit

Based on the McGraw Hill downloader work by jimmckeeth and 101arrowz, rewritten
in 2026 for the current Reader.
