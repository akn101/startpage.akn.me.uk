import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Defer client creation to first request so the module can be imported
// at build time without SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY present.
let _client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (!_client) {
    _client = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );
  }
  return _client;
}

export const db = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    return Reflect.get(getClient(), prop, receiver);
  },
});
