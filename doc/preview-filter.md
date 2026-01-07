# Preview Filter Implementation

## Goal
Keep only the Bilibili player video area visible inside the webview without moving DOM nodes, so playback remains stable.

## Core Approach
We use a visibility-based isolation strategy in the iframe preload:

1) Enable isolation.
2) Locate the exact video area using a strict selector.
3) Add marker classes to the target node and all ancestors.
4) Inject CSS that hides everything by default, then reveals only the marked subtree.

This keeps the original DOM intact and avoids breaking Bilibili's internal player logic.

## Key Selector
We target the exact video area inside the Bilibili player:

```
#bilibili-player > div > div > div.bpx-player-primary-area > div.bpx-player-video-area
```

## Implementation Details
File: `apps/desktop/src/main/bilibili-page-preload.cjs`

- Enable isolation with `ENABLE_ISOLATION = true`.
- Add constants:
  - `KEEP_SELECTOR`
  - `KEEP_ANCESTOR_CLASS`
  - `KEEP_TARGET_CLASS`
  - `KEEP_ROOT_CLASS`

- On `DOMContentLoaded`, run `mountPlayer()` before other initialization.

### mountPlayer()
- Find the target node using `KEEP_SELECTOR`.
- Add `KEEP_ANCESTOR_CLASS` to the node and all ancestors.
- Add `KEEP_TARGET_CLASS` to the target node.
- Add `KEEP_ROOT_CLASS` to `document.documentElement`.

### ensureStyle()
- Inject a single style tag that:
  - Hides all elements with `visibility: hidden` and disables pointer events.
  - Re-enables visibility and pointer events for the marked ancestor chain and target subtree.
  - Forces the target node to fill the viewport.

## Why This Works
- We do not move DOM nodes, so Bilibili's event bindings remain intact.
- Visibility isolation only affects presentation, not structure.
- The target subtree stays interactive (`pointer-events: auto`).

## Notes
- If the selector stops working (Bilibili DOM changes), update `KEEP_SELECTOR`.
- The isolation must run after the DOM is ready; otherwise the target node will not exist.
