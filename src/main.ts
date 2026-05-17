import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import fs from "node:fs";
import http, { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { buildCatalog, loadIndex, type Catalog } from "./ezviz-index";

interface ChooseDirectoryResult {
  ok: boolean;
  canceled?: boolean;
  catalog?: Catalog;
  error?: string;
}

let server: http.Server | undefined;
let serverPort: number | undefined;
let selectedBaseDir: string | null = null;

function ffmpegExecutable(): string {
  const executable = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  const bundled = app.isPackaged
    ? path.join(process.resourcesPath, "ffmpeg", executable)
    : path.join(__dirname, "..", "vendor", "ffmpeg", executable);

  return fs.existsSync(bundled) ? bundled : "ffmpeg";
}

function settingsPath(): string {
  return path.join(app.getPath("userData"), "settings.json");
}

function loadSettings(): void {
  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath(), "utf8")) as { baseDir?: string };
    if (settings.baseDir && fs.existsSync(settings.baseDir)) {
      selectedBaseDir = settings.baseDir;
    }
  } catch {
    selectedBaseDir = null;
  }
}

function saveSettings(): void {
  fs.mkdirSync(app.getPath("userData"), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify({ baseDir: selectedBaseDir }, null, 2));
}

function requireSelectedBaseDir(): string {
  if (!selectedBaseDir) {
    throw new Error("请先选择包含 index00.bin/index01.bin 和 hiv*.mp4 的目录");
  }
  return selectedBaseDir;
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Access-Control-Allow-Origin": "*"
  });
  res.end(payload);
}

function parseUrl(req: IncomingMessage): URL {
  return new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
}

function streamVideo(req: IncomingMessage, res: ServerResponse, url: URL): void {
  const id = url.searchParams.get("id");
  const offset = Math.max(0, Number(url.searchParams.get("offset") || "0"));
  const index = loadIndex(requireSelectedBaseDir());
  const record = index.records.find((item) => String(item.index) === String(id));

  if (!record || !record.exists) {
    sendJson(res, 404, { error: "Recording fragment not found" });
    return;
  }

  const startOffset = Math.min(offset, Math.max(0, record.durationSeconds - 1));
  const ffmpegArgs = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-ss",
    String(startOffset),
    "-i",
    record.filePath,
    "-map",
    "0:v:0",
    "-map",
    "0:a?",
    "-c:v",
    "copy",
    "-c:a",
    "copy",
    "-bsf:a",
    "aac_adtstoasc",
    "-movflags",
    "frag_keyframe+empty_moov+default_base_moof",
    "-f",
    "mp4",
    "pipe:1"
  ];

  const child = spawn(ffmpegExecutable(), ffmpegArgs, { windowsHide: true });
  let stderr = "";

  res.writeHead(200, {
    "Content-Type": "video/mp4",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*"
  });

  child.stdout.pipe(res);
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  const stop = (): void => {
    if (!child.killed) {
      child.kill("SIGKILL");
    }
  };

  req.on("close", stop);
  res.on("close", stop);

  child.on("error", (error) => {
    if (!res.headersSent) {
      sendJson(res, 500, { error: error.message });
    } else {
      res.destroy(error);
    }
  });

  child.on("close", (code) => {
    if (code !== 0 && !res.destroyed && stderr) {
      console.error(stderr);
    }
  });
}

function startServer(): Promise<number> {
  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      try {
        const url = parseUrl(req);

        if (url.pathname === "/api/catalog") {
          sendJson(res, 200, buildCatalog(requireSelectedBaseDir()));
          return;
        }

        if (url.pathname === "/video") {
          streamVideo(req, res, url);
          return;
        }

        sendJson(res, 404, { error: "Not found" });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sendJson(res, 500, { error: message });
      }
    });

    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server?.address();
      if (!address || typeof address === "string") {
        reject(new Error("Cannot determine local server port"));
        return;
      }
      serverPort = address.port;
      resolve(serverPort);
    });
  });
}

function createWindow(): void {
  if (!serverPort) {
    throw new Error("Local server is not started");
  }

  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: "#f4f6f8",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.js")
    }
  });

  win.loadFile(path.join(__dirname, "renderer", "index.html"), {
    query: { port: String(serverPort) }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

function registerIpc(): void {
  ipcMain.handle("choose-directory", async (event): Promise<ChooseDirectoryResult> => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const options: Electron.OpenDialogOptions = {
      title: "选择包含 bin 和 mp4 文件的目录",
      properties: ["openDirectory"]
    };
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);

    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, canceled: true };
    }

    const nextDir = result.filePaths[0];
    try {
      const catalog = buildCatalog(nextDir);
      selectedBaseDir = nextDir;
      saveSettings();
      return { ok: true, catalog };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: message };
    }
  });
}

app.whenReady().then(async () => {
  loadSettings();
  registerIpc();
  await startServer();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (server) server.close();
  if (process.platform !== "darwin") app.quit();
});
