import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !key) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY env vars')
}

// Singleton — only db.js and Auth.jsx may import this file
// flowType: 'implicit' puts tokens directly in the URL hash — no localStorage
// code_verifier needed, so magic links work even when opened in a fresh browser.
export const supabase = createClient(url, key, {
  auth: {
    flowType: 'implicit',
    detectSessionInUrl: true,
  },
})
