const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("generator", {
  run: (payload) => ipcRenderer.invoke("generator:run", payload),
  onProgress: (handler) => {
    const listener = (_event, data) => handler(data);
    ipcRenderer.on("generator:progress", listener);
    return () => ipcRenderer.removeListener("generator:progress", listener);
  }
});

contextBridge.exposeInMainWorld("preview", {
  info: (payload) => ipcRenderer.invoke("preview:info", payload),
  resolve: (payload) => ipcRenderer.invoke("preview:resolve", payload),
  prefetch: (payload) => ipcRenderer.invoke("preview:prefetch", payload),
  dashInfo: (payload) => ipcRenderer.invoke("preview:dash:info", payload),
  dashSegment: (payload) => ipcRenderer.invoke("preview:dash:segment", payload)
});

contextBridge.exposeInMainWorld("env", {
  bilibiliPreload: ipcRenderer.sendSync("env:bilibili-preload"),
  bilibiliPagePreload: ipcRenderer.sendSync("env:bilibili-page-preload")
});

contextBridge.exposeInMainWorld("webviewControl", {
  register: (payload) => ipcRenderer.send("webview:register", payload)
});

contextBridge.exposeInMainWorld("auth", {
  status: () => ipcRenderer.invoke("auth:status"),
  login: () => ipcRenderer.invoke("auth:login"),
  getCookie: () => ipcRenderer.invoke("auth:cookie:get"),
  setCookie: (payload) => ipcRenderer.invoke("auth:cookie:set", payload),
  clearCookie: () => ipcRenderer.invoke("auth:cookie:clear"),
  logout: () => ipcRenderer.invoke("auth:logout")
});

contextBridge.exposeInMainWorld("localVideo", {
  selectFolder: () => ipcRenderer.invoke("local-video:select-folder"),
  scanFolder: (folderPath) => ipcRenderer.invoke("local-video:scan-folder", folderPath),
  checkExists: (filePath) => ipcRenderer.invoke("local-video:check-exists", filePath),
  getMetadata: (filePath) => ipcRenderer.invoke("local-video:get-metadata", filePath),
  getInfoQuick: (filePath) => ipcRenderer.invoke("local-video:get-info-quick", filePath),
  load: (filePath) => ipcRenderer.invoke("local-video:load", filePath)
});
