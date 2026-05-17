"use strict";

const { app, BrowserWindow, shell } = require("electron");
const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { buildCatalog, loadIndex } = require("./ezviz-index");

const BASE_DIR = path.resolve(__dirname, "..");
let server;
let serverPort;

function sendJson(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Access-Control-Allow-Origin": "*"
  });
  res.end(payload);
}

function parseUrl(req) {
  return new URL(req.url, `http://${req.headers.host}`);
}

function streamVideo(req, res, url) {
  const id = url.searchParams.get("id");
  const offset = Math.max(0, Number(url.searchParams.get("offset") || "0"));
  const index = loadIndex(BASE_DIR);
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

  const child = spawn("ffmpeg", ffmpegArgs, { windowsHide: true });
  let stderr = "";

  res.writeHead(200, {
    "Content-Type": "video/mp4",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*"
  });

  child.stdout.pipe(res);
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const stop = () => {
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

function startServer() {
  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      try {
        const url = parseUrl(req);

        if (url.pathname === "/api/catalog") {
          sendJson(res, 200, buildCatalog(BASE_DIR));
          return;
        }

        if (url.pathname === "/video") {
          streamVideo(req, res, url);
          return;
        }

        sendJson(res, 404, { error: "Not found" });
      } catch (error) {
        sendJson(res, 500, { error: error.message });
      }
    });

    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      serverPort = server.address().port;
      resolve(serverPort);
    });
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: "#f4f6f8",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
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

app.whenReady().then(async () => {
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
