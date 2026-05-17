interface ChooseDirectoryResult {
  ok: boolean;
  canceled?: boolean;
  catalog?: Catalog;
  error?: string;
}

interface IndexRecord {
  id: string;
  index: number;
  filename: string;
  filePath: string;
  exists: boolean;
  channel: number;
  type: number;
  blockCount: number;
  startTs: number;
  endTs: number;
  startTime: string;
  endTime: string;
  durationSeconds: number;
  chronologicalOrder: number;
}

interface DaySegment extends IndexRecord {
  partId: string;
  dayKey: string;
  partStartTs: number;
  partEndTs: number;
  partStartTime: string;
  partEndTime: string;
  playOffsetSeconds: number;
  partDurationSeconds: number;
}

interface Catalog {
  baseDir: string;
  indexSource: string;
  generatedAt: string;
  fileCount: number;
  writePos: number;
  recordCount: number;
  playableCount: number;
  missingCount: number;
  firstTime: string;
  lastTime: string;
  specialMarker: {
    index: number;
    startTime: string;
    endTime: string;
  };
  days: Array<{
    date: string;
    totalSeconds: number;
    segments: DaySegment[];
  }>;
}

type EzvizWindow = Window & {
  ezviz: {
    chooseDirectory: () => Promise<ChooseDirectoryResult>;
  };
};

interface AppState {
  catalog: Catalog | null;
  selectedDate: string;
  selectedSegment: DaySegment | null;
}

const params = new URLSearchParams(window.location.search);
const apiBase = `http://127.0.0.1:${params.get("port")}`;

const state: AppState = {
  catalog: null,
  selectedDate: "",
  selectedSegment: null
};

function mustGetElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing element: ${id}`);
  }
  return element as T;
}

const els = {
  summary: mustGetElement<HTMLParagraphElement>("summary"),
  directoryPath: mustGetElement<HTMLElement>("directoryPath"),
  chooseDirectoryButton: mustGetElement<HTMLButtonElement>("chooseDirectoryButton"),
  dateSelect: mustGetElement<HTMLSelectElement>("dateSelect"),
  indexSource: mustGetElement<HTMLElement>("indexSource"),
  playableCount: mustGetElement<HTMLElement>("playableCount"),
  dayCount: mustGetElement<HTMLElement>("dayCount"),
  segments: mustGetElement<HTMLDivElement>("segments"),
  currentTitle: mustGetElement<HTMLHeadingElement>("currentTitle"),
  currentMeta: mustGetElement<HTMLParagraphElement>("currentMeta"),
  player: mustGetElement<HTMLVideoElement>("player"),
  refreshButton: mustGetElement<HTMLButtonElement>("refreshButton"),
  offsetRange: mustGetElement<HTMLInputElement>("offsetRange"),
  offsetLabel: mustGetElement<HTMLElement>("offsetLabel"),
  playOffsetButton: mustGetElement<HTMLButtonElement>("playOffsetButton")
};

function hms(seconds: number | undefined): string {
  const value = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(value / 3600);
  const m = Math.floor((value % 3600) / 60);
  const s = value % 60;
  return [h, m, s].map((part) => String(part).padStart(2, "0")).join(":");
}

function timeOnly(value: string): string {
  return value.slice(11, 19);
}

function setStatus(text: string): void {
  els.summary.textContent = text;
}

async function loadCatalog(): Promise<void> {
  setStatus("正在从 bin 文件读取...");
  const response = await fetch(`${apiBase}/api/catalog`, { cache: "no-store" });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || `HTTP ${response.status}`);
  }
  state.catalog = (await response.json()) as Catalog;
  state.selectedDate = state.catalog.days.at(-1)?.date || "";
  renderCatalog();
}

function renderCatalog(): void {
  const catalog = state.catalog;
  if (!catalog) return;

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

function clearCatalog(message: string): void {
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

function renderSegments(): void {
  const day = state.catalog?.days.find((item) => item.date === state.selectedDate);
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

function selectSegment(segment: DaySegment): void {
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

  for (const button of els.segments.querySelectorAll<HTMLButtonElement>(".segment-button")) {
    button.classList.toggle("active", button.dataset.id === segment.id);
  }
}

function playSegment(extraOffset: number): void {
  if (!state.selectedSegment) return;
  const offset = state.selectedSegment.playOffsetSeconds + Number(extraOffset || 0);
  els.player.src = `${apiBase}/video?id=${encodeURIComponent(state.selectedSegment.id)}&offset=${encodeURIComponent(offset)}`;
  els.player.play().catch(() => {});
}

function updateOffsetLabel(): void {
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
  loadCatalog().catch((error: unknown) => clearCatalog(error instanceof Error ? error.message : String(error)));
});

els.chooseDirectoryButton.addEventListener("click", async () => {
  setStatus("正在选择目录...");
  const result = await (window as unknown as EzvizWindow).ezviz.chooseDirectory();
  if (result.canceled) {
    setStatus(state.catalog ? `${state.catalog.firstTime} 至 ${state.catalog.lastTime}` : "请选择数据目录");
    return;
  }
  if (!result.ok || !result.catalog) {
    clearCatalog(result.error || "目录无法解析");
    return;
  }
  const catalog = result.catalog;
  state.catalog = catalog;
  state.selectedDate = catalog.days.at(-1)?.date || "";
  state.selectedSegment = null;
  els.player.removeAttribute("src");
  els.player.load();
  renderCatalog();
});

els.offsetRange.addEventListener("input", updateOffsetLabel);
els.playOffsetButton.addEventListener("click", () => playSegment(Number(els.offsetRange.value || 0)));

loadCatalog().catch((error: unknown) => {
  clearCatalog(error instanceof Error ? error.message : String(error));
});
