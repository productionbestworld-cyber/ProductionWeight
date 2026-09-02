// ───────────────────────────────────────────────────────────────────────────
//  ย้อนการซ่อมยอดหัวใบ — เขียน total_rolls / total_kg กลับเป็นค่าเดิมจาก backup
//    node scripts/restore-doc-totals.mjs "D:/back upเครื่องชั่ง supabase/doc-totals_YYYY-MM-DD_HHMM"
// ───────────────────────────────────────────────────────────────────────────
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const sb = createClient(
  'https://belwjdajuaxbhaqtlhrj.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJlbHdqZGFqdWF4YmhhcXRsaHJqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3NzgzNzYsImV4cCI6MjA5NDM1NDM3Nn0.aM-DKa8v0OlQQW6MsDzmCrEFY0d8rEVgzuemZ8UKZJA')

const dir = process.argv[2]
if (!dir) { console.error('ใส่โฟลเดอร์ backup ด้วย เช่น:\n  node scripts/restore-doc-totals.mjs "D:/back upเครื่องชั่ง supabase/doc-totals_2026-09-02_1500"'); process.exit(1) }

const rows = JSON.parse(readFileSync(`${dir}/before.json`, 'utf8'))
console.log(`จะคืนค่าเดิม ${rows.length} ใบ: ${rows.map(r => r.doc_no).join(', ')}\n`)

let ok = 0, fail = 0
for (const r of rows) {
  const { data, error } = await sb.from('transfer_documents')
    .update({ total_rolls: r.total_rolls, total_kg: r.total_kg })
    .eq('id', r.id).select('id')
  if (error || !data?.length) { fail++; console.log(`  ⚠ ${r.doc_no}: ${error?.message ?? 'ไม่พบใบนี้'}`) }
  else { ok++; console.log(`  ✓ ${r.doc_no} → ${r.total_rolls} · ${r.total_kg} kg`) }
}
console.log(`\nคืนค่า ${ok} · ล้มเหลว ${fail}`)
