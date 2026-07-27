# Install Guide — Windows (CS Team)

Arch Public AI Overlay is an always-on-top co-pilot for live client calls. This guide is for **Windows 10/11 x64**.

## What you need

1. The installer: `ArchPublicAIOverlay-Setup-*.exe` (from the internal SharePoint / releases link your lead sends).
2. Optional but preferred: `team-config.json` from the same folder (shared team Gemini key — you should **not** need to paste a key yourself).

Download **both** files into the same folder on your PC.

## Install (SmartScreen)

The alpha build is **unsigned**, so Windows may show **“Windows protected your PC”**.

1. Double-click the `.exe`.
2. If SmartScreen appears:
   - Click **More info**
   - Click **Run anyway**
3. Follow the installer (per-user install — **no admin / UAC prompt**).
4. Leave “Create desktop shortcut” checked if offered.
5. Finish and launch the app.

> Tip: if your lead asked you to use the shared key file, copy `team-config.json` into  
> `C:\ProgramData\ArchPublic\`  
> (create the `ArchPublic` folder if it does not exist) **before** the first launch.  
> Alternatively, place it next to the installed app `.exe` under your user Programs folder.

## First launch

- The chat window opens on top of other apps.
- If `team-config.json` was found, the Gemini key is stored securely by Windows (DPAPI). You will **not** see a key prompt.
- If you *do* see Settings → AI asking for a key, paste the key your lead gave you, then Save.
- A tray icon appears in the notification area (you may need to click the ^ overflow chevron). Use it to **Show Overlay**, open Settings, or Exit.

## Set the capture region

1. Join your Zoom / Teams / Meet call.
2. Right-click the chat header → **Set capture region…**
3. Drag over the TradingView (or shared) area on the correct monitor.
4. Press **Enter** to confirm, **Esc** or **Cancel** to abort.

Auto-capture will use that region. If the window ever disappears behind Zoom, use the tray → **Show Overlay**.

## Asking questions

Type in the input bar (or use a quick prompt). Answers include suggestions and a talk track for the live call. Do not promise performance results the product docs do not support.

## Updates

On Windows, updates download in the background. You may see a slim banner: **Update ready — installs when you close the app**. Finish your call, then quit normally — the new version installs on exit.

## Reporting a bug

1. Open **Settings → About**.
2. Click **Copy diagnostics** (copies the log folder path + version).
3. Paste that into the CS Slack thread and describe what you were doing (Zoom/Teams, one or two monitors, approx. scaling %).

## Uninstall

Use Windows **Apps & features** → Arch Public AI Overlay → Uninstall. Your settings and key under `%APPDATA%\arch-public-ai-overlay` are kept unless you delete that folder manually.
