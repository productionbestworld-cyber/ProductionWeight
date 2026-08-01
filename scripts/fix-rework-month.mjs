// ───────────────────────────────────────────────────────────────────────────
//  แก้ "เดือน" ของ Lot กรอ (rewind) ให้ตรงกับ "เดือนที่กรอจริง"
//  ปัญหา: ม้วนกรอที่ชั่งเดือนใหม่ (ส.ค.) แต่กรอจากม้วนต้นทางเดือนเก่า (ก.ค.)
//         → Lot กรอสืบทอดเดือนต้นทาง (…07) แทนที่จะเป็นเดือนที่กรอจริง (…08)
//  วิธีแก้: เฉพาะ section='rewind' ที่ created_at อยู่ในเดือนไทยใหม่ แต่ lot ยังลงท้ายเดือนเก่า
//          → เปลี่ยนท้าย lot เป็น "เดือนไทยของ created_at" (ทั้ง production_rolls + rework_jobs)
//  traceback ปลอดภัย: production_rolls.rework_source_lot เก็บ lot ต้นทางจริงไว้แล้ว (ไม่แตะ)
//
//    node scripts/fix-rework-month.mjs           ← ดูแผน (dry run, ไม่เขียน DB)
//    node scripts/fix-rework-month.mjs apply     ← แก้จริง (backup อัตโนมัติก่อน)
// ───────────────────────────────────────────────────────────────────────────
import { createClient } from '@supabase/supabase-js'
import { writeFileSync, mkdirSync } from 'node:fs'

const url = 'https://belwjdajuaxbhaqtlhrj.supabase.co'
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJlbHdqZGFqdWF4YmhhcXRsaHJqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3NzgzNzYsImV4cCI6MjA5NDM1NDM3Nn0.aM-DKa8v0OlQQW6MsDzmCrEFY0d8rEVgzuemZ8UKZJA'
const sb = createClient(url, key)

const APPLY = (process.argv[2] || '').toLowerCase() === 'apply'
// ขอบเขต: ม้วน/งานกรอ ที่ "ชั่ง/เปิดหลังเที่ยงคืนไทย 1/8" เป็นต้นไป (17:00Z 31/7 = 00:00 ICT 1/8)
const SINCE = '2026-07-31T17:00:00'
const BASE  = 'D:/back upเครื่องชั่ง supabase'

// เดือน 2 หลักตามเวลาไทยของ timestamp ที่ส่งมา
const thaiMM = (iso) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', month: '2-digit' })
  .formatToParts(new Date(iso)).find(x => x.type === 'month').value

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

// lot ที่ตรง pattern auto: yy + machine + running(4) + mm → คืน [prefix(ก่อนเดือน), oldMM]  ·  ไม่ตรง → null
function splitLot(lot) {
  const m = String(lot ?? '').match(/^(\d{2}[A-Za-z0-9]+\d{4})(\d{2})$/)
  return m ? { prefix: m[1], mm: m[2] } : null
}

// ── 1) ม้วนกรอ (rewind) ที่ชั่งเดือนไทยใหม่ แต่ lot ยังเป็นเดือนเก่า ──
const rows = await fetchAll(
  sb.from('production_rolls').select('*').eq('section', 'rewind').gte('created_at', SINCE)
)
const rollPlan = []
for (const r of rows) {
  const sp = splitLot(r.lot_no)
  if (!sp) continue                          // lot กรอกเอง (ไม่ตรง pattern) → ไม่แตะ
  const realMM = thaiMM(r.created_at)        // เดือนที่ชั่งจริง (เวลาไทย)
  if (sp.mm === realMM) continue             // ตรงอยู่แล้ว → ข้าม
  rollPlan.push({ id: r.id, oldLot: r.lot_no, newLot: sp.prefix + realMM, roll_no: r.roll_no,
    roll_type: r.roll_type, item_code: r.item_code, weight: r.weight, machine_no: r.machine_no, created_at: r.created_at })
}

