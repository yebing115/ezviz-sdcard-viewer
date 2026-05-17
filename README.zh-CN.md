# EZVIZ SD Card Viewer

本地 Electron 播放器，用所选目录中的萤石 SD 卡文件查看录像。

## 运行

```powershell
npm start
```

启动后点击“选择目录”，选择包含 `index00.bin` 或 `index01.bin` 以及 `hiv*.mp4` 的目录。
应用会记住上次选择的目录；下次启动时会优先读取该目录。

## 语言

应用支持简体中文和英文。可通过侧边栏里的语言选择框切换语言，选择结果会保存在本地。

## 构建

应用代码使用 TypeScript 编写，编译输出在 `dist/`：

```powershell
npm run build
```

检查某个数据目录：

```powershell
npm run check -- C:\path\to\sdcard-copy
```

## 打包

生成目录版应用：

```powershell
npm run package
```

生成 Windows 可运行包：

```powershell
npm run dist:win
```

输出目录为 `release/`。默认会生成 portable exe 和 zip 包。

如果希望软件包自带 `ffmpeg`，打包前把 `ffmpeg.exe` 放到：

```text
vendor\ffmpeg\ffmpeg.exe
```

也可以直接从当前系统 PATH 复制：

```powershell
npm run bundle:ffmpeg
```

生成自带 `ffmpeg` 的 Windows 包：

```powershell
npm run dist:win:self-contained
```

没有内置 `ffmpeg.exe` 时，应用会回退使用系统 PATH 里的 `ffmpeg`。

## 数据来源

应用运行时直接解析所选目录里的 `index00.bin` 或 `index01.bin`，不会读取 `recordings.csv`、`recordings_chronological.csv` 等 CSV 文件。更新 bin/mp4 文件后，点击界面里的“刷新”会重新统计。

## 播放方式

`hivXXXXX.mp4` 实际是 MPEG-PS 容器，Chromium 不能稳定直接播放。应用内置本地 HTTP 接口，播放时调用 `ffmpeg` 将对应片段从指定偏移实时封装为浏览器可播放的 fragmented MP4。

没有随包内置 `ffmpeg.exe` 时，需要系统 PATH 中可用：

```powershell
ffmpeg
```
