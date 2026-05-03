# Hong's AI Table Studio - Technical Details

## 1. Project Overview
Hong's AI Table Studio is a reactive, client-side, browser-based database/spreadsheet hybrid application (similar to Airtable or Bitable). It is designed to be highly responsive, localized in the browser, and capable of handling complex formula evaluations, data relations, persistent local storage, and iterative visual reviews.

## 2. Technology Stack
- **Core Framework**: React 19 (Hooks, Context, Portals)
- **Language**: TypeScript (`^5.8.2`)
- **Build Tool**: Vite (`^6.2.0`)
- **Styling**: Tailwind CSS (`v4`), `clsx`, `tailwind-merge`
- **Icons**: `lucide-react`
- **Data Parsing/Exporting**: `papaparse` (CSV processing)
- **Formula Evaluation**: `expr-eval` for legacy Math strings, with native JS `Function` evaluation for Excel-like commands.
- **Persistence**: `idb-keyval` (IndexedDB) and native **File System Access API** (for local auto-save to the user's hard drive).

## 3. Architecture & File Structure
- `index.html`: The entry HTML file, containing the animated splash screen and root `div`.
- `main.js` / `preload.js`: Foundational structure indicating this project can also be run natively within an Electron shell.
- `src/`
  - `App.tsx`: The mega-component housing routing, table navigation (left sidebar), settings, permissions for the File System Access API, and application state.
  - `main.tsx`: React rendering entry point.
  - `types.ts`: Shared TS interfaces defining the architecture of `GridData`, `FieldType`, and `Attachment`.
  - `initialData.ts`: Standard fallback boilerplate for newly created tables when no previous state exists.
  - `components/`: Contains UI components.
    - `Grid.tsx`: The heart of the grid rendering logic. Manages rendering rows, columns, specific field types, and drag-and-drop handles.
  - `lib/`:
    - `utils.ts`: Typical `cn()` style utilities for Tailwind.
    - `idb.ts`: Abstraction layer for `idb-keyval` allowing the app to store handles (like the autosave directory handle) safely across browser sessions.

## 4. Key Technical Mechanisms
### 4.1 Local Persistence & Auto-Save
The application defaults to caching tables inside `localStorage` (`bitable_project_cache`). 
However, it implements the **File System Access API** to create a true continuous backup loop. By obtaining a user-granted directory handle (`showDirectoryPicker`), the app can seamlessly write `JSON` structural backups directly to a local folder in the background.

### 4.2 Formula Evaluation Engine (`src/App.tsx: computeFormulaValue`)
The engine dynamically computes fields whenever a record changes. 
- It isolates dependencies enclosed in brackets (e.g., `{Price}`).
- For legacy formulas, it falls back to `expr-eval`.
- For Excel-like formulas (prefixed with `=`), it maps the record values, sanitizes special characters, and executes a strictly-scoped `new Function()` sandbox to return real-time calculations.

### 4.3 Animation & Splash Screen
The initial splash screen uses SVG drawing animations (`stroke-dasharray/offset`) combined with CSS `fractalNoise` displacement filters to create a rough, hand-drawn paper look. React detects when the component mounts and dispatches `window.removeInitialSplash()` to unmount the CSS layer smoothly once the JS engine is fully initialized.

### 4.4 Desktop & Electron Integration
If embedded within an Electron environment (such as `main.js` execution):
- **Local File System Parsing via Direct Paths**: The image processing engine effortlessly bridges the gap between web URLs and absolute system paths. Paste an absolute path (`C:\` / `/Users/`) and the UI renders it as a `file://` protocol dynamically without demanding traditional file blob uploads.
- **IPC File Downloader**: Instead of relying on jarring HTML file-save dialogues, the system integrates seamlessly with `electronAPI.downloadFile` using IPC. This allows background downloading and continuous caching integrations without interrupting the user.
- **Image Annotations & Reviews**: Features an independent overlay matrix tied to the `ZoomableImage` component, converting `X/Y` coordinate clicks into visual markers. These review threads map directly back into the dataset objects, binding design feedback physically to the active cell record.

## 5. Deployment Details
Since the primary logic exists on the client side, the project compiles to static assets (`dist` folder). 
- **Build Web Assets**: `npm run build` generates the required HTML/JS/CSS into the `dist/` folder.
- **Preview**: `npm run preview` spins up an express/vite server locally.
- **Hosting**: The contents of the `/dist` directory can be deployed to any static host (Cloudflare Pages, Vercel, Firebase Hosting, GitHub Pages) without needing a standard Node.js server. 

### 5.1 Electron Desktop Deployment
As implied by `main.js` and `preload.js`, you can initialize an Electron window rendering the frontend statically to compile this into a standalone desktop application (`.exe`, `.dmg`, or `.AppImage`). 

**Local Development (Electron):**
You can run the web dev server and Electron simultaneously to test desktop features:
1. Terminal 1: run `npm run dev` (starts on port 5173).
2. Terminal 2: run `npx electron .`
*(Your `main.js` must be configured to prioritize `http://localhost:5173` if in development mode, or fallback to `/dist/index.html`.)*

**Packaging the Desktop Application:**
To package the project into a standalone executable (no terminal required), we use **electron-builder** or **electron-packager**.

1. Ensure the project is built: `npm run build`.
2. Ensure you have electron dependencies installed as devDependencies (e.g., `npm install -D electron electron-builder`).
3. Set your execution config in `package.json`:
   ```json
   "main": "main.js",
   "scripts": {
     "pack": "electron-builder --dir",
     "dist": "electron-builder"
   },
   "build": {
     "appId": "com.hong.tablestudio",
     "productName": "Hong Table Studio",
     "directories": { "output": "release" },
     "files": ["dist/**/*", "main.js", "preload.js"],
     "win": { "target": "nsis" },
     "mac": { "target": "dmg" }
   }
   ```
4. Run `npm run dist`.
5. Check the newly created `release/` folder. It will contain your packaged setup file (e.g., `Hong Table Studio Setup 1.0.0.exe`).

By distributing the app via Electron, users bypass web browser security hurdles (like clipboard restrictions or File System Access API prompts), natively leveraging the OS file pathways and achieving the utmost performance.
