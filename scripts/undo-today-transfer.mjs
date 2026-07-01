// ───────────────────────────────────────────────────────────────────────────
//  เอาม้วนที่ "โอนวันนี้" กลับมา (un-transfer) + ลบใบโอนของวันนี้
//    ใช้ตอนโอนผิด/โอนก่อนแก้ข้อมูล แล้วอยากโอนใหม่
//    node scripts/undo-today-transfer.mjs          ← ดูสโคป (dry run, backup)
//    node scripts/undo-today-transfer.mjs apply     ← ทำจริง
//  ย้อนกลับ:  node scripts/redo-transfer.mjs <ไฟล์ backup>
// ───────────────────────────────────────────────────────────────────────────
import { createClient } from '@supabase/supabase-js'
import { writeFileSync, mkdirSync } from 'node:fs'

const url = 'https://belwjdajuaxbhaqtlhrj.supabase.co'
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJlbHdqZGFqdWF4YmhhcXRsaHJqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3NzgzNzYsImV4cCI6MjA5NDM1NDM3Nn0.aM-DKa8v0OlQQW6MsDzmCrEFY0d8rEVgzuemZ8UKZJA'
const sb = createClient(url, key)
const APPLY = (process.argv[2] || '').toLowerCase() === 'apply'
const SINCE = '2026-06-30T17:00:00'   // เที่ยงคืนไทย 1/7
const BASE = 'D:/back upเครื่องชั่ง supabase'

async function fetchAll(tbl, sel, mod) {
  const PAGE = 1000, all = []
  for (let from = 0; ; from += PAGE) {
    let q = sb.from(tbl).select(sel).range(from, from + PAGE - 1)
    q = mod(q)
    const { data, error } = await q
    if (error) throw error
    all.push(...(data ?? []))
    if (!data || data.length < PAGE) break
  }
  return all
}

// 1) ใบโอนวันนี้
const docs = await fetchAll('transfer_documents', '*', q => q.gte('transferred_at', SINCE).order('transferred_at'))
const docIds = docs.map(d => d.id)
console.log(`ใบโอนวันนี้ = ${docs.length} ใบ`)
docs.forEach(d => console.log(`  ${d.doc_no} · ${d.machine_no} · ${d.total_rolls} ม้วน`))
if (!docIds.length) { console.log('ไม่มีใบโอนวันนี้'); process.exit(0) }

// 2) ม้วนในใบเหล่านี้
const rolls = await fetchAll('production_rolls', '*', q => q.in('transfer_doc_id', docIds))
console.log(`\nม้วนที่จะเอากลับ = ${rolls.length} ม้วน`)
const shipped = rolls.filter(r => r.shipped)
if (shipped.length) {
  console.log(`\n⛔ มีม้วนที่ "ขาย/ส่งออกแล้ว (shipped)" ${shipped.length} ม้วน — หยุด ไม่ทำ (เอากลับไม่ได้ ต้องเช็คก่อน)`)
  process.exit(1)
}

// 3) backup
const pad = x => String(x).padStart(2, '0')
const now = new Date()
const stamp = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`
const dir = `${BASE}/undo-transfer_${stamp}`
mkdirSync(dir, { recursive: true })
writeFileSync(`${dir}/rolls.json`, JSON.stringify(rolls, null, 0), 'utf8')
writeFileSync(`${dir}/docs.json`, JSON.stringify(docs, null, 0), 'utf8')
console.log(`\n📁 backup → ${dir} (rolls.json ${rolls.length} · docs.json ${docs.length})`)

if (!APPLY) { console.log('\n👉 dry-run — ยังไม่แก้ · รันจริง:  node scripts/undo-today-transfer.mjs apply'); process.exit(0) }

// 4) un-transfer ม้วน
console.log('\n✍️  เอาม้วนกลับ...')
let ok = 0, fail = 0
for (const r of rolls) {
  const { error } = await sb.from('production_rolls')
    .update({ transferred: false, transfer_doc_id: null, transferred_at: null, transferred_by: null })
    .eq('id', r.id)
  if (error) { fail++; if (fail <= 5) console.warn(`  ⚠ ${r.id}: ${error.message}`) } else ok++
}
console.log(`   ม้วน: คืน ${ok} · ล้มเหลว ${fail}`)

// 5) ลบใบโอน
let dok = 0, dfail = 0
for (const d of docs) {
  const { error } = await sb.from('transfer_documents').delete().eq('id', d.id)
  if (error) { dfail++; console.warn(`  ⚠ ลบใบ ${d.doc_no}: ${error.message}`) } else dok++
}
console.log(`   ใบโอน: ลบ ${dok} · ล้มเหลว ${dfail}`)
console.log(`\n✅ เสร็จ — ม้วนกลับมาอยู่คิวรอโอนแล้ว · โอนใหม่จากแอปได้เลย`)
console.log(`   ย้อนกลับ:  node scripts/redo-transfer.mjs "${dir}"`)
