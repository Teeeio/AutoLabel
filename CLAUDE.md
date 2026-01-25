# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **Random Dance Generator** (快速随舞生成器) - a desktop application built with Electron that allows users to create dance compilations by searching and clipping video segments from Bilibili. The application uses a tag-based community system for content organization.

## Development Commands

### Running the Application
```bash
# Start all services (webui, desktop, server) in development mode
npm run dev

# Start individual services
npm run dev:webui    # React dev server on port 5173
npm run dev:desktop  # Electron app (loads from dev server or built files)
npm run dev:server   # Express API on port 8787
```

The web UI runs on `http://localhost:5173`. The desktop app expects this URL to be available via the `VITE_DEV_SERVER_URL` environment variable.

### Building
```bash
# Build both applications
npm run build

# Build only the web UI (outputs to apps/webui/dist/)
npm run build:webui

# Build only the desktop app (creates Windows NSIS installer)
npm run build:desktop
```

The desktop build outputs to `dist/desktop/` and creates a Windows NSIS installer.

## Architecture

### Monorepo Structure

The project uses NPM workspaces with three packages:

- **`apps/webui/`** - React 18.2.0 + Vite web application
- **`apps/desktop/`** - Electron 30.0.0 desktop wrapper
- **`apps/server/`** - Express.js community API server
- **`packages/core/`** - Shared utilities (currently minimal)

### Key Architectural Pattern

This is a **hybrid web-desktop application** where:
- The web UI provides the core user interface and workflow
- Electron wraps the web UI and provides native capabilities
- Communication happens via Electron IPC (Inter-Process Communication)
- Development mode loads from `http://localhost:5173`, production mode loads built files from `dist/`

### Main Process Architecture (apps/desktop/src/main/)

The Electron main process is split into focused modules:

- **`index.cjs`** - Entry point, window management, IPC handlers orchestration
- **`auth.cjs`** - Bilibili QR code authentication and cookie management
- **`preview.cjs`** - Bilibili video resolution, DASH manifest parsing, segment fetching
- **`generator.cjs`** - Dance generation pipeline (download, clip, stitch, export)
- **`local-video.cjs`** - Local video file management and metadata extraction
- **`preload.cjs`** - Context bridge for renderer-to-main IPC communication
- **`bilibili-preload.cjs`** - Preload script for Bilibili webview integration
- **`bilibili-page-preload.cjs`** - Page injection scripts for Bilibili player hijacking

### Renderer Process (apps/webui/src/)

The React application is split into focused modules:
- **`pages/`** - Main application pages (BuilderPage, CommunityPage, ManagePage)
- **`layout/`** - Layout components
- **`components/`** - Reusable UI components
- **`hooks/`** - Custom React hooks for domain-specific logic
- **`context/`** - React context for state management
- **`routes/`** - Route configuration
- **`utils/`** - Utility functions
- **`App.jsx`** - Orchestrator that wires context + hooks + routes

**Key Custom Hooks:**
- **`usePreviewPlayerState`** - Centralized player state management
- **`useTimelineScrub`** - Timeline interaction and range scrubbing
- **`useCardFormActions`** - Card creation and tag management
- **`useCommunityManager`** - Community API integration
- **`useLocalVideoLibrary`** - Local video file management
- **`useBiliSearchOverlay`** - Bilibili search functionality

## IPC Communication Protocol

### Main → Renderer (via `ipcMain.handle`)

Key IPC handlers exposed in `index.cjs`:

- **`generator:run`** - Execute the dance generation pipeline
- **`preview:resolve`** - Resolve Bilibili video URL to get aid/cid
- **`preview:info`** - Fetch video metadata (title, duration, cid list)
- **`preview:prefetch`** - Prefetch video chunks for smoother playback
- **`local-video:select-folder`** - Open folder picker for local videos
- **`local-video:list`** - List video files in selected folder
- **`local-video:metadata`** - Extract video metadata (duration, dimensions)
- **`auth:login/status`** - Check Bilibili authentication status
- **`auth:login/qr`** - Generate and return QR code for login
- **`auth:login/check`** - Check if QR code has been scanned
- **`auth:cookie`** - Get stored Bilibili cookies

