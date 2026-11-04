# Creative Coding Gallery

A static gallery site for generative art and creative coding: same rules, never the same image. Built with [Astro](https://astro.build), deployed on GitHub Pages.

**Live:** [amycardoso.github.io/creative-coding-gallery](https://amycardoso.github.io/creative-coding-gallery/)

## How it works

The gallery fetches sketch metadata from a [`manifest.json`](https://github.com/amycardoso/creative-coding/blob/main/manifest.json) in the [creative-coding](https://github.com/amycardoso/creative-coding) source repo at build time. Before the build, `npm run media` (`scripts/build-media.mjs`, needs ffmpeg) downloads each sketch's media and turns it into web versions served from this site: GIFs become a small looping MP4 for cards, a full-size MP4 for the detail page and a WebP poster frame; PNGs get a WebP thumbnail. Results land in `public/media/` (gitignored, cached in CI by source file SHA, so only new or changed GIFs are encoded). Without that folder the gallery falls back to the original files on raw.githubusercontent.

```
creative-coding repo                    creative-coding-gallery repo
┌──────────────────┐                    ┌──────────────────────────┐
│ Push manifest.json│ ──dispatch──────> │ GitHub Actions triggered  │
│ or new sketch    │                    │ 1. Fetch manifest.json   │
└──────────────────┘                    │ 2. Encode media (ffmpeg) │
                                        │ 3. Build Astro site      │
                                        │ 4. Deploy to GH Pages    │
                                        └──────────────────────────┘
```

## Adding a new sketch

1. Add the sketch folder with media to the [creative-coding](https://github.com/amycardoso/creative-coding) repo
2. Add an entry to `manifest.json`
3. Push — the gallery rebuilds automatically

Sketches that belong to a series carry a `"series": "<slug>"` field. The gallery groups them (in manifest order) into a series block on the home page and a page at `/series/<slug>/`. An optional top-level `series` array in the manifest gives each one a title and description:

```json
"series": [{ "slug": "reflexoes", "title": "Reflexões", "description": "..." }]
```

## Development

```bash
npm install
npm run media   # optional, needs ffmpeg
npm run dev
```

## Tech stack

- **Astro 5** — static site generation, with a small client script for filters, infinite scroll and lazy video
- **ffmpeg** — build-time GIF → MP4/WebP conversion (`scripts/build-media.mjs`)
- **Zod** — build-time validation of sketch metadata
- **GitHub Actions** — CI/CD with automatic deploys on push, dispatch, and weekly schedule

## License

[MIT](LICENSE)
