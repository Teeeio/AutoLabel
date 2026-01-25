import { useEffect } from "react";

export default function usePreviewPreload({
  locationPathname,
  cards,
  communityCardResults,
  managePreloaded,
  setManagePreloaded,
  communityPreloaded,
  setCommunityPreloaded,
  webviewManageIds,
  setWebviewManageIds,
  manageLoadingState,
  setManageLoadingState,
  webviewCommunityIds,
  setWebviewCommunityIds,
  communityLoadingState,
  setCommunityLoadingState,
  manageWebviewTimerRef,
  communityWebviewTimerRef
}) {
  useEffect(() => {
    if (locationPathname !== "/manage" && locationPathname !== "/") return;
    if (managePreloaded || !cards.length) return;

    const timer = setTimeout(() => {
      const newIds = new Set(webviewManageIds);
      const newLoadingStates = new Map(manageLoadingState);
      const preloadCount = 0;

      for (let i = 0; i < preloadCount; i++) {
        const card = cards[i];
        if (!newIds.has(card.id)) {
          newIds.add(card.id);
          newLoadingStates.set(card.id, {
            webviewLoading: true,
            webviewStartTime: Date.now()
          });
        }
      }

      setWebviewManageIds(newIds);
      setManageLoadingState(newLoadingStates);
      setManagePreloaded(true);
    }, 500);

    manageWebviewTimerRef.current = timer;
    return () => clearTimeout(timer);
  }, [
    locationPathname,
    cards,
    managePreloaded,
    webviewManageIds,
    manageLoadingState,
    setWebviewManageIds,
    setManageLoadingState,
    setManagePreloaded,
    manageWebviewTimerRef
  ]);

  useEffect(() => {
    if (locationPathname !== "/community") return;
    if (communityPreloaded || !communityCardResults.length) return;

    const timer = setTimeout(() => {
      const newIds = new Set(webviewCommunityIds);
      const newLoadingStates = new Map(communityLoadingState);
      const preloadCount = 0;

      for (let i = 0; i < preloadCount; i++) {
        const card = communityCardResults[i];
        if (!newIds.has(card.id)) {
          newIds.add(card.id);
          newLoadingStates.set(card.id, {
            webviewLoading: true,
            webviewStartTime: Date.now()
          });
        }
      }

      setWebviewCommunityIds(newIds);
      setCommunityLoadingState(newLoadingStates);
      setCommunityPreloaded(true);
    }, 500);

    communityWebviewTimerRef.current = timer;
    return () => clearTimeout(timer);
  }, [
    locationPathname,
    communityCardResults,
    communityPreloaded,
    webviewCommunityIds,
    communityLoadingState,
    setWebviewCommunityIds,
    setCommunityLoadingState,
    setCommunityPreloaded,
    communityWebviewTimerRef
  ]);
}
