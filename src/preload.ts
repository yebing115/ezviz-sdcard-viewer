import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("ezviz", {
  chooseDirectory: () => ipcRenderer.invoke("choose-directory") as Promise<unknown>
});
