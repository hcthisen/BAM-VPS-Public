import { NextResponse } from "next/server";

import { isDatabaseReachable } from "@/lib/db";

export async function GET() {
  const databaseReachable = await isDatabaseReachable();

  return NextResponse.json(
    {
      ok: databaseReachable,
      databaseReachable,
    },
    { status: databaseReachable ? 200 : 503 },
  );
}
