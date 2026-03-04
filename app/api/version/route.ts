export async function GET() {
  return Response.json({ id: process.env.VERCEL_DEPLOYMENT_ID ?? "dev" });
}
