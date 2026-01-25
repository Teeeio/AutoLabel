import { useCallback, useEffect, useRef, useState } from "react";

import {
  SEARCH_CSS,
  SEARCH_ISOLATE_SCRIPT,
  buildSearchUrl as buildBiliSearchUrl
} from "../utils/bilibiliSearch";

export default function useBiliSearchOverlay({
  searchWebviewRef,
  searchResultsLimit = 6,
  handleQueuePreview,
  patchSearchWebviewIframeHeight,
  extractBvid,
  initialSuggestion = "LoveLive"
}) {
  const searchSuggestion = initialSuggestion;
  const [searchQuery, setSearchQuery] = useState("");
  const [searchUrl, setSearchUrl] = useState(
    buildBiliSearchUrl(searchSuggestion)
  );
  const [isSearchLoading, setIsSearchLoading] = useState(false);
  const [showSearchOverlay, setShowSearchOverlay] = useState(true);
  const [searchDebugLines, setSearchDebugLines] = useState([]);
  const searchOverlayRef = useRef({ key: "", ready: false });

  const pushSearchDebug = useCallback((message) => {
    const text = String(message || "").trim();
    if (!text) return;
    const stamp = new Date().toTimeString().slice(0, 8);
    setSearchDebugLines((prev) => {
      const next = [...prev, `[${stamp}] ${text}`];
      return next.slice(-120);
    });
  }, []);

  const handleSearchSubmit = useCallback(
    (event) => {
      if (event?.preventDefault) event.preventDefault();
      const trimmed = searchQuery.trim();
      const keyword = trimmed || searchSuggestion;
      if (!keyword) return;
      const nextUrl = buildBiliSearchUrl(keyword);
      searchOverlayRef.current = { key: nextUrl, ready: false };
      setShowSearchOverlay(true);
      setSearchUrl(nextUrl);
    },
    [searchQuery, searchSuggestion]
  );

  useEffect(() => {
    const view = searchWebviewRef.current;
    if (!view || !searchUrl) return;

    const limit = Math.max(1, searchResultsLimit);

    const applySearchPatch = () => {
      view.insertCSS(SEARCH_CSS);
      view.executeJavaScript(SEARCH_ISOLATE_SCRIPT, true);
      patchSearchWebviewIframeHeight(view);
    };

    const handleDomReady = () => {
      setIsSearchLoading(false);
      pushSearchDebug("webview:dom-ready");
      applySearchPatch();
    };

    const handleStartLoading = () => {
      setIsSearchLoading(true);
    };

    const handleStopLoading = () => {
      setIsSearchLoading(false);
      applySearchPatch();
    };

    const handleNavigate = (event) => {
      const bvid = extractBvid(event.url);
      if (!bvid) return;
      if (event.preventDefault) event.preventDefault();
      handleQueuePreview({ bvid, status: "ready" });
    };

    const handleNewWindow = (event) => {
      const bvid = extractBvid(event.url);
      if (!bvid) return;
      if (event.preventDefault) event.preventDefault();
      handleQueuePreview({ bvid, status: "ready" });
    };

    const handleConsoleMessage = (event) => {
      const text = event.message || "";
      if (text.startsWith("rdg-mask:ready")) {
        searchOverlayRef.current = {
          ...searchOverlayRef.current,
          ready: true
        };
        setShowSearchOverlay(false);
        return;
      }
      if (text.startsWith("rdg-debug:")) {
        pushSearchDebug(text.replace("rdg-debug:", "").trim());
        return;
      }
      if (!text.startsWith("rdg-bvid:")) return;
      const bvid = text.replace("rdg-bvid:", "").trim();
      if (!bvid) return;
      handleQueuePreview({ bvid, status: "ready" });
    };

    view.addEventListener("dom-ready", handleDomReady);
    view.addEventListener("did-start-loading", handleStartLoading);
    view.addEventListener("did-stop-loading", handleStopLoading);
    view.addEventListener("will-navigate", handleNavigate);
    view.addEventListener("new-window", handleNewWindow);
    view.addEventListener("console-message", handleConsoleMessage);

    return () => {
      view.removeEventListener("dom-ready", handleDomReady);
      view.removeEventListener("did-start-loading", handleStartLoading);
      view.removeEventListener("did-stop-loading", handleStopLoading);
      view.removeEventListener("will-navigate", handleNavigate);
      view.removeEventListener("new-window", handleNewWindow);
      view.removeEventListener("console-message", handleConsoleMessage);
    };
  }, [
    searchUrl,
    searchResultsLimit,
    handleQueuePreview,
    pushSearchDebug,
    searchWebviewRef,
    patchSearchWebviewIframeHeight,
    extractBvid
  ]);

  return {
    searchSuggestion,
    searchQuery,
    setSearchQuery,
    searchUrl,
    setSearchUrl,
    isSearchLoading,
    showSearchOverlay,
    setShowSearchOverlay,
    searchDebugLines,
    handleSearchSubmit
  };
}
