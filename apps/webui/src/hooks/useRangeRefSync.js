import { useEffect } from "react";

export default function useRangeRefSync({
  rangeStart,
  rangeEnd,
  isSegmentPreview,
  segmentOffset,
  previewSpan,
  rangeRef,
  clamp
}) {
  useEffect(() => {
    const localStart = isSegmentPreview
      ? clamp(rangeStart - segmentOffset, 0, previewSpan)
      : rangeStart;
    const localEnd = isSegmentPreview
      ? clamp(rangeEnd - segmentOffset, 0, previewSpan)
      : rangeEnd;

    rangeRef.current = { start: localStart, end: localEnd };
  }, [rangeStart, rangeEnd, isSegmentPreview, segmentOffset, previewSpan, rangeRef, clamp]);
}
