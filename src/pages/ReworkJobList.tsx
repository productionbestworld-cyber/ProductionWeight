import { useEffect, useState } from 'react'
import { Plus, Trash2, RefreshCw, Search, X } from 'lucide-react'
import { supabase, fetchAll } from '../lib/supabase'
import { fetchProducts, backfillProductMatCore, type Product } from './Products'
import ExportButton from '../components/ExportButton'
import { fmtSize, type MachineProfile } from './MachineSettings'
import ReworkInbox from './ReworkInbox'

export type ReworkJob = {
  id: string
  lot_no: string
  sale_order?: string
  work_order?: string
  delivery_date?: string | null
  item_code?: string
  mat_code?: string
  product_code?: string
  product_name?: string
  width_cm?: string
  width_unit?: 'cm' | 'mm'
  thick_mc?: string
  cust_code?: string
  cust_name?: string
  cust_branch?: string
  core_weight?: string
  decimal_places?: number
  planned_qty?: string
  inspector?: string
  label_size?: 'long' | 'short'
  header_text?: string
  blank_header?: boolean
  source?: string
  source_roll_id?: string
  source_lot_no?: string          // Lot ต้นทางจากผลิต (ใช้รวมม้วนเสีย Lot เดียวกันเป็นงานเดียว)
  source_roll_count?: number      // จำนวนม้วนเสียที่รวมเข้างานนี้
  source_defect_reason?: string   // สาเหตุที่ม้วนเสีย (จากผลิต)
  rework_reason?: string          // สาเหตุ/วิธีที่กรอได้ (โดยแผนกกรอ)
  rewinder_name?: string          // ชื่อคนกรอ
  status?: 'active' | 'closed'
  created_by?: string
  created_at?: string
}

// แปลง ReworkJob + machine ที่เลือก → MachineProfile สำหรับ WeighPage
export function jobToProfile(job: ReworkJob, machine_no: string): MachineProfile {
  const prof: any = {
    machine_no,
    custCode:     job.cust_code    ?? '',
    custName:     job.cust_name    ?? '',
    custBranch:   job.cust_branch  ?? '',
    custAddress:  '',
    decimal:     (job.decimal_places ?? 2) as 1|2,
    itemCode:     job.item_code    ?? '',
    matCode:      job.mat_code     ?? '',
    productCode:  job.product_code ?? '',
    productName:  job.product_name ?? '',
    widthCm:      job.width_cm     ?? '',
    widthUnit:   (job.width_unit   ?? 'cm') as 'cm'|'mm',
    thickMc:      job.thick_mc     ?? '',
    lotNo:        job.lot_no       ?? '',
    length:       '',
    pcs:          '',
    coreWeight:   job.core_weight  ?? '1.25',
    inspector:    job.inspector    ?? '',
    locked:       false,
    plannedQty:   job.planned_qty  ?? '',
    labelSize:   (job.label_size   ?? 'long') as 'long'|'short',
    headerText:   job.header_text  ?? '',
    blankHeader:  job.blank_header ?? false,
    section:      'rewind',
    soNo:         job.sale_order   ?? '',
    woNo:         job.work_order   ?? '',
    deliveryDate: job.delivery_date ?? '',
    sourceLotNo:  job.source_lot_no ?? '',   // Lot ต้นทาง (สำหรับหมายเหตุ "กรอจาก")
    reworkJobId:  job.id,                     // ใช้โหลดม้วนที่เบิกมา (rework_withdrawals)
    newSystem:   (job as any).new_system ?? false,   // ชุดระบบใหม่ — เลขม้วนนับต่อสินค้า + ลงสี
  }
  return prof as MachineProfile
}

function fmt(n: number, d = 2) { return Number(n ?? 0).toFixed(d) }

// สร้าง Lot รูปแบบเดียวกับฝั่งผลิต: yy + เครื่อง + รหัสลูกค้า(4) + เดือน
export function genReworkLot(machine: string, custCode: string, seq?: number): string {
  const yy = String((new Date().getFullYear() + 543) % 100).padStart(2, '0')
  const mm = String(new Date().getMonth() + 1).padStart(2, '0')
  const mc = (machine ?? '').toUpperCase()
  if (!mc) return ''
  // ช่องกลาง 4 หลัก: ถ้ามีเลขรัน (seq) ใช้เลขรัน (กัน Lot ชนกันเมื่อ cust_code ว่าง)
  // ไม่งั้น fallback เป็น cust_code (พฤติกรรมเดิม)
  const mid = (seq != null && seq > 0)
    ? String(seq).padStart(4, '0').slice(-4)
    : (custCode ?? '').replace(/\D/g, '').padStart(4, '0').slice(-4)
  return `${yy}${mc}${mid}${mm}`
}

// Lot กรอ = Lot ผลิตต้นทาง เปลี่ยนแค่รหัสเครื่องเป็นสถานีกรอ
// เช่น source 69BL03000106 + เครื่องกรอ S01 → 69S01000106 (running/เดือนเดิม)
export function swapLotMachine(sourceLot?: string, sourceMachine?: string, reworkMachine?: string): string {
  const sl = (sourceLot ?? '').trim()
  const sm = (sourceMachine ?? '').trim().toUpperCase()
  const rm = (reworkMachine ?? '').trim().toUpperCase()
  if (!sl || !sm || !rm) return ''
  const idx = sl.toUpperCase().indexOf(sm)
  if (idx === -1) return ''
  return sl.slice(0, idx) + rm + sl.slice(idx + sm.length)
}

// หาเลขรันถัดไปของ Lot กรอ สำหรับเครื่อง+เดือนนี้ (กัน Lot ชนกัน)
export async function nextReworkSeq(machine: string): Promise<number> {
  const yy = String((new Date().getFullYear() + 543) % 100).padStart(2, '0')
  const mm = String(new Date().getMonth() + 1).padStart(2, '0')
  const mc = (machine ?? '').toUpperCase()
  const prefix = `${yy}${mc}`
  const { data } = await supabase.from('rework_jobs').select('lot_no').like('lot_no', `${prefix}%${mm}`)
  let max = 0
  for (const r of data ?? []) {
    const lot = (r.lot_no ?? '') as string
    if (lot.startsWith(prefix) && lot.endsWith(mm) && lot.length === prefix.length + 4 + mm.length) {
      const mid = parseInt(lot.slice(prefix.length, prefix.length + 4), 10)
      if (!isNaN(mid) && mid > max) max = mid
    }
  }
  return max + 1
}

