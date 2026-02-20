import { z } from "astro/zod";
import probe from "probe-image-size";

const REPO_OWNER = "amycardoso";
const REPO_NAME = "creative-coding";
const BRANCH = "main";

const rawUrl = (path: string) =>
  `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${BRANCH}/${path}`;

const SketchSchema = z.object({
  slug: z.string(),
  title: z.string(),
  description: z.string(),
  date: z.string(),
  media: z.string(),
  tags: z.array(z.string()),
  tech: z.array(z.string()),
});

const ManifestSchema = z.object({
  sketches: z.array(SketchSchema),
});

export type Sketch = z.infer<typeof SketchSchema> & {
  mediaUrl: string;
  sourceUrl: string;
  width: number;
  height: number;
};

let cachedSketches: Sketch[] | null = null;

export async function fetchSketches(): Promise<Sketch[]> {
  if (cachedSketches) return cachedSketches;

  const response = await fetch(rawUrl("manifest.json"));

  if (!response.ok) {
    throw new Error(
      `Failed to fetch manifest.json: ${response.status} ${response.statusText}`,
    );
  }

  const data = await response.json();
  const manifest = ManifestSchema.parse(data);

  const sketches = await Promise.all(
    manifest.sketches.map(async (sketch) => {
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
      return {
        ...sketch,
        mediaUrl,
        sourceUrl: `https://github.com/${REPO_OWNER}/${REPO_NAME}/tree/${BRANCH}/sketches/${sketch.slug}`,
        width,
        height,
      };
    }),
  );

  cachedSketches = sketches.sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );
  return cachedSketches;
}
