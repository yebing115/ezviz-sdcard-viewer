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
    chooseDirectory: (locale: Locale) => Promise<ChooseDirectoryResult>;
  };
};

type Locale = "zh-CN" | "en";

interface AppState {
  catalog: Catalog | null;
  selectedDate: string;
  selectedSegment: DaySegment | null;
  locale: Locale;
}

const translations = {
  "zh-CN": {
    appTitle: "萤石 SD 卡录像查看器",
    appHeading: "录像查看器",
    loadingIndex: "读取索引中...",
    languageLabel: "语言",
    dataDirectory: "数据目录",
    notSelected: "未选择",
    chooseDirectory: "选择目录",
    dateLabel: "日期",
    indexLabel: "索引",
    playableSegments: "可播放分片",
    dayCount: "日期数量",
    selectSegmentTitle: "选择一个时间段",
    selectSegmentMeta: "按日期筛选后点击左侧时间段播放。",
    refresh: "刷新",
    refreshTitle: "重新读取 bin 索引",
    segmentOffset: "片段内时间",
    playFromHere: "从此处播放",
    readingBin: "正在从 bin 文件读取...",
    noPlayableRecords: "没有可播放记录",
    chooseDataDirTitle: "选择一个数据目录",
    chooseDataDirMeta: "请选择包含 index00.bin/index01.bin 和 hiv*.mp4 的目录。",
    choosingDirectory: "正在选择目录...",
    chooseDataDirStatus: "请选择数据目录",
    directoryParseFailed: "目录无法解析",
    timeRange: "{first} 至 {last}",
    segmentMeta: "{filename}，片段总长 {duration}，本日覆盖 {coverage}"
  },
  en: {
    appTitle: "EZVIZ SD Card Viewer",
    appHeading: "Recording Viewer",
    loadingIndex: "Reading index...",
    languageLabel: "Language",
    dataDirectory: "Data Directory",
    notSelected: "Not selected",
    chooseDirectory: "Select Directory",
    dateLabel: "Date",
    indexLabel: "Index",
    playableSegments: "Playable Segments",
    dayCount: "Days",
    selectSegmentTitle: "Select a Time Range",
    selectSegmentMeta: "Filter by date, then click a time range on the left to play.",
    refresh: "Refresh",
    refreshTitle: "Reload the bin index",
    segmentOffset: "Offset in Segment",
    playFromHere: "Play from Here",
    readingBin: "Reading from bin files...",
    noPlayableRecords: "No playable records",
    chooseDataDirTitle: "Select a Data Directory",
    chooseDataDirMeta: "Select a directory containing index00.bin/index01.bin and hiv*.mp4 files.",
    choosingDirectory: "Selecting directory...",
    chooseDataDirStatus: "Select a data directory",
    directoryParseFailed: "Directory cannot be parsed",
    timeRange: "{first} to {last}",
    segmentMeta: "{filename}, segment length {duration}, coverage on this date {coverage}"
  }
} satisfies Record<Locale, Record<string, string>>;

const params = new URLSearchParams(window.location.search);
const apiBase = `http://127.0.0.1:${params.get("port")}`;
const supportedLocales: Locale[] = ["zh-CN", "en"];

