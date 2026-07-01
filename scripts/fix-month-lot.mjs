// ───────────────────────────────────────────────────────────────────────────
//  แก้ปัญหา "ข้ามเดือน" — ม้วนที่ชั่งหลังเที่ยงคืน 1/7 (ไทย) แต่ lot ยังเป็น 06
//  → เปลี่ยน lot 06→07 + รีเซ็ตเลขม้วน #1 ต่อ "งาน" (เครื่อง+WO+lot+ชนิด)
//
//  ปลอดภัย:  รันเปล่าๆ = backup + ไฟล์เทียบ + เช็คชนกัน (ไม่เขียน DB)
//            รันด้วย 'apply' = ลงมือแก้จริง (ต้อง backup ผ่านก่อน)
//    node scripts/fix-month-lot.mjs           ← ดูแผน (dry run)
//    node scripts/fix-month-lot.mjs apply     ← แก้จริง
//  ย้อนกลับ:  node scripts/revert-month-lot.mjs <ไฟล์ backup>
// ───────────────────────────────────────────────────────────────────────────
import { createClient } from '@supabase/supabase-js'
import { writeFileSync, mkdirSync } from 'node:fs'

const url = 'https://belwjdajuaxbhaqtlhrj.supabase.co'
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJlbHdqZGFqdWF4YmhhcXRsaHJqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3NzgzNzYsImV4cCI6MjA5NDM1NDM3Nn0.aM-DKa8v0OlQQW6MsDzmCrEFY0d8rEVgzuemZ8UKZJA'
const sb = createClient(url, key)

const APPLY = (process.argv[2] || '').toLowerCase() === 'apply'
const SINCE = '2026-06-30T17:00:00'   // = เที่ยงคืนไทย 1/7 (UTC+7)
const BASE  = 'D:/back upเครื่องชั่ง supabase'

async function fetchAll(q) {
  const PAGE = 1000, all = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await q.range(from, from + PAGE - 1)
    if (error) throw error
    all.push(...(data ?? []))
    if (!data || data.length < PAGE) break
  }
  return all
}

// 1) ดึงม้วนที่ต้องแก้: ชั่งหลังเที่ยงคืน 1/7 + lot ลงท้าย 06
const rows = await fetchAll(
  sb.from('production_rolls').select('*').gte('created_at', SINCE).like('lot_no', '%06')
)
console.log(`พบม้วนที่เข้าเงื่อนไข (ชั่ง≥1/7 ไทย & lot ...06) = ${rows.length} แถว`)

// 2) จัดกลุ่มต่อ "งาน" + คิดเลขใหม่
const groups = {}
for (const r of rows) {
  const k = [r.machine_no, r.work_order, r.lot_no, r.roll_type].join('|')
  ;(groups[k] ??= []).push(r)
}
const plan = []   // { id, machine, wo, type, oldRoll, newRoll, oldLot, newLot, weight, created_at }
for (const k of Object.keys(groups)) {
  const g = groups[k].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
  const [machine, wo, lot, type] = k.split('|')
  const newLot = lot.slice(0, -2) + '07'
  const isScrap = (type || '').startsWith('scrap')
  let n = 0
  for (const r of g) {
    n++
    plan.push({
      id: r.id, machine, wo, type,
      oldRoll: r.roll_no, newRoll: isScrap ? r.roll_no : n,   // เศษไม่เปลี่ยนเลข (roll 0)
      oldLot: lot, newLot,
      weight: r.weight, item_code: r.item_code, created_at: r.created_at,
    })
  }
}

