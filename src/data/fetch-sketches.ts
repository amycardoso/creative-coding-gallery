import { z } from "astro/zod";
import probe from "probe-image-size";
import { existsSync, readFileSync } from "node:fs";

const REPO_OWNER = "amycardoso";
const REPO_NAME = "creative-coding";
const BRANCH = "main";

// raw.githubusercontent.com caches branch URLs for minutes, so a build right
// after a push can read a stale manifest. CI pins SKETCHES_REF to the commit.
const RAW_REF = process.env.SKETCHES_REF || BRANCH;

const rawUrl = (path: string) =>
  `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${RAW_REF}/${path}`;

// Web versions of the media (small MP4/WebP for cards, MP4 for the detail page),
// written by scripts/build-media.mjs and served from this site. A sketch missing
// here falls back to its original file on raw.githubusercontent.
type MediaEntry = {
  width: number;
  height: number;
  kind: "video" | "image";
  thumb: string;
  full: string | null;
  poster: string | null;
};
const MEDIA_INDEX = "public/media/index.json";
const mediaIndex: Record<string, MediaEntry> = existsSync(MEDIA_INDEX)
  ? JSON.parse(readFileSync(MEDIA_INDEX, "utf8"))
  : {};
const localMedia = (slug: string, file: string) =>
  `${import.meta.env.BASE_URL}media/${slug}/${file}`;

export type MediaSource = { src: string; video: boolean; poster?: string };

export const CATEGORIES = [
  "space",
  "landscape",
  "brasilidade",
  "abstract",
  "data-viz",
] as const;

const SketchSchema = z.object({
  slug: z.string(),
  title: z.string(),
  description: z.string(),
  date: z.string(),
  category: z.enum(CATEGORIES),
  series: z.string().optional(),
  media: z.string(),
  /** Default seed: what the live sketch shows first (and what the recording shows). */
  seed: z.number().optional(),
  /** false keeps the detail page on the recording (e.g. sketches that need live data). */
  live: z.boolean().optional(),
  tags: z.array(z.string()),
  tech: z.array(z.string()),
});

const SeriesInfoSchema = z.object({
  slug: z.string(),
  title: z.string(),
  description: z.string().optional(),
});

const ManifestSchema = z.object({
  series: z.array(SeriesInfoSchema).optional(),
  sketches: z.array(SketchSchema),
});

export type Sketch = z.infer<typeof SketchSchema> & {
  mediaUrl: string;
  /** Light version for cards and mosaics. */
  thumb: MediaSource;
  /** Detail page version. */
  full: MediaSource;
  /** A still frame, absolute path on this site (for og:image), when one exists. */
  posterUrl?: string;
  sourceUrl: string;
  /** The sketch itself, copied by scripts/build-live.mjs, when it can run here. */
  liveUrl?: string;
  width: number;
  height: number;
  dateLabel: string;
  seriesTitle?: string;
  seriesIndex?: number;
  seriesCount?: number;
};

export type Series = {
  slug: string;
  title: string;
  description?: string;
  sketches: Sketch[];
};

// "handmaids-tale" -> "Handmaids Tale", used when the manifest has no series entry.
const titleFromSlug = (slug: string) =>
  slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

let cached: { sketches: Sketch[]; series: Series[] } | null = null;

async function load() {
  if (cached) return cached;

  const response = await fetch(rawUrl("manifest.json"));

  if (!response.ok) {
    throw new Error(
      `Failed to fetch manifest.json: ${response.status} ${response.statusText}`,
    );
  }

  const data = await response.json();
  const manifest = ManifestSchema.parse(data);
  const seriesInfo = new Map(manifest.series?.map((s) => [s.slug, s]));

  // Series keep the manifest order (first appearance), and so do their parts.
  const seriesMembers = new Map<string, string[]>();
  for (const s of manifest.sketches) {
    if (!s.series) continue;
    if (!seriesMembers.has(s.series)) seriesMembers.set(s.series, []);
    seriesMembers.get(s.series)!.push(s.slug);
  }

  const sketches = await Promise.all(
    manifest.sketches.map(async (sketch): Promise<Sketch> => {
      const mediaUrl = rawUrl(sketch.media);
      const local = mediaIndex[sketch.slug];
      let width = local?.width ?? 800;
      let height = local?.height ?? 600;
      if (!local) {
        try {
          const result = await probe(mediaUrl);
          width = result.width;
          height = result.height;
        } catch {
          // fallback to defaults
        }
      }
      const poster = local?.poster ? localMedia(sketch.slug, local.poster) : undefined;
      const original: MediaSource = { src: mediaUrl, video: /\.mp4$/i.test(sketch.media) };
      const thumb: MediaSource = local
        ? { src: localMedia(sketch.slug, local.thumb), video: local.kind === "video", poster }
        : original;
      const full: MediaSource = local?.full
        ? { src: localMedia(sketch.slug, local.full), video: true, poster }
        : original;
      const members = sketch.series ? seriesMembers.get(sketch.series)! : null;
      return {
        ...sketch,
        // The category and series already show on every card, so a tag that
        // repeats either one is noise.
        tags: sketch.tags.filter((t) => t !== sketch.category && t !== sketch.series),
        mediaUrl,
        thumb,
        full,
        posterUrl: poster,
        liveUrl: existsSync(`public/live/${sketch.slug}/index.html`)
          ? `${import.meta.env.BASE_URL}live/${sketch.slug}/`
          : undefined,
        // The sketch folder is wherever its media lives (sketches/<category>/<slug>/...).
        sourceUrl: `https://github.com/${REPO_OWNER}/${REPO_NAME}/tree/${BRANCH}/${sketch.media.split("/").slice(0, -1).join("/")}`,
        width,
        height,
        dateLabel: new Date(sketch.date).toLocaleDateString("en-US", {
          year: "numeric",
          month: "short",
          timeZone: "UTC",
        }),
        ...(sketch.series && {
          seriesTitle: seriesInfo.get(sketch.series)?.title ?? titleFromSlug(sketch.series),
          seriesIndex: members!.indexOf(sketch.slug) + 1,
          seriesCount: members!.length,
        }),
      };
    }),
  );

  const bySlug = new Map(sketches.map((s) => [s.slug, s]));
  const series: Series[] = [...seriesMembers].map(([slug, slugs]) => ({
    slug,
    title: seriesInfo.get(slug)?.title ?? titleFromSlug(slug),
    description: seriesInfo.get(slug)?.description,
    sketches: slugs.map((s) => bySlug.get(s)!),
  }));

  cached = {
    sketches: sketches.sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    ),
    series,
  };
  return cached;
}

export async function fetchSketches(): Promise<Sketch[]> {
  return (await load()).sketches;
}

export async function fetchSeries(): Promise<Series[]> {
  return (await load()).series;
}
