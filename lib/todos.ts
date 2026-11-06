import { db } from "@/lib/supabase-server";

export interface Todo { id: string; text: string; done: boolean; is_public: boolean }

const COLS = "id, text, done, is_public";

/** uid null -> public todos only; otherwise that user's todos (private included). */
export async function listTodos(uid: string | null) {
  let query = db.from("todos").select(COLS).order("created_at", { ascending: true });
  if (uid) query = query.eq("user_id", uid);
  else query = query.eq("is_public", true);
  return query;
}

/** Sets done on one of the user's todos and returns the updated row (null if not found). */
export async function setTodoDone(uid: string, id: string, done: boolean) {
  return db.from("todos").update({ done }).eq("id", id).eq("user_id", uid).select(COLS).maybeSingle();
}
