import { DeleteObjectsCommand, GetObjectCommand, S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { createClient } from "@supabase/supabase-js";

import { getEnv } from "@/lib/env";
import { getS3Settings } from "@/lib/settings";

let s3Client: S3Client | null = null;
let cachedSignature = "";

async function getS3Client() {
  const settings = await getS3Settings();
  const signature = JSON.stringify({
    endpoint: settings.endpoint,
    region: settings.region,
    accessKey: settings.accessKey,
    secretKey: settings.secretKey,
  });

  if (s3Client && cachedSignature === signature) {
    return s3Client;
  }

  if (!settings.region || !settings.accessKey || !settings.secretKey || !settings.endpoint) {
    throw new Error("S3 storage is not configured");
  }

  cachedSignature = signature;
  s3Client = new S3Client({
    region: settings.region,
    endpoint: settings.endpoint,
    credentials: {
      accessKeyId: settings.accessKey,
      secretAccessKey: settings.secretKey,
    },
    forcePathStyle: true,
  });

  return s3Client;
}

export async function uploadAsset(path: string, body: Buffer | Uint8Array | string, contentType: string) {
  const env = getEnv();
  const s3 = await getS3Settings();

  if (!s3.bucket && env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
    const payload = body instanceof Buffer ? body : Buffer.from(body);

    const { error } = await supabase.storage.from(env.SUPABASE_STORAGE_BUCKET).upload(path, payload, {
      contentType,
      upsert: true,
    });

    if (error) {
      throw error;
    }

    const { data } = supabase.storage.from(env.SUPABASE_STORAGE_BUCKET).getPublicUrl(path);
    return {
      path,
      publicUrl: data.publicUrl,
      backend: "supabase",
    };
  }

  if (!s3.bucket || !s3.endpoint) {
    throw new Error("S3 bucket is not configured");
  }

  const client = await getS3Client();
  await client.send(
    new PutObjectCommand({
      Bucket: s3.bucket,
      Key: path,
      Body: body,
      ContentType: contentType,
    }),
  );

  return {
    path,
    publicUrl: `${s3.endpoint}/${s3.bucket}/${path}`,
    backend: "s3",
  };
}

export async function downloadAsset(path: string) {
  const env = getEnv();
  const s3 = await getS3Settings();

  if (!s3.bucket && env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
    const { data, error } = await supabase.storage.from(env.SUPABASE_STORAGE_BUCKET).download(path);

    if (error) {
      throw error;
    }

    return {
      body: Buffer.from(await data.arrayBuffer()),
      contentType: data.type || "application/octet-stream",
    };
  }

  if (!s3.bucket || !s3.endpoint) {
    throw new Error("S3 bucket is not configured");
  }

  const client = await getS3Client();
  const response = await client.send(
    new GetObjectCommand({
      Bucket: s3.bucket,
      Key: path,
    }),
  );

  const bytes = await response.Body?.transformToByteArray();
  if (!bytes) {
    throw new Error(`Storage asset ${path} has no body`);
  }

  return {
    body: Buffer.from(bytes),
    contentType: response.ContentType ?? "application/octet-stream",
  };
}

export async function deleteAssets(paths: string[]) {
  const uniquePaths = [...new Set(paths.map((path) => path.trim()).filter(Boolean))];
  if (!uniquePaths.length) {
    return { deleted: 0 };
  }

  const env = getEnv();
  const s3 = await getS3Settings();

  if (!s3.bucket && env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
    const { error } = await supabase.storage.from(env.SUPABASE_STORAGE_BUCKET).remove(uniquePaths);

    if (error) {
      throw error;
    }

    return { deleted: uniquePaths.length };
  }

  if (!s3.bucket || !s3.endpoint) {
    throw new Error("S3 bucket is not configured");
  }

  const client = await getS3Client();
  for (let index = 0; index < uniquePaths.length; index += 1000) {
    const chunk = uniquePaths.slice(index, index + 1000);
    await client.send(
      new DeleteObjectsCommand({
        Bucket: s3.bucket,
        Delete: {
          Objects: chunk.map((path) => ({ Key: path })),
          Quiet: true,
        },
      }),
    );
  }

  return { deleted: uniquePaths.length };
}
