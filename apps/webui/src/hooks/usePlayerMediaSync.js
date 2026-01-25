import { useEffect } from "react";

export default function usePlayerMediaSync({
  volume,
  isMuted,
  playbackRate,
  volumeRef,
  muteRef,
  rateRef,
  sendPlayerCommand
}) {
  useEffect(() => {
    volumeRef.current = volume;
    muteRef.current = isMuted;
    sendPlayerCommand("volume", { value: volume, muted: isMuted });
  }, [volume, isMuted, sendPlayerCommand, volumeRef, muteRef]);

  useEffect(() => {
    rateRef.current = playbackRate;
    sendPlayerCommand("rate", { value: playbackRate });
  }, [playbackRate, sendPlayerCommand, rateRef]);
}
