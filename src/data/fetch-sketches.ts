import { z } from "astro/zod";

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
};

export async function fetchSketches(): Promise<Sketch[]> {
  const response = await fetch(rawUrl("manifest.json"));

  if (!response.ok) {
    throw new Error(
      `Failed to fetch manifest.json: ${response.status} ${response.statusText}`,
    );
  }

  const data = await response.json();
  const manifest = ManifestSchema.parse(data);

  return manifest.sketches
    .map((sketch) => ({
      ...sketch,
      mediaUrl: rawUrl(sketch.media),
      sourceUrl: `https://github.com/${REPO_OWNER}/${REPO_NAME}/tree/${BRANCH}/sketches/${sketch.slug}`,
    }))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}
