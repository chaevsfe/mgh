# McGraw Hill and Pearson+ eTextbook Downloaders

Two browser scripts that save a textbook you already have access to as an EPUB or ZIP.

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

1. Sign in and open the actual book in the Reader (Chrome Recommended)
2. Wait for a chapter to load
3. Open DevTools and go to the Console
4. Paste `loader.js` and run it
5. Leave every resource type selected for a complete EPUB, or pick a subset for a raw ZIP
6. Choose EPUB or ZIP and click Start download
7. Read the report before closing the window

If the page blocks the loader, open `script.js` on GitHub and paste it into the
Console instead.

### One-line loader

```javascript
fetch('https://raw.githubusercontent.com/chaevsfe/mgh/main/script.js?t='+Date.now(),{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.text()}).then(s=>(0,eval)(s)).catch(console.error)
```


### Troubleshooting

**Could not locate the open textbook.** You are probably on the Connect assignment
or course page rather than the Reader.

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


## Pearson+

### Usage

Install `pearson-media.user.js` in Tampermonkey or Violentmonkey and open the book
normally. It starts itself on `/products/...` pages, and there is a menu command
called **Launch Pearson Downloader** if you need it by hand. (Chrome Recommended)

The userscript also loads JSZip up front so Pearson's Content Security Policy
cannot block it. It may pull images from
`cite-media.pearson.com` and `media.pearsoncmg.com`. No cookies or credentials are sent to those hosts.

If you would rather not install anything, paste `pearson-loader.js` into the
Console. Images may be blocked by CORS stay
as their original web links instead of being saved into the book.

### TOC

Pearson usually asks for `/api/contenttoc/v1/assets` before a pasted script is
running. If the downloader says it is waiting
for the TOC:

1. Open DevTools and go to Network
2. Filter for `contenttoc` and reload the page
3. Click `/api/contenttoc/v1/assets`
4. Open Response and copy the whole JSON body
5. **Use copied TOC JSON** or **Paste TOC JSON**


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

### ZIP

`pearson-fastzip.js` keeps the original bytes handed to `zip.file(...)` and writes
a plain stored ZIP itself, computing the CRCs and writing the headers and central
directory directly. It leaves `mimetype` stored as EPUB requires, and reports
progress per file. Classic ZIP limits only.

### Output

EPUB:

```text
mimetype
META-INF/container.xml
OEBPS/content.opf
OEBPS/nav.xhtml
OEBPS/source/...
OEBPS/external/...
OEBPS/pearson-download-report.json
```

## Authorization

Only use these for books you are allowed to read. Do not use them to get around
account permissions or DRM, and do not redistribute what they save.

## Credit

The McGraw Hill downloader is based on work by jimmckeeth and 101arrowz, rewritten
in 2026 for the current Reader. The Pearson+ downloader is my own.

## License

MIT. See [LICENSE](LICENSE).
