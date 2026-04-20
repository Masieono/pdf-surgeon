# PDF Surgeon

A browser-based PDF editor. Merge, split, reorder, and annotate PDF pages — no uploads, no account, no server.

**[Try it live →](https://masieono.github.io/pdf-surgeon/)**

---

## Features

- **Merge** — combine multiple PDFs or images into one document
- **Split** — divide a PDF into separate files by page range or one-per-page
- **Reorder** — drag pages into any order before exporting
- **Extract** — pull specific pages into a new PDF
- **Watermark** — overlay text or image watermarks with custom position, opacity, and rotation
- **Header / Footer** — add custom text and automatic page numbers to any or all pages
- **Image import** — include JPEGs, PNGs, and WebP files alongside PDFs
- **Undo / Redo** — full history for all page plan changes

## Privacy

All processing happens locally in your browser. Your files are never uploaded anywhere. Nothing leaves your device.

## Usage

1. Open the [live app](https://masieono.github.io/pdf-surgeon/)
2. Drop PDFs or images onto the import area (or click to browse)
3. Arrange, trim, and annotate pages in the editor
4. Click **Export** to download the result

No installation required. Works in any modern browser.

## Running Locally

```bash
git clone https://github.com/masieono/pdf-surgeon.git
cd pdf-surgeon
python3 -m http.server 8080
# open http://localhost:8080
```

A static file server is required because ES modules don't load from `file://` URLs in most browsers.

## Browser Support

Chrome, Edge, Firefox, Safari — any browser with ES module and IndexedDB support (2020+).
