import { z } from "astro/zod";
import probe from "probe-image-size";

const REPO_OWNER = "amycardoso";
const REPO_NAME = "creative-coding";
const BRANCH = "main";

// raw.githubusercontent.com caches branch URLs for minutes, so a build right
// after a push can read a stale manifest. CI pins SKETCHES_REF to the commit.
const RAW_REF = process.env.SKETCHES_REF || BRANCH;

const rawUrl = (path: string) =>
  `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${RAW_REF}/${path}`;

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
  sourceUrl: string;
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
      let width = 800;
      let height = 600;
      try {
        const result = await probe(mediaUrl);
        width = result.width;
        height = result.height;
      } catch {
        // fallback to defaults
      }
      const members = sketch.series ? seriesMembers.get(sketch.series)! : null;
      return {
        ...sketch,
        // The category and series already show on every card, so a tag that
        // repeats either one is noise.
        tags: sketch.tags.filter((t) => t !== sketch.category && t !== sketch.series),
        mediaUrl,
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
