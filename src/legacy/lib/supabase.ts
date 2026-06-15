import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://ecsvgwhzfbhlbcnpcpzl.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVjc3Znd2h6ZmJobGJjbnBjcHpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc4NTk5MDAsImV4cCI6MjA5MzQzNTkwMH0.OGQgd5H7M3-yq7iqw0I-0oULAt02qcdBx4AL_hN_rzE'

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, storageKey: 'bwp-legacy-dash' },
})