// 3) เช็คชนกัน: เลขใหม่ (newLot, wo, item, roll, type) ต้องไม่ไปทับม้วนอื่นที่ไม่ได้อยู่ในชุดนี้
const affectedIds = new Set(rows.map(r => r.id))
const newLots = [...new Set(plan.map(p => p.newLot))]
const existing = await fetchAll(
  sb.from('production_rolls').select('id,lot_no,work_order,item_code,roll_no,roll_type,transferred').in('lot_no', newLots)
)
const collisions = []
for (const p of plan) {
  if ((p.type || '').startsWith('scrap')) continue
  const hit = existing.find(e =>
    !affectedIds.has(e.id) &&
    e.lot_no === p.newLot && (e.work_order ?? '') === (p.wo ?? '') &&
    (e.item_code ?? '') === (p.item_code ?? '') &&
    Number(e.roll_no) === Number(p.newRoll) && e.roll_type === p.type)
  if (hit) collisions.push({ ...p, hitId: hit.id })
}

// 4) เขียน backup + ไฟล์เทียบ
const pad = x => String(x).padStart(2, '0')
const now = new Date()
const stamp = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`
const dir = `${BASE}/lot-fix_${stamp}`
mkdirSync(dir, { recursive: true })
writeFileSync(`${dir}/backup_rows.json`, JSON.stringify(rows, null, 0), 'utf8')

const head = ['เครื่อง','WO','ชนิด','เลขเดิม','เลขใหม่','น้ำหนัก','lot เดิม','lot ใหม่','id']
const csv = [head.join(',')].concat(plan
  .sort((a,b)=> a.machine.localeCompare(b.machine) || String(a.type).localeCompare(String(b.type)) || a.newRoll-b.newRoll)
  .map(p => [p.machine, p.wo, p.type, p.oldRoll, p.newRoll, p.weight, p.oldLot, p.newLot, p.id]
    .map(x => `"${String(x ?? '').replace(/"/g,'""')}"`).join(',')))
writeFileSync(`${dir}/เทียบเลขม้วน.csv`, '﻿' + csv.join('\r\n'), 'utf8')

console.log(`\n📁 backup + ไฟล์เทียบ → ${dir}`)
console.log(`   backup_rows.json (ของเดิมครบทุกคอลัมน์ ${rows.length} แถว)`)
console.log(`   เทียบเลขม้วน.csv (${plan.length} แถว)`)

// สรุปต่อเครื่อง
const byMachine = {}
for (const p of plan) (byMachine[p.machine] ??= { good:0, bad:0, scrap:0 })[p.type?.startsWith('scrap')?'scrap':p.type] ++
console.log('\nสรุปต่อเครื่อง (จำนวนที่จะแก้):')
for (const m of Object.keys(byMachine).sort())
  console.log(`  ${m}: ดี ${byMachine[m].good||0} · กรอ ${byMachine[m].bad||0} · เศษ ${byMachine[m].scrap||0}`)

if (collisions.length) {
  console.log(`\n⛔ พบเลขชนกัน ${collisions.length} รายการ — หยุด ไม่แก้ (ดูด้านล่าง)`)
  for (const c of collisions.slice(0,20)) console.log(`   ${c.machine} WO${c.wo} ${c.type} #${c.newRoll} lot ${c.newLot} ชนกับ id ${c.hitId}`)
  process.exit(1)
}
console.log('\n✅ ไม่มีเลขชนกัน — ปลอดภัยที่จะแก้')

// 5) ลงมือแก้ (เฉพาะ apply)
if (!APPLY) {
  console.log('\n👉 นี่คือ dry-run (ยังไม่แก้ DB) · ตรวจไฟล์เทียบก่อน แล้วรัน:  node scripts/fix-month-lot.mjs apply')
  process.exit(0)
}
console.log('\n✍️  กำลังแก้ DB...')
let ok = 0, fail = 0
for (const p of plan) {
  const patch = { lot_no: p.newLot }
  if (!(p.type || '').startsWith('scrap')) patch.roll_no = p.newRoll
  const { error } = await sb.from('production_rolls').update(patch).eq('id', p.id)
  if (error) { fail++; console.warn(`  ⚠ ${p.id}: ${error.message}`) } else ok++
}
console.log(`\n✅ แก้เสร็จ: สำเร็จ ${ok} · ล้มเหลว ${fail}`)
console.log(`   ย้อนกลับได้ด้วย:  node scripts/revert-month-lot.mjs "${dir}/backup_rows.json"`)
