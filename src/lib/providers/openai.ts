import OpenAI from "openai";

import { getOpenAiSettings } from "@/lib/settings";

type JsonObject = Record<string, unknown>;

let cachedClient: OpenAI | null = null;
let cachedApiKey: string | null = null;

async function getClient() {
  const settings = await getOpenAiSettings();
  if (cachedClient && cachedApiKey === settings.apiKey) {
    return cachedClient;
  }

  if (!settings.apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  cachedApiKey = settings.apiKey;
  cachedClient = new OpenAI({ apiKey: settings.apiKey });
  return cachedClient;
}

export async function generateText(prompt: string, model?: string) {
  const settings = await getOpenAiSettings();
  const selectedModel = model ?? settings.textModel;

  const client = await getClient();
  const response = await client.responses.create({
    model: selectedModel,
    input: prompt,
  });

  return response.output_text;
}

export async function generateJson<T extends JsonObject>(prompt: string, fallback: T, model?: string): Promise<T> {
  const settings = await getOpenAiSettings();
  const selectedModel = model ?? settings.textModel;

  const text = await generateText(`${prompt}\n\nReturn JSON only.`, selectedModel);

  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export async function generateArticle(prompt: string) {
  const settings = await getOpenAiSettings();

  return generateText(prompt, settings.writingModel);
}

export type GeneratedImage = {
  assetId: string;
  imageUrl: string | null;
  imageBase64: string | null;
  error: string | null;
};

/**
 * Generate images one at a time using the OpenAI Images API.
 * Synchronous - returns immediately with all results.
 */
export async function generateImages(requests: Array<{ assetId: string; prompt: string; size?: string }>): Promise<GeneratedImage[]> {
  const settings = await getOpenAiSettings();

  if (!settings.apiKey) {
    return requests.map((r) => ({
      assetId: r.assetId,
      imageUrl: null,
      imageBase64: null,
      error: "OPENAI_API_KEY is not configured",
    }));
  }

  const client = await getClient();
  const results: GeneratedImage[] = [];

  for (const request of requests) {
    try {
      const response = await client.images.generate({
        model: settings.imageModel,
        prompt: request.prompt,
        size: (request.size ?? "1536x1024") as "1024x1024",
        n: 1,
      }, {
        timeout: 180_000,
      });

      const imageData = response.data?.[0];
      results.push({
        assetId: request.assetId,
        imageUrl: imageData?.url ?? null,
        imageBase64: imageData?.b64_json ?? null,
        error: null,
      });
    } catch (error) {
      results.push({
        assetId: request.assetId,
        imageUrl: null,
        imageBase64: null,
        error: error instanceof Error ? error.message : "Image generation failed",
      });
    }
  }

  return results;
}

/**
 * Submit images for batch generation via the Batch API (50% cost discount, 24h window).
 * Returns batch metadata - caller must poll for completion separately.
 */
export async function createImageBatch(requests: Array<{ assetId: string; prompt: string; size?: string }>) {
  const settings = await getOpenAiSettings();
  const client = await getClient();
  const jsonl = requests
    .map((request) =>
      JSON.stringify({
        custom_id: request.assetId,
        method: "POST",
        url: "/v1/images/generations",
        body: {
          model: settings.imageModel,
          prompt: request.prompt,
          size: request.size ?? "1536x1024",
        },
      }),
    )
    .join("\n");

  const file = new File([jsonl], "batch-requests.jsonl", { type: "application/jsonl" });
  const uploaded = await client.files.create({ file, purpose: "batch" });
  const batch = await client.batches.create({
    input_file_id: uploaded.id,
    endpoint: "/v1/images/generations" as never,
    completion_window: "24h",
  });

  return { batchId: batch.id, status: batch.status };
}

export async function getImageBatch(batchId: string) {
  const client = await getClient();
  return client.batches.retrieve(batchId);
}

export async function downloadBatchOutput(outputFileId: string): Promise<GeneratedImage[]> {
  const client = await getClient();
  const response = await client.files.content(outputFileId);
  const text = await response.text();

  return text.split("\n").filter(Boolean).map((line) => {
    const entry = JSON.parse(line) as {
      custom_id: string;
      response?: { body?: { data?: Array<{ url?: string; b64_json?: string }>; error?: { message?: string } } };
      error?: { message?: string };
    };

    const body = entry.response?.body;
    if (entry.error || body?.error) {
      return { assetId: entry.custom_id, imageUrl: null, imageBase64: null, error: entry.error?.message ?? body?.error?.message ?? "Batch error" };
    }

    const img = body?.data?.[0];
    return { assetId: entry.custom_id, imageUrl: img?.url ?? null, imageBase64: img?.b64_json ?? null, error: null };
  });
}

