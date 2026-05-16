# Hong's AI Table Studio - User Manual

## 1. Overview
Welcome to Hong's AI Table Studio! This application is designed as your personal, highly interactive data workspace. It allows you to organize information like a spreadsheet but structure it with the strict type behaviors of a database. 

## 2. Getting Started
When you open the application, you will see your primary workspace partitioned into two structural areas:
1. **The Left Sidebar**: Your table navigation pane. Here you can create, rename, delete, and duplicate different data tables.
2. **The Main Grid Area**: The active table, where you input data, define columns, and alter views.

### Managing Tables
- **Add a Table**: Click the `+` icon or "Add Table" in the left sidebar to generate a new blank sheet.
- **Customize Icon**: Right-click or double-click the default icon next to a table's name to assign a unique emoji to it for better visual categorization.
- **Rename/Duplicate/Delete**: Hover over a table name in the sidebar to reveal a "More" (three dots) menu. Click it to perform table-level actions.

## 3. Core Features & Functions
### Column Field Types
When you add a new column, you can define its Type. This strictly forces the column to only accept data representing that type:
- **Text**: Standard textual input.
- **Number**: Numerical values.
- **Single Select / Multi-Select**: Creates a dropdown array of tags to choose from. Very useful for "Status", "Priority", or "Tags".
- **Formula**: A dynamic read-only column that calculates values based on other columns.

### Working with Formulas
If you create a **Formula** column, you can reference other columns by putting their names in curly braces `{}`. 
- **Example (Math)**: `{Quantity} * {Price}`
- **Example (Excel Mode)**: Start your formula with an equal sign `=`. E.g., `={Inventory} - {Sold}`.
If you rename a referenced column, make sure to update your formula so it points to the correct new name.

### Image Review, Cropping & Callout Annotations
When viewing images within an attachment column or generative image field:
- **View Fullscreen**: Click the image to open the immersive Zoom Viewer. You can also use your mouse wheel to zoom continuously and drag to pan around the image for a comprehensive inspection.
- **Add Annotations**: **Double-Click** anywhere directly on the image to drop a "Review Marker" (Annotation Pin).
- **Manage Feedback**: You can define the state of an annotation marker (e.g., "Pending", "Resolved", or "Approved"). 
- **Discussion Threads**: Reply inside an annotation pin to leave notes for tracking iterative design changes or QA tracking.
- **Cropping & Composition Limits**: Switch to "Crop Mode" to pull up an aspect ratio reticle. Pan and zoom your master image freely behind the bounds and save the final crop to your record. The system supports full **editing and deletion** of any existing crops. The thumbnail will feature a specific "Crop" badge to easily distinguish it on your grid. *(Note: While in Standard Crop mode, bounding-box physics are enforced; you cannot drag the image out of bounds and accidentally expose negative space.)*
- **Advanced Outpaint Mode**: Toggling the "Outpaint" checkbox unlocking the restrictive bounds and dropping you into an **Intelligent Intent-Recognizing** outpaint engine:
    - **Auto Top-Aligned Strategy**: Every time you switch ratios or enter Outpaint mode, the system auto-calculates the relative dimensions of your image vs the target frame. It strategically defaults to a "Top-Aligned" position out of the box. This saves massive amounts of manual adjusting, particularly optimized for the frequent portrait/character "chest-up to full-body" expansions. 
    - **Intelligent Intent Tracking**: While panning, the engine interprets your dragging pattern. If you drag vertically, it rigidly locks horizontal drifting, clamping you neatly to the center for up/down compositions. Similarly, dragging horizontally locks your vertical axis. Diagonal motion breaks these locks entirely, offering absolute freedom of movement over the background.
    - **Pixel-Perfect Freedom**: By eliminating all previously forced 15px magnetic edge-snaps, you can define negative space and offset coordinates down to the precise pixel.
    - An Outpaint configuration yields an **"Expand" badge** instead of a regular Crop pin! A saved outpaint image natively functions as a compositional base template, ready to be driven into Generative AI flows.
    - (Note: Mouse-wheel zooming step sensitivity has been fine-tuned for Outpaint scenarios to provide a gentle, hyper-controlled zoom behavior against extreme boundary manipulations.)

