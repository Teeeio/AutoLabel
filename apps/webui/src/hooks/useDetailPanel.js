import { useCallback } from "react";

export default function useDetailPanel({
  setDetailCard,
  setDetailWebviewLoading,
  detailWebviewKeyRef,
  setPreviewPanelKey,
  setPreviewEpoch,
  setActiveId,
  setPreviewSource,
  setPreviewUrl,
  setPreviewError,
  setDuration,
  setCurrentTime,
  setRangeStart,
  setRangeEnd,
  setSegmentSpan,
  setSegmentOffset,
  setSourceDuration,
  setIsPlaying,
  setIsBuffering,
  setIsDashMode,
  setIsLoadingPreview,
  setIsResolving,
  resetDash
}) {
  const handleOpenCardDetail = useCallback((card) => {
    detailWebviewKeyRef.current += 1;
    setDetailCard(card);
  }, [detailWebviewKeyRef, setDetailCard]);

  const handleCloseDetail = useCallback(() => {
    setDetailCard(null);
    setDetailWebviewLoading(false);
    setPreviewPanelKey((prev) => prev + 1);
    setPreviewEpoch((prev) => prev + 2);
    setActiveId("");
    setPreviewSource(null);
    setPreviewUrl("");
    setPreviewError("");
    setDuration(0);
    setCurrentTime(0);
    setRangeStart(0);
    setRangeEnd(30);
    setSegmentSpan(0);
    setSegmentOffset(0);
    setSourceDuration(0);
    setIsPlaying(false);
    setIsBuffering(false);
    setIsDashMode(false);
    setIsLoadingPreview(false);
    setIsResolving(false);
    resetDash();
  }, [
    setDetailCard,
    setDetailWebviewLoading,
    setPreviewPanelKey,
    setPreviewEpoch,
    setActiveId,
    setPreviewSource,
    setPreviewUrl,
    setPreviewError,
    setDuration,
    setCurrentTime,
    setRangeStart,
    setRangeEnd,
    setSegmentSpan,
    setSegmentOffset,
    setSourceDuration,
    setIsPlaying,
    setIsBuffering,
    setIsDashMode,
    setIsLoadingPreview,
    setIsResolving,
    resetDash
  ]);

  return {
    handleOpenCardDetail,
    handleCloseDetail
  };
}
