# Refreshy

**Reinstall Windows. Keep everything.**

Refreshy is a desktop app (Windows 11 ready, also runs on Linux/macOS) that backs up your **app list** and **app data** to an external drive before a clean Windows install, then restores everything automatically afterwards — including installing **all of your apps in one automated run**.

## How it works

### 1. Back up this PC
- **Ask the OS you'll install next** (Windows 11, Windows 10, Ubuntu, Fedora, Debian, Arch, other Linux, macOS) — this decides what's worth saving and how apps can be put back.
- **Destination**: pick your external drive from the auto-detected drive list (removable drives are flagged *Recommended*) or choose any folder.
- **App list**: captured with `winget export` so every app can be reinstalled automatically. If winget is missing, the app list is captured from the registry instead.
- **App data**: AppData `Roaming` / `Local` / `LocalLow` by default (or `.config` / `.local/share` on Linux), plus optional personal folders (Desktop, Documents, Pictures, Videos, Music, Downloads). Caches, temp files, crash dumps and package-manager caches are skipped automatically to keep the backup small.
- Everything lands in one folder on your drive: `Refreshy-<PC-name>-<date>/` with `manifest.json`, `apps/` and `data/`.

### 2. Reinstall Windows (or Linux)
Wipe the machine and install the OS you picked. Your external drive keeps the backup.

### 3. Restore
- Point Refreshy at the backup folder — it shows what was captured and warns if the new OS differs from the one the backup was prepared for (e.g. backup made for Windows, but you installed Linux).
- **Apps**: Refreshy generates **one single installer** (`apps/Refreshy-Installer.ps1`) that installs every selected app in one automated run via winget, with a live log in the app. One app failing never blocks the rest; a summary tells you exactly what needs attention.
- **Data**: copies settings and profiles back into your new user profile, skipping any file that already exists locally, and reports the results per folder.

## Run from source

```bash
npm install
npm start        # launch the app
npm test         # engine logic tests
npm run dist     # build Windows NSIS installer + portable exe (build on Windows)
```

To cross-build the unpacked Windows app from Linux:

```bash
npx electron-builder --win --dir --config.win.signAndEditExecutable=false
```

(NSIS/portable targets with embedded icons require building on Windows.)

## Tech

- Electron 33, plain HTML/CSS/JS — no framework
- Fluent design language: Mica-backed frameless window on Windows 11, Segoe UI Variable, custom titlebar overlay, light/dark aware, reduced-motion friendly
- UI icons from [Microsoft Fluent UI System Icons](https://github.com/microsoft/fluentui-system-icons), OS brand marks (Ubuntu, Fedora, Debian, Arch, Tux) from [Simple Icons](https://simpleicons.org), app logo and Windows mark generated/embedded in `src/renderer/icons/`
- Backup/restore logic lives in [`src/lib/`](src/lib) and is framework-free, so it can be unit-tested headlessly (see [`test/logic.test.js`](test/logic.test.js))
