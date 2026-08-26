import { supabase } from './supabase'

// ────────────────────────────────────────────────────────────────────────────
// คืนม้วนต้นทางเมื่อ "ลบม้วนกรอ (output)"
// ────────────────────────────────────────────────────────────────────────────
// เดิม: ทุกจุดที่ลบม้วนกรอจะตั้งม้วนต้นทาง rework_status='reworking' เสมอ
//   แต่คิว "รับจากผลิต" (ReworkInbox) โชว์เฉพาะม้วนที่ rework_status = null/pending
//   → ถ้างานกรอของม้วนนั้น "ปิดไปแล้ว/ถูกลบ" ม้วนจะค้างสถานะ 'reworking' แบบไม่มีงานรองรับ
//     มองไม่เห็นในคิว เลือกกรอใหม่ไม่ได้ (บั๊ก "โยนคืนแล้วไม่มีให้เลือก")
//
// แก้: คืนม้วนต้นทางให้ถูกที่ตามสถานการณ์จริง
//   • ยังมีงานกรอ (rework_jobs) ที่ยัง active อ้างม้วนนี้อยู่ → คืนเป็น 'reworking'
//     (กรอต่อในงานเดิมได้ตามปกติ)
//   • ไม่มีงาน active แล้ว (งานปิด/ถูกลบ) → คืนเป็น null = เด้งกลับเข้าคิว "รับจากผลิต"
//     ให้เลือกกรอใหม่ได้ (ตรงกับสิ่งที่ปุ่ม/ป้ายบอกว่า "คืนม้วนต้นทางกลับคิว")
//   • เช็คไม่ได้ (network/RLS) → default = คืนเข้าคิว (null) ปลอดภัยกว่า อย่างน้อยเลือกได้
export async function restoreReworkSource(
  sourceRollId: string,
  note: string,
): Promise<'reworking' | 'queue'> {
  let hasActiveJob = false
  try {
    // (ก) งานกรอที่อ้างม้วนนี้ตรง ๆ ผ่าน source_roll_id (flow "รับเดี่ยว"/ReceiveModal ไม่ได้ลง withdrawals)
    const { data: direct } = await supabase.from('rework_jobs')
      .select('id').eq('status', 'active').eq('source_roll_id', sourceRollId).limit(1)
    hasActiveJob = !!(direct && direct.length)
    // (ข) งานกรอที่อ้างม้วนนี้ผ่าน rework_withdrawals (flow "เบิกหลายม้วน")
    if (!hasActiveJob) {
      const { data: wds } = await supabase.from('rework_withdrawals')
        .select('job_id').eq('source_roll_id', sourceRollId)
      const jobIds = [...new Set((wds ?? []).map((w: any) => w.job_id).filter(Boolean))] as string[]
      if (jobIds.length) {
        const { data: aj } = await supabase.from('rework_jobs')
          .select('id').eq('status', 'active').in('id', jobIds).limit(1)
        hasActiveJob = !!(aj && aj.length)
      }
    }
  } catch {
    hasActiveJob = false   // เช็คไม่ได้ → คืนเข้าคิว (เลือกได้ไว้ก่อน)
  }

  const patch: Record<string, any> = { rework_status: hasActiveJob ? 'reworking' : null, rework_remark: note }
  if (!hasActiveJob) {
    // กลับเข้าคิวเหมือนม้วนใหม่ — ล้างร่องรอยการรับเข้ากรอ (ให้ตรงกับ flow "โยนคืนกลับคิว")
    patch.rework_received_by = null
    patch.rework_received_at = null
    patch.new_system = false
  }
  await supabase.from('production_rolls').update(patch).eq('id', sourceRollId)
  return hasActiveJob ? 'reworking' : 'queue'
}

// ────────────────────────────────────────────────────────────────────────────
// จัดการม้วนต้นทาง "ของงานกรอนี้" ตอน โยนคืน/ยกเลิกงาน/ปิดงาน
// ────────────────────────────────────────────────────────────────────────────
// เดิม: returnJobCore/confirmCloseJob คืนม้วนโดยอิง source_lot_no (Lot เดียว) หรือ item_code
//   • source_lot_no เก็บได้ Lot เดียว แต่ 1 งานอาจ "เบิกม้วนข้าม Lot" มารวมกัน
//     → ม้วน Lot อื่นไม่ถูกคืน ค้างสถานะ reworking มองไม่เห็นในคิว (บั๊ก "ไม่มีให้เลือก")
//   • item_code กว้างเกินไป → ไปแตะม้วนของงานอื่นที่ item เดียวกัน (หลุดจากงานที่ยังทำอยู่)
// แก้: อ้าง "ม้วนต้นทางของงานนี้จริง ๆ" จากรายการเบิก (rework_withdrawals) + source_roll_id ของงาน
//   • ม้วนที่กรอไปแล้ว (มี output อ้างเป็น source) → 'reworked'
//   • ม้วนที่ยังไม่ได้กรอ → คืนเข้าคิว "รับจากผลิต" (null) ให้เลือกกรอใหม่ได้
//   แตะเฉพาะม้วนที่ยัง 'reworking' อยู่เท่านั้น (idempotent · ไม่ทับสถานะที่ผู้ใช้จัดการไปแล้ว)
export async function resolveJobSources(
  job: { id?: string | null; source_roll_id?: string | null },
): Promise<{ reworked: number; queued: number }> {
  const ids = new Set<string>()
  if (job?.id) {
    const { data: wds } = await supabase.from('rework_withdrawals')
      .select('source_roll_id').eq('job_id', job.id)
    for (const w of wds ?? []) if ((w as any).source_roll_id) ids.add((w as any).source_roll_id)
  }
  if (job?.source_roll_id) ids.add(job.source_roll_id)   // เผื่องานเดิมที่ไม่มี withdrawal
  const list = [...ids]
  if (!list.length) return { reworked: 0, queued: 0 }

  // ม้วนไหนถูกกรอไปแล้ว (มี output อ้างเป็น rework_source_roll_id)
  const { data: outs } = await supabase.from('production_rolls')
    .select('rework_source_roll_id').in('rework_source_roll_id', list)
  const wound = new Set((outs ?? []).map((o: any) => o.rework_source_roll_id).filter(Boolean))
  const toReworked = list.filter(id => wound.has(id))
  const toQueue    = list.filter(id => !wound.has(id))

  if (toReworked.length) {
    await supabase.from('production_rolls')
      .update({ rework_status: 'reworked' })
      .in('id', toReworked).eq('rework_status', 'reworking')
  }
  if (toQueue.length) {
    await supabase.from('production_rolls')
      .update({ rework_status: null, rework_received_by: null, rework_received_at: null, rework_remark: null, new_system: false })
      .in('id', toQueue).eq('rework_status', 'reworking')
  }
  return { reworked: toReworked.length, queued: toQueue.length }
}
