import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

export const backendStatus = Object.freeze({
  provider: "supabase",
  configured: Boolean(supabaseUrl && supabasePublishableKey),
  mode: supabaseUrl && supabasePublishableKey ? "cloud" : "local-demo",
});

export const supabase = backendStatus.configured
  ? createClient(supabaseUrl, supabasePublishableKey, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: true,
        persistSession: true,
      },
    })
  : null;
