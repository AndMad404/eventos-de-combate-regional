import path from "node:path";
import { appendFile } from "node:fs/promises";
import { createApi } from "./api.mjs";
import { driveClient, instagramClient } from "./providers.mjs";

const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing configuration: ${name}`);
  return value;
};

let server;
try {
  const mode = process.env.ACTION_MODE ?? "preview";
  if (!["preview", "publish"].includes(mode))
    throw new Error("Invalid ACTION_MODE");
  const stateDir = required("CENTRIFICADOR_STATE_DIR");
  if (!path.isAbsolute(stateDir))
    throw new Error("CENTRIFICADOR_STATE_DIR must be absolute");
  const relative = path.relative(process.cwd(), stateDir);
  if (
    !relative ||
    (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  ) {
    throw new Error(
      "Keep publication state outside the checkout to survive Actions cleanup",
    );
  }
  const accountId = required("INSTAGRAM_ACCOUNT_ID");
  const apiKey = required("PUBLISH_API_KEY");
  const publicOrigin =
    mode === "publish" ? required("PUBLIC_ORIGIN") : undefined;
  const port = Number(process.env.PORT || 8787);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error("Invalid PORT");
  const instagram =
    mode === "publish"
      ? instagramClient({
          token: required("INSTAGRAM_ACCESS_TOKEN"),
          accountId,
          version: required("META_API_VERSION"),
          host: required("META_GRAPH_HOST"),
        })
      : null;
  server = createApi({
    drive: driveClient(required("GOOGLE_ACCESS_TOKEN")),
    instagram,
    folderId: required("DRIVE_FOLDER_ID"),
    accountId,
    apiKey,
    publicOrigin,
    stateDir,
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const post = async (route) => {
    const response = await fetch(`http://127.0.0.1:${port}${route}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(240000),
    });
    if (!response.ok)
      throw new Error(
        `Local API returned HTTP ${response.status}; inspect private state before retrying publication`,
      );
    return response.json();
  };
  const preview = await post("/preview");
  let summary =
    "Preview prepared. Text and image remain in private runner storage. No post published.\n";
  if (mode === "publish") {
    const result = await post(`/publish/${preview.previewId}`);
    if (result.status !== "published")
      throw new Error("Publication not confirmed");
    summary =
      "Instagram confirmed publication. The media ID is recorded in private runner storage.\n";
  }
  // No caption, image URL, file names, access token or private metadata in logs/artifacts.
  console.log(summary.trim());
  if (process.env.GITHUB_STEP_SUMMARY)
    await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
} catch (error) {
  // Only known configuration errors are printable; arbitrary runtime errors can contain secrets.
  const message = String(error.message);
  console.error(
    /^(Missing configuration: [A-Z_]+|Invalid (ACTION_MODE|PORT)|CENTRIFICADOR_STATE_DIR must be absolute|Keep publication state outside the checkout to survive Actions cleanup|Local API returned HTTP \d+; inspect private state before retrying publication|Publication not confirmed)$/.test(
      message,
    )
      ? message
      : "Action failed. Check private runner state and provider configuration; do not blindly retry publication.",
  );
  process.exitCode = 1;
} finally {
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
}
