// ───────────────────────────────────────────────────────────────────────────
//  ซ่อมยอดบนหัวใบโอนให้ตรงกับม้วนที่ผูกอยู่จริง
//    เกิดจากบั๊กเก่าใน undoTransfer: ปลดม้วนออกจากใบ แต่ไม่ลด total_rolls/total_kg
//    (แก้โค้ดต้นเหตุแล้ว — สคริปต์นี้ไว้ซ่อมของเก่าที่ค้างอยู่)
//
//    node scripts/fix-doc-totals.mjs          ← dry-run (ไม่แก้อะไร + เขียน backup)
//    node scripts/fix-doc-totals.mjs apply    ← แก้จริง
//    ย้อนกลับ:  node scripts/restore-doc-totals.mjs "<โฟลเดอร์ backup>"
//
//  กฎความปลอดภัย (ห้ามถอดออก)
//    - แตะเฉพาะ transfer_documents.total_rolls / total_kg เท่านั้น
//      ไม่มีคำสั่งเขียน/ลบตาราง production_rolls อยู่ในไฟล์นี้เลย
//    - ไม่ลบใบไหนทั้งสิ้น (ใบผีถูกเก็บกวาดไปแล้วด้วย delete-ghost-docs.mjs)
//      ถ้าเจอใบที่ผูกจริง 0 ม้วน จะ "ข้าม" แล้วรายงาน ไม่ตัดสินใจเอง
//    - ยอดใหม่คำนวณจากการนับม้วนจริงในฐาน ไม่ได้เดาจากตัวเลขเดิม
//    - backup ค่าเดิมทุกใบก่อนเสมอ (แม้ dry-run)
//    - นับ production_rolls ก่อน-หลัง ต้องเท่ากันเป๊ะ
// ───────────────────────────────────────────────────────────────────────────
import { createClient } from '@supabase/supabase-js'
import { writeFileSync, mkdirSync } from 'node:fs'

const sb = createClient(
  'https://belwjdajuaxbhaqtlhrj.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJlbHdqZGFqdWF4YmhhcXRsaHJqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3NzgzNzYsImV4cCI6MjA5NDM1NDM3Nn0.aM-DKa8v0OlQQW6MsDzmCrEFY0d8rEVgzuemZ8UKZJA')

const APPLY = (process.argv[2] || '').toLowerCase() === 'apply'
const BASE  = 'D:/back upเครื่องชั่ง supabase'
const fmt = n => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

async function all(tbl, sel, mod = q => q) {
  const P = 1000, out = []
  for (let f = 0; ; f += P) {
    const { data, error } = await mod(sb.from(tbl).select(sel)).range(f, f + P - 1)
    if (error) throw error
    out.push(...data)
    if (data.length < P) break
  }
  return out
}
const cnt = async (tbl) => (await sb.from(tbl).select('id', { count: 'exact', head: true })).count

// ── 1) ยอดตั้งต้น ────────────────────────────────────────────────────────
const rollsBefore = await cnt('production_rolls')
const docsBefore  = await cnt('transfer_documents')
console.log(`ยอดตั้งต้น: ใบโอน ${docsBefore} ใบ · ม้วน/ถุง ${rollsBefore} แถว\n`)

// ── 2) หาใบที่ยอดไม่ตรง — นับม้วนจริงทั้งฐาน ────────────────────────────
const docs  = await all('transfer_documents', 'id,doc_no,total_rolls,total_kg,transferred_by,transferred_at')
const links = await all('production_rolls', 'transfer_doc_id,weight', q => q.not('transfer_doc_id', 'is', null))
const real = {}
for (const r of links) {
  const k = r.transfer_doc_id
  ;(real[k] ??= { n: 0, kg: 0 })
  real[k].n += 1
  real[k].kg += (r.weight ?? 0)
}

const empty = [], todo = []
for (const d of docs) {
  const r = real[d.id]
  if (!r) { if (d.total_rolls) empty.push(d); continue }        // ใบผี — ข้าม ไม่ยุ่ง
  const kg = parseFloat(r.kg.toFixed(2))
  if (r.n !== d.total_rolls || Math.abs(kg - (d.total_kg ?? 0)) > 0.01)
    todo.push({ doc: d, newRolls: r.n, newKg: kg })
}

