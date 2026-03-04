import { db } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/auth";

export async function GET() {
  const deny = requireAuth();
  if (deny) return deny;

  const { data, error } = await db.from("visitors")
    .select("id, captured_at, face_label, image_path")
    .order("captured_at", { ascending: false })
    .limit(50);

  if (error) return Response.json({ error: error.message }, { status: 500 });

  // Generate signed URLs for images
  const visitors = await Promise.all(
    (data ?? []).map(async (v) => {
      if (!v.image_path) return { ...v, imageUrl: null };
      const { data: signed } = await db.storage
        .from("visitors")
        .createSignedUrl(v.image_path, 3600);
      return { ...v, imageUrl: signed?.signedUrl ?? null };
    })
  );

  return Response.json({ visitors });
}
