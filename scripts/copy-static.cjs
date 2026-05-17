"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const rendererSrc = path.join(root, "src", "renderer");
const rendererDest = path.join(root, "dist", "renderer");

fs.mkdirSync(rendererDest, { recursive: true });

for (const name of ["index.html", "styles.css"]) {
  fs.copyFileSync(path.join(rendererSrc, name), path.join(rendererDest, name));
}
