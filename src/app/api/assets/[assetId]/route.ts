import { NextResponse } from "next/server";

import { getAdminSession } from "@/lib/auth/server";
import { query } from "@/lib/db";
import { downloadAsset } from "@/lib/providers/storage";

type AssetRouteProps = {
  params: Promise<{ assetId: string }>;
};

export async function GET(_request: Request, { params }: AssetRouteProps) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { assetId } = await params;
  const result = await query<{ storage_path: string | null; public_url: string | null }>(
    "select storage_path, public_url from content_assets where id = $1 and generation_status = 'ready' limit 1",
    [assetId],
  );
  const asset = result.rows[0];

  if (!asset) {
    return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  }

  if (asset.storage_path) {
    const downloaded = await downloadAsset(asset.storage_path);
    return new Response(downloaded.body, {
      headers: {
        "Content-Type": downloaded.contentType,
        "Cache-Control": "private, max-age=300",
      },
    });
  }

  if (asset.public_url) {
    const response = await fetch(asset.public_url);
    if (!response.ok) {
      return NextResponse.json({ error: "Asset is not readable" }, { status: response.status });
    }

    return new Response(await response.arrayBuffer(), {
      headers: {
        "Content-Type": response.headers.get("content-type") ?? "application/octet-stream",
        "Cache-Control": "private, max-age=300",
      },
    });
  }

  return NextResponse.json({ error: "Asset has no storage path" }, { status: 404 });
}
