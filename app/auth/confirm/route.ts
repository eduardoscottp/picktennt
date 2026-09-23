import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

function resultUrl(request: NextRequest, status: "success" | "expired" | "invalid") {
  const url = request.nextUrl.clone();
  url.pathname = "/auth/confirmation";
  url.search = "";
  url.searchParams.set("status", status);
  return url;
}

export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const requestedType = request.nextUrl.searchParams.get("type");

  if (!tokenHash || requestedType !== "email") {
    return NextResponse.redirect(resultUrl(request, "invalid"));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: "email",
  });

  if (!error) {
    return NextResponse.redirect(resultUrl(request, "success"));
  }

  const status = error.code === "otp_expired" ? "expired" : "invalid";
  return NextResponse.redirect(resultUrl(request, status));
}
