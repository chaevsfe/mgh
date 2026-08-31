# McGraw Hill and Pearson+ eTextbook Downloaders

Two browser scripts that save a textbook you already have access to as an EPUB or ZIP.

Run them on the Reader page while you are signed in. They only package what your own
session can already load, and neither one reads, prints or asks for your cookies,
tokens or password.

- McGraw Hill is `script.js`, v2026.08.31.2
- Pearson+ is `pearson.js` and three helpers, v2026.08.31.6

### Files

- `script.js` - the McGraw Hill downloader
- `loader.js` - fetches the current `script.js` from this repo
- `pearson.js` - finds the Pearson book, crawls it, cleans it up and builds the EPUB
- `pearson-fastzip.js` - fixes the final EPUB metadata and writes the ZIP
- `pearson-loader.js` - console loader, loads the ZIP writer before `pearson.js`
- `pearson-media.user.js` - Tampermonkey script, and the way I'd run Pearson

## McGraw Hill

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

## Pearson+

### Usage

Install `pearson-media.user.js` in Tampermonkey or Violentmonkey and open the book
normally. It starts itself on `/products/...` pages, and there is a menu command
called **Launch Pearson Downloader** if you need it by hand.

The userscript also loads JSZip up front so Pearson's Content Security Policy
cannot block it, follows the site's own page changes so going from the library
into a book works without a refresh, and can pull images from
`cite-media.pearson.com` and `media.pearsoncmg.com` that the page itself is not
allowed to read. It sends no cookies or credentials to those hosts.

If you would rather not install anything, paste `pearson-loader.js` into the
Console. You still get every page you can reach, but images blocked by CORS stay
as their original web links instead of being saved into the book.

### The TOC step

Pearson usually asks for `/api/contenttoc/v1/assets` before a pasted script is
running, so there is nothing to listen to. If the downloader says it is waiting
for the TOC:

1. Open DevTools and go to Network
2. Filter for `contenttoc`
3. Click `/api/contenttoc/v1/assets`, not `page-mapping`
4. Open Response and copy the whole JSON body
5. Click **Use copied TOC JSON**

**Paste TOC JSON** does the same thing if the clipboard route fails. Only the
response body is needed. Never paste request headers or tokens.

### Why Pearson needs its own script

McGraw Hill hands you something close to a finished EPUB, with a `container.xml`
and an OPF you can read. Pearson does not. Its Reader exposes the book as a nested
`contenttoc` plus separate resources like:

```text
/eps/sanvan/api/item/<item-id>/<version>/file/narrative/<uuid>.html
```

So EPUB mode builds the package itself out of Pearson's ordered pages and whatever
those pages point at.

### What EPUB mode does

- Orders pages by Pearson's own `playOrder`
- Builds `nav.xhtml` from the real chapter and section tree
- Downloads the images, CSS, fonts and JSON the pages reference
- Only rewrites a link to a local file after that file downloaded
- Strips scripts, iframes, embeds, refresh tags and inline event handlers
- Strips control characters that would make the XHTML invalid
- Finds the cover and marks it properly
- Marks a page `remote-resources` only when it really embeds something remote,
  not just because it has a normal external link
- Confirms the finished file starts with an uncompressed `mimetype` entry

### The ZIP writer

Big Pearson books hold hundreds of images that are already compressed. Asking
JSZip to compress them again stalls the export.

`pearson-fastzip.js` keeps the original bytes handed to `zip.file(...)` and writes
a plain stored ZIP itself, computing the CRCs and writing the headers and central
directory directly. It leaves `mimetype` stored as EPUB requires, and reports
progress per file. Classic ZIP limits only, no ZIP64.

Diagnostics live at `window.__PEARSON_FASTZIP_PATCH__`.

### Output

EPUB mode writes:

```text
mimetype
META-INF/container.xml
OEBPS/content.opf
OEBPS/nav.xhtml
OEBPS/source/...
OEBPS/external/...
OEBPS/pearson-download-report.json
```

Raw ZIP is for digging around or keeping the original web files. It does not add
the EPUB package files, and with **Include JavaScript/interactive assets** on it
will keep things no ebook reader will ever use.

### The report

`OEBPS/pearson-download-report.json` covers the pages found and placed in the
spine, what downloaded and what failed, how much came through the media bridge,
embedded remote resources against plain external links, control characters
removed, scripts stripped, whether the cover was recovered, and a final pass or
check on the EPUB itself.

While the window is open it is also at:

```javascript
window.__PEARSON_DOWNLOADER__.lastReport
```

### How well it works

This is stable on the Pearson+ Vega Reader as far as I have tested it. The last
full run came out with every page in order, media saved locally, valid XHTML,
valid spine references, the cover recovered and a clean archive.

Other titles can use author-specific widgets, so a new book can still surprise it
even though the Reader underneath is the same.

## Authorization

Only use these for books you are allowed to read. Do not use them to get around
account permissions or DRM, and do not redistribute what they save.

## Credit

The McGraw Hill downloader is based on work by jimmckeeth and 101arrowz, rewritten
in 2026 for the current Reader. The Pearson+ downloader is my own.

## License

MIT. See [LICENSE](LICENSE).
