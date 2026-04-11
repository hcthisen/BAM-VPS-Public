import "dotenv/config";

import { randomUUID } from "node:crypto";

import {
  createWpPost,
  deleteWpMedia,
  deleteWpPost,
  getWpCurrentUser,
  getWpMedia,
  getWpPost,
  listWpCategories,
  uploadWpMedia,
  type WordPressCredentials,
} from "@/lib/providers/wordpress";

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64",
);

function getCredentials(): WordPressCredentials {
  const baseUrl = process.env.WORDPRESS_URL?.trim();
  const username = process.env.WORDPRESS_USER?.trim();
  const applicationPassword = process.env.WORDPRESS_APPLICATION_PASSWORD?.trim();

  if (!baseUrl || !username || !applicationPassword) {
    throw new Error("WORDPRESS_URL, WORDPRESS_USER, and WORDPRESS_APPLICATION_PASSWORD are required.");
  }

  return { baseUrl, username, applicationPassword };
}

async function main() {
  const credentials = getCredentials();
  const suffix = randomUUID().slice(0, 8);
  let mediaId: number | null = null;
  let postId: number | null = null;

  try {
    const [user, categories] = await Promise.all([
      getWpCurrentUser(credentials),
      listWpCategories(credentials),
    ]);

    const media = await uploadWpMedia(
      credentials,
      `bam-smoke-${suffix}.png`,
      "image/png",
      tinyPng,
    ) as { id?: number };
    mediaId = media.id ?? null;
    if (!mediaId) {
      throw new Error("WordPress media upload did not return an id.");
    }

    const verifiedMedia = await getWpMedia(credentials, mediaId);
    if (verifiedMedia.id !== mediaId) {
      throw new Error("Uploaded WordPress media could not be fetched.");
    }

    const post = await createWpPost(credentials, {
      title: `BAM smoke draft ${suffix}`,
      slug: `bam-smoke-draft-${suffix}`,
      content: `<p>Automated BAM smoke test draft ${suffix}.</p>`,
      status: "draft",
      author: user.id,
      categories: categories[0]?.id ? [categories[0].id] : undefined,
      featured_media: mediaId,
    }) as { id?: number };

    postId = post.id ?? null;
    if (!postId) {
      throw new Error("WordPress post create did not return an id.");
    }

    const verifiedPost = await getWpPost(credentials, postId);
    if (verifiedPost.id !== postId || verifiedPost.status !== "draft") {
      throw new Error("Draft WordPress post could not be verified.");
    }

    console.log("WordPress smoke test completed.");
  } finally {
    if (postId) {
      await deleteWpPost(credentials, postId).catch(() => undefined);
    }
    if (mediaId) {
      await deleteWpMedia(credentials, mediaId).catch(() => undefined);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
