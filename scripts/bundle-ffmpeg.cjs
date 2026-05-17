"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "vendor", "ffmpeg");
const outPath = path.join(outDir, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");

function commandOutput(command, args) {
  try {
    return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true }).trim();
  } catch {
    return "";
  }
}

function resolveScoopShim(candidate) {
  const shimPath = candidate.replace(/\.exe$/i, ".shim");
  if (!fs.existsSync(shimPath)) return candidate;

  const shim = fs.readFileSync(shimPath, "utf8");
  const match = shim.match(/path\s*=\s*"([^"]+)"/i);
  return match ? match[1] : candidate;
}

function findFfmpeg() {
  const candidates = [];
  if (process.env.FFMPEG_PATH) candidates.push(process.env.FFMPEG_PATH);

  if (process.platform === "win32") {
    candidates.push(...commandOutput("where.exe", ["ffmpeg"]).split(/\r?\n/).filter(Boolean));
    if (process.env.USERPROFILE) {
      candidates.push(
        path.join(process.env.USERPROFILE, "scoop", "shims", "ffmpeg.exe"),
        path.join(process.env.USERPROFILE, "scoop", "apps", "ffmpeg", "current", "bin", "ffmpeg.exe")
      );
    }
  } else {
    candidates.push(...commandOutput("which", ["ffmpeg"]).split(/\r?\n/).filter(Boolean));
  }

  for (const candidate of candidates) {
    const resolved = process.platform === "win32" ? resolveScoopShim(candidate) : candidate;
    if (resolved && fs.existsSync(resolved)) return resolved;
  }

  return "";
}

const source = findFfmpeg();
if (!source || !fs.existsSync(source)) {
  throw new Error("Cannot find ffmpeg. Set FFMPEG_PATH to an ffmpeg executable.");
}

fs.mkdirSync(outDir, { recursive: true });
fs.copyFileSync(source, outPath);
fs.chmodSync(outPath, 0o755);
console.log(`Bundled ffmpeg: ${source} -> ${outPath}`);
