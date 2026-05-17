import path from "node:path";
import { buildCatalog } from "./ezviz-index";

const baseDir = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
const catalog = buildCatalog(baseDir);

console.log(`directory: ${catalog.baseDir}`);
console.log(`index: ${catalog.indexSource}`);
console.log(`records: ${catalog.recordCount}, playable: ${catalog.playableCount}, missing: ${catalog.missingCount}`);
console.log(`range: ${catalog.firstTime} -> ${catalog.lastTime}`);
console.log(`days: ${catalog.days.length}`);
console.log(catalog.days.slice(0, 5).map((day) => `${day.date}: ${day.segments.length}`).join("\n"));
