import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import {
  documentText,
  normalizeCaption,
  selectFiles,
} from "../../scripts/instagram/content.mjs";
import {
  driveClient,
  instagramClient,
} from "../../scripts/instagram/providers.mjs";
import { createApi } from "../../scripts/instagram/api.mjs";

test("Docs tabs, tables and person chips preserve names without exporting emails", () => {
  const paragraph = {
    paragraph: {
      elements: [
        { textRun: { content: "Texto\u000b#EventoExterno\n" } },
        {
          person: {
            personProperties: {
              name: "Persona",
              email: "private@example.invalid",
            },
          },
        },
      ],
    },
  };
  const document = {
    tabs: [
      {
        documentTab: { body: { content: [paragraph] } },
        childTabs: [
          {
            documentTab: {
              body: {
                content: [
                  {
                    table: {
                      tableRows: [
                        {
                          tableCells: [
                            {
                              content: [
                                {
                                  paragraph: {
                                    elements: [
                                      { textRun: { content: "Final" } },
                                    ],
                                  },
                                },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                  },
                ],
              },
            },
          },
        ],
      },
    ],
  };
  const before = JSON.stringify(document);
  assert.equal(
    normalizeCaption(documentText(document)),
    "Texto\n#TestDeAPI\nPersona\nFinal",
  );
  assert.equal(JSON.stringify(document), before);
  assert.equal(
    normalizeCaption("#EventoExternoExtra #EventoExterno"),
    "#EventoExternoExtra #TestDeAPI",
  );
  assert.throws(() => normalizeCaption(" "));
  assert.throws(() => normalizeCaption("x".repeat(2201)));
});

test("ambiguous or missing assets stop selection", () => {
  assert.throws(() => selectFiles([]));
  assert.throws(() =>
    selectFiles([
      { mimeType: "text/plain" },
      { mimeType: "text/plain" },
      { mimeType: "image/jpeg" },
    ]),
  );
});

test("Drive paginates and reads dynamic private text/image without writing to source", async () => {
  const png = await sharp({
    create: { width: 640, height: 480, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  const calls = [];
  const client = driveClient("test-token", async (input, options) => {
    const url = new URL(input);
    calls.push(url);
    assert.equal(options.headers.Authorization, "Bearer test-token");
    assert.equal(options.method, undefined);
    if (url.pathname.endsWith("/files")) {
      return Response.json(
        url.searchParams.has("pageToken")
          ? { files: [{ id: "photo", mimeType: "image/png" }] }
          : {
              files: [{ id: "text", mimeType: "text/plain" }],
              nextPageToken: "second",
            },
      );
    }
    if (url.pathname.endsWith("/text"))
      return new Response("Texto distinto #EventoExterno");
    return new Response(png);
  });
  const result = await client.readFolder("folder");
  assert.equal(result.caption, "Texto distinto #TestDeAPI");
  assert.equal((await sharp(result.image).metadata()).format, "jpeg");
  assert.equal(calls.length, 4);
});

test("Meta requests use configured account/version, Bearer token and two-step publish", async () => {
  const calls = [];
  const client = instagramClient(
    { token: "secret", accountId: "123", version: "v25.0" },
    async (url, options) => {
      calls.push([url.toString(), options]);
      assert.equal(url.toString().includes("secret"), false);
      assert.equal(options.headers.Authorization, "Bearer secret");
      return Response.json({ id: "456" });
    },
  );
  await client.create("Caption", "https://example.invalid/image.jpg");
  await client.publish("456");
  assert.equal(calls[0][0], "https://graph.instagram.com/v25.0/123/media");
  assert.equal(calls[0][1].body.get("caption"), "Caption");
  assert.equal(calls[1][1].body.get("creation_id"), "456");
});

async function fixture(t, overrides = {}) {
  const stateDir = await mkdtemp(path.join(tmpdir(), "instagram-api-"));
  const calls = [];
  let currentTime = 0;
  const server = createApi({
    stateDir,
    apiKey: "k".repeat(32),
    folderId: "folder",
    accountId: "123",
    publicOrigin: "https://example.invalid",
    now: () => currentTime,
    wait: async () => {},
    drive: {
      readFolder: async () => ({
        caption: "Dynamic #TestDeAPI",
        image: Buffer.from("image-fixture"),
        sources: { text: { id: "text" }, image: { id: "photo" } },
      }),
    },
    instagram: {
      create: async (...args) => {
        calls.push(args);
        return { id: "container" };
      },
      status: async () => ({ status_code: "FINISHED" }),
      publish: async () => {
        calls.push("published");
        return { id: "media" };
      },
      permalink: async () => ({
        permalink: "https://www.instagram.com/p/example/",
      }),
      ...overrides,
    },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(stateDir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (route, method = "POST") =>
    fetch(base + route, {
      method,
      headers: { Authorization: `Bearer ${"k".repeat(32)}` },
    });
  return {
    base,
    request,
    calls,
    expire: () => {
      currentTime = 3600001;
    },
  };
}

test("HTTP authentication, preview, dynamic image, publication and durable duplicate protection", async (t) => {
  const f = await fixture(t);
  assert.equal(
    (await fetch(f.base + "/preview", { method: "POST" })).status,
    401,
  );
  const preview = await (await f.request("/preview")).json();
  assert.equal(preview.caption, "Dynamic #TestDeAPI");
  assert.equal(f.calls.length, 0);
  assert.equal(
    await (await fetch(f.base + preview.imagePath)).text(),
    "image-fixture",
  );
  const post = await f.request(`/publish/${preview.previewId}`);
  assert.equal(post.status, 200);
  assert.equal((await post.json()).mediaId, "media");
  assert.equal(f.calls[0][0], preview.caption);
  assert.equal(f.calls[0][1], "https://example.invalid" + preview.imagePath);
  const another = await (await f.request("/preview")).json();
  assert.equal((await f.request(`/publish/${another.previewId}`)).status, 409);
  f.expire();
  assert.equal((await fetch(f.base + preview.imagePath)).status, 404);
  assert.equal((await f.request(`/publish/${preview.previewId}`)).status, 409);
});

test("uncertain Meta result blocks retries even through a new preview", async (t) => {
  const f = await fixture(t, {
    publish: async () => {
      throw new Error("timeout with token that must never be exposed");
    },
  });
  const preview = await (await f.request("/preview")).json();
  const result = await f.request(`/publish/${preview.previewId}`);
  assert.equal(result.status, 502);
  assert.equal((await result.text()).includes("token"), false);
  const another = await (await f.request("/preview")).json();
  assert.equal((await f.request(`/publish/${another.previewId}`)).status, 409);
});
