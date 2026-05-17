import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("ezviz", {
  chooseDirectory: (locale: string) => ipcRenderer.invoke("choose-directory", locale) as Promise<unknown>
});
