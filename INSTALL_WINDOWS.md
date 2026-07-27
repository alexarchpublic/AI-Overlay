# Install Guide — Windows (CS Team)

Arch Public AI Overlay is an always-on-top co-pilot for live client calls. This guide is for **Windows 10/11 (64-bit)**.

Download the latest alpha installer from the internal link your lead sends, or from the team releases page:

**https://github.com/alexarchpublic/AI-Overlay-releases/releases**

Look for `ArchPublicAIOverlay-Setup-*.exe` (prerelease). Also download `team-config.json` from the **internal SharePoint / shared folder** (not from GitHub — that file holds the team API key).

Put **both** files in the same folder on your PC before installing.

---

## Install — SmartScreen (“Windows protected your PC”)

The alpha build is **unsigned**, so Windows Defender SmartScreen often blocks it. This is expected. Follow these clicks exactly:

```
┌─────────────────────────────────────────────┐
│  Windows protected your PC                  │
│                                             │
│  Microsoft Defender SmartScreen prevented   │
│  an unrecognized app from starting.         │
│                                             │
│  App: ArchPublicAIOverlay-Setup-….exe       │
│                                             │
│              [ Don't run ]                  │
│                                             │
│  More info   ← click this first             │
└─────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────┐
│  Windows protected your PC                  │
│  …                                          │
│  Publisher: Unknown publisher               │
│                                             │
│  [ Run anyway ]  ← click this               │
│  [ Don't run ]                              │
└─────────────────────────────────────────────┘
```

**Step-by-step**

1. Double-click `ArchPublicAIOverlay-Setup-….exe`.
2. If you see **Windows protected your PC**:
   - Click **More info** (blue text under the message — easy to miss).
   - Click **Run anyway**.
3. If Windows asks “Do you want to allow this app…?” and you are **not** an admin install: you should **not** need admin. This installer is **per-user** (no UAC). If UAC appears, stop and ping your lead — something is wrong for alpha.
4. Click through the installer. Leave **Create desktop shortcut** checked if offered.
5. Finish and launch **Arch Public AI Overlay**.

Still blocked? Right-click the `.exe` → **Properties** → if there is an **Unblock** checkbox at the bottom, check it → **Apply** → open the installer again.

---

## First launch

- The chat window opens **on top of** other apps.
- If `team-config.json` was found, the Gemini key is stored by Windows (DPAPI). You should **not** see a key prompt.
- If Settings → AI asks for a key, paste the key your lead gave you, then **Save**.
- A **tray icon** appears near the clock (click the `^` chevron if it is hidden). Use it to **Show Overlay**, toggle auto-capture, open Settings, or **Exit**.

### Where to put `team-config.json` (if first launch asked for a key)

Copy it to **one** of these before relaunching:

1. Next to the installed app `.exe` (under your user Programs folder), **or**
2. `C:\ProgramData\ArchPublic\team-config.json` (create the `ArchPublic` folder if needed), **or**
3. `%APPDATA%\arch-public-ai-overlay\team-config.json`

---

## Set the capture region

1. Join your Zoom / Teams / Meet call.
2. Right-click the **chat header** → **Set capture region…**
3. Drag over the TradingView (or shared) area on the correct monitor.
4. Press **Enter** to confirm, or **Esc** / on-screen **Cancel** to abort.

Auto-capture uses that region. If the window ever disappears behind Zoom/Teams, use the tray → **Show Overlay**.

---

## Asking questions

Type in the input bar (or use a quick prompt). Answers include suggestions and a **talk track** for the live call. Do not promise performance results the product docs do not support.

---

## Updates

On Windows, updates download in the background. You may see a slim banner:

**Update ready — installs when you close the app**

Finish your call, then quit normally — the new version installs on exit. Do not force-quit mid-call to “get the update.”

---

## Reporting a bug

1. Open **Settings → About**.
2. Click **Copy diagnostics** (copies the log folder path + version + Windows).
3. Paste that into the **CS Slack thread** and note: Zoom or Teams, one or two monitors, and display scaling (e.g. 150%).

---

## Uninstall

**Settings → Apps → Installed apps** → Arch Public AI Overlay → Uninstall.

Your settings and key under `%APPDATA%\arch-public-ai-overlay` are kept unless you delete that folder manually.
