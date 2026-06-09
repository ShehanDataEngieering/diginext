# CLAUDE.md — Diginext Inventory Manager

This file gives AI coding assistants (Claude, OpenCode, Cursor, etc.) the context they need to contribute to this project without breaking its architecture. Read it before touching any code.

---

## What this app does

Desktop app for managing shared physical equipment (tools, safety gear) across multiple construction/field project sites. It replaces a manually maintained set of Excel workbooks with a local encrypted database, while still exporting back to Excel for site leads who fill in the sheets on-site.

**Core user workflow:**
1. Track item types (Items) and individual physical units (Item Units) with serial numbers, status, and photos
2. Assign units to project sites
3. Export a per-project Excel sheet → send to site lead → they fill it in → re-import (planned)
4. Dashboard shows live rollup of who has what

---

## Tech stack

| Layer | Library | Notes |
|---|---|---|
| App shell | Electron (via electron-vite) | Main + renderer + preload split |
| UI framework | React 19 + TypeScript | Renderer only — no SSR |
| Styling | Tailwind CSS v4 + shadcn/ui | Components in `src/renderer/src/components/ui/` |
| Database | better-sqlite3-multiple-ciphers | SQLCipher-encrypted SQLite; all DB calls are main-process only |
| Auth | Clerk (`@clerk/clerk-react` + `@clerk/backend`) | Google sign-in; JWT verified in main process |
| Excel write | ExcelJS | Styled workbook generation (borders, freeze panes, images) |
| Excel read | SheetJS (`xlsx`) | Parsing imported/seed workbooks |
| Icons | lucide-react | |
| Build/package | electron-builder | Win NSIS + macOS DMG/ZIP |

---

## Project structure

```
src/
  main/                      # Node/Electron process — no browser APIs here
    index.ts                 # App entry: creates window, wires up IPC
    auth/
      verifySession.ts       # Clerk JWT verification (main-process trust boundary)
    db/
      connection.ts          # Opens encrypted DB, runs migrations, schedules backups
      backup.ts              # Auto backup-on-launch + prune; manual backup/restore
      migrations/index.ts    # All schema migrations in version order — never edit released ones
      repositories/
        items.ts             # CRUD for item types
        projects.ts          # CRUD + status transitions for projects
        itemUnits.ts         # CRUD for physical units; getItemUnitById for photo cleanup
        dashboard.ts         # Live rollup query
      maybeSeed.ts           # One-time seed from SEED_XLSX_PATH env var
      seed.ts                # Parses master inventory XLSX and inserts rows
    excel/
      exportProjectSheet.ts  # ExcelJS workbook builder — per-project export
      diginextLogo.ts        # Logo as base64 for embedding in Excel header
      parseMasterInventory.ts# SheetJS parser used during seed
    photos/
      photoStore.ts          # Copies dropped files into userData/photos/, serves as base64
    ipc/
      dataHandlers.ts        # Registers ALL ipcMain.handle() calls — single file
    security/
      encryptionKey.ts       # Derives DB key via safeStorage/DPAPI

  preload/
    index.ts                 # contextBridge — exposes `window.api` to renderer
    electron-api.d.ts        # TypeScript types for window.api (must stay in sync with index.ts)

  shared/
    ipc.ts                   # IPC_CHANNELS constants + all domain types (Project, Item, etc.)
                             # Imported by both main AND renderer — no Electron/Node imports here

  renderer/src/
    main.tsx                 # React entry
    App.tsx                  # Router: auth gate → sidebar layout → page switching
    auth/
      AuthGate.tsx           # Clerk sign-in UI; passes JWT to main for verification
    components/
      Sidebar.tsx            # Left nav
      TitleBar.tsx           # Custom window chrome
      PhotoDropField.tsx     # Drag-and-drop image upload (NO file picker — see constraints)
      PhotoThumbnail.tsx     # Thumbnail + click-to-enlarge dialog
      ui/                    # shadcn/ui generated components (badge, button, dialog, etc.)
    pages/
      DashboardPage.tsx      # Live rollup table with expandable unit rows
      ItemsPage.tsx          # Item type catalog CRUD
      ItemUnitsPage.tsx      # Per-unit CRUD with photo, serial, project assignment
      ProjectsPage.tsx       # Project site CRUD + status
    styles/global.css        # Tailwind base + theme tokens
    lib/utils.ts             # cn() helper
    env.d.ts                 # Vite env types
```

---

## Critical architecture rules

### 1. IPC is the only bridge between renderer and main

The renderer has **zero** direct access to Node.js, the filesystem, or the database. Everything goes through `window.api.*` (defined in `src/preload/index.ts`).

- **Adding a new IPC call** requires touching **four files** in order:
  1. `src/shared/ipc.ts` — add channel name to `IPC_CHANNELS` and any new types
  2. `src/main/ipc/dataHandlers.ts` — add `ipcMain.handle(IPC_CHANNELS.xxx, ...)`
  3. `src/preload/index.ts` — add the method to the `api` object
  4. `src/preload/electron-api.d.ts` — add the type signature to the `Api` interface

### 2. No native file dialogs in the renderer

`dialog.showSaveDialog` and `<input type="file">` both **freeze the entire app** under WSLg (Windows Subsystem for Linux with GUI). They are banned. The only file-input method is drag-and-drop via `PhotoDropField.tsx`. Excel exports write to a fixed folder under Documents — no save-as picker.

### 3. Drag-and-drop photo path extraction

