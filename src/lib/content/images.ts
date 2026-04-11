import { slugify } from "@/lib/services/slug";

export type ArticleImage = {
  role: string | null;
  placementKey: string | null;
  altText: string | null;
  url: string | null;
};

function cleanAltText(value: string | null | undefined) {
  return (value ?? "Article image").replace(/[\r\n[\]]+/g, " ").trim() || "Article image";
}

function imageMarkdown(asset: ArticleImage) {
  if (!asset.url) {
    return null;
  }

  return `![${cleanAltText(asset.altText)}](${asset.url})`;
}

export function insertArticleImages(markdown: string, assets: ArticleImage[]) {
  const usableAssets = assets.filter((asset) => asset.url);
  if (!usableAssets.length) {
    return markdown;
  }

  const hero = usableAssets.find((asset) => asset.role === "hero") ?? usableAssets[0];
  const sectionAssets = usableAssets.filter((asset) => asset !== hero && asset.role !== "hero");
  const emitted = new Set<ArticleImage>();
  const output: string[] = [];
  let heroInserted = false;

  function pushImage(asset: ArticleImage) {
    const rendered = imageMarkdown(asset);
    if (!rendered || emitted.has(asset)) {
      return;
    }

    output.push("", rendered, "");
    emitted.add(asset);
  }

  function pushHero() {
    if (!heroInserted) {
      pushImage(hero);
      heroInserted = true;
    }
  }

  const lines = markdown.split("\n");
  for (const line of lines) {
    if (!heroInserted && !line.trim()) {
      output.push(line);
      continue;
    }

    output.push(line);

    if (line.startsWith("# ")) {
      pushHero();
      continue;
    }

    if (line.startsWith("## ")) {
      if (!heroInserted) {
        pushHero();
      }

      const headingKey = slugify(line.replace(/^##\s+/, ""));
      const matchingAssets = sectionAssets.filter((asset) => asset.placementKey?.startsWith(`${headingKey}-`));
      for (const asset of matchingAssets) {
        pushImage(asset);
      }
    }
  }

  if (!heroInserted) {
    output.unshift("");
    output.unshift(imageMarkdown(hero) ?? "");
  }

  for (const asset of sectionAssets) {
    pushImage(asset);
  }

  return output.join("\n").replace(/\n{4,}/g, "\n\n\n");
}
