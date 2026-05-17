# EZVIZ SD Card Viewer

本地 Electron 播放器，用当前目录中的萤石 SD 卡文件查看录像。

## 运行

```powershell
npm start
```

启动后点击“选择目录”，选择包含 `index00.bin` 或 `index01.bin` 以及 `hiv*.mp4` 的目录。
应用会记住上次选择的目录；下次启动时会优先读取该目录。

## 构建

应用代码使用 TypeScript 编写，编译输出在 `dist/`：

```powershell
npm run build
```

检查某个数据目录：

```powershell
npm run check -- C:\path\to\sdcard-copy
```

## 数据来源

应用运行时直接解析所选目录里的 `index00.bin` 或 `index01.bin`，不会读取 `recordings.csv`、`recordings_chronological.csv` 等 CSV 文件。更新 bin/mp4 文件后，点击界面里的“刷新”会重新统计。

## 播放方式

`hivXXXXX.mp4` 实际是 MPEG-PS 容器，Chromium 不能稳定直接播放。应用内置本地 HTTP 接口，播放时调用 `ffmpeg` 将对应片段从指定偏移实时封装为浏览器可播放的 fragmented MP4。

需要系统 PATH 中可用：

```powershell
ffmpeg
```
