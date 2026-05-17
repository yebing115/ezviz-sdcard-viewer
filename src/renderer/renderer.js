"use strict";

const params = new URLSearchParams(window.location.search);
const apiBase = `http://127.0.0.1:${params.get("port")}`;

const state = {
  catalog: null,
  selectedDate: "",
  selectedSegment: null
};

const els = {
  summary: document.getElementById("summary"),
  directoryPath: document.getElementById("directoryPath"),
  chooseDirectoryButton: document.getElementById("chooseDirectoryButton"),
  dateSelect: document.getElementById("dateSelect"),
  indexSource: document.getElementById("indexSource"),
  playableCount: document.getElementById("playableCount"),
  dayCount: document.getElementById("dayCount"),
  segments: document.getElementById("segments"),
  currentTitle: document.getElementById("currentTitle"),
  currentMeta: document.getElementById("currentMeta"),
  player: document.getElementById("player"),
  refreshButton: document.getElementById("refreshButton"),
  offsetRange: document.getElementById("offsetRange"),
  offsetLabel: document.getElementById("offsetLabel"),
  playOffsetButton: document.getElementById("playOffsetButton")
};

function hms(seconds) {
  const value = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(value / 3600);
  const m = Math.floor((value % 3600) / 60);
  const s = value % 60;
  return [h, m, s].map((part) => String(part).padStart(2, "0")).join(":");
}

function timeOnly(value) {
  return value.slice(11, 19);
}

function setStatus(text) {
  els.summary.textContent = text;
}

async function loadCatalog() {
  setStatus("正在从 bin 文件读取...");
  const response = await fetch(`${apiBase}/api/catalog`, { cache: "no-store" });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${response.status}`);
  }
  state.catalog = await response.json();
  state.selectedDate = state.catalog.days.at(-1)?.date || "";
  renderCatalog();
}

function renderCatalog() {
  const catalog = state.catalog;
  els.directoryPath.textContent = catalog.baseDir || "未选择";
  els.indexSource.textContent = catalog.indexSource;
  els.playableCount.textContent = `${catalog.playableCount}/${catalog.recordCount}`;
  els.dayCount.textContent = String(catalog.days.length);
  setStatus(`${catalog.firstTime} 至 ${catalog.lastTime}`);

  els.dateSelect.innerHTML = "";
  for (const day of catalog.days) {
    const option = document.createElement("option");
    option.value = day.date;
    option.textContent = `${day.date} (${day.segments.length})`;
    option.selected = day.date === state.selectedDate;
    els.dateSelect.appendChild(option);
  }

  renderSegments();
}

function clearCatalog(message) {
  state.catalog = null;
  state.selectedDate = "";
  state.selectedSegment = null;
  els.dateSelect.innerHTML = "";
  els.segments.textContent = message;
  els.directoryPath.textContent = "未选择";
  els.indexSource.textContent = "-";
  els.playableCount.textContent = "-";
  els.dayCount.textContent = "-";
  els.player.removeAttribute("src");
  els.player.load();
  els.currentTitle.textContent = "选择一个数据目录";
  els.currentMeta.textContent = "请选择包含 index00.bin/index01.bin 和 hiv*.mp4 的目录。";
  els.offsetRange.disabled = true;
  els.playOffsetButton.disabled = true;
  setStatus(message);
}

function renderSegments() {
  const day = state.catalog.days.find((item) => item.date === state.selectedDate);
  els.segments.innerHTML = "";

  if (!day) {
    els.segments.textContent = "没有可播放记录";
    return;
  }

  for (const segment of day.segments) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "segment-button";
    button.dataset.id = segment.id;
    button.innerHTML = `
      <span>${timeOnly(segment.partStartTime)} - ${timeOnly(segment.partEndTime)}</span>
      <small>${segment.filename} · ${hms(segment.partDurationSeconds)}</small>
    `;
    button.addEventListener("click", () => selectSegment(segment));
    els.segments.appendChild(button);
  }
}

function selectSegment(segment) {
  state.selectedSegment = segment;
  els.currentTitle.textContent = `${segment.partStartTime} - ${timeOnly(segment.partEndTime)}`;
  els.currentMeta.textContent = `${segment.filename}，片段总长 ${hms(segment.durationSeconds)}，本日覆盖 ${hms(segment.partDurationSeconds)}`;
  els.offsetRange.disabled = false;
  els.playOffsetButton.disabled = false;
  els.offsetRange.min = "0";
  els.offsetRange.max = String(Math.max(0, segment.partDurationSeconds - 1));
  els.offsetRange.value = "0";
  updateOffsetLabel();
  playSegment(0);

  for (const button of els.segments.querySelectorAll(".segment-button")) {
    button.classList.toggle("active", button.dataset.id === segment.id);
  }
}

function playSegment(extraOffset) {
  if (!state.selectedSegment) return;
  const offset = state.selectedSegment.playOffsetSeconds + Number(extraOffset || 0);
  els.player.src = `${apiBase}/video?id=${encodeURIComponent(state.selectedSegment.id)}&offset=${encodeURIComponent(offset)}`;
  els.player.play().catch(() => {});
}

function updateOffsetLabel() {
  const offset = Number(els.offsetRange.value || 0);
  els.offsetLabel.textContent = hms(offset);
}

els.dateSelect.addEventListener("change", () => {
  state.selectedDate = els.dateSelect.value;
  state.selectedSegment = null;
  els.player.removeAttribute("src");
  els.player.load();
  els.currentTitle.textContent = "选择一个时间段";
  els.currentMeta.textContent = "按日期筛选后点击左侧时间段播放。";
  els.offsetRange.disabled = true;
  els.playOffsetButton.disabled = true;
  renderSegments();
});

els.refreshButton.addEventListener("click", () => {
  loadCatalog().catch((error) => clearCatalog(error.message));
});

els.chooseDirectoryButton.addEventListener("click", async () => {
  setStatus("正在选择目录...");
  const result = await window.ezviz.chooseDirectory();
  if (result.canceled) {
    setStatus(state.catalog ? `${state.catalog.firstTime} 至 ${state.catalog.lastTime}` : "请选择数据目录");
    return;
  }
  if (!result.ok) {
    clearCatalog(result.error || "目录无法解析");
    return;
  }
  state.catalog = result.catalog;
  state.selectedDate = state.catalog.days.at(-1)?.date || "";
  state.selectedSegment = null;
  els.player.removeAttribute("src");
  els.player.load();
  renderCatalog();
});

els.offsetRange.addEventListener("input", updateOffsetLabel);
els.playOffsetButton.addEventListener("click", () => playSegment(Number(els.offsetRange.value || 0)));

loadCatalog().catch((error) => {
  clearCatalog(error.message);
});
