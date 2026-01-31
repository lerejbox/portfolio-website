# Portfolio Dev Mode

A local development server with web UI for editing your portfolio projects without touching code.

## Quick Start

```bash
# Install dependencies
npm install

# Start the dev server
npm run dev
```

Then open:
- **Admin UI**: http://localhost:3000/admin
- **Site Preview**: http://localhost:3000/index.html

## Features

| Feature | How |
|---------|-----|
| **Add Project** | Click "+ Add New Project" button |
| **Edit Project** | Click "Edit" on any project card |
| **Reorder** | Drag the `⋮⋮` handle to reorder |
| **Delete** | Click "Delete" (with confirmation) |
| **Upload Image** | Click image area in the form |
| **Generate HTML** | Click "🔄 Generate index.html" |

## Project Structure

```
portfolio-website/
├── data/
│   └── projects.json          # Project data (auto-managed)
├── dev-server/
│   └── server.js              # Express server + Admin UI
├── index.html                 # Auto-generated from projects.json
└── package.json
```

## Workflow

1. **Add/Edit Projects** through the web UI at `/admin`
2. **Changes auto-save** to `data/projects.json`
3. **index.html regenerates** automatically
4. **Preview instantly** at `/index.html`

## Tips

- **HTML in descriptions**: Use `<strong>`, `<p>`, etc. for formatting
- **Image styles**: Add custom CSS like `width: 300px; height: auto;`
- **Center images**: Check the "Center image vertically" option
- **Concurrent SASS**: Run `npm run dev:scss` to edit styles while developing

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/projects` | List all projects |
| POST | `/api/projects` | Create project |
| PUT | `/api/projects/:id` | Update project |
| DELETE | `/api/projects/:id` | Delete project |
| POST | `/api/projects/reorder` | Reorder projects |
| POST | `/api/upload` | Upload image |
| POST | `/api/generate` | Regenerate index.html |

---

**Note**: This only manages the projects list in `index.html`. Individual project detail pages (`project-1.html`, etc.) are not yet editable through the UI.
