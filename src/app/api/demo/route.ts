import { NextRequest, NextResponse } from "next/server";
import { createDemoAuction } from "@/server/demo";

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin") ?? new URL(req.url).origin;
  const result = await createDemoAuction(origin);
  return NextResponse.json(result);
}
