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

### Image Review & Callout Annotations
When viewing images within an attachment column or generative image field:
- **View Fullscreen**: Click the image to open the immersive Zoom Viewer.
- **Add Annotations**: **Double-Click** anywhere directly on the image to drop a "Review Marker" (Annotation Pin).
- **Manage Feedback**: You can define the state of an annotation marker (e.g., "Pending", "Resolved", or "Approved"). 
- **Discussion Threads**: Reply inside an annotation pin to leave notes for tracking iterative design changes or QA tracking.

### Desktop-First Local File Routing
If you are running this application comprehensively as a desktop-installed app:
- **Do Not Upload, Just Link**: You do not have to manually click and upload images taking up memory. You can directly paste the physical path of the image sitting on your computer (e.g., `C:\Users\YourName\Pictures\design.png`).
- The system will intelligently mount these system paths and read them instantly, keeping your local performance perfectly sharp and bridging the gap between web capabilities and your desktop environment.

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