// ── 2) งานกรอ (rework_jobs) ที่เปิดเดือนไทยใหม่ แต่ lot ยังเป็นเดือนเก่า ──
const jobs = await fetchAll(
  sb.from('rework_jobs').select('*').gte('created_at', SINCE)
)
const jobPlan = []
for (const j of jobs) {
  const sp = splitLot(j.lot_no)
  if (!sp) continue
  const realMM = thaiMM(j.created_at)
  if (sp.mm === realMM) continue
  jobPlan.push({ id: j.id, oldLot: j.lot_no, newLot: sp.prefix + realMM, work_order: j.work_order,
    status: j.status, product_name: j.product_name, created_at: j.created_at })
}

console.log(`พบม้วนกรอที่ต้องแก้เดือน = ${rollPlan.length} แถว · งานกรอ = ${jobPlan.length} แถว`)
if (!rollPlan.length && !jobPlan.length) { console.log('✅ ไม่มีอะไรต้องแก้'); process.exit(0) }

for (const p of rollPlan) console.log(`  ROLL ${p.oldLot} #${p.roll_no} ${p.roll_type} (${p.item_code}) ${p.weight}kg → ${p.newLot}`)
for (const p of jobPlan) console.log(`  JOB  ${p.oldLot} wo=${p.work_order} [${p.status}] → ${p.newLot}`)

// ── 3) เช็คชนกัน: (newLot, item_code, roll_no, roll_type) ต้องไม่ทับม้วนอื่นที่ไม่ได้อยู่ในชุดนี้ ──
const affected = new Set(rollPlan.map(p => p.id))
const newLots = [...new Set(rollPlan.map(p => p.newLot))]
const existing = newLots.length ? await fetchAll(
  sb.from('production_rolls').select('id,lot_no,item_code,roll_no,roll_type').in('lot_no', newLots)
) : []
const collisions = []
for (const p of rollPlan) {
  if ((p.roll_type || '').startsWith('scrap')) continue   // เศษ roll_no=0 ซ้ำได้ปกติ
  const hit = existing.find(e => !affected.has(e.id) &&
    e.lot_no === p.newLot && (e.item_code ?? '') === (p.item_code ?? '') &&
    Number(e.roll_no) === Number(p.roll_no) && e.roll_type === p.roll_type)
  if (hit) collisions.push({ ...p, hitId: hit.id })
}

// ── 4) backup ──
const pad = x => String(x).padStart(2, '0')
const now = new Date()
const stamp = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`
let dir = `${BASE}/rework-month-fix_${stamp}`
try { mkdirSync(dir, { recursive: true }) }
catch { dir = `./backup_rework-month_${stamp}`; mkdirSync(dir, { recursive: true }) }
writeFileSync(`${dir}/backup_rolls.json`, JSON.stringify(rows.filter(r => affected.has(r.id)), null, 0), 'utf8')
writeFileSync(`${dir}/backup_jobs.json`, JSON.stringify(jobs.filter(j => jobPlan.some(p => p.id === j.id)), null, 0), 'utf8')
console.log(`\n📁 backup → ${dir}`)

if (collisions.length) {
  console.log(`\n⛔ พบเลขชนกัน ${collisions.length} รายการ — หยุด ไม่แก้:`)
  for (const c of collisions) console.log(`   ${c.newLot} #${c.roll_no} ${c.roll_type} (${c.item_code}) ชนกับ id ${c.hitId}`)
  process.exit(1)
}
console.log('✅ ไม่มีเลขชนกัน — ปลอดภัยที่จะแก้')

if (!APPLY) {
  console.log('\n👉 นี่คือ dry-run (ยังไม่แก้ DB) · ตรวจแผนด้านบนแล้วรัน:  node scripts/fix-rework-month.mjs apply')
  process.exit(0)
}

// ── 5) แก้จริง ──
console.log('\n✍️  กำลังแก้ DB...')
let ok = 0, fail = 0
for (const p of rollPlan) {
  const { error } = await sb.from('production_rolls').update({ lot_no: p.newLot }).eq('id', p.id)
  if (error) { fail++; console.warn(`  ⚠ roll ${p.id}: ${error.message}`) } else ok++
}
for (const p of jobPlan) {
  const { error } = await sb.from('rework_jobs').update({ lot_no: p.newLot }).eq('id', p.id)
  if (error) { fail++; console.warn(`  ⚠ job ${p.id}: ${error.message}`) } else ok++
}
console.log(`\n✅ แก้เสร็จ: สำเร็จ ${ok} · ล้มเหลว ${fail}`)
console.log(`   backup อยู่ที่: ${dir}`)
