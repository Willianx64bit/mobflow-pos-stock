import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://ezkwubdpblqkdfampopa.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_UYLcJXGRBbP9aq4sPAD3Eg_jcKTuk6A";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});
