import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, open, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { fingerprint } from "./content.mjs";
import { driveClient, instagramClient } from "./providers.mjs";

const TTL = 60 * 60 * 1000;
export function createApi({
  drive,
  instagram,
  folderId,
  accountId,
  apiKey,
  publicOrigin,
  stateDir,
  now = Date.now,
  wait = delay,
}) {
  if (!/^[\w-]+$/.test(folderId) || !accountId || apiKey.length < 32)
    throw new Error(
      "Invalid folder/account or API key (minimum 32 characters)",
    );
  if (publicOrigin && new URL(publicOrigin).protocol !== "https:")
    throw new Error("PUBLIC_ORIGIN must use HTTPS");
  let busy = false;
  const location = (id, extension) => path.join(stateDir, `${id}.${extension}`);
  const save = (id, state) =>
    writeFile(location(id, "json"), JSON.stringify(state), { mode: 0o600 });
  const load = async (id) => {
    try {
      return JSON.parse(await readFile(location(id, "json"), "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  };
  return createServer(async (req, res) => {
    const send = (status, value) => {
      res.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(value));
    };
    const pathname = new URL(req.url, "http://localhost").pathname;
    const media = /^\/media\/([a-f0-9]{48})\.jpg$/.exec(pathname);
    try {
      await mkdir(stateDir, { recursive: true, mode: 0o700 });
      if (req.method === "GET" && media) {
        const state = await load(media[1]);
        if (!state || state.expires <= now())
          return send(404, { error: "Image unavailable" });
        const bytes = await readFile(location(media[1], "jpg"));
        res.writeHead(200, {
          "Content-Type": "image/jpeg",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        });
        return res.end(bytes);
      }
      const expected = Buffer.from(`Bearer ${apiKey}`);
      const actual = Buffer.from(req.headers.authorization ?? "");
      if (
        actual.length !== expected.length ||
        !timingSafeEqual(actual, expected)
      )
        return send(401, { error: "Unauthorized" });
      if (req.method === "GET" && pathname === "/health")
        return send(200, { status: "ok" });
      const publish = /^\/publish\/([a-f0-9]{48})$/.exec(pathname);
      if (req.method !== "POST" || (pathname !== "/preview" && !publish))
        return send(404, { error: "Not found" });
      if (busy) return send(409, { error: "Another operation is running" });
      busy = true;
      try {
        if (pathname === "/preview") {
          const { caption, image, sources } = await drive.readFolder(folderId);
          const id = randomBytes(24).toString("hex");
          const hash = fingerprint(accountId, caption, image);
          const state = {
            caption,
            sources,
            hash,
            accountId,
            expires: now() + TTL,
          };
          await writeFile(location(id, "jpg"), image, { mode: 0o600 });
          await save(id, state);
          return send(200, {
            previewId: id,
            caption,
            sources,
            accountId,
            expires: state.expires,
            imagePath: `/media/${id}.jpg`,
          });
        }
        if (!publicOrigin)
          return send(409, {
            error: "Configure PUBLIC_ORIGIN before publishing",
          });
        const id = publish[1];
        const state = await load(id);
        if (!state || state.expires <= now() || state.accountId !== accountId)
          return send(409, {
            error: "Preview expired or account changed; create a new preview",
          });
        // Exclusive durable reservation: failures remain reserved because a timeout
        // may mean Meta accepted the post. Never automatically retry publication.
        const ledger = location(state.hash, "publication");
        let handle;
        try {
          handle = await open(ledger, "wx", 0o600);
        } catch (error) {
          if (error.code === "EEXIST")
            return send(409, {
              error:
                "Content already attempted; inspect local publication record",
            });
          throw error;
        }
        try {
          await handle.writeFile(
            JSON.stringify({ status: "started", previewId: id }),
          );
        } finally {
          await handle.close();
        }
        const record = { status: "started", previewId: id };
        const persist = () =>
          writeFile(ledger, JSON.stringify(record), { mode: 0o600 });
        try {
          const created = await instagram.create(
            state.caption,
            `${publicOrigin.replace(/\/$/, "")}/media/${id}.jpg`,
          );
          if (!created.id) throw new Error("Meta returned no container ID");
          record.containerId = created.id;
          await persist();
          let ready = false;
          for (let attempt = 0; attempt < 30; attempt++) {
            const status = await instagram.status(created.id);
            if (status.status_code === "FINISHED") {
              ready = true;
              break;
            }
            if (["ERROR", "EXPIRED", "PUBLISHED"].includes(status.status_code))
              throw new Error("Unexpected container state");
            await wait(2000);
          }
          if (!ready) throw new Error("Container readiness timed out");
          const result = await instagram.publish(created.id);
          if (!result.id) throw new Error("Meta returned no media ID");
          Object.assign(record, { status: "published", mediaId: result.id });
          await persist();
          let permalink;
          try {
            permalink = (await instagram.permalink(result.id)).permalink;
          } catch {
            /* publication already succeeded */
          }
          return send(200, {
            status: "published",
            mediaId: result.id,
            permalink,
          });
        } catch {
          if (record.status !== "published") record.status = "needs-review";
          await persist();
          return send(502, {
            error: "Publication requires review; do not retry blindly",
            containerId: record.containerId,
            mediaId: record.mediaId,
          });
        }
      } finally {
        busy = false;
      }
    } catch {
      return send(502, {
        error:
          "Operation failed; check configuration, provider access and folder contents",
      });
    }
  });
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const required = (name) => {
    if (!process.env[name]) throw new Error(`Missing ${name}`);
    return process.env[name];
  };
  try {
    const server = createApi({
      drive: driveClient(required("GOOGLE_ACCESS_TOKEN")),
      instagram: instagramClient({
        token: required("INSTAGRAM_ACCESS_TOKEN"),
        accountId: required("INSTAGRAM_ACCOUNT_ID"),
        version: required("META_API_VERSION"),
        host: process.env.META_GRAPH_HOST,
      }),
      folderId: required("DRIVE_FOLDER_ID"),
      accountId: required("INSTAGRAM_ACCOUNT_ID"),
      apiKey: required("PUBLISH_API_KEY"),
      publicOrigin: process.env.PUBLIC_ORIGIN,
      stateDir: path.resolve("local/instagram"),
    });
    server.listen(Number(process.env.PORT ?? 8787), "127.0.0.1", () =>
      console.log("Instagram API listening on loopback"),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
