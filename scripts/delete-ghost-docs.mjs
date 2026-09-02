// ───────────────────────────────────────────────────────────────────────────
//  ลบ "ใบผี" — หัวใบใน transfer_documents ที่ไม่มีม้วนผูกอยู่เลย (0 ม้วน)
//    เกิดจากบั๊กเก่า: insert หัวใบสำเร็จ แต่ .update() แสตมป์ม้วนล้ม (URL ยาวเกิน)
//    แล้วไม่มีใครลบหัวใบทิ้ง → ค้างในประวัติ ทำให้รายงานที่บวก total_kg เพี้ยน
//    (โค้ดหน้าโอนปิดทางนี้แล้วตั้งแต่ commit 4040a86 — สคริปต์นี้ไว้เก็บกวาดของเก่า)
//
//    node scripts/delete-ghost-docs.mjs          ← dry-run (ไม่แก้อะไร + เขียน backup)
//    node scripts/delete-ghost-docs.mjs apply    ← ลบจริง
//    ย้อนกลับ:  node scripts/restore-ghost-docs.mjs "<โฟลเดอร์ backup>"
//
//  กฎความปลอดภัย (ห้ามถอดออก)
//    - ลบเฉพาะใบที่ระบุชื่อไว้ใน TARGETS เท่านั้น ไม่มีการลบแบบกวาด
//    - ก่อนลบทุกใบ ต้องนับม้วนที่ผูกอยู่ "สด ๆ" อีกครั้ง ถ้าไม่ใช่ 0 → ข้าม ไม่ลบ
//    - backup ทั้งแถวลง JSON ก่อนเสมอ (แม้ dry-run)
//    - นับ transfer_documents / production_rolls ก่อน-หลัง ต้องลดเฉพาะจำนวนใบที่ตั้งใจลบ
//      และจำนวนม้วนต้องไม่เปลี่ยนแม้แต่แถวเดียว
// ───────────────────────────────────────────────────────────────────────────
import { createClient } from '@supabase/supabase-js'
import { writeFileSync, mkdirSync } from 'node:fs'

const url = 'https://belwjdajuaxbhaqtlhrj.supabase.co'
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJlbHdqZGFqdWF4YmhhcXRsaHJqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3NzgzNzYsImV4cCI6MjA5NDM1NDM3Nn0.aM-DKa8v0OlQQW6MsDzmCrEFY0d8rEVgzuemZ8UKZJA'
const sb = createClient(url, key)

const APPLY = (process.argv[2] || '').toLowerCase() === 'apply'
const BASE  = 'D:/back upเครื่องชั่ง supabase'

// ใบที่จะลบ — ระบุชื่อชัดเจน ห้ามใส่เงื่อนไขกวาดเด็ดขาด
const TARGETS = ['690825-14', '690826-2', '690826-3', 'TR-71573622']

const th = (d) => d ? new Date(d).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }) : '—'
const cnt = async (tbl, mod = (q) => q) =>
  (await mod(sb.from(tbl).select('id', { count: 'exact', head: true }))).count

// ── 1) ยอดตั้งต้น ────────────────────────────────────────────────────────
const docsBefore  = await cnt('transfer_documents')
const rollsBefore = await cnt('production_rolls')
console.log(`ยอดตั้งต้น: ใบโอน ${docsBefore} ใบ · ม้วน/ถุง ${rollsBefore} แถว\n`)