function initialLocale(): Locale {
  const stored = localStorage.getItem("ezviz.locale");
  if (stored && supportedLocales.includes(stored as Locale)) {
    return stored as Locale;
  }
  return navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

const state: AppState = {
  catalog: null,
  selectedDate: "",
  selectedSegment: null,
  locale: initialLocale()
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
  languageSelect: mustGetElement<HTMLSelectElement>("languageSelect"),
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

function t(key: keyof typeof translations["zh-CN"], values: Record<string, string> = {}): string {
  let text = translations[state.locale][key];
  for (const [name, value] of Object.entries(values)) {
    text = text.replaceAll(`{${name}}`, value);
  }
  return text;
}

function applyLocale(): void {
  document.documentElement.lang = state.locale;
  document.title = t("appTitle");
  els.languageSelect.value = state.locale;

  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((element) => {
    const key = element.dataset.i18n as keyof typeof translations["zh-CN"] | undefined;
    if (key) {
      element.textContent = t(key);
    }
  });

  document.querySelectorAll<HTMLElement>("[data-i18n-title]").forEach((element) => {
    const key = element.dataset.i18nTitle as keyof typeof translations["zh-CN"] | undefined;
    if (key) {
      element.title = t(key);
    }
  });
}

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

function catalogStatus(catalog: Catalog): string {
  return t("timeRange", { first: catalog.firstTime, last: catalog.lastTime });
}

function renderCurrentSelectionText(): void {
  const segment = state.selectedSegment;
  if (segment) {
    els.currentTitle.textContent = `${segment.partStartTime} - ${timeOnly(segment.partEndTime)}`;
    els.currentMeta.textContent = t("segmentMeta", {
      filename: segment.filename,
      duration: hms(segment.durationSeconds),
      coverage: hms(segment.partDurationSeconds)
    });
    return;
  }

  if (state.catalog) {
    els.currentTitle.textContent = t("selectSegmentTitle");
    els.currentMeta.textContent = t("selectSegmentMeta");
    return;
  }

  els.currentTitle.textContent = t("chooseDataDirTitle");
  els.currentMeta.textContent = t("chooseDataDirMeta");
}

async function loadCatalog(): Promise<void> {
  setStatus(t("readingBin"));
  const response = await fetch(`${apiBase}/api/catalog?lang=${encodeURIComponent(state.locale)}`, { cache: "no-store" });
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

  els.directoryPath.textContent = catalog.baseDir || t("notSelected");
  els.indexSource.textContent = catalog.indexSource;
  els.playableCount.textContent = `${catalog.playableCount}/${catalog.recordCount}`;
  els.dayCount.textContent = String(catalog.days.length);
  setStatus(catalogStatus(catalog));

  els.dateSelect.innerHTML = "";
  for (const day of catalog.days) {
    const option = document.createElement("option");
    option.value = day.date;
    option.textContent = `${day.date} (${day.segments.length})`;
    option.selected = day.date === state.selectedDate;
    els.dateSelect.appendChild(option);
  }

  renderSegments();
  renderCurrentSelectionText();
}

function clearCatalog(message: string): void {
  state.catalog = null;
  state.selectedDate = "";
  state.selectedSegment = null;
  els.dateSelect.innerHTML = "";
  els.segments.textContent = message;
  els.directoryPath.textContent = t("notSelected");
  els.indexSource.textContent = "-";
  els.playableCount.textContent = "-";
  els.dayCount.textContent = "-";
  els.player.removeAttribute("src");
  els.player.load();
  renderCurrentSelectionText();
  els.offsetRange.disabled = true;
  els.playOffsetButton.disabled = true;
  setStatus(message);
}

function renderSegments(): void {
  const day = state.catalog?.days.find((item) => item.date === state.selectedDate);
  els.segments.innerHTML = "";

  if (!day) {
    els.segments.textContent = t("noPlayableRecords");
    return;
  }

  for (const segment of day.segments) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "segment-button";
    button.dataset.id = segment.id;
    button.classList.toggle("active", state.selectedSegment?.id === segment.id);
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
  renderCurrentSelectionText();
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
  els.player.src = `${apiBase}/video?id=${encodeURIComponent(state.selectedSegment.id)}&offset=${encodeURIComponent(offset)}&lang=${encodeURIComponent(state.locale)}`;
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
  renderCurrentSelectionText();
  els.offsetRange.disabled = true;
  els.playOffsetButton.disabled = true;
  renderSegments();
});

els.languageSelect.addEventListener("change", () => {
  state.locale = els.languageSelect.value === "zh-CN" ? "zh-CN" : "en";
  localStorage.setItem("ezviz.locale", state.locale);
  applyLocale();

  if (state.catalog) {
    renderCatalog();
  } else {
    els.directoryPath.textContent = t("notSelected");
    els.segments.textContent = t("chooseDataDirStatus");
    renderCurrentSelectionText();
    setStatus(t("chooseDataDirStatus"));
  }
});

els.refreshButton.addEventListener("click", () => {
  loadCatalog().catch((error: unknown) => clearCatalog(error instanceof Error ? error.message : String(error)));
});

els.chooseDirectoryButton.addEventListener("click", async () => {
  setStatus(t("choosingDirectory"));
  const result = await (window as unknown as EzvizWindow).ezviz.chooseDirectory(state.locale);
  if (result.canceled) {
    setStatus(state.catalog ? catalogStatus(state.catalog) : t("chooseDataDirStatus"));
    return;
  }
  if (!result.ok || !result.catalog) {
    clearCatalog(result.error || t("directoryParseFailed"));
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

applyLocale();

loadCatalog().catch((error: unknown) => {
  clearCatalog(error instanceof Error ? error.message : String(error));
});
