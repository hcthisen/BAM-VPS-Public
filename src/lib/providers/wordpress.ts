import { Buffer } from "node:buffer";

export type WordPressCredentials = {
  baseUrl: string;
  username: string;
  applicationPassword: string;
};

function buildHeaders(credentials: WordPressCredentials, contentType = "application/json") {
  const token = Buffer.from(`${credentials.username}:${credentials.applicationPassword}`).toString("base64");
  return {
    Authorization: `Basic ${token}`,
    "Content-Type": contentType,
  };
}

export async function wpGet<T>(credentials: WordPressCredentials, path: string): Promise<T> {
  const response = await fetch(`${credentials.baseUrl.replace(/\/$/, "")}${path}`, {
    headers: buildHeaders(credentials),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`WordPress GET ${path} failed with ${response.status}`);
  }

  return (await response.json()) as T;
}

export async function wpDelete<T>(credentials: WordPressCredentials, path: string): Promise<T> {
  const response = await fetch(`${credentials.baseUrl.replace(/\/$/, "")}${path}`, {
    method: "DELETE",
    headers: buildHeaders(credentials),
  });

  if (!response.ok) {
    throw new Error(`WordPress DELETE ${path} failed with ${response.status}`);
  }

  return (await response.json()) as T;
}

export async function listWpUsers(credentials: WordPressCredentials) {
  return wpGet<Array<{ id: number; name: string; slug: string; email?: string }>>(credentials, "/wp-json/wp/v2/users");
}

export async function getWpCurrentUser(credentials: WordPressCredentials) {
  return wpGet<{ id: number; name: string; slug: string; email?: string }>(credentials, "/wp-json/wp/v2/users/me");
}

export async function listWpCategories(credentials: WordPressCredentials) {
  return wpGet<Array<{ id: number; name: string; slug: string; description?: string }>>(credentials, "/wp-json/wp/v2/categories");
}

export async function createWpPost(
  credentials: WordPressCredentials,
  payload: {
    title: string;
    slug?: string;
    content: string;
    excerpt?: string;
    status?: "draft" | "publish" | "future" | "private";
    author?: number;
    categories?: number[];
    featured_media?: number;
  },
) {
  const response = await fetch(`${credentials.baseUrl.replace(/\/$/, "")}/wp-json/wp/v2/posts`, {
    method: "POST",
    headers: buildHeaders(credentials),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`WordPress post create failed with ${response.status}`);
  }

  return response.json();
}

export async function updateWpPost(
  credentials: WordPressCredentials,
  postId: number,
  payload: {
    title?: string;
    slug?: string;
    content?: string;
    excerpt?: string;
    status?: "draft" | "publish" | "future" | "private";
    author?: number;
    categories?: number[];
    featured_media?: number;
  },
) {
  const response = await fetch(`${credentials.baseUrl.replace(/\/$/, "")}/wp-json/wp/v2/posts/${postId}`, {
    method: "POST",
    headers: buildHeaders(credentials),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`WordPress post update failed with ${response.status}`);
  }

  return response.json();
}

export async function findWpPostBySlug(credentials: WordPressCredentials, slug: string) {
  const posts = await wpGet<Array<{ id: number; link?: string; status?: string; title?: { rendered?: string } }>>(
    credentials,
    `/wp-json/wp/v2/posts?slug=${encodeURIComponent(slug)}&context=edit`,
  );

  return posts[0] ?? null;
}

export async function getWpPost(credentials: WordPressCredentials, postId: number) {
  return wpGet<{ id: number; link?: string; status?: string; title?: { rendered?: string } }>(
    credentials,
    `/wp-json/wp/v2/posts/${postId}?context=edit`,
  );
}

export async function deleteWpPost(credentials: WordPressCredentials, postId: number) {
  return wpDelete(credentials, `/wp-json/wp/v2/posts/${postId}?force=true`);
}

export async function uploadWpMedia(
  credentials: WordPressCredentials,
  fileName: string,
  contentType: string,
  body: Buffer | Uint8Array,
) {
  const bytes = body instanceof Uint8Array ? body : new Uint8Array(body);
  const payload = new Blob([Uint8Array.from(bytes)], { type: contentType });
  const token = Buffer.from(`${credentials.username}:${credentials.applicationPassword}`).toString("base64");
  const response = await fetch(`${credentials.baseUrl.replace(/\/$/, "")}/wp-json/wp/v2/media`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${token}`,
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Content-Type": contentType,
    },
    body: payload,
  });

  if (!response.ok) {
    throw new Error(`WordPress media upload failed with ${response.status}`);
  }

  return response.json();
}

export async function getWpMedia(credentials: WordPressCredentials, mediaId: number) {
  return wpGet<{ id: number; source_url?: string; media_type?: string }>(
    credentials,
    `/wp-json/wp/v2/media/${mediaId}?context=edit`,
  );
}

export async function deleteWpMedia(credentials: WordPressCredentials, mediaId: number) {
  return wpDelete(credentials, `/wp-json/wp/v2/media/${mediaId}?force=true`);
}
