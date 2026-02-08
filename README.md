# Creative Coding Gallery

A static gallery site showcasing generative art and creative coding experiments. Built with [Astro](https://astro.build), deployed on GitHub Pages.

**Live:** [amycardoso.github.io/creative-coding-gallery](https://amycardoso.github.io/creative-coding-gallery/)

## How it works

The gallery fetches artwork metadata from a [`manifest.json`](https://github.com/amycardoso/creative-coding/blob/main/manifest.json) in the [creative-coding](https://github.com/amycardoso/creative-coding) source repo at build time. Media files (GIFs, PNGs) are served directly from GitHub's raw content CDN.

```
creative-coding repo                    creative-coding-gallery repo
┌──────────────────┐                    ┌──────────────────────────┐
│ Push manifest.json│ ──dispatch──────> │ GitHub Actions triggered  │
│ or new artwork   │                    │ 1. Fetch manifest.json   │
└──────────────────┘                    │ 2. Build Astro site      │
                                        │ 3. Deploy to GH Pages   │
                                        └──────────────────────────┘
```

## Adding a new artwork

1. Add the artwork folder with media to the [creative-coding](https://github.com/amycardoso/creative-coding) repo
2. Add an entry to `manifest.json`
3. Push — the gallery rebuilds automatically

## Development

```bash
npm install
npm run dev
```

## Tech stack

- **Astro 5** — static site generation, zero client-side JS
- **Zod** — build-time validation of artwork metadata
- **GitHub Actions** — CI/CD with automatic deploys on push, dispatch, and weekly schedule

## License

[MIT](LICENSE)
