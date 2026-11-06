import { NextResponse } from "next/server";

// Without this, Next 14 prerenders this GET handler at build time and every
// request is served the events that existed when the deployment was built.
export const dynamic  = "force-dynamic";
export const revalidate = 0;

import { fetchCalendarPayload } from "@/lib/caldav";

export async function GET() {
  const { status, body } = await fetchCalendarPayload();
  return NextResponse.json(body, { status });
}
