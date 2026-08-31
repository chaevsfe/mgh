# McGraw Hill eTextbook downloader

Updated copy of the McGraw Hill textbook downloader from [jimmckeeth's gist](https://gist.github.com/jimmckeeth/47bc555346f1e3ddf1815acf205c16c1), which was forked from work by 101arrowz.

## 2026 fix

The older script initialized with:

```text
https://player-api.mheducation.com/lti
```

McGraw Hill's Reader now uses:

```text
https://prod.reader.prod.mheducation.com/v1/lti
```

`script.js` uses the new endpoint and also reports HTTP/JSON/manifest errors more clearly so a future API change is easier to diagnose.

## Usage

Use this only with content you are authorized to access and keep downloaded material for your own permitted use.

1. Open the textbook in McGraw Hill Connect/Reader in Chrome or Brave and make sure the book itself is loaded.
2. Open `script.js` from this repository and copy its contents.
3. Open DevTools Console on the McGraw Hill reader page, paste the script, and run it.
4. Choose the file types and whether to save the result as EPUB or ZIP.
5. Wait for the download and retry pass to finish.

### Bookmarklet/raw-loader note

This repository is currently private. A `javascript:` loader that fetches `raw.githubusercontent.com/.../script.js` will not work reliably from the McGraw Hill page while the repo is private because the raw file is not publicly accessible to that cross-origin request. If the repository is made public, a raw-loader/bookmarklet can be added.

## Changes from the source gist

- Switched LTI discovery to `https://prod.reader.prod.mheducation.com/v1/lti`.
- Added HTTP status validation for LTI, `content.opf`, and `container.xml`.
- Added JSON/XML validation and clearer initialization errors.
- Kept the source gist's file-type selector, EPUB/ZIP choice, logging panels, retry behavior, and JSZip packaging flow.
- Sanitizes characters in the generated download filename that are invalid on common filesystems.

## Attribution

Original/derived work: jimmckeeth and 101arrowz. This repository is an updated copy for personal/educational use. Do not redistribute copyrighted textbook content you download.
