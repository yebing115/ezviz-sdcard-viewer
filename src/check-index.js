"use strict";

const path = require("node:path");
const { buildCatalog } = require("./ezviz-index");

const catalog = buildCatalog(path.resolve(__dirname, ".."));
console.log(`index: ${catalog.indexSource}`);
console.log(`records: ${catalog.recordCount}, playable: ${catalog.playableCount}, missing: ${catalog.missingCount}`);
console.log(`range: ${catalog.firstTime} -> ${catalog.lastTime}`);
console.log(`days: ${catalog.days.length}`);
console.log(catalog.days.slice(0, 5).map((day) => `${day.date}: ${day.segments.length}`).join("\n"));
