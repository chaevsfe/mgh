# Pearson+ eText Downloader

Saves a Pearson+ book you already have access to as an EPUB or ZIP.

It never reads, prints or asks for your Pearson cookies, tokens or passwords.

The current stack is v2026.08.31.6:

- `pearson.js` - finds the book, crawls it, cleans it up and builds the EPUB
- `pearson-fastzip.js` - fixes the final EPUB metadata and writes the ZIP
- `pearson-loader.js` - console loader, loads the ZIP writer before `pearson.js`
- `pearson-media.user.js` - Tampermonkey script, and the way I'd run it

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

### Why this is not the McGraw Hill script

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

### Authorization

Only use this for books you are allowed to read. Do not use it to get around
account permissions or DRM, and do not redistribute what it saves.
