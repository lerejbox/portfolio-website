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
- `dev-server/portfolio-layout.js` provides the shared navigation, profile icons,
  and project cards used by the editor. The first three projects in the editor's
  order appear under Work experiences; the remainder appear under Personal projects.
- The header pairs a circular profile photo with the name and provides LinkedIn
  and GitHub icon links. There is no footer. The homepage opens with About. The technical
  stack follows the project sections. Navigation links follow that reading order.
- Cards retain full project descriptions and use existing detail metadata and
  skills. Update content through the editor as before.
- Keep the `projects:start` and `projects:end` comments in `index.html`; they bound
  the area replaced by project regeneration, preserving About and the technical stack.

## React-inspired visual direction

`design/react-inspired-portfolio` branches from the earlier design at
`be6e069e546dbb9b3bae5428e234bb30f60ca479`. The earlier design remains on
`design/portfolio-layout-cleanup` (PR #1) for comparison or rollback.

This direction uses a charcoal/cyan palette, larger headings, a centred About
introduction and a light/dark switch. It remains static HTML/CSS/JS.
`theme.js` saves the chosen theme locally; dark is the default. All project
content and maintenance statuses are retained. Manrope is hosted locally in
`assets/fonts/`, with its SIL Open Font License included alongside the font.
