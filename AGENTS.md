# Repository Guidelines

## Project Structure & Module Organization
- `apps/desktop/`: Electron main process and preload scripts. Main entry: `src/main/index.cjs`
- `apps/webui/`: React UI for card/community workflow. Entry: `src/main.jsx`
- `apps/webui/src/`: WebUI code split into `pages/`, `layout/`, `components/`, `hooks/`, `routes/`, `context/`, `utils/`
- `apps/webui/src/App.jsx`: Orchestrator that wires context + hooks + routes; keep page/layout UI in their respective modules
- `apps/server/`: Express.js backend API for community features. Entry: `index.js`
- `packages/core/`: Shared utilities and validation logic. Entry: `src/card.js`
- `dist/`: Build outputs for desktop app and bundled UI (created by build scripts)

## Build, Test, and Development Commands
Run these from the repository root:
- `npm install`: Install all workspace dependencies
- `npm run dev`: Start WebUI (port 5173), Desktop (Electron), and Server (port 8787) together
- `npm run dev:webui`: Start only the React UI dev server
- `npm run dev:desktop`: Launch Electron and load the running WebUI
- `npm run dev:server`: Start only the Express API server
- `npm run build`: Build WebUI to static assets and package Electron app for Windows (NSIS)
- `npm run build:webui`: Build React UI with Vite to `apps/webui/dist/`
- `npm run build:desktop`: Package Electron app using electron-builder

Note: No automated tests are configured. Manual testing is required: run `npm run dev`, open the UI, verify IPC handlers work (e.g., preview:info, auth:login).

## Code Style & Naming Conventions

### File Naming
- React components: `PascalCase.jsx` (e.g., `App.jsx`, `CardPreview.jsx`)
- Utilities/API modules: `camelCase.js` (e.g., `communityApi.js`, `index.css`)
- Electron main/preload: `.cjs` extension to avoid ESM interop issues
- Shared core package: `.js` with CommonJS exports

### Indentation & Formatting
- Use 2 spaces for indentation across all files (JavaScript, JSON, CSS)
- No trailing whitespace
- Maintain consistent line breaks (LF recommended, though the project may use CRLF on Windows)

### Imports & Exports
- **ES Modules** (`import/export`) for WebUI and Server:
  ```javascript
  import { useState, useEffect } from "react";
  export async function login({ username, password }) { ... }
  ```
- **CommonJS** (`require/module.exports`) for Core package and Electron main:
  ```javascript
  const { app, BrowserWindow } = require("electron");
  module.exports = { isValidSegment };
  ```
- Import React hooks first, then third-party modules, then local modules

### Naming Conventions
- Functions/variables: `camelCase` (e.g., `createCard`, `getVideoInfo`, `handleSearchSubmit`)
- Constants: `UPPER_SNAKE_CASE` for top-level config (e.g., `bilibiliUserAgent`)
- React components: `PascalCase` (e.g., `App`, `CardList`)
- Event handlers: `handle` prefix (e.g., `handleAddCard`, `handleKeyDown`)
- Async functions: `await` inside try/catch, return consistent error shape

### Error Handling
- Use try/catch for async operations, return error object with `message` property
- Server responses: `{ ok: boolean, message?: string, ...data }` format
- Frontend errors: Store in state, display to user (e.g., `setCommunityStatus({ loading: false, error: "..." })`)
- Silent failures acceptable for non-critical operations (e.g., prefetch errors ignored)
- Always check for `undefined`/null before accessing properties

### React Patterns
- Functional components with hooks only (no class components)
- Use `useCallback` for functions passed to child components or used as dependencies
- Use `useMemo` for expensive computations
- Prefer controlled components with state for forms
- Clean up effects properly (remove event listeners, clearTimeout)

### Electron IPC Patterns
- IPC handlers named with domain pattern: `preview:info`, `auth:login`, `generator:run`
- Main process: `ipcMain.handle("name", async (event, payload) => { ... })`
- Renderer: `window.electronAPI.invoke("name", payload)` (exposed via preload)
- Cookie management: Store in `userData/rdg-cookie.json`, use `path.join(app.getPath("userData"), ...)`

### API Patterns
- RESTful endpoints: `/api/cards`, `/api/tags`, `/api/auth/login`
- Query params with `URLSearchParams` for GET requests
- POST/DELETE/PATCH for mutations, return `{ ok: boolean, item?: object }`
- Auth: Bearer token via `Authorization: Bearer <token>` header
- Pagination: `page` and `pageSize` query params, return `{ items, total, page, pageSize }`

## Security & Configuration Notes
- Only embed official Bilibili player URLs (`player.bilibili.com` or `www.bilibili.com/video/`)
- Set Referer/Origin headers for Bilibili media requests to avoid blocking
- Cookies stored locally, never transmitted to external servers
- Media downloads/ffmpeg processing must run locally on user device
- Session tokens: 7-day TTL default, stored in `sessions.json`
- Passwords: Hashed with `crypto.scryptSync` with random salt

## Commit & Pull Request Guidelines
- Use Conventional Commits format: `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`
  - Examples: `feat: add preview quality selector`, `fix: handle invalid BVID`, `refactor: extract card hydration logic`
- PRs should include: short summary of changes, key screenshots for UI changes, and manual testing steps
- After changes: Run `npm run build` to verify build succeeds, test UI manually

## Environment Variables
- `VITE_DEV_SERVER_URL`: Set by `dev:desktop` script to load dev server
- `COMMUNITY_PORT`: Server port (default: 8787)
- `COMMUNITY_SESSION_TTL_MS`: Session TTL in ms (default: 7 days)
- `RDG_BILI_COOKIE`: Optional env var to pre-populate Bilibili cookie
- `VITE_COMMUNITY_API_URL`: Override community API URL (default: http://localhost:8787)
