import path from "node:path";
import { buildCatalog } from "./ezviz-index";

type Locale = "zh-CN" | "en";
type TranslationKey =
  | "usage"
  | "argument"
  | "dataDirectoryPlaceholder"
  | "dataDirectoryArgument"
  | "options"
  | "helpOption"
  | "langOption"
  | "example"
  | "missingDirectory"
  | "directory"
  | "index"
  | "records"
  | "range"
  | "days"
  | "playable"
  | "missing"
  | "error";

const translations: Record<Locale, Record<TranslationKey, string>> = {
  "zh-CN": {
    usage: "用法: npm run check -- <数据目录> [--lang zh-CN|en]",
    argument: "参数:",
    dataDirectoryPlaceholder: "<数据目录>",
    dataDirectoryArgument: "包含 index00.bin/index01.bin 和 hiv*.mp4 的目录。",
    options: "选项:",
    helpOption: "显示帮助信息。",
    langOption: "指定输出语言；当前仅支持 zh-CN 和 en。",
    example: "示例: npm run check -- C:\\path\\to\\sdcard-copy --lang zh-CN",
    missingDirectory: "缺少数据目录。请传入包含 index00.bin/index01.bin 和 hiv*.mp4 的目录。",
    directory: "目录",
    index: "索引",
    records: "记录",
    range: "范围",
    days: "日期",
    playable: "可播放",
    missing: "缺失",
    error: "错误"
  },
  en: {
    usage: "Usage: npm run check -- <data-directory> [--lang zh-CN|en]",
    argument: "Argument:",
    dataDirectoryPlaceholder: "<data-directory>",
    dataDirectoryArgument: "Directory containing index00.bin/index01.bin and hiv*.mp4 files.",
    options: "Options:",
    helpOption: "Show this help message.",
    langOption: "Set output language; currently only zh-CN and en are supported.",
    example: "Example: npm run check -- C:\\path\\to\\sdcard-copy --lang en",
    missingDirectory: "Missing data directory. Pass a directory containing index00.bin/index01.bin and hiv*.mp4 files.",
    directory: "directory",
    index: "index",
    records: "records",
    range: "range",
    days: "days",
    playable: "playable",
    missing: "missing",
    error: "error"
  }
};

interface CliArgs {
  baseDir?: string;
  help: boolean;
  locale: Locale;
}

function normalizeLocale(value: string | undefined): Locale {
  return value?.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

function defaultLocale(): Locale {
  return normalizeLocale(process.env.LANGUAGE || process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG);
}

function parseArgs(argv: string[]): CliArgs {
  let locale = defaultLocale();
  let help = false;
  let baseDir: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }

    if (arg === "--lang") {
      locale = normalizeLocale(argv[i + 1]);
      i += 1;
      continue;
    }

    if (arg.startsWith("--lang=")) {
      locale = normalizeLocale(arg.slice("--lang=".length));
      continue;
    }

    if (!arg.startsWith("-") && !baseDir) {
      baseDir = arg;
    }
  }

  return { baseDir, help, locale };
}

function t(locale: Locale, key: TranslationKey): string {
  return translations[locale][key];
}

function printHelp(locale: Locale): void {
  console.log(t(locale, "usage"));
  console.log("");
  console.log(`${t(locale, "argument")}`);
  console.log(`  ${t(locale, "dataDirectoryPlaceholder")}  ${t(locale, "dataDirectoryArgument")}`);
  console.log("");
  console.log(`${t(locale, "options")}`);
  console.log(`  -h, --help        ${t(locale, "helpOption")}`);
  console.log(`  --lang zh-CN|en   ${t(locale, "langOption")}`);
  console.log("");
  console.log(t(locale, "example"));
}

function localizeError(locale: Locale, message: string): string {
  if (locale === "en") return message;

  if (message.startsWith("No index file found:")) {
    return "找不到索引文件：index00.bin 或 index01.bin";
  }

  if (message === "Cannot find index record area") {
    return "找不到索引记录区";
  }

  if (message === "Index file is too small") {
    return "索引文件太小";
  }

  return message;
}

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printHelp(args.locale);
  process.exitCode = 0;
} else if (!args.baseDir) {
  console.log(t(args.locale, "missingDirectory"));
  console.log("");
  printHelp(args.locale);
  process.exitCode = 1;
} else {
  try {
    const catalog = buildCatalog(path.resolve(args.baseDir));

    console.log(`${t(args.locale, "directory")}: ${catalog.baseDir}`);
    console.log(`${t(args.locale, "index")}: ${catalog.indexSource}`);
    console.log(
      `${t(args.locale, "records")}: ${catalog.recordCount}, ${t(args.locale, "playable")}: ${catalog.playableCount}, ${t(args.locale, "missing")}: ${catalog.missingCount}`
    );
    console.log(`${t(args.locale, "range")}: ${catalog.firstTime} -> ${catalog.lastTime}`);
    console.log(`${t(args.locale, "days")}: ${catalog.days.length}`);
    console.log(catalog.days.slice(0, 5).map((day) => `${day.date}: ${day.segments.length}`).join("\n"));
  } catch (error) {
    const message = localizeError(args.locale, error instanceof Error ? error.message : String(error));
    console.error(`${t(args.locale, "error")}: ${message}`);
    process.exitCode = 1;
  }
}
