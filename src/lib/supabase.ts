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

// ── ดึงทุกแถวแบบแบ่งหน้า (page ละ 1000) จนครบ ──────────────────────────────
// Supabase บังคับ server max-rows = 1000 ต่อ query — .limit(8000) หรือ select เปล่า
// จะถูก cap เหลือ 1000 เงียบ ๆ ทำให้ยอดรวม/สต็อกขาด พอข้อมูลเกิน 1000 แถว
// makeQuery: คืน query ใหม่ทุกครั้ง (ใส่ .select/.eq/.order ได้ตามต้องการ แต่ "อย่า" ใส่ .range)
// ⚡ ดึงหลายหน้า "พร้อมกัน" (parallel) ทีละชุด — ได้ข้อมูลชุดเดิมเป๊ะ (เรียงตาม .order ที่ส่งมา)
//    แต่เร็วขึ้นมากเมื่อข้อมูลเยอะ (เช่น 17 หน้า: เดิมยิงเรียงกัน 17 รอบ → ตอนนี้ ~3 รอบ)
// ⚠ strict:true → โหลดพลาด (เน็ตสะดุด/5xx) ให้ "โยน error" แทนการคืน [] เงียบ ๆ
//   ใช้กับจุดที่ผลลัพธ์ว่างมีความหมาย เช่น ตัวนับเลขม้วนในจอชั่ง — [] ปลอมทำให้เลขเด้งกลับ #1
//   แล้วชั่งทับเลขเดิม (เคสจริง BL06 Lot 69BL06003408 ได้ #1 ซ้ำ 26/8/2026)
export async function fetchAll<T = any>(
  makeQuery: () => any,
  opts?: { pageSize?: number; concurrency?: number; strict?: boolean },
): Promise<T[]> {
  const PAGE = opts?.pageSize ?? 1000
  const CONC = opts?.concurrency ?? 6
  const all: T[] = []
  let from = 0
  for (;;) {
    // ยิงพร้อมกัน CONC หน้า (range ต่อเนื่องกัน) — Promise.all รักษาลำดับผลลัพธ์
    const batch = await Promise.all(
      Array.from({ length: CONC }, (_, i) =>
        makeQuery().range(from + i * PAGE, from + i * PAGE + PAGE - 1)),
    )
    let done = false
    for (const { data, error } of batch) {
      if (error || !data) {
        if (opts?.strict) throw (error ?? new Error('fetchAll: no data'))
        done = true; break
      }
      all.push(...(data as T[]))
      if (data.length < PAGE) done = true   // เจอหน้าที่ไม่เต็ม = ถึงท้ายแล้ว
    }
    if (done) break
    from += CONC * PAGE
  }
  return all
}
