"use strict";

const fs = require("node:fs");
const path = require("node:path");

const INDEX_NAMES = ["index00.bin", "index01.bin"];
const MIN_TS = 1262304000;
const MAX_TS = 4102444800;

function readU32(buf, offset) {
  return buf.readUInt32LE(offset);
}

function readU16(buf, offset) {
  return buf.readUInt16LE(offset);
}

function isPlausibleTimeRange(startTs, endTs) {
  return (
    startTs >= MIN_TS &&
    startTs <= MAX_TS &&
    endTs >= MIN_TS &&
    endTs <= MAX_TS &&
    endTs >= startTs
  );
}

function tsToIsoLike(ts) {
  return new Date(ts * 1000).toISOString().replace("T", " ").slice(0, 19);
}

function toDateKey(ts) {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

function findRecordStart(buf) {
  for (let offset = 0x40; offset < buf.length - 32; offset += 16) {
    if (buf[offset + 4] === 0x01 && buf[offset + 5] === 0x00 && readU32(buf, offset) === 0) {
      return offset;
    }
  }
  throw new Error("Cannot find index record area");
}

function parseIndexBuffer(buf, baseDir) {
  if (buf.length < 0x500) {
    throw new Error("Index file is too small");
  }

  const header = {
    magic: readU32(buf, 0x00),
    version: readU32(buf, 0x08),
    fileCount: readU32(buf, 0x0c),
    blockSize: readU32(buf, 0x10),
    writePos: readU32(buf, 0x14),
    maxIndex: readU32(buf, 0x18)
  };

  const special = {
    index: readU16(buf, 0x30),
    flag: readU16(buf, 0x32),
    startTs: readU32(buf, 0x34),
    endTs: readU32(buf, 0x38)
  };

  const recordStart = findRecordStart(buf);
  const records = [];

  for (let i = 0; i < header.fileCount; i += 1) {
    const offset = recordStart + i * 32;
    if (offset + 32 > buf.length) break;

    const index = readU32(buf, offset);
    const channel = readU16(buf, offset + 4);
    const type = readU16(buf, offset + 6);
    const startTs = readU32(buf, offset + 8);
    const endTs = readU32(buf, offset + 12);
    const blockCount = readU32(buf, offset + 20);
    const filename = `hiv${String(index).padStart(5, "0")}.mp4`;
    const filePath = path.join(baseDir, filename);

    if (!isPlausibleTimeRange(startTs, endTs)) continue;

    records.push({
      id: String(index),
      index,
      filename,
      filePath,
      exists: fs.existsSync(filePath),
      channel,
      type,
      blockCount,
      startTs,
      endTs,
      startTime: tsToIsoLike(startTs),
      endTime: tsToIsoLike(endTs),
      durationSeconds: endTs - startTs,
      chronologicalOrder: (index - header.writePos + header.fileCount) % header.fileCount
    });
  }

  records.sort((a, b) => a.chronologicalOrder - b.chronologicalOrder);

  return {
    header,
    special,
    recordStart,
    records
  };
}

function loadIndex(baseDir) {
  const indexPath = INDEX_NAMES.map((name) => path.join(baseDir, name)).find((candidate) => fs.existsSync(candidate));
  if (!indexPath) {
    throw new Error(`No index file found: ${INDEX_NAMES.join(" or ")}`);
  }
  const parsed = parseIndexBuffer(fs.readFileSync(indexPath), baseDir);
  return {
    sourceFile: path.basename(indexPath),
    sourcePath: indexPath,
    ...parsed
  };
}

function splitRecordByDay(record) {
  const parts = [];
  let cursor = record.startTs;

  while (cursor < record.endTs) {
    const dayKey = toDateKey(cursor);
    const nextMidnight = Math.floor(Date.parse(`${dayKey}T00:00:00.000Z`) / 1000) + 86400;
    const partEnd = Math.min(record.endTs, nextMidnight);
    parts.push({
      ...record,
      partId: `${record.id}-${cursor}`,
      dayKey,
      partStartTs: cursor,
      partEndTs: partEnd,
      partStartTime: tsToIsoLike(cursor),
      partEndTime: tsToIsoLike(partEnd),
      playOffsetSeconds: cursor - record.startTs,
      partDurationSeconds: partEnd - cursor
    });
    cursor = partEnd;
  }

  return parts;
}

function buildCatalog(baseDir) {
  const index = loadIndex(baseDir);
  const playableRecords = index.records.filter((record) => record.exists);
  const days = new Map();

  for (const record of playableRecords) {
    for (const part of splitRecordByDay(record)) {
      if (!days.has(part.dayKey)) {
        days.set(part.dayKey, {
          date: part.dayKey,
          totalSeconds: 0,
          segments: []
        });
      }
      const day = days.get(part.dayKey);
      day.totalSeconds += part.partDurationSeconds;
      day.segments.push(part);
    }
  }

  const dayList = Array.from(days.values())
    .map((day) => ({
      ...day,
      segments: day.segments.sort((a, b) => a.partStartTs - b.partStartTs)
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const first = playableRecords[0];
  const last = playableRecords[playableRecords.length - 1];

  return {
    baseDir,
    indexSource: index.sourceFile,
    generatedAt: new Date().toISOString(),
    fileCount: index.header.fileCount,
    writePos: index.header.writePos,
    recordCount: index.records.length,
    playableCount: playableRecords.length,
    missingCount: index.records.length - playableRecords.length,
    firstTime: first ? first.startTime : "",
    lastTime: last ? last.endTime : "",
    specialMarker: {
      index: index.special.index,
      startTime: tsToIsoLike(index.special.startTs),
      endTime: tsToIsoLike(index.special.endTs)
    },
    days: dayList
  };
}

module.exports = {
  buildCatalog,
  loadIndex
};