const th = d => new Date(d).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })
if (empty.length) {
  console.log(`⚠ เจอใบที่ไม่มีม้วนผูกเลย ${empty.length} ใบ — ข้าม ไม่แตะ (ถ้าจะลบใช้ delete-ghost-docs.mjs)`)
  empty.forEach(d => console.log(`   ${d.doc_no} · หัวใบ ${d.total_rolls}`))
  console.log()
}
console.log(`ใบที่ยอดไม่ตรง = ${todo.length} ใบ\n`)
for (const t of todo) {
  console.log(`${t.doc.doc_no.padEnd(12)} | ${th(t.doc.transferred_at)} | ${t.doc.transferred_by}`)
  console.log(`   จำนวน : ${String(t.doc.total_rolls).padStart(5)} → ${String(t.newRolls).padStart(5)}  (ขาด ${t.doc.total_rolls - t.newRolls})`)
  console.log(`   น้ำหนัก: ${fmt(t.doc.total_kg).padStart(12)} → ${fmt(t.newKg).padStart(12)} kg`)
}
if (!todo.length) { console.log('ไม่มีอะไรต้องแก้'); process.exit(0) }

// ── 3) backup ค่าเดิม ────────────────────────────────────────────────────
const pad = x => String(x).padStart(2, '0')
const n0 = new Date()
const dir = `${BASE}/doc-totals_${n0.getFullYear()}-${pad(n0.getMonth()+1)}-${pad(n0.getDate())}_${pad(n0.getHours())}${pad(n0.getMinutes())}`
mkdirSync(dir, { recursive: true })
writeFileSync(`${dir}/before.json`, JSON.stringify(todo.map(t => ({
  id: t.doc.id, doc_no: t.doc.doc_no, total_rolls: t.doc.total_rolls, total_kg: t.doc.total_kg,
})), null, 1), 'utf8')
console.log(`\n📁 backup ค่าเดิม → ${dir}/before.json (${todo.length} ใบ)`)

if (!APPLY) {
  console.log('\n👉 dry-run — ยังไม่แก้ · แก้จริง:  node scripts/fix-doc-totals.mjs apply')
  process.exit(0)
}

// ── 4) แก้ทีละใบ ─────────────────────────────────────────────────────────
console.log('\n✍️  แก้ยอด...')
let ok = 0, fail = 0
for (const t of todo) {
  const { data, error } = await sb.from('transfer_documents')
    .update({ total_rolls: t.newRolls, total_kg: t.newKg })
    .eq('id', t.doc.id).select('id')
  if (error)            { fail++; console.log(`  ⚠ ${t.doc.doc_no}: ${error.message}`) }
  else if (!data.length){ fail++; console.log(`  ⚠ ${t.doc.doc_no}: ไม่มีแถวถูกแก้ (ใบหายไปแล้ว?)`) }
  else                  { ok++;   console.log(`  ✓ ${t.doc.doc_no} → ${t.newRolls} · ${fmt(t.newKg)} kg`) }
}

// ── 5) ตรวจซ้ำ ───────────────────────────────────────────────────────────
const rollsAfter = await cnt('production_rolls')
const docsAfter  = await cnt('transfer_documents')
console.log(`\nแก้สำเร็จ ${ok} · ล้มเหลว ${fail}`)
console.log(`ม้วน/ถุง: ${rollsBefore} → ${rollsAfter} (${rollsAfter === rollsBefore ? '✅ ไม่เปลี่ยน' : '⛔ เปลี่ยนไป ' + (rollsAfter - rollsBefore) + ' แถว — ผิดปกติ!'})`)
console.log(`ใบโอน  : ${docsBefore} → ${docsAfter} (${docsAfter === docsBefore ? '✅ ไม่เปลี่ยน' : '⛔ เปลี่ยนไป — ผิดปกติ!'})`)
console.log(`\nย้อนกลับ:  node scripts/restore-doc-totals.mjs "${dir}"`)
