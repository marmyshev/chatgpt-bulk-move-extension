# ChatGPT Bulk Move Chats

A small TypeScript / Manifest V3 Chrome extension that automates the **visible ChatGPT UI** to move chats from the root **Chats** section into a selected project.

It deliberately does **not** call undocumented ChatGPT APIs.

## Important limitation

The ChatGPT DOM and menu structure are private implementation details and can change at any time. This extension uses conservative DOM heuristics and English UI labels. If it cannot confidently identify the root chat section, it stops rather than scanning every conversation link.

Before moving everything, use **Test one**.

## Build locally

```bash
npm install
npm run typecheck
npm run build
```

The unpacked extension is generated in `dist/`.

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

## Install locally

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the generated `dist/` directory.
5. Open or reload `https://chatgpt.com/`.
6. Open the extension popup.
7. Enter the **exact** destination project name.
8. Click **Test one**.
9. Verify the chat moved to the correct project.
10. Click **Move all**.

Keep the ChatGPT tab open during the run.

## How it works

For each currently loaded chat in the root Chats section:

1. Finds the first visible `/c/...` link after the root `Chats` heading.
2. Dispatches a right-click (`contextmenu`) event.
3. Falls back to the row's menu/options button if needed.
4. Clicks `Move to project`.
5. Selects the exact destination project name.
6. Waits for the row to disappear from the root list.
7. If the chat does not move, or the requested project is unavailable for that chat, records it as **Skipped** and continues.
8. Repeats.
9. If no chat is available, attempts `Show more` / `Load more` or scrolls the sidebar to trigger lazy loading.
10. Stops after several stable empty rounds.

## Selector/text maintenance

The main UI assumptions are isolated near the top of `src/content.ts`:

```ts
const UI_TEXT = {
  rootSectionLabels: ["Chats", "Recent", "Your chats"],
  moveToProject: ["Move to project"],
  loadMore: ["Show more", "Load more"],
  projectSearchPlaceholders: ["Search projects", "Search"]
};
```

If ChatGPT changes its labels or DOM structure, update these heuristics rather than spreading selectors throughout the code.

## Safety behavior

- It only considers conversation links in the sidebar that appear after the recognized root chat section label.
- If the root section cannot be confidently located, it stops.
- If more than one visible project menu item has the exact requested name, it stops rather than clicking an ambiguous destination.
- A failed individual chat does not abort the batch; it is marked skipped and excluded from further attempts during that run.
- A missing destination project for a particular chat is treated as a skip.
- A move is only counted as successful after the chat disappears from the root list.
- A Stop button cancels the loop.
- There is a configurable delay between attempts.

## Known limitations

- English ChatGPT UI is assumed by default.
- Duplicate project names are intentionally treated as ambiguous.
- A future ChatGPT UI update may require selector changes.
- Context-menu automation may behave differently if ChatGPT replaces its menu implementation.
- This is UI automation, so it is slower and less stable than an official bulk-move API would be.

## Publish this repository to GitHub

Create an empty repository on GitHub, then from this project directory run:

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin git@github.com:<owner>/<repository>.git
git push -u origin main
```

After the first push, the **Build Chrome Extension** workflow runs automatically. No repository secrets are required for the build workflow.
