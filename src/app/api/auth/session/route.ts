import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";

export async function GET() {
  const session = await auth();
  return NextResponse.json(session);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ user: session.user });
}
