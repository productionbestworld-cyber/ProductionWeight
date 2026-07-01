// ───────────────────────────────────────────────────────────────────────────
//  หยุด/เปิด การชั่งทั้งระบบ  (ตั้งค่า weigh_locked ใน app_settings)
//    node scripts/weigh-lock.mjs stop     → หยุดชั่งทุกเครื่อง (บล็อกปุ่มบันทึก + ขึ้นจอแดง)
//    node scripts/weigh-lock.mjs go        → เปิดให้ชั่งตามปกติ
//    node scripts/weigh-lock.mjs status    → ดูสถานะปัจจุบัน
//
//  ทุกเครื่องเช็คแฟล็กนี้ทุก ~20 วิ → สั่งแล้วมีผลภายในไม่เกิน 20 วินาที
//  (เครื่องต้องใช้เวอร์ชันที่รองรับ weigh_locked = v2.4.0 ขึ้นไป)
// ───────────────────────────────────────────────────────────────────────────
import { createClient } from '@supabase/supabase-js'

const url = 'https://belwjdajuaxbhaqtlhrj.supabase.co'
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJlbHdqZGFqdWF4YmhhcXRsaHJqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3NzgzNzYsImV4cCI6MjA5NDM1NDM3Nn0.aM-DKa8v0OlQQW6MsDzmCrEFY0d8rEVgzuemZ8UKZJA'
const sb = createClient(url, key)

const cmd = (process.argv[2] || 'status').toLowerCase()

async function getStatus() {
  const { data } = await sb.from('app_settings').select('value').eq('key', 'weigh_locked').maybeSingle()
  return data?.value === '1'
}
async function setLock(on) {
  const { error } = await sb.from('app_settings')
    .upsert({ key: 'weigh_locked', value: on ? '1' : '0', updated_at: new Date().toISOString() }, { onConflict: 'key' })
  if (error) throw error
}

const locked = await getStatus()

if (cmd === 'status') {
  console.log(locked ? '🔒 ตอนนี้ "หยุดชั่ง" อยู่ (locked)' : '✅ ตอนนี้ชั่งได้ปกติ (unlocked)')
} else if (cmd === 'stop' || cmd === 'lock') {
  await setLock(true)
  console.log('⛔ สั่งหยุดชั่งทั้งระบบแล้ว — ทุกเครื่องจะขึ้นจอแดง/บล็อกปุ่มบันทึกภายใน ~20 วินาที')
  console.log('   ปลดล็อกด้วย:  node scripts/weigh-lock.mjs go')
} else if (cmd === 'go' || cmd === 'unlock' || cmd === 'resume') {
  await setLock(false)
  console.log('✅ เปิดให้ชั่งตามปกติแล้ว — ทุกเครื่องกลับมาชั่งได้ภายใน ~20 วินาที')
} else {
  console.log('ใช้:  node scripts/weigh-lock.mjs [stop|go|status]')
}
