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
- **Main Page**: http://localhost:3000/index.html

## Portfolio layout

The published site is static HTML/CSS; the editor is only used locally. Existing
Netlify hosting and build settings can stay as they are.

- `css/portfolio.css` contains the shared portfolio layout and responsive styles.
  It loads after the generated `css/style.css`, so Sass compilation preserves it.
- `dev-server/portfolio-layout.js` provides the shared navigation, profile links,
  and project cards used by the editor. The first three projects in the editor's
  order appear under Selected projects; the remainder appear under Other projects.
- Cards retain full project descriptions and use existing detail metadata and
  skills. Update content through the editor as before.
- Keep the `projects:start` and `projects:end` comments in `index.html`; they bound
  the area replaced by project regeneration, preserving About and profile links.
