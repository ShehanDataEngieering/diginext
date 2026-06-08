# Inventory Manager

A desktop app for tracking shared equipment (tools, safety gear, etc.) across
multiple project sites/regions — replacing a set of manually-maintained Excel
workbooks with a single, centrally-managed, encrypted database.

It covers:

- A live "Main Inventory" dashboard — per-item totals and per-project
  allocation, computed straight from the data instead of hand-typed
- CRUD for item types, individually-tracked units (with serial/unique IDs,
  status, audit dates, and photos), and projects
- Exporting a project's current inventory to an `.xlsx` in the familiar
  layout, ready to send to the person on-site
- Google sign-in (via Clerk), restricted to an allow-list of email addresses
- An encrypted local database (SQLCipher) with automatic timestamped backups

## Tech stack

- **Electron + React + TypeScript**, bundled with `electron-vite`
- **better-sqlite3-multiple-ciphers** — encrypted local SQLite (SQLCipher)
- **Clerk** — Google sign-in / session verification
- **shadcn/ui + Tailwind CSS** — UI components and styling
- **SheetJS (`xlsx`)** — reading/writing Excel workbooks
- **electron-builder** — packaging into Windows/macOS installers

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org) (LTS)
- A [Clerk](https://clerk.com) application configured with Google as a sign-in
  provider

### Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy the environment template and fill in your own values:

   ```bash
   cp .env.example .env
   ```

   `.env.example` documents what each variable is for — your Clerk
   publishable/secret keys, the list of email addresses allowed to sign in,
   and (optionally, for a one-time initial data load) the path to an existing
   `Master_Inventory final.xlsx` workbook to seed the database from.

   **Never commit your real `.env`** — it holds secrets and is already
   git-ignored.

3. Run the app in development mode:

   ```bash
   npm run dev
   ```

## Building installers

> **Note:** each platform's installer can only be built *on* that platform —
> electron-builder relies on native OS tooling (e.g. macOS's disk-image tools
> for `.dmg`), and the bundled SQLite module has to be compiled for the host
> machine's own OS/CPU.

- **Windows** (run on Windows): produces an NSIS installer under `release/`

  ```bash
  npm run build:win
  ```

- **macOS** (run on a Mac): produces a `.dmg` and `.zip` for both Apple
  Silicon (`arm64`) and Intel (`x64`) under `release/`

  ```bash
  npm run build:mac
  ```

  Builds aren't code-signed (no Apple Developer ID is configured), so macOS
  will flag the app as being from an "unidentified developer" the first time
  it's opened — right-click the app → **Open** to get past this once.

## Project structure

```
src/
  main/        Electron main process — database, IPC handlers, Excel I/O,
               photo storage, backups, auth verification
  preload/     contextBridge API exposed to the renderer (window.api.*)
  renderer/    React UI — pages, components, styling
  shared/      Types and IPC channel constants shared between main & renderer
```

## Workflow

Each feature/milestone lives on its own branch (`feat/*`), implemented and
verified step by step, then merged into `master` once confirmed working.
