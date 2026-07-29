// v2.18.2 — backfill label_size + cust_address ให้ม้วนของ "งานที่ยังเดินอยู่"
// (ดึงจาก machine_profiles ปัจจุบัน — งานที่ปิดไปแล้ว profile ถูกเคลียร์ กู้ไม่ได้)
// รันครั้งเดียวหลังเพิ่มคอลัมน์ (add-cols-label-address.sql): node scripts/backfill-label-address.mjs
import { createClient } from '@supabase/supabase-js'

const url='https://belwjdajuaxbhaqtlhrj.supabase.co'
const key='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJlbHdqZGFqdWF4YmhhcXRsaHJqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3NzgzNzYsImV4cCI6MjA5NDM1NDM3Nn0.aM-DKa8v0OlQQW6MsDzmCrEFY0d8rEVgzuemZ8UKZJA'
const sb=createClient(url,key)

const { data: profs, error: pe } = await sb.from('machine_profiles')
  .select('machine_no, lot_no, work_order, label_size, cust_address')
if (pe) { console.error('อ่าน machine_profiles ไม่ได้:', pe.message); process.exit(1) }

let total = 0
for (const p of profs ?? []) {
  if (!p.machine_no || !p.lot_no) continue
  const patch = {}
  if (p.label_size)   patch.label_size   = p.label_size
  if (p.cust_address) patch.cust_address = p.cust_address
  if (Object.keys(patch).length === 0) continue

  // เฉพาะม้วนของ WO ปัจจุบัน + ที่ยังว่างอยู่ (กันทับของเดิม)
  let q = sb.from('production_rolls').update(patch)
    .eq('machine_no', p.machine_no).eq('lot_no', p.lot_no)
  if (p.work_order) q = q.eq('work_order', p.work_order)
  if (patch.label_size)   q = q.is('label_size', null)
  const { data, error } = await q.select('id')
  if (error) { console.error(`  ${p.machine_no}/${p.lot_no}:`, error.message); continue }
  const n = data?.length ?? 0
  total += n
  console.log(`✓ ${p.machine_no} · Lot ${p.lot_no} · WO ${p.work_order||'—'} → ${n} ม้วน`, patch)
}
console.log(`\nเสร็จ — อัปเดตรวม ${total} ม้วน`)