// ── 2) ดึงใบเป้าหมาย + นับม้วนที่ผูกอยู่จริง ─────────────────────────────
const rows = []
for (const docNo of TARGETS) {
  const { data, error } = await sb.from('transfer_documents').select('*').eq('doc_no', docNo)
  if (error) throw error
  if (!data?.length) { console.log(`⚠ ${docNo}: ไม่พบใบนี้แล้ว (ถูกลบไปก่อนหน้า?) — ข้าม`); continue }
  if (data.length > 1) { console.log(`⛔ ${docNo}: เจอ ${data.length} ใบชื่อซ้ำ — ข้าม ไม่เสี่ยงลบผิดใบ`); continue }
  const d = data[0]
  const linked = await cnt('production_rolls', q => q.eq('transfer_doc_id', d.id))
  rows.push({ doc: d, linked })
  const mark = linked === 0 ? '👻 ใบผี — ลบได้' : `⛔ มีม้วนผูกอยู่ ${linked} แถว — จะไม่ลบ`
  console.log(`${docNo.padEnd(12)} | ${th(d.transferred_at)} | ${String(d.transfer_type).padEnd(5)}`
    + ` | หัวใบอ้าง ${String(d.total_rolls).padStart(5)} ถุง/ม้วน ${String(d.total_kg).padStart(10)} kg`
    + ` | ผูกจริง ${String(linked).padStart(4)} | ${d.transferred_by}\n   → ${mark}`)
}

const deletable = rows.filter(r => r.linked === 0)
const blocked   = rows.filter(r => r.linked !== 0)
console.log(`\nสรุป: ลบได้ ${deletable.length} ใบ · ติดเงื่อนไขไม่ลบ ${blocked.length} ใบ`)
if (!deletable.length) { console.log('ไม่มีอะไรต้องลบ'); process.exit(0) }

// ── 3) backup ก่อนเสมอ (แม้ dry-run) ─────────────────────────────────────
const pad = x => String(x).padStart(2, '0')
const n = new Date()
const stamp = `${n.getFullYear()}-${pad(n.getMonth()+1)}-${pad(n.getDate())}_${pad(n.getHours())}${pad(n.getMinutes())}`
const dir = `${BASE}/ghost-docs_${stamp}`
mkdirSync(dir, { recursive: true })
writeFileSync(`${dir}/docs.json`, JSON.stringify(deletable.map(r => r.doc), null, 1), 'utf8')
console.log(`\n📁 backup → ${dir}/docs.json (${deletable.length} ใบ ทั้งแถว)`)

if (!APPLY) {
  console.log('\n👉 dry-run — ยังไม่ลบอะไร · ลบจริง:  node scripts/delete-ghost-docs.mjs apply')
  process.exit(0)
}

// ── 4) ลบทีละใบ — นับม้วนสดอีกรอบก่อนลบทุกครั้ง ─────────────────────────
console.log('\n✍️  ลบ...')
let ok = 0, skip = 0, fail = 0
for (const { doc } of deletable) {
  const recheck = await cnt('production_rolls', q => q.eq('transfer_doc_id', doc.id))
  if (recheck !== 0) { skip++; console.log(`  ⏭ ${doc.doc_no}: เพิ่งมีม้วนผูกเข้ามา ${recheck} แถว — ข้าม ไม่ลบ`); continue }
  const { error } = await sb.from('transfer_documents').delete().eq('id', doc.id)
  if (error) { fail++; console.log(`  ⚠ ${doc.doc_no}: ${error.message}`) }
  else { ok++; console.log(`  ✓ ${doc.doc_no} ลบแล้ว`) }
}

// ── 5) ตรวจยอดหลังลบ — ม้วนต้องไม่หายแม้แต่แถวเดียว ─────────────────────
const docsAfter  = await cnt('transfer_documents')
const rollsAfter = await cnt('production_rolls')
console.log(`\nลบสำเร็จ ${ok} · ข้าม ${skip} · ล้มเหลว ${fail}`)
console.log(`ใบโอน: ${docsBefore} → ${docsAfter} (ลดลง ${docsBefore - docsAfter} · ต้องเท่ากับ ${ok})`)
console.log(`ม้วน/ถุง: ${rollsBefore} → ${rollsAfter} (${rollsAfter === rollsBefore ? '✅ ไม่เปลี่ยน' : '⛔ เปลี่ยนไป ' + (rollsAfter - rollsBefore) + ' แถว — ผิดปกติ!'})`)
console.log(`\nย้อนกลับ:  node scripts/restore-ghost-docs.mjs "${dir}"`)