export default function ReworkJobList({ onPickJob }: { onPickJob: (profile: MachineProfile, job: ReworkJob) => void }) {
  const [view, setView] = useState<'jobs' | 'inbox'>('jobs')
  const [inboxCount, setInboxCount] = useState(0)

  // นับม้วนรอกรอ (queue) — แสดง badge บนแท็บ + auto refresh
  useEffect(() => {
    let alive = true
    async function count() {
      const data = await fetchAll(() => supabase.from('production_rolls')
        .select('rework_status, is_legacy').eq('roll_type', 'bad'))
      if (!alive) return
      const n = (data ?? []).filter(r => !r.is_legacy && (!r.rework_status || r.rework_status === 'pending')).length
      setInboxCount(n)
    }
    count()
    const t = setInterval(count, 15_000)
    return () => { alive = false; clearInterval(t) }
  }, [view])

  return (
    <div className="min-h-[calc(100vh-48px)] bg-[#0a0f1e] flex flex-col">
      {/* แถบสลับ: งานกรอ / รับจากผลิต */}
      <div className="flex gap-1 px-3 pt-3">
        {([
          { key: 'jobs',  label: '🔁 งานกรอ (ชั่งน้ำหนัก)' },
          { key: 'inbox', label: '🏭 รับจากผลิต' },
        ] as const).map(t => (
          <button key={t.key} onClick={() => setView(t.key)}
            className={`relative px-4 py-2 rounded-t-lg text-sm font-bold transition-colors ${
              view === t.key ? 'bg-slate-900 text-white border-x border-t border-slate-700' : 'bg-slate-950 text-slate-500 hover:text-slate-300'
            }`}>
            {t.label}
            {t.key === 'inbox' && inboxCount > 0 && (
              <span className="ml-2 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-red-500 text-white text-[11px] font-black animate-pulse align-middle">
                {inboxCount}
              </span>
            )}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0">
        {view === 'jobs' ? <JobListView onPickJob={onPickJob} /> : <ReworkInbox />}
      </div>
    </div>
  )
}

function JobListView({ onPickJob }: { onPickJob: (profile: MachineProfile, job: ReworkJob) => void }) {
  const [jobs, setJobs] = useState<ReworkJob[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [jobStatus, setJobStatus] = useState<'active'|'closed'>('active')   // log งานกรอที่ปิดแล้ว
  const [sysFilter, setSysFilter] = useState<'new'|'old'>('new')            // ✨ ชุดระบบใหม่ / งานเก่า
  const [reopening, setReopening] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [pickFor, setPickFor]       = useState<ReworkJob | null>(null)
  const [machines, setMachines]     = useState<{machine_no:string}[]>([])
  const [progress, setProgress]     = useState<Record<string,{rolls:number,kg:number}>>({})
  const [jobOrders, setJobOrders]   = useState<Record<string,{wos:string[],sos:string[],bys:string[],reasons:string[],count:number}>>({})   // job.id → WO/SO/ผู้เบิก/สาเหตุ ทั้งหมดที่เบิกเข้างานนี้
  const [closeFor, setCloseFor]     = useState<ReworkJob | null>(null)
  const [closeBy, setCloseBy]       = useState('')
  const [closing, setClosing]       = useState(false)

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('rework_jobs')
      .select('*')
      .eq('status', jobStatus)
      .order(jobStatus === 'closed' ? 'closed_at' : 'created_at', { ascending: false })
    const list = (data ?? []) as ReworkJob[]
    setJobs(list)
    // รวบ WO/SO ทั้งหมดที่เบิกเข้าแต่ละงาน (งานรวมข้ามไซส์/WO → หลาย WO·SO ต่องาน)
    const jobIds = list.map(j => j.id).filter(Boolean)
    if (jobIds.length) {
      const { data: wds } = await supabase.from('rework_withdrawals')
        .select('job_id, work_order, sale_order, withdrawn_by, source_roll_id').in('job_id', jobIds as string[])
      // ดึงสาเหตุของม้วนต้นทางแต่ละม้วน (remark = สาเหตุที่แผนกเป่าระบุ)
      const srcIds = [...new Set((wds ?? []).map((w: any) => w.source_roll_id).filter(Boolean))]
      const reasonById: Record<string,string> = {}
      if (srcIds.length) {
        const { data: srcs } = await supabase.from('production_rolls')
          .select('id, remark, rework_remark').in('id', srcIds as string[])
        for (const s of srcs ?? []) reasonById[(s as any).id] = ((s as any).remark || (s as any).rework_remark || '').trim()
      }
      const ord: Record<string,{wos:string[],sos:string[],bys:string[],reasons:string[],count:number}> = {}
      for (const w of wds ?? []) {
        const k = w.job_id; if (!k) continue
        if (!ord[k]) ord[k] = { wos: [], sos: [], bys: [], reasons: [], count: 0 }
        ord[k].count++
        const wo = (w.work_order ?? '').trim(); const so = (w.sale_order ?? '').trim()
        const by = ((w as any).withdrawn_by ?? '').trim(); const rs = reasonById[(w as any).source_roll_id] ?? ''
        if (wo && !ord[k].wos.includes(wo)) ord[k].wos.push(wo)
        if (so && !ord[k].sos.includes(so)) ord[k].sos.push(so)
        if (by && !ord[k].bys.includes(by)) ord[k].bys.push(by)
        if (rs && !ord[k].reasons.includes(rs)) ord[k].reasons.push(rs)
      }
      setJobOrders(ord)
    } else setJobOrders({})
    // ดึง progress (ม้วน good ของแต่ละ lot)
    // งานปกติ: แยกตาม Lot + WO (กัน 2 งานปน Lot เดียว)
    // ชุดระบบใหม่: นับรวมทั้ง Lot (เลขม้วนต่อเนื่องข้าม WO — ไม่งั้นนับไม่ครบ)
    const lots = list.map(j => j.lot_no).filter(Boolean)
    if (lots.length) {
      const { data: rolls } = await supabase.from('production_rolls')
        .select('lot_no, work_order, weight, roll_type, new_system, transferred')
        .in('lot_no', lots)
        .eq('roll_type', 'good')
      const p: Record<string,{rolls:number,kg:number}> = {}
      for (const r of rolls ?? []) {
        // ชุดระบบใหม่: นับเฉพาะม้วนที่ "ยังไม่โอน" (โอนแล้ว = จบชุด ตัดเป็นชุดใหม่ — ไม่นับรวม)
        if ((r as any).new_system && (r as any).transferred) continue
        const k = (r as any).new_system ? `NS__${r.lot_no}` : `${r.lot_no}__${r.work_order ?? ''}`
        if (!p[k]) p[k] = { rolls: 0, kg: 0 }
        p[k].rolls += 1
        p[k].kg    += r.weight ?? 0
      }
      setProgress(p)
    }
    setLoading(false)
  }
  // คีย์ progress = Lot + WO (กันงานคนละ WO แต่ Lot เดียวกันยอดปน)
  const progKey = (j: { lot_no?: string; work_order?: string; new_system?: boolean }) =>
    (j as any).new_system ? `NS__${j.lot_no ?? ''}` : `${j.lot_no ?? ''}__${j.work_order ?? ''}`
  async function loadMachines() {
    const { data } = await supabase.from('machine_profiles').select('machine_no').eq('section','rewind').order('machine_no')
    setMachines((data ?? []) as any)
  }

  useEffect(() => { loadMachines() }, [])
  useEffect(() => { load() }, [jobStatus]) // eslint-disable-line react-hooks/exhaustive-deps

  // เลือกเครื่องแล้ว → สร้าง Lot + เปิดจอชั่งของเครื่องนั้น (ใช้ทั้งจากปุ่มเลือกเครื่อง และกดม้วน "ชั่งเลย")
  async function pickMachine(job: ReworkJob, machine_no: string) {
    let lot = job.lot_no?.trim() ?? ''
    const srcLot = ((job as any).source_lot_no ?? '').trim()
    let gen = ''
    if (srcLot) {
      const { data: sr } = await supabase.from('production_rolls')
        .select('machine_no').eq('lot_no', srcLot).limit(1).maybeSingle()
      gen = swapLotMachine(srcLot, sr?.machine_no ?? '', machine_no)
    }
    if (!gen && !lot) gen = genReworkLot(machine_no, job.cust_code ?? '')
    if (gen && gen !== lot) {
      lot = gen
      await supabase.from('rework_jobs').update({ lot_no: gen }).eq('id', job.id)
    }
    const prof = jobToProfile({ ...job, lot_no: lot }, machine_no)
    setPickFor(null)
    onPickJob(prof, { ...job, lot_no: lot })
  }

  // กดการ์ดงาน → ถ้าชุดระบบใหม่มีเครื่องล็อกอยู่แล้ว ไปจอชั่งเลย ไม่ต้องเลือกเครื่องซ้ำ
  async function openJob(job: ReworkJob) {
    if ((job as any).new_system) {
      const ic = (job.item_code ?? '').trim()
      const { data } = await supabase.from('production_rolls')
        .select('machine_no')
        .eq('item_code', ic).eq('roll_type', 'good').eq('new_system', true).eq('transferred', false)
        .limit(1).maybeSingle()
      if (data?.machine_no) { await pickMachine(job, data.machine_no); return }  // ล็อกเครื่องเดิม → ชั่งต่อเลย
    }
    setPickFor(job)  // ยังไม่มีเครื่องล็อก (เริ่มม้วน #1) → เลือกเครื่องก่อน
  }

  // ดึงงานกรอที่ปิดแล้วกลับมาทำต่อ (เปิดงานใหม่ → active)
  async function reopenJob(job: ReworkJob) {
    if (!confirm(`ดึงงานกรอนี้กลับมาชั่งต่อ?\n\n${job.product_name}\nLot ${job.lot_no || '—'}\n\nงานจะกลับไปอยู่ในรายการ "งานกรอ" ให้เลือกเครื่องชั่งต่อได้`)) return
    setReopening(job.id!)
    const { error } = await supabase.from('rework_jobs')
      .update({ status: 'active', closed_at: null, closed_by: null })
      .eq('id', job.id!)
    setReopening(null)
    if (error) { alert('ดึงงานไม่สำเร็จ: ' + error.message); return }
    alert('✓ ดึงงานกลับแล้ว — ไปที่แท็บ "กำลังทำ" เพื่อเลือกเครื่องชั่งต่อ')
    setJobStatus('active')
  }

  const filtered = jobs.filter(j => {
    // แยกชุดระบบใหม่ / งานเก่า (เฉพาะแท็บกำลังทำ)
    if (jobStatus === 'active') {
      const isNew = !!(j as any).new_system
      if (sysFilter === 'new' && !isNew) return false
      if (sysFilter === 'old' &&  isNew) return false
    }
    if (!search.trim()) return true
    const s = search.toLowerCase()
    return [j.lot_no, j.product_name, j.cust_name, j.item_code, j.sale_order]
      .filter(Boolean).some(x => String(x).toLowerCase().includes(s))
  })

  function closeJob(job: ReworkJob) {
    setCloseBy('')
    setCloseFor(job)
  }
  async function confirmCloseJob() {
    if (!closeFor) return
    setClosing(true)
    try {
      const { data, error } = await supabase.from('rework_jobs').update({
        status: 'closed', closed_at: new Date().toISOString(), closed_by: closeBy.trim() || null
      }).eq('id', closeFor.id).select()
      if (error) { alert('ปิดงานไม่สำเร็จ: ' + error.message); return }
      if (!data || data.length === 0) {
        alert('ปิดงานไม่สำเร็จ: ไม่มีสิทธิ์อัปเดต (RLS) หรือไม่พบงานนี้\nให้เปิดสิทธิ์ UPDATE บนตาราง rework_jobs ใน Supabase')
        return
      }
      if ((closeFor as any).new_system) {
        // ชุดระบบใหม่: ปิดงาน → ม้วนต้นทางที่ "กรอแล้ว" = reworked · ที่ "ยังไม่กรอ" = กลับคิว (รับจากผลิต)
        const ic = (closeFor.item_code ?? '').trim()
        const { data: outs } = await supabase.from('production_rolls')
          .select('rework_source_roll_id').eq('item_code', ic).eq('roll_type', 'good')
          .eq('new_system', true).not('rework_source_roll_id', 'is', null)
        const used = new Set((outs ?? []).map((o: any) => o.rework_source_roll_id))
        const { data: srcs } = await supabase.from('production_rolls')
          .select('id').eq('item_code', ic).eq('roll_type', 'bad').eq('rework_status', 'reworking')
        for (const s of srcs ?? []) {
          if (used.has(s.id)) {
            await supabase.from('production_rolls').update({ rework_status: 'reworked' }).eq('id', s.id)
          } else {
            await supabase.from('production_rolls').update({
              rework_status: null, rework_received_by: null, rework_received_at: null, rework_remark: null, new_system: false,
            }).eq('id', s.id)   // เหลือไม่ได้กรอ → กลับคิว
          }
        }
      } else {
        // งานเก่า: เดิม — ม้วนกำลังกรอของ Lot ต้นทาง → reworked
        const srcLot = ((closeFor as any).source_lot_no || '').trim()
        if (srcLot) {
          const { error: rollErr } = await supabase.from('production_rolls')
            .update({ rework_status: 'reworked' })
            .eq('lot_no', srcLot).eq('roll_type', 'bad').eq('rework_status', 'reworking')
          if (rollErr) console.warn('อัปเดตสถานะม้วนต้นทางไม่สำเร็จ (non-fatal):', rollErr.message)
        }
      }
      setCloseFor(null)
      await load()
    } catch (e: any) {
      alert('ปิดงานไม่สำเร็จ: ' + (e?.message ?? e))
    } finally {
      setClosing(false)
    }
  }
  async function deleteJob(job: ReworkJob) {
    if (!confirm(`ลบงาน "${job.product_name}" (Lot ${job.lot_no}) ทิ้ง?\n\nม้วนต้นทางที่ยังไม่ได้ชั่งกรอจะถูกคืนกลับคิว "รับจากผลิต"\nม้วนที่กรอไปแล้วยังอยู่ในระบบ`)) return
    try {
      if ((job as any).new_system) {
        // ชุดระบบใหม่: คืนม้วนต้นทางที่ "ยังไม่ได้กรอ" กลับคิว · ม้วนที่กรอแล้ว = reworked
        const ic = (job.item_code ?? '').trim()
        const { data: outs } = await supabase.from('production_rolls')
          .select('rework_source_roll_id').eq('item_code', ic).eq('roll_type', 'good')
          .eq('new_system', true).not('rework_source_roll_id', 'is', null)
        const used = new Set((outs ?? []).map((o: any) => o.rework_source_roll_id))
        const { data: srcs } = await supabase.from('production_rolls')
          .select('id').eq('item_code', ic).eq('roll_type', 'bad').eq('rework_status', 'reworking')
        for (const s of srcs ?? []) {
          if (used.has(s.id)) {
            await supabase.from('production_rolls').update({ rework_status: 'reworked' }).eq('id', s.id)
          } else {
            await supabase.from('production_rolls').update({
              rework_status: null, rework_received_by: null, rework_received_at: null, rework_remark: null, new_system: false,
            }).eq('id', s.id)   // ยังไม่ได้กรอ → กลับคิว
          }
        }
      } else {
        // งานเก่า: คืนม้วนต้นทางของ Lot นี้ที่กำลังกรอกลับคิว
        const srcLot = ((job as any).source_lot_no || '').trim()
        if (srcLot) {
          await supabase.from('production_rolls').update({
            rework_status: null, rework_received_by: null, rework_received_at: null, rework_remark: null,
          }).eq('lot_no', srcLot).eq('roll_type', 'bad').eq('rework_status', 'reworking')
        }
      }
    } catch (e: any) {
      console.warn('คืนม้วนต้นทางไม่สำเร็จ (non-fatal):', e?.message ?? e)
    }
    await supabase.from('rework_jobs').delete().eq('id', job.id)
    load()
  }

  return (
    <div className="min-h-[calc(100vh-48px)] bg-[#0a0f1e] p-3 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <h1 className="text-white font-bold text-xl flex items-center gap-2">
            🔁 งานกรอ (Rework Jobs)
            <span className={`text-xs font-bold px-3 py-1 rounded-full ${jobStatus==='closed' ? 'bg-slate-600/30 text-slate-300' : 'bg-green-500/20 text-green-300'}`}>
              {filtered.length} {jobStatus==='closed' ? 'งานที่ปิดแล้ว' : 'งาน active'}
            </span>
          </h1>
          <p className="text-slate-400 text-sm mt-0.5">สร้างงาน → เลือก station ตอนชั่ง → ใบปะหน้าโชว์เครื่องที่เลือก</p>
        </div>
        <div className="flex gap-2">
          <ExportButton rows={filtered}
            cols={[
              { header:'Lot', value:'lot_no', width:16 },
              { header:'WO', value: j => j.work_order ?? '' },
              { header:'SO', value: j => j.sale_order ?? '' },
              { header:'สินค้า', value:'product_name', width:30 },
              { header:'ลูกค้า', value: j => j.cust_name ?? '', width:24 },
              { header:'Item Code', value: j => j.item_code ?? '' },
              { header:'เป้าผลิต (kg)', value: j => j.planned_qty ?? '' },
              { header:'กรอได้ (kg)', value: j => progress[progKey(j)]?.kg ?? 0 },
              { header:'ม้วนกรอได้', value: j => progress[progKey(j)]?.rolls ?? 0 },
              { header:'ผู้รับ', value: j => j.inspector ?? '' },
              { header:'สร้างเมื่อ', value: j => j.created_at ? new Date(j.created_at).toLocaleString('th-TH') : '', width:18 },
            ]}
            fileName="งานกรอ_active" sheetName="งานกรอ" />
          <button onClick={load}
            className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 px-3 py-2 rounded-lg text-sm flex items-center gap-1.5">
            <RefreshCw size={14}/>
          </button>
          <button onClick={() => setShowCreate(true)}
            className="bg-brand-600 hover:bg-brand-500 text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-1.5">
            <Plus size={16}/> สร้างงานใหม่
          </button>
        </div>
      </div>

      {/* Search + filter สถานะ */}
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <div className="relative max-w-md flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"/>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="ค้นหา lot/สินค้า/ลูกค้า/SO..."
            className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-sm text-white outline-none focus:border-brand-500"/>
        </div>
        {jobStatus === 'active' && (() => {
          const newCount = jobs.filter(j => (j as any).new_system).length
          const oldCount = jobs.length - newCount
          return (
          <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 rounded-lg p-1">
            {([['new','✨ ชุดระบบใหม่',newCount],['old','งานเก่า',oldCount]] as const).map(([k,label,cnt]) => (
              <button key={k} onClick={()=>setSysFilter(k as any)}
                className={`text-xs font-bold px-3 py-1.5 rounded transition-colors ${sysFilter===k ? (k==='new'?'bg-emerald-600 text-white':'bg-slate-600 text-white') : 'text-slate-400 hover:bg-slate-800'}`}>
                {label} <span className="opacity-70">({cnt})</span>
              </button>
            ))}
          </div>
          )
        })()}
        <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 rounded-lg p-1">
          {([['active','🔁 กำลังทำ'],['closed','🏁 จบงานแล้ว (Log)']] as const).map(([k,label]) => (
            <button key={k} onClick={()=>setJobStatus(k as any)}
              className={`text-xs font-bold px-3 py-1.5 rounded transition-colors ${jobStatus===k ? 'bg-brand-600 text-white' : 'text-slate-400 hover:bg-slate-800'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Job grid */}
      {loading ? (
        <p className="text-center py-20 text-slate-500">กำลังโหลด...</p>
      ) : filtered.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-slate-500">
            <p className="text-4xl mb-2">{jobStatus==='active' && sysFilter==='new' ? '✨' : '📋'}</p>
            <p>{jobStatus==='closed' ? 'ยังไม่มีงานกรอที่ปิดแล้ว'
               : sysFilter==='new' ? 'ยังไม่มีงานชุดระบบใหม่'
               : 'ยังไม่มีงานเก่า'}</p>
            <p className="text-xs mt-1">{jobStatus==='closed' ? 'งานที่กดปิดแล้วจะมาอยู่ที่นี่ — ดึงกลับมาชั่งต่อได้'
               : sysFilter==='new' ? 'ไปที่แท็บ "🏭 รับจากผลิต" → ติ๊กม้วน → ติ๊ก ✨ ชุดระบบใหม่ → กดเบิก · หรือกดดู "งานเก่า" ด้านบน'
               : 'กด "+ สร้างงานใหม่" หรือ "รับจากผลิต"'}</p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-3 2xl:grid-cols-4 gap-2 overflow-y-auto pb-3">
          {filtered.map(j => {
            const p = progress[progKey(j)] ?? { rolls: 0, kg: 0 }
            const planned = parseFloat(j.planned_qty ?? '') || 0
            const pct = planned > 0 ? Math.min(100, Math.round((p.kg / planned) * 100)) : 0
            const remaining = Math.max(0, planned - p.kg)
            const isFromProduction = j.source === 'from_production'
            return (
              <div key={j.id} className={`bg-slate-900 border rounded-2xl flex flex-col overflow-hidden transition-colors group relative ${jobStatus==='closed' ? 'border-slate-700' : 'border-slate-700 hover:border-brand-500'}`}>
                {jobStatus === 'active' && <button onClick={() => openJob(j)} className="absolute inset-0 z-0"/>}
                {/* top */}
                <div className={`flex items-center justify-between px-3 py-2 border-b relative z-0 pointer-events-none ${jobStatus==='closed' ? 'bg-slate-800/40 border-slate-700' : 'bg-brand-600/15 border-brand-500/20'}`}>
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`font-bold text-xs shrink-0 ${jobStatus==='closed' ? 'text-slate-400' : 'text-brand-300'}`}>
                      {jobStatus==='closed' ? '🏁 ปิดงานแล้ว' : isFromProduction ? '🏭 จากผลิต' : '⚙ สร้างเอง'}
                    </span>
                    {j.width_cm && (
                      <span className="text-sm font-black bg-brand-500/25 text-brand-100 border border-brand-400/40 px-2.5 py-0.5 rounded-lg whitespace-nowrap leading-none">
                        {fmtSize(j.width_cm, j.thick_mc, j.width_unit)}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-1 pointer-events-auto z-10">
                    {jobStatus === 'closed' ? (
                      <button onClick={e => { e.stopPropagation(); reopenJob(j) }} disabled={reopening===j.id}
                        title="ดึงกลับมาชั่งต่อ" className="text-[10px] bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white px-2 py-0.5 rounded font-bold">
                        {reopening===j.id ? '...' : '↩ ดึงกลับมาชั่ง'}</button>
                    ) : (<>
                      <button onClick={e => { e.stopPropagation(); closeJob(j) }}
                        title="ปิดงาน" className="text-[10px] bg-slate-700/60 hover:bg-green-600 text-slate-300 hover:text-white px-1.5 py-0.5 rounded">✓</button>
                      <button onClick={e => { e.stopPropagation(); deleteJob(j) }}
                        title="ลบงาน" className="text-[10px] bg-slate-700/60 hover:bg-red-600 text-slate-300 hover:text-white px-1.5 py-0.5 rounded">
                        <Trash2 size={10}/>
                      </button>
                    </>)}
                  </div>
                </div>
                {/* body */}
                <div className="px-3 py-2 flex flex-col gap-1.5 flex-1 pointer-events-none">
                  <p className="text-white font-bold text-sm line-clamp-1">{j.product_name || '—'}</p>
                  <p className="text-slate-400 text-xs truncate">{j.cust_name || '—'}{j.cust_branch ? ` · ${j.cust_branch}` : ''}</p>

                  <div className="flex gap-1.5 flex-wrap">
                    {(() => {
                      const wos = jobOrders[j.id]?.wos?.length ? jobOrders[j.id].wos : (j.work_order ? [j.work_order] : [])
                      const sos = jobOrders[j.id]?.sos?.length ? jobOrders[j.id].sos : (j.sale_order ? [j.sale_order] : [])
                      return <>
                        {wos.map(wo => <span key={'w'+wo} className="text-[10px] bg-orange-500/15 text-orange-300 border border-orange-500/25 px-2 py-0.5 rounded font-bold">WO {wo}</span>)}
                        {sos.map(so => <span key={'s'+so} className="text-[10px] bg-amber-500/15 text-amber-300 border border-amber-500/25 px-2 py-0.5 rounded font-bold">SO {so}</span>)}
                      </>
                    })()}
                    <span className="text-[10px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded font-mono border border-slate-700">
                      {j.lot_no?.trim() ? `Lot ${j.lot_no.slice(-8)}` : '🆕 รอเลือกเครื่อง'}
                    </span>
                    {(j.source_roll_count ?? 1) > 1 && <span className="text-[10px] bg-rose-500/15 text-rose-300 border border-rose-500/25 px-2 py-0.5 rounded font-bold">รวม {j.source_roll_count} ม้วนเสีย</span>}
                  </div>

                  {(() => {
                    const o = jobOrders[j.id]
                    const bys = o?.bys?.length ? o.bys : (j.inspector ? [j.inspector] : [])
                    const cnt = o?.count ?? (j.source_roll_count ?? 0)
                    return (
                      <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-xs bg-slate-800/40 rounded-lg px-2 py-1.5">
                        <span className="text-slate-500">Mat</span><span className="text-slate-200 font-mono text-right truncate">{j.mat_code || '—'}</span>
                        <span className="text-slate-500">👤 ผู้เบิก</span><span className="text-sky-200 text-right truncate font-bold">{bys.length ? bys.join(', ') : '—'}</span>
                        <span className="text-slate-500">ม้วนเบิกมา</span><span className="text-slate-200 text-right truncate">{cnt ? `${cnt} ม้วน` : '—'}</span>
                      </div>
                    )
                  })()}

                  {/* สาเหตุการกรอ — รวมสาเหตุทุกม้วนที่เบิกเข้างานนี้ */}
                  {(() => {
                    const reasons = jobOrders[j.id]?.reasons?.length
                      ? jobOrders[j.id].reasons
                      : (j.source_defect_reason ? [j.source_defect_reason] : [])
                    if (!reasons.length && !j.rework_reason && !j.rewinder_name) return null
                    return (
                      <div className="text-[10px] bg-emerald-500/5 border border-emerald-500/20 rounded-lg px-2 py-1.5 space-y-0.5">
                        {reasons.map((r, i) => (
                          <p key={i} className="text-rose-300 line-clamp-2">⚠ เสีย: <span className="text-slate-300">{r}</span></p>
                        ))}
                        {j.rework_reason && <p className="text-emerald-300 truncate">🔧 กรอ: <span className="text-slate-300">{j.rework_reason}</span></p>}
                        {j.rewinder_name && <p className="text-sky-300 truncate">👤 คนกรอ: <span className="text-slate-300">{j.rewinder_name}</span></p>}
                      </div>
                    )
                  })()}

                  {/* progress: เบิกมา / กรอได้ / เศษ */}
                  <div className="mt-auto">
                    <div className="grid grid-cols-3 gap-1 text-center mb-1.5">
                      <div className="bg-slate-800/60 rounded-lg py-1">
                        <p className="text-[9px] text-slate-500">เบิกมา</p>
                        <p className="text-xs font-black text-slate-200">{fmt(planned,1)}</p>
                      </div>
                      <div className="bg-green-500/10 rounded-lg py-1">
                        <p className="text-[9px] text-green-400/70">กรอได้</p>
                        <p className="text-xs font-black text-green-300">{fmt(p.kg,1)}</p>
                      </div>
                      <div className="bg-red-500/10 rounded-lg py-1">
                        <p className="text-[9px] text-red-400/70">เศษ(คาด)</p>
                        <p className="text-xs font-black text-red-300">{fmt(Math.max(0, planned - p.kg),1)}</p>
                      </div>
                    </div>
                    <div className="flex justify-between text-[10px] mb-1">
                      <span className="text-slate-500">{p.rolls} ม้วนกรอได้</span>
                      {planned > 0 && (
                        <span className={remaining <= 0 ? 'text-green-400 font-bold' : 'text-amber-400 font-bold'}>
                          {remaining <= 0 ? '✓ ครบ' : `เหลือ ${fmt(remaining,0)}`} · {pct}%
                        </span>
                      )}
                    </div>
                    {planned > 0 && (
                      <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${pct >= 100 ? 'bg-green-500' : pct >= 70 ? 'bg-amber-400' : 'bg-brand-500'}`}
                          style={{ width: `${pct}%` }}/>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {showCreate && (
        <CreateJobModal onClose={() => setShowCreate(false)} onSaved={() => { setShowCreate(false); load() }} />
      )}

      {pickFor && (
        <PickMachineModal job={pickFor} machines={machines}
          onClose={() => setPickFor(null)}
          onPick={(machine_no) => pickMachine(pickFor, machine_no)} />
      )}

      {closeFor && (() => {
        const prog = progress[progKey(closeFor)] ?? { rolls: 0, kg: 0 }
        return (
          <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={() => !closing && setCloseFor(null)}>
            <div className="bg-slate-900 border-2 border-brand-500/40 rounded-2xl w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
              <div className="px-6 py-4 border-b border-slate-800">
                <p className="text-white font-bold text-lg flex items-center gap-2">🏁 ปิดงานกรอ · สรุปผล</p>
                <p className="text-slate-400 text-xs mt-1">{closeFor.product_name} · Lot {closeFor.lot_no?.trim() || '— (ยังไม่เลือกเครื่อง)'}</p>
              </div>

              <div className="px-6 py-4 space-y-3">
                {/* สรุป: เบิกมา / กรอได้ / เศษ(คิดอัตโนมัติ) */}
                {(() => {
                  const withdrawn = parseFloat(closeFor.planned_qty ?? '') || 0
                  const scrap = Math.max(0, withdrawn - prog.kg)
                  return (
                  <div className="grid grid-cols-3 gap-2">
                    <div className="bg-slate-800 rounded-xl p-3 text-center">
                      <p className="text-slate-400 text-[10px]">เบิกมา</p>
                      <p className="text-slate-100 font-black text-2xl">{fmt(withdrawn, 1)}</p>
                      <p className="text-slate-500 text-[9px]">Kg</p>
                    </div>
                    <div className="bg-green-500/10 border border-green-500/25 rounded-xl p-3 text-center">
                      <p className="text-green-400 text-[10px]">กรอได้ ({prog.rolls} ม้วน)</p>
                      <p className="text-green-300 font-black text-2xl">{fmt(prog.kg, 1)}</p>
                      <p className="text-slate-500 text-[9px]">Kg</p>
                    </div>
                    <div className="bg-red-500/10 border border-red-500/25 rounded-xl p-3 text-center">
                      <p className="text-red-400 text-[10px]">เศษ (อัตโนมัติ)</p>
                      <p className="text-red-300 font-black text-2xl">{fmt(scrap, 1)}</p>
                      <p className="text-slate-500 text-[9px]">เบิก − กรอได้</p>
                    </div>
                  </div>
                  )
                })()}

                {/* รายละเอียด สาเหตุ/คนกรอ */}
                <div className="bg-slate-800 rounded-xl p-3 space-y-1.5 text-sm">
                  <div className="flex justify-between gap-2"><span className="text-slate-400 shrink-0">ลูกค้า</span><b className="text-slate-200 text-right truncate">{closeFor.cust_name || '—'}</b></div>
                  {closeFor.source_defect_reason && <div className="flex justify-between gap-2"><span className="text-rose-300 shrink-0">⚠ สาเหตุเสีย</span><b className="text-slate-200 text-right">{closeFor.source_defect_reason}</b></div>}
                  {closeFor.rework_reason && <div className="flex justify-between gap-2"><span className="text-emerald-300 shrink-0">🔧 วิธีกรอ</span><b className="text-slate-200 text-right">{closeFor.rework_reason}</b></div>}
                  {closeFor.rewinder_name && <div className="flex justify-between gap-2"><span className="text-sky-300 shrink-0">👤 คนกรอ</span><b className="text-slate-200 text-right">{closeFor.rewinder_name}</b></div>}
                </div>

                {prog.rolls === 0 && (
                  <div className="bg-amber-500/10 border border-amber-500/25 rounded-xl px-3 py-2 text-xs text-amber-300">
                    ⚠️ ยังไม่มีม้วนดีที่ชั่งออกจากงานนี้ — ปิดงานโดยไม่มีผลผลิต?
                  </div>
                )}
                {(closeFor as any).new_system && (
                  <div className="bg-emerald-500/10 border border-emerald-500/25 rounded-xl px-3 py-2 text-xs text-emerald-300">
                    ✨ ชุดระบบใหม่: ปิดได้เลยแม้กรอไม่หมด — ม้วนที่ยังไม่กรอจะ<b>กลับเข้าคิว "รับจากผลิต"</b> ให้กรอต่อทีหลังได้
                  </div>
                )}

                <div>
                  <label className="text-slate-400 text-xs">ชื่อผู้ปิดงาน</label>
                  <input value={closeBy} onChange={e => setCloseBy(e.target.value)} autoFocus
                    placeholder="ชื่อผู้ปิด..."
                    className="w-full mt-1 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-brand-500 placeholder-slate-500" />
                </div>
                <p className="text-[10px] text-slate-500 text-center">ปิดแล้วงานจะหายจากรายการ — ม้วนที่ชั่งไว้ยังอยู่ใน DB</p>
              </div>

              <div className="px-6 pb-4 space-y-2">
                <button onClick={confirmCloseJob} disabled={closing}
                  className="w-full bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white py-3 rounded-xl font-bold transition-colors">
                  {closing ? 'กำลังปิด...' : '🏁 ยืนยันปิดงาน'}
                </button>
                <button onClick={() => setCloseFor(null)} disabled={closing}
                  className="w-full bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-400 py-2 rounded-xl text-sm transition-colors">
                  ยกเลิก
                </button>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

// ─── เลือก station ก่อนเข้าหน้าชั่ง ──
function PickMachineModal({ job, machines, onClose, onPick }: {
  job: ReworkJob; machines: {machine_no:string}[]; onClose: () => void; onPick: (m: string) => void
}) {
  const isNew = !!(job as any).new_system
  // ชุดระบบใหม่: เช็กม้วนที่ "ยังไม่โอน" ของสินค้านี้ → ล็อกเครื่อง + บอกเลขม้วนถัดไป
  const [info, setInfo] = useState<{ lock?: string; next: number; pending: number } | null>(null)
  useEffect(() => {
    if (!isNew) { setInfo({ next: 1, pending: 0 }); return }
    const ic = (job.item_code ?? '').trim()
    supabase.from('production_rolls')
      .select('roll_no, machine_no')
      .eq('item_code', ic).eq('roll_type', 'good').eq('new_system', true).eq('transferred', false)
      .then(({ data }) => {
        const rows = data ?? []
        const max = Math.max(0, ...rows.map((r: any) => r.roll_no ?? 0))
        setInfo({ lock: rows[0]?.machine_no || undefined, next: max + 1, pending: rows.length })
      })
  }, [])
  // ถ้ามีม้วนค้าง → บังคับเครื่องเดิม (ชั่งเครื่องเดียว)
  const lock = info?.lock
  const list = lock ? machines.filter(m => m.machine_no === lock) : machines
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <p className="text-white font-bold">🔁 เลือกเครื่องสำหรับ "{job.product_name}"</p>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={18}/></button>
        </div>

        {/* ── แจ้งเตือนเลขม้วนถัดไป (ชุดระบบใหม่) ── */}
        {isNew && info && (
          info.pending > 0 ? (
            <div className="bg-amber-500/15 border border-amber-500/40 rounded-xl px-3 py-2.5 mb-3 text-sm">
              <p className="text-amber-300 font-bold">⚠ งานนี้มีม้วนค้าง {info.pending} ม้วน (ยังไม่โอน)</p>
              <p className="text-amber-200 text-xs mt-0.5">ม้วนถัดไปจะเป็น <b className="text-base">#{info.next}</b> — ชั่งต่อจากเดิม{lock ? ` · ล็อกเครื่อง ${lock}` : ''}</p>
            </div>
          ) : (
            <div className="bg-emerald-500/15 border border-emerald-500/40 rounded-xl px-3 py-2.5 mb-3 text-sm">
              <p className="text-emerald-300 font-bold">✅ รอบก่อนโอนหมดแล้ว</p>
              <p className="text-emerald-200 text-xs mt-0.5">ม้วนถัดไป <b className="text-base">เริ่ม #1 ใหม่</b> — เลือกเครื่องไหนก็ได้</p>
            </div>
          )
        )}

        <p className="text-slate-400 text-xs mb-3">Lot <span className="font-mono text-slate-200">{job.lot_no || '—'}</span> · ใบปะหน้าจะแสดงเครื่องที่เลือก</p>

        {machines.length === 0 ? (
          <p className="text-red-400 text-sm text-center py-4">⚠ ยังไม่มีเครื่องกรอ — ไปตั้งค่าก่อน</p>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {list.map(m => (
              <button key={m.machine_no} onClick={() => onPick(m.machine_no)}
                className={`border-2 text-white py-4 rounded-xl font-black text-lg transition-colors ${lock ? 'bg-amber-600 border-amber-400' : 'bg-slate-800 hover:bg-brand-600 border-slate-700 hover:border-brand-500'}`}>
                {m.machine_no}{lock && ' 🔒'}
              </button>
            ))}
          </div>
        )}
        {lock && <p className="text-[11px] text-amber-400/80 text-center mt-2">🔒 งานนี้กรออยู่เครื่อง {lock} — ต้องชั่งต่อเครื่องเดิม</p>}
      </div>
    </div>
  )
}

// ─── สร้างงานใหม่ — minimal form (ใช้ Products picker เลือก item code) ──
function CreateJobModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [products, setProducts] = useState<Product[]>([])
  const [form, setForm] = useState<Partial<ReworkJob>>({
    lot_no: '',
    item_code: '', mat_code: '', product_name: '', width_cm: '', width_unit: 'cm', thick_mc: '',
    cust_code: '', cust_name: '', cust_branch: '',
    core_weight: '1.25', decimal_places: 2, planned_qty: '',
    inspector: '', label_size: 'long', sale_order: '', work_order: '',
    source_defect_reason: '', rework_reason: '', rewinder_name: '',
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => { fetchProducts().then(setProducts) }, [])

  function fillFromProduct(p: Product) {
    setForm(f => ({
      ...f,
      item_code:    p.item_code,
      product_code: p.product_code,
      product_name: p.product_name,
      width_cm:     p.width_cm,
      width_unit:  (p.width_unit ?? 'cm') as 'cm'|'mm',
      thick_mc:     p.thick_mc,
      cust_code:    p.cust_code,
      cust_name:    p.cust_name ?? '',
      mat_code:     p.mat_code ?? '',     // auto
      core_weight:  p.core_weight ?? '',  // auto น้ำหนักแกน
    }))
    // ไม่ auto-gen lot ที่นี่ — Lot จะถูกสร้างตอนเลือกเครื่อง (yy+เครื่อง+ลูกค้า+เดือน)
  }
  function pickProduct(item_code: string) {
    const p = products.find(x => x.item_code === item_code.trim())
    if (!p) { setForm(f => ({ ...f, item_code })); return }
    fillFromProduct(p)
  }
  // พิมพ์ Mat Code ตรงกับสินค้า → เด้งข้อมูลให้เลย
  function onMatCode(val: string) {
    const m = products.find(x => (x.mat_code ?? '').trim().toLowerCase() === val.trim().toLowerCase() && val.trim() !== '')
    if (m) { fillFromProduct(m); return }
    setForm(f => ({ ...f, mat_code: val }))
  }

  async function save() {
    if (!form.product_name?.trim()) { alert('กรอกชื่อสินค้า'); return }
    if (!form.cust_name?.trim())    { alert('กรอกลูกค้า'); return }
    setSaving(true)
    const { error } = await supabase.from('rework_jobs').insert({
      ...form, source: 'manual', status: 'active', created_at: new Date().toISOString(),
    })
    setSaving(false)
    if (error) { alert('สร้างไม่สำเร็จ: ' + error.message); return }
    // จำค่าที่กรอกเอง: ถ้า master ยังไม่มี Mat Code/แกน → เติมกลับให้ครั้งหน้า auto-fill
    backfillProductMatCore(form.item_code, form.mat_code, form.core_weight)
    onSaved()
  }

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-xl max-h-[90vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between shrink-0">
          <p className="text-white font-bold">+ สร้างงานกรอใหม่</p>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={18}/></button>
        </div>
        <div className="px-5 py-4 space-y-2.5 overflow-y-auto">

          <div>
            <label className="block text-[10px] text-slate-500 mb-1">Item Code (เลือกจาก master)</label>
            <input list="job-items" value={form.item_code ?? ''} onChange={e => pickProduct(e.target.value)}
              placeholder="พิมพ์ค้นหา หรือเลือก"
              className="w-full bg-slate-800 border-2 border-brand-500/40 hover:border-brand-500 focus:border-brand-500 rounded-lg px-2.5 py-1.5 text-white text-sm outline-none"/>
            <datalist id="job-items">
              {products.map(p => <option key={p.item_code} value={p.item_code}>{p.product_name} · {p.cust_name}</option>)}
            </datalist>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] text-slate-500 mb-1">SO</label>
              <input value={form.sale_order ?? ''} onChange={e => setForm(f => ({ ...f, sale_order: e.target.value }))}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-sm outline-none focus:border-brand-500"/>
            </div>
            <div>
              <label className="block text-[10px] text-slate-500 mb-1">WO</label>
              <input value={form.work_order ?? ''} onChange={e => setForm(f => ({ ...f, work_order: e.target.value }))}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-sm outline-none focus:border-brand-500"/>
            </div>
          </div>

          <div>
            <label className="block text-[10px] text-slate-500 mb-1">Lot No <span className="text-slate-600">(เว้นว่าง = สร้างอัตโนมัติตอนเลือกเครื่อง)</span></label>
            <input value={form.lot_no ?? ''} onChange={e => setForm(f => ({ ...f, lot_no: e.target.value }))}
              placeholder="เว้นว่างไว้ได้ — ระบบจะสร้างเป็น 69S01000105"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-sm font-mono outline-none focus:border-brand-500"/>
          </div>

          <div>
            <label className="block text-[10px] text-slate-500 mb-1">Mat Code</label>
            <input value={form.mat_code ?? ''} onChange={e => onMatCode(e.target.value)}
              placeholder="พิมพ์ Mat Code ตรงกับสินค้า → เด้งข้อมูลให้"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-sm outline-none focus:border-brand-500"/>
          </div>

          <div>
            <label className="block text-[10px] text-slate-500 mb-1">ชื่อสินค้า *</label>
            <input value={form.product_name ?? ''} onChange={e => setForm(f => ({ ...f, product_name: e.target.value }))}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-sm outline-none focus:border-brand-500"/>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] text-slate-500 mb-1">กว้าง</label>
              <div className="flex gap-1">
                <input value={form.width_cm ?? ''} onChange={e => setForm(f => ({ ...f, width_cm: e.target.value }))}
                  className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-sm outline-none focus:border-brand-500"/>
                {(['cm','mm'] as const).map(u => (
                  <button key={u} type="button" onClick={() => setForm(f => {
                      const cur = f.width_unit ?? 'cm'
                      if (cur === u) return { ...f, width_unit: u }
                      const n = parseFloat(f.width_cm ?? '')
                      if (!Number.isFinite(n)) return { ...f, width_unit: u }
                      const v = cur === 'cm' && u === 'mm' ? n * 10 : cur === 'mm' && u === 'cm' ? n / 10 : n
                      return { ...f, width_cm: v.toString(), width_unit: u }
                    })}
                    className={`px-2 py-1.5 rounded-lg text-xs font-bold ${(form.width_unit ?? 'cm') === u ? 'bg-brand-600 text-white' : 'bg-slate-800 text-slate-400'}`}>{u}</button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-[10px] text-slate-500 mb-1">หนา (mc)</label>
              <input value={form.thick_mc ?? ''} onChange={e => setForm(f => ({ ...f, thick_mc: e.target.value }))}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-sm outline-none focus:border-brand-500"/>
            </div>
          </div>

          <div className="grid grid-cols-12 gap-2">
            <div className="col-span-2">
              <label className="block text-[10px] text-slate-500 mb-1">รหัส</label>
              <input value={form.cust_code ?? ''} maxLength={3} onChange={e => setForm(f => ({ ...f, cust_code: e.target.value.slice(0,3) }))}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-sm font-mono outline-none focus:border-brand-500"/>
            </div>
            <div className="col-span-7">
              <label className="block text-[10px] text-slate-500 mb-1">ลูกค้า *</label>
              <input value={form.cust_name ?? ''} onChange={e => setForm(f => ({ ...f, cust_name: e.target.value }))}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-sm outline-none focus:border-brand-500"/>
            </div>
            <div className="col-span-3">
              <label className="block text-[10px] text-slate-500 mb-1">สาขา</label>
              <input value={form.cust_branch ?? ''} onChange={e => setForm(f => ({ ...f, cust_branch: e.target.value }))}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-sm outline-none focus:border-brand-500"/>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] text-slate-500 mb-1">Core (kg)</label>
              <input value={form.core_weight ?? ''} onChange={e => setForm(f => ({ ...f, core_weight: e.target.value }))}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-sm outline-none focus:border-brand-500"/>
            </div>
            <div>
              <label className="block text-[10px] text-slate-500 mb-1">ผู้ตรวจ</label>
              <input value={form.inspector ?? ''} onChange={e => setForm(f => ({ ...f, inspector: e.target.value }))}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-sm outline-none focus:border-brand-500"/>
            </div>
          </div>

        </div>
        <div className="flex gap-2 px-5 py-3 border-t border-slate-800 shrink-0">
          <button onClick={onClose} className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-400 py-2.5 rounded-xl text-sm">ยกเลิก</button>
          <button onClick={save} disabled={saving}
            className="flex-[2] bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white py-2.5 rounded-xl font-bold">
            {saving ? 'กำลังสร้าง...' : '+ สร้างงาน'}
          </button>
        </div>
      </div>
    </div>
  )
}
