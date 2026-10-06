import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://ezkwubdpblqkdfampopa.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_UYLcJXGRBbP9aq4sPAD3Eg_jcKTuk6A";

const REMEMBER_KEY = "mobflow-remember-login";
const SESSION_STORAGE_KEY = "mobflow-auth-session";

const storage = {
  getItem: (key: string) => {
    const remember = localStorage.getItem(REMEMBER_KEY) !== "0";
    return (remember ? localStorage : sessionStorage).getItem(key);
  },
  setItem: (key: string, value: string) => {
    const remember = localStorage.getItem(REMEMBER_KEY) !== "0";
    (remember ? localStorage : sessionStorage).setItem(key, value);
  },
  removeItem: (key: string) => {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  },
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storage,
    storageKey: SESSION_STORAGE_KEY,
  },
});