Post-Electron 13, `File.path` is removed. Use `window.api.photos.pathForFile(file)` which calls `webUtils.getPathForFile()` in the preload. This is the **only** legal way to get the filesystem path from a dropped `File` object.

### 4. Database calls are synchronous in main, async over IPC

`better-sqlite3-multiple-ciphers` is a synchronous API. All DB calls happen in the main process inside `ipcMain.handle()` callbacks, which are `async` only because they return Promises across the IPC boundary. Don't wrap DB calls in extra async/await chains unnecessarily.

### 5. Migrations are append-only

Never edit or delete a migration in `src/main/db/migrations/index.ts`. Each migration runs exactly once (tracked in `schema_migrations` table). Add a **new** migration at the end for any schema change.

### 6. Shared types live in `src/shared/ipc.ts`

Types used by both the renderer and main process go in `src/shared/ipc.ts` — nowhere else. This file must not import from `electron`, `better-sqlite3-multiple-ciphers`, or any Node-only module, because the renderer also imports it.

---

## Environment setup

```bash
# 1. Install dependencies
npm install

# 2. Create .env from the example
cp .env.example .env
# Edit .env and fill in:
#   VITE_CLERK_PUBLISHABLE_KEY=pk_test_...   (from clerk.com dashboard)
#   CLERK_SECRET_KEY=sk_test_...             (from clerk.com dashboard)
#   ALLOWED_EMAILS=your@email.com            (comma-separated, who can sign in)
#   SEED_XLSX_PATH=/path/to/Master_Inventory_final.xlsx  (optional, one-time seed)

# 3. Run in development
npm run dev

# 4. Type-check only (no emit)
npx tsc -b --noEmit

# 5. Build (outputs to out/)
npm run build

# 6. Package for Windows
npm run build:win

# 7. Package for macOS (must run ON macOS)
npm run build:mac
```

The `.env` file is git-ignored. Never commit real keys.

---

## Branching workflow

Feature branches are named `feat/<milestone-name>`. The pattern is:

```bash
git checkout -b feat/my-feature
# ... implement step by step, commit at logical checkpoints ...
git checkout master
git merge --no-ff feat/my-feature -m "Merge feat/my-feature: <description>"
git push origin master
```

Never push directly to `master` mid-feature. Each branch should be a complete, buildable unit.

---

## Key domain concepts

| Term | Meaning |
|---|---|
| **Item** | An item *type* (e.g. "Body Harness" in category "Safety Related Items"). `initial_stock` is the total ever purchased. |
| **Item Unit** | One physical instance of an Item. Has a `serial_id` (nullable — quantity-only items have no serial), `assigned_project_id` (null = Available), `status`, `photo_evidence_ref`, `audit_date`, `remarks`. |
| **Project** | A site/region (e.g. "At North Copenhagen"). Units are assigned here. Status: `active` or `completed`. |
| **Dashboard rollup** | Computed live: for each item type, how many units are at each project vs. available. Not stored — derived from item_units. |
| **Photo reference** | An opaque filename string stored in `photo_evidence_ref`. The file lives in `userData/photos/`. Never construct the path manually — use `photoStore.ts` functions. |

---

## What is already built

- Auth gate (Clerk Google sign-in, JWT verification in main process, email allowlist)
- Encrypted SQLite database with automatic backups
- Full CRUD: Items, Projects, Item Units
- Dashboard rollup with expandable rows showing per-unit details and photos
- Photo attachment: drag-and-drop → managed store → thumbnail display
- Excel export: per-project styled workbook with freeze panes, black borders, logo, date-based tab name
- One-time seed from existing Master Inventory XLSX
- Packaging config: Windows NSIS installer, macOS DMG + ZIP

## What is NOT yet built (pending milestones)

- **Settings page** — IPC handlers exist (`window.api.db.backupNow`, `listBackups`, `restoreBackup`) but there is no UI page for them yet
- **Sign-out button** — `AuthGate.tsx` has a raw unstyled `<button onClick={() => signOut()}>` that needs proper placement in the sidebar or header
- **Excel import & reconciliation** — biggest remaining feature: parse a filled-in export sheet, reconcile transfers by serial ID, show import summary; `transfers` table is in the schema but has no repository or UI
- **Transfer log & hand-over views** — `transfers` and `handovers` tables exist in the schema; no repository, IPC handlers, or pages yet
- **Serial ID search** in Item Units page (currently filter by item or project, no free-text search)

---

## Common pitfalls

- **"File has not been read yet" from Edit tool** — always `Read` a file before `Edit`ing it
- **`.git/index.lock` stale file** — if a git command fails with "Unable to create index.lock", run `rm -f .git/index.lock` then retry
- **GitHub secret scanning false positive** — `sk_test_` prefixed placeholder values in `.env.example` can trigger Stripe/Clerk pattern detection; the repo owner must unblock via the GitHub security alert URL
- **DMG build requires macOS** — `electron-builder --mac` shells out to `hdiutil` and other macOS-only tools; it cannot run in WSL or on Windows even with the darwin prebuilt binaries present
- **Preview tools don't work** — this is a desktop Electron app, not a web app; never use `mcp__Claude_Preview__*` tools
- **WSLg drag-and-drop from Windows Explorer** — may not pass drag events through to the Electron window; if photos aren't attaching, this is likely the cause rather than a code bug

---

## Running tests / type checks

There is no test suite yet. Use the TypeScript compiler as the primary correctness check:

```bash
npx tsc -b --noEmit        # full type check, zero output
npx electron-vite build    # full bundle build — catches import/resolution errors tsc misses
```

Both must pass clean before committing.
