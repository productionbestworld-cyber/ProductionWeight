// ───────────────────────────────────────────────────────────────────────────
// Backup ฐานข้อมูล Supabase → ไฟล์ JSON (ทุกตาราง)
//   วิธีรัน:  node scripts/backup-db.mjs
//   ไฟล์เก็บที่:  D:\back upเครื่องชั่ง supabase\backup_YYYY-MM-DD_HHMM\
//   กู้กลับด้วย:  node scripts/restore-db.mjs   (ตั้งค่า RESTORE_FROM ในไฟล์นั้น)
// ───────────────────────────────────────────────────────────────────────────
import { createClient } from '@supabase/supabase-js'
import { writeFileSync, mkdirSync } from 'node:fs'

const url = 'https://belwjdajuaxbhaqtlhrj.supabase.co'
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJlbHdqZGFqdWF4YmhhcXRsaHJqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3NzgzNzYsImV4cCI6MjA5NDM1NDM3Nn0.aM-DKa8v0OlQQW6MsDzmCrEFY0d8rEVgzuemZ8UKZJA'

// โฟลเดอร์หลักที่เก็บ backup (ใช้ / แทน \ ได้บน Windows)
const BASE = 'D:/back upเครื่องชั่ง supabase'

// ตารางทั้งหมดที่จะสำรอง (ตรงกับปุ่ม Backup ในแอป)
const TABLES = [
  'production_rolls', 'job_summaries', 'weigh_logs', 'rework_jobs', 'rework_rolls',
  'rework_withdrawals', 'transfer_documents', 'sales_orders', 'parked_jobs',
  'machine_profiles', 'customers', 'products', 'label_layouts',
  'roll_deletion_logs', 'app_settings',
]

const sb = createClient(url, key)

async function fetchAll(table) {
  const PAGE = 1000
  const all = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from(table).select('*').range(from, from + PAGE - 1)
    if (error) { console.warn(`  ⚠ ${table}: ${error.message}`); return { rows: all, ok: false } }
    all.push(...(data ?? []))
    if (!data || data.length < PAGE) break
  }
  return { rows: all, ok: true }
}

const pad = n => String(n).padStart(2, '0')
const now = new Date()
const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`
const dir = `${BASE}/backup_${stamp}`
mkdirSync(dir, { recursive: true })

console.log(`💾 เริ่ม backup → ${dir}\n`)
const manifest = { created_at: now.toISOString(), tables: {} }
let grand = 0

for (const t of TABLES) {
  const { rows, ok } = await fetchAll(t)
  writeFileSync(`${dir}/${t}.json`, JSON.stringify(rows, null, 0), 'utf8')
  manifest.tables[t] = { rows: rows.length, ok }
  grand += rows.length
  console.log(`  ✓ ${t.padEnd(22)} ${String(rows.length).padStart(7)} แถว${ok ? '' : '  (อ่านไม่ครบ!)'}`)
}

writeFileSync(`${dir}/_manifest.json`, JSON.stringify(manifest, null, 2), 'utf8')
console.log(`\n✅ เสร็จ — รวม ${grand.toLocaleString()} แถว · ${TABLES.length} ตาราง`)
console.log(`📁 ${dir}`)
