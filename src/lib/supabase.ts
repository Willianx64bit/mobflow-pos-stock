import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://ezkwubdpblqkdfampopa.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_UYLcJXGRBbP9aq4sPAD3Eg_jcKTuk6A";

const REMEMBER_KEY = "mobflow-remember-login";
const SESSION_STORAGE_KEY = "mobflow-auth-session";

const storage = {
  getItem: (key: string) => {
    // This app is rendered on the server as well as in the browser.
    // Never touch browser storage during SSR; sessions remain browser-only.
    if (typeof window === "undefined") return null;
    const remember = window.localStorage.getItem(REMEMBER_KEY) !== "0";
    return (remember ? window.localStorage : window.sessionStorage).getItem(key);
  },
  setItem: (key: string, value: string) => {
    if (typeof window === "undefined") return;
    const remember = window.localStorage.getItem(REMEMBER_KEY) !== "0";
    (remember ? window.localStorage : window.sessionStorage).setItem(key, value);
  },
  removeItem: (key: string) => {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(key);
    window.sessionStorage.removeItem(key);
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
