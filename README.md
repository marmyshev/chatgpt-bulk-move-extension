# ChatGPT Bulk Move Chats

A TypeScript / Manifest V3 Chrome extension that lists your ChatGPT conversations, lets you select any subset of them, and bulk-moves them into a project.

Version 0.3.0 replaced the previous DOM/click automation with direct calls to ChatGPT's own backend API, issued from a content script running on `chatgpt.com` (so cookies, `Origin`, and Cloudflare clearance all apply automatically).

Permissions requested: `storage` (settings), `activeTab` + `scripting` (inject the panel into an already-open tab), and the `https://chatgpt.com/*` host permission (so the popup can identify the ChatGPT tab).

## Important limitation

`/backend-api/*` is an undocumented, private API. It can change or disappear without notice. Use at your own risk, and prefer small batches first.

## How it works

```
Popup (launcher)  ──OPEN_PANEL──▶  Content script on chatgpt.com
                                        │
                                        ├── Shadow DOM overlay panel (list + selection)
                                        └── API client (same-origin fetch)
```

### Endpoints used

| Purpose | Request |
|---|---|
| Access token | `GET /api/auth/session` → `accessToken` |
| Account id | `GET /backend-api/accounts/check/v4-2023-04-27` → `chatgpt-account-id` header |
| Conversations | `GET /backend-api/conversations?offset=N&limit=100&order=updated&is_archived=false`, paged until `total` |
| Projects | `GET /backend-api/gizmos/snorlax/sidebar?conversations_per_gizmo=0&limit=20&owned_only=false`, cursor-paged |
| Move | `PATCH /backend-api/conversation/{id}` with body `{"gizmo_id":"g-p-..."}` → `{"success":true}` |

Every request carries `authorization: Bearer <token>`, `chatgpt-account-id`, and `oai-device-id` (read from the `oai-did` cookie).

### Resilience

- `401` / `403` → the session token is re-fetched once and the request retried.
- `429` and `5xx` → exponential backoff honoring `Retry-After`, up to 5 attempts.
- A failed individual move is recorded on its row and does not abort the batch.

## Using it

1. Open `https://chatgpt.com/`.
2. Click the extension icon, then **Open panel**.
3. The panel loads every project and every conversation (paged, progress shown in the header).
4. Choose a scope: **Chats without a project**, **All chats**, or **In: \<project\>**.
5. Optionally filter by title, sort by Title or Updated, and toggle **Archived · include**.
6. Select rows with the checkboxes. Shift-click selects a range. **Select all shown** respects the current filter.
7. Pick a destination in **Move to project** (or **— Remove from project —** to clear the assignment).
8. Click **Move selected**.

Progress is shown per row (`pending` → `moving` → `moved` / `failed`) and in the footer. **Stop** halts after the current move finishes.

ChatGPT's own sidebar does not live-update from these API calls — reload the page to see the new grouping.

Press `Escape` or click the backdrop to close the panel (disabled while a run is in progress).

## Settings

- **Delay between moves (ms)** — set in the popup or the panel, persisted in `chrome.storage.sync`. Default `400`. Lower it to go faster at a higher risk of rate limiting.

## Build locally

```bash
npm install
npm run typecheck
npm run build
```

The unpacked extension is generated in `dist/`.

## Install locally

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the generated `dist/` directory.
5. Open or reload `https://chatgpt.com/`.

## Source layout

| File | Role |
|---|---|
| [`src/api.ts`](src/api.ts) | Same-origin ChatGPT backend client: auth, paging, retries, move |
| [`src/panel.ts`](src/panel.ts) | Shadow DOM overlay: list, filters, selection, sequential move runner |
| [`src/panel-styles.ts`](src/panel-styles.ts) | Panel CSS, injected into the shadow root |
| [`src/content.ts`](src/content.ts) | Thin host: mounts/unmounts the panel, answers popup messages |
| [`src/popup.ts`](src/popup.ts) | Launcher: delay setting, open panel, stop, status |
| [`src/shared.ts`](src/shared.ts) | Shared types and message contracts |

## GitHub Actions CI

The repository includes `.github/workflows/ci.yml`. The workflow runs on:

- every push,
- every pull request, and
- manual runs via **Actions → Build Chrome Extension → Run workflow**.

CI performs these steps:

1. installs Node.js 24,
2. installs dependencies,
3. runs TypeScript type checking,
4. builds the Manifest V3 extension into `dist/`,
5. packages `dist/` as `chatgpt-bulk-move-extension-v<VERSION>.zip`, and
6. uploads that ZIP as the `chatgpt-bulk-move-extension` GitHub Actions artifact.

### Download a CI build

1. Open the repository on GitHub.
2. Open **Actions**.
3. Select a successful **Build Chrome Extension** run.
4. Scroll to **Artifacts**.
5. Download `chatgpt-bulk-move-extension`.
6. Extract the downloaded GitHub artifact once to get the extension ZIP. Extract that ZIP and select its contents with Chrome's **Load unpacked**.

Artifacts are retained for 30 days by the workflow configuration.

## Known limitations

- Private API; a ChatGPT backend change can break the extension.
- Moves are sequential by design to stay well under rate limits.
- The ChatGPT sidebar needs a page reload to reflect the new grouping.
- Projects shared with you but not owned by you may reject a move; that row is marked `failed` with the server message.
