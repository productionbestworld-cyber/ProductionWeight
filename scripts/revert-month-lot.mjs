// ───────────────────────────────────────────────────────────────────────────
//  ย้อนกลับการแก้ lot/เลขม้วน — คืนค่า roll_no + lot_no เดิมจากไฟล์ backup
//    node scripts/revert-month-lot.mjs "D:/back up.../lot-fix_xxxx/backup_rows.json"
// ───────────────────────────────────────────────────────────────────────────
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const url = 'https://belwjdajuaxbhaqtlhrj.supabase.co'
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJlbHdqZGFqdWF4YmhhcXRsaHJqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3NzgzNzYsImV4cCI6MjA5NDM1NDM3Nn0.aM-DKa8v0OlQQW6MsDzmCrEFY0d8rEVgzuemZ8UKZJA'
const sb = createClient(url, key)

const file = process.argv[2]
if (!file) { console.log('ใส่ path ไฟล์ backup ด้วย'); process.exit(1) }
const rows = JSON.parse(readFileSync(file, 'utf8'))
console.log(`คืนค่าเดิม ${rows.length} แถว จาก ${file}`)
let ok = 0, fail = 0
for (const r of rows) {
  const { error } = await sb.from('production_rolls').update({ roll_no: r.roll_no, lot_no: r.lot_no }).eq('id', r.id)
  if (error) { fail++; console.warn(`  ⚠ ${r.id}: ${error.message}`) } else ok++
}
console.log(`✅ คืนค่าเสร็จ: สำเร็จ ${ok} · ล้มเหลว ${fail}`)
