// Turns the source repo's GIFs/PNGs into web-friendly media before `astro build`.
//
// For every sketch in the manifest it writes public/media/<slug>/:
//   GIF/MP4 -> thumb.mp4 (small, for cards), full.mp4 (detail page), poster.webp
//   PNG     -> thumb.webp
// and records the result in public/media/index.json, which fetch-sketches.ts
// reads. A GIF whose MP4 comes out bigger than the GIF keeps the GIF; an MP4
// source that does not shrink is served as it is.
//
// Outputs are keyed by the source file's git blob SHA, so with public/media
// restored from the CI cache only new or changed files are downloaded and
// encoded. Needs ffmpeg/ffprobe on PATH.

import { execFile } from "node:child_process";
import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

const OWNER = "amycardoso";
const REPO = "creative-coding";
const REF = process.env.SKETCHES_REF || "main";
const OUT = "public/media";
const INDEX = join(OUT, "index.json");
const CONCURRENCY = Number(process.env.MEDIA_CONCURRENCY) || 4;

const THUMB_WIDTH = 480;
// Noisy pieces (TV static, dense particles) barely compress; shrink their cards harder.
const THUMB_MAX_BYTES = 2_500_000;

const raw = (path) => `https://raw.githubusercontent.com/${OWNER}/${REPO}/${REF}/${path}`;

async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`);
  return res.json();
}

async function blobShas() {
  const headers = { Accept: "application/vnd.github+json" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const tree = await getJson(
    `https://api.github.com/repos/${OWNER}/${REPO}/git/trees/${REF}?recursive=1`,
    headers,
  );
  return new Map(tree.tree.filter((e) => e.type === "blob").map((e) => [e.path, e.sha]));
}

const ffmpeg = (args) => run("ffmpeg", ["-v", "error", "-y", ...args], { maxBuffer: 1 << 24 });
const size = async (p) => (await stat(p)).size;

async function dimensions(file) {
  const { stdout } = await run("ffprobe", [
    "-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=width,height", "-of", "csv=p=0", file,
  ]);
  const [width, height] = stdout.trim().split(",").map(Number);
  return { width, height };
}

const h264 = (width, crf) => [
  "-an", "-movflags", "+faststart", "-pix_fmt", "yuv420p",
  "-vf", width ? `scale=${width}:-2` : "scale=trunc(iw/2)*2:trunc(ih/2)*2",
  "-c:v", "libx264", "-preset", "slow", "-crf", String(crf),
];

async function processVideo(src, dir, ext) {
  const thumb = join(dir, "thumb.mp4");
  const full = join(dir, "full.mp4");
  await ffmpeg(["-i", src, ...h264(THUMB_WIDTH, 28), thumb]);
  if ((await size(thumb)) > THUMB_MAX_BYTES) {
    await ffmpeg(["-i", src, ...h264(360, 34), thumb]);
  }
  await ffmpeg(["-i", src, ...h264(null, 24), full]);
  await ffmpeg(["-i", src, "-frames:v", "1", "-c:v", "libwebp", "-quality", "80", join(dir, "poster.webp")]);
  const keepSource = (await size(full)) >= (await size(src));
  if (keepSource && ext === "mp4") await copyFile(src, full);
  else if (keepSource) await rm(full);
  const servesFull = !keepSource || ext === "mp4";
  return { kind: "video", thumb: "thumb.mp4", full: servesFull ? "full.mp4" : null, poster: "poster.webp" };
}

async function processPng(src, dir) {
  await ffmpeg(["-i", src, "-vf", "scale='min(800,iw)':-2", "-c:v", "libwebp", "-quality", "82", join(dir, "thumb.webp")]);
  return { kind: "image", thumb: "thumb.webp", full: null, poster: null };
}

async function build(sketch, sha) {
  const ext = sketch.media.split(".").pop().toLowerCase();
  if (!["gif", "mp4", "png"].includes(ext)) return null;
  const dir = join(OUT, sketch.slug);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const src = join(tmpdir(), `cc-media-${sketch.slug}.${ext}`);
  const res = await fetch(raw(sketch.media));
  if (!res.ok) throw new Error(`${sketch.media}: ${res.status}`);
  await writeFile(src, Buffer.from(await res.arrayBuffer()));
  try {
    const out = ext === "png" ? await processPng(src, dir) : await processVideo(src, dir, ext);
    return { sha, ...(await dimensions(src)), ...out };
  } finally {
    await rm(src, { force: true });
  }
}

const filesExist = (slug, e) =>
  [e.thumb, e.full, e.poster].filter(Boolean).every((f) => existsSync(join(OUT, slug, f)));

async function main() {
  const manifest = await getJson(raw("manifest.json"));
  // Without SHAs nothing counts as cached, so everything is encoded again.
  const shas = await blobShas().catch((err) => {
    console.warn(`media: could not list source blobs (${err.message}), re-encoding all`);
    return new Map();
  });
  const old = existsSync(INDEX) ? JSON.parse(await readFile(INDEX, "utf8")) : {};
  const index = {};
  const todo = [];

  for (const sketch of manifest.sketches) {
    const sha = shas.get(sketch.media);
    const prev = old[sketch.slug];
    if (prev && sha && prev.sha === sha && filesExist(sketch.slug, prev)) index[sketch.slug] = prev;
    else todo.push({ sketch, sha });
  }

  console.log(`media: ${manifest.sketches.length - todo.length} cached, ${todo.length} to encode`);
  await mkdir(OUT, { recursive: true });

  let next = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < todo.length) {
        const { sketch, sha } = todo[next++];
        const t = Date.now();
        try {
          const entry = await build(sketch, sha);
          if (entry) index[sketch.slug] = entry;
          console.log(`  ${sketch.slug} (${((Date.now() - t) / 1000).toFixed(1)}s)`);
        } catch (err) {
          // The gallery falls back to the original file for anything missing here.
          console.warn(`  ${sketch.slug} failed: ${err.message}`);
        }
      }
    }),
  );

  // Drop folders of sketches that left the manifest.
  for (const slug of Object.keys(old)) {
    if (!(slug in index)) await rm(join(OUT, slug), { recursive: true, force: true });
  }
  await writeFile(INDEX, JSON.stringify(index, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
