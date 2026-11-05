// Copies every sketch from the source repo into public/live/<slug>/ so the
// detail page can run it in an iframe instead of only showing a recording.
//
// Each copy gets two things injected into its index.html:
//   - the sketch's default seed (manifest `seed`) and the source repo's
//     scripts/seed.js, which make ?seed=N reproducible for any sketch;
//   - a stylesheet that fits the canvas to the iframe and hides the
//     sketch's own buttons (the detail page has its own controls).
//
// Recordings (GIF/MP4) are left out: the page never needs them inside the
// iframe. A sketch with `"live": false` in the manifest is skipped.

import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const OWNER = "amycardoso";
const REPO = "creative-coding";
const REF = process.env.SKETCHES_REF || "main";
const OUT = "public/live";
const CONCURRENCY = Number(process.env.LIVE_CONCURRENCY) || 8;
const SKIP = /\.(gif|mp4|webm|mov)$/i;

const raw = (path) => `https://raw.githubusercontent.com/${OWNER}/${REPO}/${REF}/${path}`;

async function get(url, headers = {}) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`);
  return res;
}

async function tree() {
  const headers = { Accept: "application/vnd.github+json" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await get(
    `https://api.github.com/repos/${OWNER}/${REPO}/git/trees/${REF}?recursive=1`,
    headers,
  );
  return (await res.json()).tree.filter((e) => e.type === "blob").map((e) => e.path);
}

// Fit the canvas inside the iframe, keep its aspect ratio, and drop the
// sketch's own page chrome. !important beats the inline sizes p5 sets.
const FIT = `<style id="gallery-fit">
  html, body { margin: 0 !important; padding: 0 !important; width: 100% !important; height: 100% !important; min-height: 0 !important; overflow: hidden !important; }
  body { display: flex !important; align-items: center !important; justify-content: center !important; }
  main, #canvas-container { display: contents !important; }
  .controls, .p5c-container { display: none !important; }
  canvas { width: auto !important; height: auto !important; max-width: 100vw !important; max-height: 100vh !important; box-shadow: none !important; }
</style>`;

function inject(html, seed, withSeed) {
  const head = withSeed && seed !== undefined
    ? `\n<script>window.__seedBase = ${JSON.stringify(seed)};</script>\n<script src="../seed.js"></script>`
    : "";
  let out = /<head[^>]*>/i.test(html)
    ? html.replace(/<head[^>]*>/i, (m) => m + head)
    : head + html;
  out = /<\/head>/i.test(out) ? out.replace(/<\/head>/i, `${FIT}\n</head>`) : FIT + out;
  return out;
}

async function main() {
  const manifest = await (await get(raw("manifest.json"))).json();
  const files = await tree();

  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  let withSeed = true;
  try {
    await writeFile(join(OUT, "seed.js"), await (await get(raw("scripts/seed.js"))).text());
  } catch (err) {
    console.warn(`live: no scripts/seed.js in the source repo (${err.message}), seeds disabled`);
    withSeed = false;
  }

  const jobs = [];
  for (const sketch of manifest.sketches) {
    if (sketch.live === false) continue;
    const dir = dirname(sketch.media);
    const own = files.filter(
      (f) => f.startsWith(`${dir}/`) && f !== sketch.media && !SKIP.test(f),
    );
    if (!own.includes(`${dir}/index.html`)) continue;
    for (const f of own) jobs.push({ sketch, from: f, to: join(OUT, sketch.slug, f.slice(dir.length + 1)) });
  }

  let next = 0;
  let failed = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < jobs.length) {
        const { sketch, from, to } = jobs[next++];
        try {
          const res = await get(raw(from));
          await mkdir(dirname(to), { recursive: true });
          if (from.endsWith("/index.html")) {
            await writeFile(to, inject(await res.text(), sketch.seed, withSeed));
          } else {
            await writeFile(to, Buffer.from(await res.arrayBuffer()));
          }
        } catch (err) {
          failed++;
          console.warn(`  ${sketch.slug}: ${err.message}`);
        }
      }
    }),
  );

  const slugs = new Set(jobs.map((j) => j.sketch.slug));
  console.log(`live: ${slugs.size} sketches, ${jobs.length - failed} files${failed ? `, ${failed} failed` : ""}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
