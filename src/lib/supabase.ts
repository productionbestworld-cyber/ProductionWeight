import { createClient } from '@supabase/supabase-js'

// ── อ่านจาก env (Vite) — ใช้ค่า fallback เพื่อ backward-compat กับ deploy เดิม ──
// production ควรตั้ง VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY ใน Vercel / .env.local
const SUPABASE_URL =
  (import.meta as any).env?.VITE_SUPABASE_URL
  || 'https://belwjdajuaxbhaqtlhrj.supabase.co'

const SUPABASE_KEY =
  (import.meta as any).env?.VITE_SUPABASE_ANON_KEY
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJlbHdqZGFqdWF4YmhhcXRsaHJqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3NzgzNzYsImV4cCI6MjA5NDM1NDM3Nn0.aM-DKa8v0OlQQW6MsDzmCrEFY0d8rEVgzuemZ8UKZJA'

if (!SUPABASE_URL || !SUPABASE_KEY) {
  // eslint-disable-next-line no-console
  console.error('Supabase URL/KEY missing — set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY')
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
