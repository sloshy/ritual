# Ritual Documentation Site

This site is built with [Astro Starlight](https://starlight.astro.build/), a documentation
framework built on [Astro](https://astro.build/). Full-text search is provided out of the box
by [Pagefind](https://pagefind.app/), which indexes the site at build time and runs entirely
client-side.

## Development

```bash
npm install
npm run dev
```

Starts a local dev server at `http://localhost:4321` with hot reload. Note that search is
only available in production builds — use `npm run build && npm run preview` to test it.

## Build

```bash
npm run build
```

Builds the static site into `dist/`. Internal links are validated at build time via
`starlight-links-validator`; broken links fail the build.

## Structure

- `src/content/docs/` — all documentation pages (Markdown/MDX). File paths map to URLs.
- `astro.config.mjs` — site config, including the sidebar structure.
- `src/styles/custom.css` — theme color overrides.
- `public/` — static assets served as-is.

## Deployment

Deployed to GitHub Pages automatically on push to `main` via
`.github/workflows/deploy-docs.yml`.
