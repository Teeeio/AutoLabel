# Repository Guidelines

## Project Structure & Module Organization
- `apps/desktop`: Electron main process and preload scripts (e.g., `apps/desktop/src/main`).
- `apps/webui`: React UI for the community and card workflow (e.g., `apps/webui/src`).
- `packages/core`: Shared logic such as card validation and generator task shapes.
- `dist/`: Build outputs for the desktop app and bundled UI (created by build scripts).

## Build, Test, and Development Commands
Run these from the repository root:
- `npm install`: Install workspace dependencies.
- `npm run dev`: Start the WebUI dev server and launch Electron together.
- `npm run dev:webui`: Start only the React UI for faster iteration.
- `npm run dev:desktop`: Launch Electron and load the running WebUI.
- `npm run build`: Build WebUI and then package the desktop app.
- `npm run build:webui`: Build the React UI to static assets.
- `npm run build:desktop`: Package the Electron app for Windows (NSIS).

## Coding Style & Naming Conventions
- Indentation: 2 spaces for JavaScript/JSON; keep files consistent.
- React components use `PascalCase` file names (e.g., `CardPreview.jsx`).
- Shared utilities and hooks use `camelCase` (e.g., `useCards`).
- Electron main process files use `.cjs` to avoid ESM interop issues.

## Testing Guidelines
- Automated tests are not set up yet. If you add tests, place them near source files and name them `*.test.js` or `*.test.jsx`.
- Include at least one manual smoke check: start `npm run dev`, open the UI, and verify the Generate buttons call the IPC stub.

## Commit & Pull Request Guidelines
- No established commit convention yet. Use Conventional Commits (e.g., `feat: add card preview`, `fix: handle invalid segment`).
- PRs should include a short summary, key screenshots for UI changes, and how you verified behavior.

## Security & Configuration Notes
- Only embed the official Bilibili player URL in iframes.
- Media downloads and ffmpeg processing must run locally on the user device; do not upload media to a server.
- If bundling ffmpeg, document the version and license in the release notes.
