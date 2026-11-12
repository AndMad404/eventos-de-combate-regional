import { createHash } from "node:crypto";

export function documentText(document) {
  const walk = (elements = []) =>
    elements
      .map((element) => {
        if (element.paragraph)
          return element.paragraph.elements
            .map(
              (part) =>
                part.textRun?.content ??
                part.person?.personProperties?.name ??
                "",
            )
            .join("");
        if (element.table)
          return element.table.tableRows
            .map((row) =>
              row.tableCells.map((cell) => walk(cell.content)).join("\n"),
            )
            .join("\n");
        return "";
      })
      .join("");
  const tabs = (items = []) =>
    items
      .map((tab) =>
        [walk(tab.documentTab?.body?.content), tabs(tab.childTabs)]
          .filter(Boolean)
          .join("\n"),
      )
      .filter(Boolean)
      .join("\n");
  return document.tabs?.length
    ? tabs(document.tabs)
    : walk(document.body?.content);
}

export function normalizeCaption(text) {
  const caption = text
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replaceAll("\u000b", "\n")
    .replaceAll("\u000c", "\n")
    .replace(/#EventoExterno(?![\p{L}\p{N}_])/gu, "#TestDeAPI")
    .replace(/[\t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!caption) throw new Error("Empty caption");
  if ([...caption].length > 2200)
    throw new Error("Caption exceeds 2200 characters");
  return caption;
}

export function selectFiles(files) {
  const texts = files.filter((f) =>
    ["text/plain", "application/vnd.google-apps.document"].includes(f.mimeType),
  );
  const images = files.filter((f) =>
    ["image/jpeg", "image/png", "image/webp"].includes(f.mimeType),
  );
  if (texts.length !== 1 || images.length !== 1) {
    throw new Error(
      "Folder must contain exactly one TXT/Google Doc and one JPEG/PNG/WebP image",
    );
  }
  return { text: texts[0], image: images[0] };
}

export function fingerprint(account, caption, image) {
  return createHash("sha256")
    .update(JSON.stringify([account, caption]))
    .update(image)
    .digest("hex");
}
