// ───────────────────────────────────────────────────────────────────────────
// กู้ฐานข้อมูล Supabase กลับจากไฟล์ backup (JSON)
//   วิธีใช้:
//     1) ตั้ง RESTORE_FROM = โฟลเดอร์ backup ที่จะกู้ (เช่นที่ได้จาก backup-db.mjs)
//     2) (เลือกได้) ตั้ง ONLY_TABLES = ['production_rolls'] ถ้าอยากกู้เฉพาะบางตาราง
//     3) รัน:  node scripts/restore-db.mjs        ← ครั้งแรก "ลองดูเฉย ๆ" (ไม่เขียนจริง)
//     4) ดูสรุปว่าจะเขียนกี่แถว ถ้าโอเค → ตั้ง CONFIRM = true แล้วรันอีกครั้ง
//
//   ⚠ การกู้ = upsert (เขียนทับแถวที่มี id เดียวกัน · แถวใหม่กว่าที่ไม่อยู่ใน backup จะ"ไม่ถูกลบ")
//      แนะนำ: กด Backup ปัจจุบันไว้ก่อนเสมอ เผื่อกู้ผิดจะย้อนได้
// ───────────────────────────────────────────────────────────────────────────
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'node:fs'

const url = 'https://belwjdajuaxbhaqtlhrj.supabase.co'
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJlbHdqZGFqdWF4YmhhcXRsaHJqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3NzgzNzYsImV4cCI6MjA5NDM1NDM3Nn0.aM-DKa8v0OlQQW6MsDzmCrEFY0d8rEVgzuemZ8UKZJA'

// ⬇⬇⬇ ตั้งค่าตรงนี้ ⬇⬇⬇
const RESTORE_FROM = 'D:/back upเครื่องชั่ง supabase/backup_XXXX-XX-XX_XXXX'  // ← ใส่โฟลเดอร์ backup ที่จะกู้
const CONFIRM      = false   // false = ลองดูเฉย ๆ (ไม่เขียน) · true = เขียนจริง
const ONLY_TABLES  = []      // [] = ทุกตาราง · เช่น ['production_rolls','app_settings']
// ⬆⬆⬆ ตั้งค่าตรงนี้ ⬆⬆⬆

// conflict column ต่อตาราง (ส่วนใหญ่ใช้ id · บางตารางใช้คีย์อื่น)
const CONFLICT = { machine_profiles: 'machine_no', app_settings: 'key', products: 'item_code' }

const TABLES_ORDER = [
  'customers', 'products', 'sales_orders', 'machine_profiles', 'label_layouts', 'app_settings',
  'job_summaries', 'rework_jobs', 'transfer_documents', 'parked_jobs',
  'production_rolls', 'rework_rolls', 'rework_withdrawals', 'weigh_logs', 'roll_deletion_logs',
]

const sb = createClient(url, key)

if (!existsSync(RESTORE_FROM)) {
  console.error(`❌ ไม่พบโฟลเดอร์: ${RESTORE_FROM}\n   → แก้ค่า RESTORE_FROM ในไฟล์ scripts/restore-db.mjs ให้ถูก`)
  process.exit(1)
}
console.log(`${CONFIRM ? '🟢 กู้จริง (เขียนทับ)' : '🔍 โหมดลองดู (ไม่เขียน)'}  ←  ${RESTORE_FROM}\n`)

const list = ONLY_TABLES.length ? TABLES_ORDER.filter(t => ONLY_TABLES.includes(t)) : TABLES_ORDER
let grand = 0

for (const t of list) {
  const file = `${RESTORE_FROM}/${t}.json`
  if (!existsSync(file)) { console.log(`  – ${t.padEnd(22)} (ไม่มีไฟล์ ข้าม)`); continue }
  const rows = JSON.parse(readFileSync(file, 'utf8'))
  if (!Array.isArray(rows) || rows.length === 0) { console.log(`  – ${t.padEnd(22)} (ว่าง)`); continue }

  if (!CONFIRM) { console.log(`  • ${t.padEnd(22)} จะเขียน ${String(rows.length).padStart(7)} แถว`); grand += rows.length; continue }

  const onConflict = CONFLICT[t] ?? 'id'
  let done = 0, failed = 0
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500)
    const { error } = await sb.from(t).upsert(chunk, { onConflict })
    if (error) { failed += chunk.length; if (i === 0) console.warn(`     ⚠ ${t}: ${error.message}`) }
    else done += chunk.length
  }
  grand += done
  console.log(`  ✓ ${t.padEnd(22)} เขียน ${String(done).padStart(7)} แถว${failed ? `  (พลาด ${failed})` : ''}`)
}

console.log(`\n${CONFIRM ? '✅ กู้เสร็จ' : 'ℹ ลองดูจบ — ถ้าโอเคให้ตั้ง CONFIRM = true แล้วรันอีกครั้ง'} · รวม ${grand.toLocaleString()} แถว`)
