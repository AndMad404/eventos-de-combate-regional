import sharp from "sharp";
import { documentText, normalizeCaption, selectFiles } from "./content.mjs";

async function request(fetchImpl, url, options = {}) {
  const response = await fetchImpl(url, {
    ...options,
    signal: AbortSignal.timeout(30000),
  });
  // Never echo provider bodies or URLs: they may contain private content/tokens.
  if (!response.ok)
    throw new Error(`Provider request failed (HTTP ${response.status})`);
  return response;
}

export function driveClient(token, fetchImpl = fetch) {
  const get = (url) =>
    request(fetchImpl, url, { headers: { Authorization: `Bearer ${token}` } });
  return {
    async readFolder(folderId) {
      const files = [];
      let pageToken;
      do {
        const params = new URLSearchParams({
          q: `'${folderId}' in parents and trashed = false`,
          fields: "nextPageToken,files(id,name,mimeType,modifiedTime)",
          pageSize: "100",
          supportsAllDrives: "true",
          includeItemsFromAllDrives: "true",
        });
        if (pageToken) params.set("pageToken", pageToken);
        const page = await (
          await get(`https://www.googleapis.com/drive/v3/files?${params}`)
        ).json();
        files.push(...(page.files ?? []));
        pageToken = page.nextPageToken;
        if (files.length > 1000) throw new Error("Folder exceeds 1000 files");
      } while (pageToken);
      const selected = selectFiles(files);
      const id = encodeURIComponent(selected.text.id);
      const raw =
        selected.text.mimeType === "text/plain"
          ? await (
              await get(
                `https://www.googleapis.com/drive/v3/files/${id}?alt=media`,
              )
            ).text()
          : documentText(
              await (
                await get(
                  `https://docs.googleapis.com/v1/documents/${id}?includeTabsContent=true`,
                )
              ).json(),
            );
      const response = await get(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(selected.image.id)}?alt=media`,
      );
      const chunks = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > 20 * 1024 * 1024)
          throw new Error("Source image exceeds 20 MB");
        chunks.push(chunk);
      }
      const input = Buffer.concat(chunks);
      const image = await sharp(input, { limitInputPixels: 40000000 })
        .rotate()
        .resize({
          width: 1080,
          height: 1080,
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({ quality: 90 })
        .toBuffer();
      const { width, height } = await sharp(image).metadata();
      if (width / height < 0.8 || width / height > 1.91)
        throw new Error(
          "Image aspect ratio must be between 4:5 and 1.91:1; no automatic crop applied",
        );
      return { caption: normalizeCaption(raw), image, sources: selected };
    },
  };
}

export function instagramClient(
  { token, accountId, version, host = "graph.instagram.com" },
  fetchImpl = fetch,
) {
  if (!["graph.instagram.com", "graph.facebook.com"].includes(host))
    throw new Error("Invalid Meta host");
  if (!/^v\d+\.\d+$/.test(version) || !/^\d+$/.test(accountId))
    throw new Error("Invalid Meta API version/account ID");
  const call = async (resource, values, method = "POST") => {
    const url = new URL(`https://${host}/${version}/${resource}`);
    const params = new URLSearchParams(values);
    if (method === "GET") url.search = params.toString();
    return (
      await request(fetchImpl, url, {
        method,
        headers: { Authorization: `Bearer ${token}` },
        ...(method === "POST" ? { body: params } : {}),
      })
    ).json();
  };
  return {
    create: (caption, imageUrl) =>
      call(`${accountId}/media`, { caption, image_url: imageUrl }),
    status: (id) => call(id, { fields: "status_code" }, "GET"),
    publish: (id) => call(`${accountId}/media_publish`, { creation_id: id }),
    permalink: (id) => call(id, { fields: "permalink" }, "GET"),
  };
}
