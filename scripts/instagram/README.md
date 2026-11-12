# Drive to Instagram API

Local Node.js API for one image post, isolated from the website build. Requires
Node 22+ and the repository dependencies (`pnpm install`). No new dependencies.
The operator triggers detection with POST `/preview`; no unattended watcher is
installed. Each preview reads the configured Drive folder again.

## Configuration

Supply environment variables through a secret manager or an ignored local env
file. Never put tokens, personal Drive IDs, captions or photographs in Git.
The Codex Drive connector's authentication is not available to this process.

| Variable                 | Value                                                                                     |
| ------------------------ | ----------------------------------------------------------------------------------------- |
| `DRIVE_FOLDER_ID`        | ID of the input folder, not its display name                                              |
| `GOOGLE_ACCESS_TOKEN`    | OAuth token with read access to Drive and Google Docs                                     |
| `INSTAGRAM_ACCOUNT_ID`   | Numeric ID of the target professional account                                             |
| `INSTAGRAM_ACCESS_TOKEN` | Token authorized for content publishing                                                   |
| `META_API_VERSION`       | Explicit supported Graph version, e.g. `v25.0`; verify in your Meta app                   |
| `META_GRAPH_HOST`        | `graph.instagram.com` (Instagram Login, default) or `graph.facebook.com` (Facebook Login) |
| `PUBLISH_API_KEY`        | Random secret of at least 32 characters for this local API                                |
| `PUBLIC_ORIGIN`          | Public HTTPS origin routing `/media/*` to this server                                     |
| `PORT`                   | Optional local port; default 8787                                                         |

Google requires the Drive API and Docs API enabled, an OAuth client, and granted
scopes `https://www.googleapis.com/auth/drive.readonly` and
`https://www.googleapis.com/auth/documents.readonly`. Tokens expire: this first
increment accepts operator-supplied tokens and does not implement token renewal.

Instagram Login requires a Business/Creator account and permissions
`instagram_business_basic` and `instagram_business_content_publish`. Facebook
Login has different permissions and Page/account linkage requirements. Use the
host/token/account combination for the selected login flow. Setup/app access
and permission approval are configured at Meta, not implemented by this API.

Start from repository root, after supplying the variables:

```sh
node scripts/instagram/api.mjs
```

It binds to `127.0.0.1`. Configure an HTTPS reverse proxy for the media route
before publishing; the code does not create a tunnel, change Drive sharing or
upload media to the public website. Keep control routes private. The random
media URL is accessible without Bearer auth for one hour so Meta can fetch it.
Treat that URL as private; anyone who receives it can fetch the image during
that hour. Configure the proxy not to retain media URLs in access logs.

## Operation

1. Put exactly one TXT or Google Doc and one JPEG/PNG/WebP in the folder.
   Multiple candidates stop detection rather than picking arbitrary files.
2. POST `/preview` with `Authorization: Bearer <PUBLISH_API_KEY>`.
   Review `caption`, `sources`, `accountId`, and the returned `imagePath`.
3. POST `/publish/<previewId>` with the same Authorization header to publish
   that exact snapshot. Publication is never triggered by GET or preview.

The source is only read. The caption normalizes whitespace and replaces the
exact hashtag `#EventoExterno` with `#TestDeAPI`; other tags are preserved.
Google Docs person chips become display names, without email addresses or
invented Instagram handles. Images are oriented and converted to JPEG using
`sharp`, bounded to 1080 pixels, without enlargement or cropping. Unsupported
aspect ratios fail. The post uses the snapshot reviewed, even if Drive changes
after preview; generate a new preview to use updated content.

The server creates a container, polls readiness, then calls `media_publish`.
It returns the media ID and, when available, the permalink. Private snapshots
and durable publication records live in ignored `local/instagram/`. Use a
single running process and persistent storage. Do not use ephemeral deployment
storage: removing records loses duplicate protection. The content/account hash
blocks repeat attempts, including after process restart. A failed/uncertain
attempt remains blocked: inspect the local `.publication` record and reconcile
the container/media with Meta before any operator recovery. There is no blind
retry, force override, scheduler, carousel, multi-post matching or batch upload.

Expired media returns 404 but snapshots remain on disk. The operator must
remove expired snapshots according to their retention policy while retaining
publication records. Avoid logging captions or tokens.

## Verification

```sh
node --test tests/data/instagram-api.test.mjs
```

Tests use synthetic data and simulated providers, not the user's accounts. A
successful test does not prove OAuth permissions, HTTPS reachability or actual
Instagram publication. Perform a controlled post only after configuring those.

References: [Meta publishing documentation](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/content-publishing/),
[Meta's Postman collection](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api),
[Drive files.list](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list),
[Docs documents.get](https://developers.google.com/workspace/docs/api/reference/rest/v1/documents/get).