### Custom Protocol

The app registers a custom `rdg://` protocol for local preview handling, enabling secure local resource access.

## Bilibili Integration

### Webview Architecture

The app uses Electron `<webview>` tags to embed Bilibili content:
- Maintains isolation through sandboxing
- Uses official Bilibili player URLs (`https://www.bilibili.com/video/{bvid}`)
- Injects custom scripts to hijack player controls
- Preserves Bilibili's original UI while adding custom timeline scrubbing

### Authentication Flow

1. Main process generates QR code via Bilibili API
2. QR code is displayed in renderer
3. User scans with Bilibili mobile app
4. Main process polls login status
5. Cookies are extracted and stored for authenticated requests
6. Cookies are applied to webview session for embedded player

### Video Processing Pipeline

1. **Search** - Users search for videos on Bilibili
2. **Resolve** - Get video metadata (aid, cid, title, duration)
3. **Preview** - Embed player in webview with custom controls
4. **Select Range** - Use timeline scrubbing to select dance segments
5. **Tag** - Add tags for community organization
6. **Generate** - Process selected cards through generation pipeline

## Code Style & Conventions

### File Naming
- React components: `PascalCase.jsx` (e.g., `App.jsx`, `CardPreview.jsx`)
- Utilities/API modules: `camelCase.js` (e.g., `communityApi.js`)
- Electron main/preload: `.cjs` extension to avoid ESM interop issues

### Module Systems
- **ES Modules** (`import/export`) for WebUI and Server
- **CommonJS** (`require/module.exports`) for Electron main process and Core package

### Naming Conventions
- Functions/variables: `camelCase` (e.g., `createCard`, `getVideoInfo`)
- Constants: `UPPER_SNAKE_CASE` for top-level config
- React components: `PascalCase`
- Event handlers: `handle` prefix (e.g., `handleAddCard`)
- IPC handlers: Domain pattern with colon (e.g., `preview:info`, `auth:login`)

### Error Handling
- Use try/catch for async operations, return error object with `message` property
- Server responses: `{ ok: boolean, message?: string, ...data }` format
- Frontend errors: Store in state, display to user
- Silent failures acceptable for non-critical operations (e.g., prefetch errors)

### React Patterns
- Functional components with hooks only (no class components)
- Use `useCallback` for functions passed to child components
- Use `useMemo` for expensive computations
- Prefer controlled components with state for forms
- Clean up effects properly (remove event listeners, clearTimeout)

## Security & Configuration

- Only embed official Bilibili player URLs
- Set Referer/Origin headers for Bilibili media requests to avoid blocking
- Cookies stored locally in `userData/rdg-cookie.json`, never transmitted to external servers
- Media downloads/ffmpeg processing must run locally on user device
- Session tokens: 7-day TTL default, stored in `sessions.json`
- Passwords: Hashed with `crypto.scryptSync` with random salt

## Environment Variables

- `VITE_DEV_SERVER_URL`: Set by `dev:desktop` script to load dev server
- `COMMUNITY_PORT`: Server port (default: 8787)
- `COMMUNITY_SESSION_TTL_MS`: Session TTL in ms (default: 7 days)
- `RDG_BILI_COOKIE`: Optional env var to pre-populate Bilibili cookie
- `VITE_COMMUNITY_API_URL`: Override community API URL (default: http://localhost:8787)

## Technical Details

### Window Configuration
- Default size: 1200x800
- Autoplay policy override enabled
- Custom protocol `rdg://` registered for local resources

### Time Range Format
- Ranges are in seconds (floating point)
- Minimum range duration: 0.05 seconds (50ms)
- Auto-merge ranges within 0.05 seconds

### Bilibili User Agent
```
"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
```

## Community API

The Express.js server provides RESTful endpoints:
- **Authentication**: `/api/auth/login` (POST)
- **Cards**: `/api/cards` (GET, POST, PATCH, DELETE)
- **Tags**: `/api/tags` (GET, POST, DELETE)
- **User**: `/api/user` (GET)

Query params with `URLSearchParams` for GET requests. Auth via Bearer token in `Authorization` header.
