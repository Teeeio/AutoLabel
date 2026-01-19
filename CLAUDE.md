# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **Random Dance Generator** (快速随舞生成器) - a desktop application built with Electron that allows users to create dance compilations by searching and clipping video segments from Bilibili. The application uses a tag-based community system for content organization.

## Development Commands

### Running the Application
```bash
# Start both webui and desktop in development mode
npm run dev

# Start only the web UI (React + Vite)
npm run dev:webui

# Start only the desktop app (Electron)
npm run dev:desktop
```

The web UI runs on `http://localhost:5173`. The desktop app expects this URL to be available via the `VITE_DEV_SERVER_URL` environment variable.

### Building
```bash
# Build both applications
npm run build

# Build only the web UI
npm run build:webui

# Build only the desktop app (creates Windows installer)
npm run build:desktop
```

The desktop build outputs to `dist/desktop/` and creates a Windows NSIS installer.

## Architecture

### Monorepo Structure

The project uses NPM workspaces with three packages:

- **`apps/webui/`** - React 18.2.0 + Vite web application
- **`apps/desktop/`** - Electron 30.0.0 desktop wrapper
- **`packages/core/`** - Shared utilities (currently minimal)

### Key Architectural Pattern

This is a **hybrid web-desktop application** where:
- The web UI provides the core user interface and workflow
- Electron wraps the web UI and provides native capabilities
- Communication happens via Electron IPC (Inter-Process Communication)

### Main Process Architecture (apps/desktop/src/main/)

The Electron main process is split into focused modules:

- **`index.cjs`** - Entry point, window management, IPC handlers orchestration
- **`auth.cjs`** - Bilibili QR code authentication and cookie management
- **`preview.cjs`** - Bilibili video resolution, DASH manifest parsing, segment fetching
- **`generator.cjs`** - Dance generation pipeline (download, clip, stitch, export)
- **`preload.cjs`** - Context bridge for renderer-to-main IPC communication
- **`bilibili-preload.cjs`** - Preload script for Bilibili webview integration
- **`bilibili-page-preload.cjs`** - Page injection scripts for Bilibili player hijacking

### Renderer Process (apps/webui/src/)

The React application is currently a single-file application (`App.jsx`) containing:
- Bilibili video search UI
- Timeline-based video segment selection with range scrubbing
- Card-based workflow for organizing dance segments
- Tag management (search tags + clip tags)
- Embedded Bilibili player with custom controls

## IPC Communication Protocol

### Main → Renderer (via `ipcMain.handle`)

Key IPC handlers exposed in `index.cjs`:

- **`generator:run`** - Execute the dance generation pipeline
- **`preview:resolve`** - Resolve Bilibili video URL to get aid/cid
- **`preview:info`** - Fetch video metadata (title, duration, cid list)
- **`preview:prefetch`** - Prefetch video chunks for smoother playback
- **`auth:login/status`** - Check Bilibili authentication status
- **`auth:login/qr`** - Generate and return QR code for login
- **`auth:login/check`** - Check if QR code has been scanned

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

## Technical Details

### File Format Conventions

- **`.cjs`** - CommonJS modules (Electron main process, Node.js)
- **`.jsx`** - React components with JSX (Renderer process)
- ES modules used in webui, CommonJS in desktop

### State Management

- No external state management library
- Uses React hooks (useState, useEffect, useRef, useMemo, useCallback)
- IPC bridges render state to main process actions

### Build Configuration

- **Vite** serves web UI on port 5173
- **Electron Builder** packages desktop app with NSIS installer
- Desktop app expects web UI to be built to `dist/` directory

### Environment Detection

Development mode is determined by `process.env.VITE_DEV_SERVER_URL` in the desktop app, which affects:
- Whether to load from dev server or built files
- Window positioning and debugging features

## Key Constants and Patterns

### Bilibili User Agent
```javascript
"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
```

### Time Range Format
- Ranges are in seconds (floating point)
- Minimum range duration: 0.05 seconds (50ms)
- Auto-merge ranges within 0.05 seconds

### Window Configuration
- Default size: 1200x800
- Autoplay policy override enabled
- Custom protocol `rdg://` registered for local resources
