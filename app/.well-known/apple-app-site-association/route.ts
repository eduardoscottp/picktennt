import { NextResponse } from "next/server";

export const dynamic = "force-static";

export function GET() {
  return NextResponse.json({
    applinks: {
      details: [
        {
          appIDs: ["ZX88S3Q93L.Idddeas.Picktennt"],
          components: [{ "/": "/s/*", comment: "Picktennt Play Session invitations" }],
        },
      ],
    },
  }, {
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}
