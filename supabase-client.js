import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
const configured = Boolean(supabaseUrl && supabasePublishableKey);
const localPreview = Boolean(import.meta.env.DEV && !configured);

if (!configured && !localPreview) {
  throw new Error(
    "ProMoms production requires VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.",
  );
}

export const backendStatus = Object.freeze({
  provider: "supabase",
  configured,
  localPreview,
  mode: configured ? "cloud" : "local-preview",
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
