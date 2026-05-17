Optional bundled ffmpeg location.

For a fully self-contained Windows package, place `ffmpeg.exe` in this folder
before running:

```powershell
npm run dist:win
```

If no executable is bundled, the app falls back to `ffmpeg` from PATH.
