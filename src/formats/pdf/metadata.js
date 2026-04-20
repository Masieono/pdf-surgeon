function toTrimmedString(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function applyPdfMetadata(pdfDoc, meta) {
  if (!pdfDoc || !meta || typeof meta !== "object") {
    return;
  }

  const title = toTrimmedString(meta.title);
  const author = toTrimmedString(meta.author);
  const subject = toTrimmedString(meta.subject);
  const keywordsRaw = toTrimmedString(meta.keywords);

  if (title && typeof pdfDoc.setTitle === "function") {
    pdfDoc.setTitle(title);
  }
  if (author && typeof pdfDoc.setAuthor === "function") {
    pdfDoc.setAuthor(author);
  }
  if (subject && typeof pdfDoc.setSubject === "function") {
    pdfDoc.setSubject(subject);
  }

  if (keywordsRaw && typeof pdfDoc.setKeywords === "function") {
    const keywords = keywordsRaw
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    if (keywords.length > 0) {
      pdfDoc.setKeywords(keywords);
    }
  }
}
