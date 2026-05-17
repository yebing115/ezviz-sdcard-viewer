# EZVIZ SD Card Viewer

本地 Electron 播放器，用当前目录中的萤石 SD 卡文件查看录像。

## 运行

```powershell
npm start
```

## 数据来源

应用运行时直接解析当前目录里的 `index00.bin` 或 `index01.bin`，不会读取 `recordings.csv`、`recordings_chronological.csv` 等 CSV 文件。更新 bin/mp4 文件后，重启应用或点击界面里的“刷新”会重新统计。

## 播放方式

`hivXXXXX.mp4` 实际是 MPEG-PS 容器，Chromium 不能稳定直接播放。应用内置本地 HTTP 接口，播放时调用 `ffmpeg` 将对应片段从指定偏移实时封装为浏览器可播放的 fragmented MP4。

需要系统 PATH 中可用：

```powershell
ffmpeg
```
