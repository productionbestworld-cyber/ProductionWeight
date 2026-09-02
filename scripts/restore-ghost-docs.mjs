// ───────────────────────────────────────────────────────────────────────────
//  ย้อนการลบใบผี — เอาหัวใบกลับเข้า transfer_documents จาก backup
//    node scripts/restore-ghost-docs.mjs "D:/back upเครื่องชั่ง supabase/ghost-docs_YYYY-MM-DD_HHMM"
//  ใส่กลับด้วย id เดิม → ม้วนที่เคยชี้ใบนี้ (ถ้ามี) จะกลับมาผูกได้เหมือนเดิม
// ───────────────────────────────────────────────────────────────────────────
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const sb = createClient(
  'https://belwjdajuaxbhaqtlhrj.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJlbHdqZGFqdWF4YmhhcXRsaHJqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3NzgzNzYsImV4cCI6MjA5NDM1NDM3Nn0.aM-DKa8v0OlQQW6MsDzmCrEFY0d8rEVgzuemZ8UKZJA')

const dir = process.argv[2]
if (!dir) { console.error('ใส่โฟลเดอร์ backup ด้วย เช่น:\n  node scripts/restore-ghost-docs.mjs "D:/back upเครื่องชั่ง supabase/ghost-docs_2026-09-02_1530"'); process.exit(1) }

const docs = JSON.parse(readFileSync(`${dir}/docs.json`, 'utf8'))
console.log(`จะใส่กลับ ${docs.length} ใบ: ${docs.map(d => d.doc_no).join(', ')}\n`)

let ok = 0, skip = 0, fail = 0
for (const d of docs) {
  const { data: exist } = await sb.from('transfer_documents').select('id').eq('id', d.id).maybeSingle()
  if (exist) { skip++; console.log(`  ⏭ ${d.doc_no}: มีอยู่แล้ว — ข้าม`); continue }
  const { error } = await sb.from('transfer_documents').insert(d)
  if (error) { fail++; console.log(`  ⚠ ${d.doc_no}: ${error.message}`) }
  else { ok++; console.log(`  ✓ ${d.doc_no} ใส่กลับแล้ว`) }
}
console.log(`\nใส่กลับ ${ok} · ข้าม ${skip} · ล้มเหลว ${fail}`)
