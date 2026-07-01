// ───────────────────────────────────────────────────────────────────────────
//  ย้อนกลับ undo-today-transfer — คืนสถานะโอน + ใบโอนเดิม จาก backup
//    node scripts/redo-transfer.mjs "D:/back up.../undo-transfer_xxxx"
// ───────────────────────────────────────────────────────────────────────────
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const url = 'https://belwjdajuaxbhaqtlhrj.supabase.co'
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJlbHdqZGFqdWF4YmhhcXRsaHJqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3NzgzNzYsImV4cCI6MjA5NDM1NDM3Nn0.aM-DKa8v0OlQQW6MsDzmCrEFY0d8rEVgzuemZ8UKZJA'
const sb = createClient(url, key)
const dir = process.argv[2]
if (!dir) { console.log('ใส่ path โฟลเดอร์ backup'); process.exit(1) }
const rolls = JSON.parse(readFileSync(`${dir}/rolls.json`, 'utf8'))
const docs = JSON.parse(readFileSync(`${dir}/docs.json`, 'utf8'))

console.log(`คืนใบโอน ${docs.length} · ม้วน ${rolls.length}`)
for (const d of docs) {
  const { error } = await sb.from('transfer_documents').upsert(d, { onConflict: 'id' })
  if (error) console.warn(`  ⚠ ใบ ${d.doc_no}: ${error.message}`)
}
let ok = 0
for (const r of rolls) {
  const { error } = await sb.from('production_rolls')
    .update({ transferred: r.transferred, transfer_doc_id: r.transfer_doc_id, transferred_at: r.transferred_at, transferred_by: r.transferred_by })
    .eq('id', r.id)
  if (!error) ok++
}
console.log(`✅ คืนสถานะโอน ${ok}/${rolls.length} ม้วน`)
