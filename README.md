# EZVIZ SD Card Viewer

A local Electron player for viewing EZVIZ SD card recordings from a selected directory.

## Run

```powershell
npm start
```

After startup, click "Select Directory" and choose a directory that contains `index00.bin` or `index01.bin` and `hiv*.mp4` files.
The app remembers the last selected directory and will try to load it first on the next startup.

## Build

The application code is written in TypeScript, with compiled output in `dist/`:

```powershell
npm run build
```

Check a data directory:

```powershell
npm run check -- C:\path\to\sdcard-copy
```

## Package

Create an unpacked application directory:

```powershell
npm run package
```

Create a Windows runnable package:

```powershell
npm run dist:win
```

The output directory is `release/`. By default, this produces a portable exe and a zip package.

To bundle `ffmpeg` with the package, place `ffmpeg.exe` here before packaging:

```text
vendor\ffmpeg\ffmpeg.exe
```

You can also copy it directly from the current system `PATH`:

```powershell
npm run bundle:ffmpeg
```

Create a self-contained Windows package with bundled `ffmpeg`:

```powershell
npm run dist:win:self-contained
```

If no bundled `ffmpeg.exe` is present, the app falls back to `ffmpeg` from the system `PATH`.

## Data Source

At runtime, the app parses `index00.bin` or `index01.bin` directly from the selected directory. It does not read CSV files such as `recordings.csv` or `recordings_chronological.csv`. After updating bin/mp4 files, click "Refresh" in the UI to rescan them.

## Playback

`hivXXXXX.mp4` files are actually MPEG-PS containers, which Chromium cannot play directly and reliably. The app includes a local HTTP endpoint. During playback, it calls `ffmpeg` to repackage the corresponding segment from the specified offset into fragmented MP4 that the browser can play.

If `ffmpeg.exe` is not bundled with the package, `ffmpeg` must be available from the system `PATH`:

```powershell
ffmpeg
```