### Desktop-First Local File Routing
If you are running this application comprehensively as a desktop-installed app:
- **Do Not Upload, Just Link**: You do not have to manually click and upload images taking up memory. You can directly paste the physical path of the image sitting on your computer (e.g., `C:\Users\YourName\Pictures\design.png`).
- The system will intelligently mount these system paths and read them instantly, keeping your local performance perfectly sharp and bridging the gap between web capabilities and your desktop environment.

### AI Workflows & Batch Generation
If your table features columns specifically geared towards artificial intelligence (like **Smart Text** or **AI Image** field types):
- **Sequential Row Processing**: You can select one or multiple rows, right-click, and choose **Run Workflow**.
- **Automated Queuing**: The system will automatically move left to right across AI columns within the same row, triggering and completing generation requests one by one. Once a row is complete, it shifts down to the next selected row. 
- **Resilience**: If a specific AI task fails (due to a connection issue or timeout), the application will attempt an immediate retry. If it encounters consecutive failures, it gracefully skips that item, ensuring that a batch job doesn't completely stall because of one bad connection.

### Batch Saving & Image Archiving
If you have generated assets or loaded multiple attachments, you can seamlessly export them directly to your workstation:
- **Zip Archive Download**: At any point within the image grid viewer, you can batch download selected photos compiled into a single Zip archive.
- **Desktop Batch Save Capabilities**: Operating in standard desktop/Electron environments unlocks a **Batch Save Locally** button. The system respects generated structured sub-folder paths (if configured via filename templates) and quietly writes all items directly onto your physical disk without redundant save confirmation prompts. It also intelligently resolves filename collisions automatically.

### Cloud OSS Image Backup & Smart Syncing
If you provide an OSS (Aliyun Object Storage) configuration through the settings, the app unlocks seamless multi-device continuity capabilities:
- **Intelligent WebP Compression**: Before any new image is piped to the cloud, it is dynamically resized to a maximum width of 3K (3072px) and transcoded effortlessly into the high-quality `.webp` format. This guarantees massive footprint reductions without ever compromising human-eye fidelity.
- **Bi-directional Reference Sync**: The application maintains an absolute reference registry (`oss_references_node.csv`). With bi-directional timestamp checking, the app will instantly sync newer versions up, or download the most recent mapping from the cloud whenever you change devices or clear your browser cache.

### Drag and Drop
- **Columns**: Click and hold a column header to drag it left or right, reordering the grid.
- **Rows**: Use the grip handle located at the far left edge of any row to reorder the row structure vertically.
- **Tables**: You can drag and drop table names in the left sidebar to sort them by relevance.

## 4. Advanced: Auto-Save & Backup Settings
Since this is a client-side web application, your data lives in your browser temporarily. For robust protection against data loss:

1. Look for the **Settings / Preferences** gear icon.
2. Locate the **Auto-Save Settings** feature.
3. Choose a folder on your computer (e.g., your Documents folder). **Note: Avoid highly restricted system folders like the Windows C: root or desktop in some cases, due to browser security restrictions.**
4. Once granted permission, the system will regularly back up your tables into that folder as JSON files. If your browser cache is ever cleared, you can recover everything natively from these files.

## 5. Import and Export
- **CSV Import**: Click the "Import CSV" button to automatically convert standard spreadsheet files into a Studio Table.
- **CSV Export**: Instantly download your current table layout and data back into a `.csv` file, allowing seamless transition to Microsoft Excel or Apple Numbers.

## FAQ
**Q: I keep getting file permission errors when autosaving?**
A: Web browsers limit web apps from modifying specific "risky" folders. Try creating a completely new dedicated folder in your "Documents" directory (e.g., `Documents\TableStudioBackups`) and assign the Auto-Save feature to that explicitly.
