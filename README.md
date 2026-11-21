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

#### Apps that aren't on winget (website/sideloaded)

Refreshy records **every** installed program, not just winget ones. On restore it closes the gap in three steps:

1. **Auto-match with winget** — searches winget by app name; matches become regular auto-installs.
2. **Find installers with AI** — a [Mistral](https://mistral.ai/) model proposes the official download pages for the remaining apps, [Firecrawl](https://firecrawl.dev/) scrapes them, and Mistral picks the direct installer link. Refreshy downloads the installer (`.exe`/`.msi`/`.msix`) onto the backup drive.
3. **Manual list** — anything still unresolved is printed at the end of the installer log and saved to `apps/Manual-Apps.txt` (name, version, publisher), so only those few need a hand.

The downloaded installers run **in the same single installer run** as the winget packages, with per-installer silent flags (MSI → `msiexec /qn`, NSIS → `/S`, Inno fallback → `/VERYSILENT`).

**API keys**: the AI installer search uses your own keys — set them in-app when prompted. They are stored only on this PC (`%APPDATA%/Refreshy/refreshy-config.json`) and are only ever sent to `api.mistral.ai` and `api.firecrawl.dev`. Without keys, everything else still works and the manual list is generated instead.

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

## Troubleshooting builds

**`Cannot create symbolic link : A required privilege is not held by the client`** when running `npm run dist`: the winCodeSign helper archive contains symlinks, which non-elevated terminals cannot create. Run the build once from an **elevated** PowerShell (Right-click Start → Windows PowerShell (Admin)):

```powershell
npm run dist
```

Alternatively skip the signing/resource step (exe won't get the embedded icon):

```powershell
npx electron-builder --win nsis portable --publish never -c.win.signAndEditExecutable=false
```

To cross-build the unpacked Windows app from Linux:

```bash
npx electron-builder --win --dir --config.win.signAndEditExecutable=false
```

(NSIS/portable targets with embedded icons require building on Windows, or GitHub Actions.)

## Tech

- Electron 33, plain HTML/CSS/JS — no framework
- Fluent design language: frameless window with native titlebar overlay on Windows 11, solid Fluent-styled backdrop (Mica intentionally avoided for rendering reliability on Insider/GPU-varied setups), light/dark aware, reduced-motion friendly
- UI icons from [Microsoft Fluent UI System Icons](https://github.com/microsoft/fluentui-system-icons), OS brand marks (Ubuntu, Fedora, Debian, Arch, Tux) from [Simple Icons](https://simpleicons.org), app logo and Windows mark generated/embedded in `src/renderer/icons/`
- Backup/restore logic lives in [`src/lib/`](src/lib) and is framework-free, so it can be unit-tested headlessly (see [`test/logic.test.js`](test/logic.test.js))
