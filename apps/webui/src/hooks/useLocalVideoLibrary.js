import { useEffect, useState } from "react";

export default function useLocalVideoLibrary() {
  const [localVideoInfo, setLocalVideoInfo] = useState(null);
  const [selectedLocalFile, setSelectedLocalFile] = useState(null);
  const [localVideoFolder, setLocalVideoFolder] = useState(null);
  const [localVideoList, setLocalVideoList] = useState([]);

  useEffect(() => {
    const loadLastFolder = async () => {
      const lastFolder = localStorage.getItem("lastLocalVideoFolder");
      if (!lastFolder) return;

      console.log("[LocalVideo] restore last folder", lastFolder);
      setLocalVideoFolder(lastFolder);

      try {
        const scanResult = await window.localVideo?.scanFolder?.(lastFolder);
        if (scanResult?.ok && scanResult.files) {
          setLocalVideoList(scanResult.files);
          console.log("[LocalVideo] auto load folder files", scanResult.files.length);
        }
      } catch (error) {
        console.error("[LocalVideo] auto load folder failed", error);
        localStorage.removeItem("lastLocalVideoFolder");
      }
    };

    loadLastFolder();
  }, []);

  return {
    localVideoInfo,
    setLocalVideoInfo,
    selectedLocalFile,
    setSelectedLocalFile,
    localVideoFolder,
    setLocalVideoFolder,
    localVideoList,
    setLocalVideoList
  };
}
