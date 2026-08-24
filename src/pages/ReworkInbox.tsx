import { useEffect, useState } from 'react'
import { Wrench, Trash2, Plus, RefreshCw, Search, X, ArrowLeft } from 'lucide-react'
import { supabase, fetchAll } from '../lib/supabase'
import { fetchProducts, type Product } from './Products'
import ExportButton from '../components/ExportButton'

function fmt(n: number | null | undefined, d = 2) {
  if (n == null || isNaN(n as number)) return (0).toFixed(d)
  return (n as number).toLocaleString('th-TH', { minimumFractionDigits: d, maximumFractionDigits: d })
}
function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('th-TH', { timeZone:'Asia/Bangkok', day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' })
}

type Tab = 'queue' | 'working' | 'done'
type InboundType = 'internal' | 'return_no_cn' | 'return_with_cn' | 'qc_reject' | 'warehouse_damage'

// ── Phase 1: Inbound Job Classification ─────────────────────────────────
const INBOUND_TYPES: {
  key: InboundType
  no: string
  label: string
  labelEn: string
  desc: string
  emoji: string
  color: string      // tailwind: border-xxx-500
  ring: string       // border + bg
  badge: string
}[] = [
  { key:'internal',         no:'1.1', label:'งานจากแผนกเป่า',         labelEn:'Internal Production',  desc:'ม้วนกรอที่ผลิตโอนเข้ามา',    emoji:'🏭', color:'border-blue-500',   ring:'bg-blue-500/10 border-blue-500/40 hover:border-blue-400',     badge:'bg-blue-500/20 text-blue-300' },
  { key:'return_no_cn',     no:'1.2', label:'ลูกค้าคืน (ไม่ลดหนี้)',   labelEn:'Return, No CN',        desc:'ส่งคืนลูกค้าโดยตรง ไม่เปิดบิลใหม่', emoji:'↩️', color:'border-amber-500',  ring:'bg-amber-500/10 border-amber-500/40 hover:border-amber-400',  badge:'bg-amber-500/20 text-amber-300' },
  { key:'return_with_cn',   no:'1.3', label:'ลูกค้าคืน (ลดหนี้/NC)',   labelEn:'NC Return, Open CN',   desc:'รับเข้าคลังเป็น NC + เบิกแก้ไข',  emoji:'📋', color:'border-purple-500', ring:'bg-purple-500/10 border-purple-500/40 hover:border-purple-400', badge:'bg-purple-500/20 text-purple-300' },
  { key:'qc_reject',        no:'1.4', label:'ตรวจไม่ผ่านก่อนโหลด',   labelEn:'QC Reject, Warehouse', desc:'ม้วนแกนติด, ม้วนเป็นลอน',     emoji:'🚫', color:'border-orange-500', ring:'bg-orange-500/10 border-orange-500/40 hover:border-orange-400', badge:'bg-orange-500/20 text-orange-300' },
  { key:'warehouse_damage', no:'1.5', label:'เสียหายจากคลัง/เคลื่อนย้าย', labelEn:'Warehouse/Transit',    desc:'แกนเบี้ยว, แกนขึ้น',          emoji:'📦', color:'border-red-500',    ring:'bg-red-500/10 border-red-500/40 hover:border-red-400',       badge:'bg-red-500/20 text-red-300' },
]

function inboundInfo(key?: string | null) {
  return INBOUND_TYPES.find(t => t.key === key) || INBOUND_TYPES[0]
}

export default function ReworkInbox({ onJumpToMachine }: { onJumpToMachine?: (machine: string) => void } = {}) {
  // ใช้ 'internal' (ม้วนจากเป่า) เป็น default — ข้าม Phase 1 selector
  const [selectedType, setSelectedType] = useState<InboundType | null>('internal')
  const [rolls, setRolls] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [showScrap, setShowScrap] = useState<any | null>(null)
  const [showReceive, setShowReceive] = useState<any | null>(null)
  const [showReturn, setShowReturn] = useState<any | null>(null)  // ส่งคืนผลิต — ให้ ผจก พิจารณา
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})
  const [groupBy, setGroupBy] = useState<'item' | 'wo' | 'so'>('item')   // จัดกลุ่มตาม (ค่าเริ่มต้น = สินค้า/ไซส์ — รวมข้าม WO ให้เบิกกรอต่อเนื่อง)
  const [defaultOpen, setDefaultOpen] = useState(false)   // ยุบกลุ่มเป็นค่าเริ่มต้น (ม้วนเยอะ ดูง่าย)
  const [logRows, setLogRows] = useState<any[]>([])   // ประวัติการรับเข้ากรอ (รับไปแล้ว)
  const [showLog, setShowLog] = useState(true)
  const [logSearch, setLogSearch] = useState('')      // ค้นหาใน log
  // ── เบิกม้วน (multi-select) ──
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [withdrawBy, setWithdrawBy] = useState('')
  const [newSystem, setNewSystem]   = useState(true)   // ชุดระบบใหม่ (เลขม้วนนับต่อสินค้า รีเซ็ตตามโอน + ลงสี)
  const [withdrawing, setWithdrawing] = useState(false)

  function toggleSel(id: string) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function toggleMany(ids: string[], on: boolean) {
    setSelected(prev => { const n = new Set(prev); ids.forEach(id => on ? n.add(id) : n.delete(id)); return n })
  }

  // เบิกม้วนที่เลือก → รวมเป็นงานกรอเดียวตาม "สินค้า + ขนาด" (รวมข้าม WO · เลขม้วนเรียงต่อเนื่อง)
  // แต่ละม้วนกรอยังเก็บ WO ต้นทางไว้ (ผูกจากม้วนต้นทาง) — traceability ไม่หาย
  async function withdrawSelected() {
    if (!withdrawBy.trim()) { alert('กรุณากรอกชื่อผู้เบิก'); return }
    const picked = rolls.filter(r => selected.has(r.id))
    if (picked.length === 0) { alert('กรุณาเลือกม้วนที่จะเบิกก่อน (ติ๊ก ☑)'); return }
    setWithdrawing(true)
    const now = new Date().toISOString()
    const jobCache = new Map<string, any>()   // (item_code + ขนาด) → job (กันสร้างซ้ำในรอบเดียว)
    let totalKg = 0
    try {
      for (const r of picked) {
        const ic = (r.item_code ?? '').trim() || '(ไม่ระบุ)'
        const wo = (r.work_order ?? '').trim()
        const sizeKey = `${(r.width_cm ?? '').toString().trim()}x${(r.thick_mc ?? '').toString().trim()}`
        // แยกงานตาม new_system ด้วย — ชุดใหม่/เก่าไม่ปนงานกัน
        const jobKey = `${ic}__${sizeKey}__${newSystem ? 'NS' : 'OLD'}`
        const rollKg = parseFloat((r.weight ?? 0).toFixed(2))
        // ชุดระบบใหม่: เบิกทีละม้วน = 1 งาน/ม้วน (ไม่รวบหลายม้วนเข้างานเดียว)
        // ชุดเก่า: รวบตามสินค้า+ขนาด (cache → DB) เหมือนเดิม
        let job = newSystem ? null : (jobCache.get(jobKey) ?? null)
        if (!job && !newSystem) {
          const { data: existing } = await supabase.from('rework_jobs').select('*')
            .eq('status', 'active').eq('source', 'from_production').eq('item_code', ic)
            .eq('width_cm', r.width_cm ?? '').eq('thick_mc', r.thick_mc ?? '')
            .eq('new_system', newSystem).limit(1)
          job = existing?.[0] ?? null
        }
        if (job) {
          await supabase.from('rework_jobs').update({
            planned_qty:       ((parseFloat(job.planned_qty ?? '0') || 0) + rollKg).toFixed(2),
            source_roll_count: (job.source_roll_count ?? 0) + 1,
            new_system:        newSystem,
          }).eq('id', job.id)
          job.planned_qty = ((parseFloat(job.planned_qty ?? '0') || 0) + rollKg).toFixed(2)
          job.source_roll_count = (job.source_roll_count ?? 0) + 1
        } else {
          const { data: created, error: cErr } = await supabase.from('rework_jobs').insert({
            lot_no: '', sale_order: r.sale_order ?? '', work_order: r.work_order ?? '',
            item_code: ic === '(ไม่ระบุ)' ? '' : ic, mat_code: r.mat_code ?? '', product_code: r.product_code ?? '',
            product_name: r.product_name ?? '', width_cm: r.width_cm ?? '', width_unit: r.width_unit ?? 'cm',
            thick_mc: r.thick_mc ?? '', cust_code: r.cust_code ?? '', cust_name: r.customer ?? '',
            cust_branch: r.cust_branch ?? '', core_weight: ((r.core_weight ?? '').toString().trim() || '1.25'), decimal_places: 2,
            planned_qty: rollKg.toString(), inspector: withdrawBy.trim(), label_size: 'long',
            // ✨ หัวใบของผลิต ติดมากับงานกรอ → ใบที่ปริ้นจากกรอ หัวบริษัทเหมือนใบผลิต
            header_text: r.header_text ?? '', blank_header: r.blank_header ?? false,
            source: 'from_production', source_roll_id: r.id, source_lot_no: (r.lot_no ?? '').trim(),
            source_roll_count: 1, source_defect_reason: r.remark ?? '',
            status: 'active', created_by: withdrawBy.trim(), created_at: now,
            new_system: newSystem,
          }).select().single()
          if (cErr) throw cErr
          job = created
        }
        if (!newSystem) jobCache.set(jobKey, job)   // ชุดใหม่ไม่ cache → ม้วนถัดไปสร้างงานใหม่
        // mark ม้วนต้นทาง = reworking
        await supabase.from('production_rolls').update({
          rework_status: 'reworking', rework_received_by: withdrawBy.trim(), rework_received_at: now,
          rework_remark: `เบิกเข้างานกรอ (สินค้า ${ic}${wo ? ` · WO ${wo}` : ''})`,
          new_system: newSystem,
        }).eq('id', r.id)
        // บันทึกประวัติเบิก
        await supabase.from('rework_withdrawals').insert({
          job_id: job.id, source_roll_id: r.id, withdrawn_by: withdrawBy.trim(),
          weight: rollKg, item_code: ic === '(ไม่ระบุ)' ? '' : ic, product_name: r.product_name ?? '',
          lot_no: r.lot_no ?? '', work_order: r.work_order ?? '', sale_order: r.sale_order ?? '',
        })
        totalKg += rollKg
      }
      alert(`✓ เบิกม้วนเรียบร้อย ${picked.length} ม้วน · รวม ${fmt(totalKg)} Kg\nผู้เบิก: ${withdrawBy.trim()}\n\n→ ไปหน้า "ชั่งน้ำหนัก" (แผนกกรอ) → คลิกการ์ดงานของสินค้านั้น → เลือกเครื่อง → ชั่งม้วนใหม่`)
      setSelected(new Set()); setWithdrawBy('')
      load()
    } catch (e: any) {
      alert('เบิกไม่สำเร็จ: ' + (e?.message ?? e))
    } finally {
      setWithdrawing(false)
    }
  }

  async function load() {
    if (!selectedType) return
    setLoading(true)
    // โหลดม้วน bad ทุกใบ (ไม่ต้องรอกดโอนเป็นทางการ — ม้วนกรอ = รอแก้ทันที)
    const allData = await fetchAll(() => supabase.from('production_rolls').select('*')
      .eq('roll_type', 'bad').order('created_at', { ascending: false }))
    const allRows = (allData ?? []).filter(r => !r.is_legacy)

    // queue เท่านั้น — ม้วนเสียที่รอตัดสินใจ (ยังไม่เริ่มกรอ)
    const filtered = allRows.filter(r => !r.rework_status || r.rework_status === 'pending')
    setRolls(filtered)

    // log — ม้วนที่ "รับเข้ากรอ" ไปแล้ว (มี rework_status ที่ไม่ใช่ pending)
    const log = allRows
      .filter(r => r.rework_status && r.rework_status !== 'pending')
      .sort((a, b) => (b.rework_received_at || b.created_at || '').localeCompare(a.rework_received_at || a.created_at || ''))
    setLogRows(log)
    setLoading(false)
  }

  const reworkStatusLabel = (s?: string) => {
    switch (s) {
      case 'reworking': return { txt: '🔧 กำลังกรอ', cls: 'bg-blue-500/20 text-blue-300' }
      case 'reworked':  return { txt: '✓ กรอสำเร็จ', cls: 'bg-green-500/20 text-green-300' }
      case 'scrapped':  return { txt: '🗑 ทำลาย', cls: 'bg-red-500/20 text-red-300' }
      default:          return { txt: s || '—', cls: 'bg-slate-700 text-slate-300' }
    }
  }

  useEffect(() => { load() }, [selectedType])

  // ── โหลดจำนวนต่อประเภท (สำหรับ badge บนการ์ด) ─────────────────────
  const [counts, setCounts] = useState<Record<InboundType, number>>({
    internal:0, return_no_cn:0, return_with_cn:0, qc_reject:0, warehouse_damage:0,
  })
  useEffect(() => {
    fetchAll(() => supabase.from('production_rolls')
      .select('inbound_type, rework_status, transferred')
      .eq('roll_type', 'bad'))
      .then((data) => {
        const c: Record<InboundType, number> = { internal:0, return_no_cn:0, return_with_cn:0, qc_reject:0, warehouse_damage:0 }
        for (const r of data ?? []) {
          // ม้วนกรอทุกใบที่ยังไม่ปิดงาน (ไม่ต้องรอกดโอน)
          const isQueue = (!r.rework_status || r.rework_status === 'pending')
          const isWorking = r.rework_status === 'reworking'
          if (!isQueue && !isWorking) continue
          const t = (r.inbound_type ?? 'internal') as InboundType
          if (c[t] !== undefined) c[t] += 1
        }
        setCounts(c)
      })
  }, [rolls.length])

  const filtered = rolls.filter(r => {
    if (!search) return true
    const w = (r.width_cm ?? '').toString().trim()
    const t = (r.thick_mc ?? '').toString().trim()
    const sizeBlob = w || t ? `${w}x${t} ${w}*${t} ${w} ${t}` : ''
    const blob = `${r.machine_no} ${r.lot_no} ${r.work_order} ${r.sale_order} ${r.product_name} ${r.customer} ${r.item_code} ${r.mat_code} ${sizeBlob}`.toLowerCase()
    return blob.includes(search.toLowerCase())
  })

  // ── หน้าแรก: เลือกประเภทแหล่งที่มา ─────────────────────────────────
  if (!selectedType) {
    return (
      <div className="min-h-[calc(100vh-48px)] bg-[#0a0f1e] p-5">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-6">
            <h1 className="text-white font-bold text-2xl flex items-center justify-center gap-2 mb-1">
              <Wrench size={26} className="text-amber-400"/> แผนกกรอ (Rewinding &amp; Slitting)
            </h1>
            <p className="text-slate-400 text-sm">เลือกประเภทแหล่งที่มาของม้วน (Phase 1: Inbound Job Classification)</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {INBOUND_TYPES.map(t => (
              <button key={t.key} onClick={() => setSelectedType(t.key)}
                className={`relative text-left p-5 rounded-2xl border-2 transition-all duration-200 hover:scale-[1.02] hover:shadow-xl ${t.ring}`}>
                <div className="flex items-start gap-3">
                  <span className="text-4xl">{t.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-[10px] font-black px-1.5 py-0.5 rounded ${t.badge}`}>{t.no}</span>
                      {counts[t.key] > 0 && (
                        <span className="text-[10px] font-black bg-red-500 text-white px-1.5 py-0.5 rounded-full animate-pulse">
                          {counts[t.key]} ม้วน
                        </span>
                      )}
                    </div>
                    <p className="text-white font-bold text-sm leading-tight">{t.label}</p>
                    <p className="text-slate-500 text-[10px] mb-2">{t.labelEn}</p>
                    <p className="text-slate-400 text-xs leading-snug">{t.desc}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>

          <div className="mt-6 bg-slate-900/50 border border-slate-800 rounded-xl p-4 text-xs text-slate-400 space-y-1.5">
            <p className="text-amber-300 font-bold">💡 ขั้นตอนการทำงาน:</p>
            <p><b className="text-blue-300">Phase 1</b> — เลือกประเภทแหล่งที่มา → <b className="text-purple-300">Phase 2</b> เบิกม้วนเข้าระบบ → <b className="text-orange-300">Phase 3</b> กรอ/แก้ไข + ชั่งร่วม QC → <b className="text-green-300">Phase 4</b> ส่งออก (คลัง/ลูกค้า/ต้นทาง) หรือ <b className="text-red-300">ทำลาย</b></p>
          </div>
        </div>
      </div>
    )
  }

  const cat = inboundInfo(selectedType)

  // ค้นหาใน log (ผู้เบิก/ม้วน/WO/SO/สินค้า/เหตุ/เครื่อง)
  const lq = logSearch.trim().toLowerCase()
  const filteredLog = lq ? logRows.filter(r =>
    [r.rework_received_by, r.transferred_by, r.roll_no, r.work_order, r.sale_order, r.product_name, r.remark, r.machine_no, r.customer]
      .some(v => (v ?? '').toString().toLowerCase().includes(lq))) : logRows

  return (
    <div className="bg-[#0a0f1e] p-5">
      <div className="max-w-6xl mx-auto space-y-4 pb-24">

        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-white font-bold text-xl flex items-center gap-2">
              <Wrench size={22} className="text-amber-400"/> เบิกม้วนกรอ — แผนกกรอ
            </h1>
            <p className="text-slate-400 text-xs mt-0.5">
              🏭 ☑ ติ๊กม้วนที่จะกรอ → ใส่ชื่อผู้เบิก → กด "เบิก" (รวมเป็นงานกรอตามสินค้า) → ไปชั่งที่เมนู "ชั่งน้ำหนัก"
            </p>
          </div>
          <div className="flex gap-2">
            <ExportButton rows={filtered}
              cols={[
                { header:'วันที่', value: r => fmtDateTime(r.rework_received_at || r.created_at), width:18 },
                { header:'เครื่องเดิม', value:'machine_no' },
                { header:'WO', value: r => r.work_order ?? '' },
                { header:'SO', value: r => r.sale_order ?? '' },
                { header:'Lot', value:'lot_no', width:16 },
                { header:'ม้วนที่', value:'roll_no' },
                { header:'สินค้า', value:'product_name', width:30 },
                { header:'ลูกค้า', value:'customer', width:24 },
                { header:'น้ำหนัก (kg)', value:'weight' },
                { header:'เหตุผลกรอ', value:'remark', width:30 },
              ]}
              fileName="ม้วนรอกรอ" sheetName="รอกรอ"
              label="📥 Export รอกรอ" />
            <button onClick={load}
              className="flex items-center gap-1.5 text-slate-400 hover:text-white text-xs bg-slate-800 hover:bg-slate-700 px-3 py-2 rounded-lg">
              <RefreshCw size={12}/> รีเฟรช
            </button>
          </div>
        </div>

        {/* ── แบนเนอร์แจ้งเตือน: มีม้วนรอกรอหรือไม่ (เห็นชัดทันที) ── */}
        {(() => {
          const waiting = rolls.length
          const waitingKg = rolls.reduce((s, r) => s + (r.weight ?? 0), 0)
          const woCount = new Set(rolls.map(r => (r.work_order ?? '').trim() || '(ไม่ระบุ)')).size
          if (loading) return null
          if (waiting === 0) {
            return (
              <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 flex items-center gap-2">
                <span className="text-base">✅</span>
                <p className="text-emerald-300 font-bold text-sm">ไม่มีม้วนรอกรอ <span className="text-emerald-400/70 font-normal">— เคลียร์งานหมดแล้ว</span></p>
              </div>
            )
          }
          return (
            <div className="rounded-xl border border-amber-500/50 bg-amber-500/10 px-4 py-2 flex items-center gap-3 flex-wrap">
              <span className="text-xl">🔔</span>
              <p className="text-amber-200 font-bold text-sm flex-1 min-w-[140px]">
                มีม้วนรอกรอ <b className="text-base">{waiting}</b> ม้วน · <span className="text-orange-300">{fmt(waitingKg, 0)} Kg</span>
              </p>
              <span className="text-[11px] text-amber-300/70">{woCount} ใบสั่งผลิต · แผนกผลิตส่งมาแล้ว</span>
            </div>
          )
        })()}

        {/* Search */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"/>
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="ค้นหา WO/SO/Lot/สินค้า/ลูกค้า/ขนาด..."
              className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-9 pr-3 py-1.5 text-sm text-white outline-none focus:border-amber-500"/>
          </div>
          {/* เลือกการจัดกลุ่ม */}
          <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 rounded-lg p-1">
            <span className="text-[10px] text-slate-500 px-1">กลุ่มตาม:</span>
            {([['item','📦 สินค้า'],['wo','📋 WO'],['so','🧾 SO']] as const).map(([k, label]) => (
              <button key={k} onClick={() => setGroupBy(k)}
                className={`text-xs font-bold px-2.5 py-1 rounded transition-colors ${groupBy === k ? 'bg-amber-500 text-white' : 'text-slate-400 hover:bg-slate-800'}`}>
                {label}
              </button>
            ))}
          </div>
          <button onClick={() => { setOpenGroups({}); setDefaultOpen(v => !v) }}
            className="text-xs font-bold px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:bg-slate-800 whitespace-nowrap">
            {defaultOpen ? '▲ ยุบทั้งหมด' : '▼ ขยายทั้งหมด'}
          </button>
        </div>

        {/* List */}
        {(
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
            <p className="text-white font-semibold text-sm">📥 ม้วนเสียจากผลิต — รอตัดสินใจ</p>
            <span className="text-slate-500 text-xs">{filtered.length} รายการ · รวม {fmt(filtered.reduce((s, r) => s + (r.weight ?? 0), 0))} Kg</span>
          </div>

          {loading ? (
            <div className="py-16 text-center text-slate-500 text-sm">กำลังโหลด...</div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center text-slate-600">ไม่มีรายการ</div>
          ) : (() => {
            // จัดกลุ่มตามที่เลือก: สินค้า (item) / WO / SO
            const keyOf = (r: any) =>
              groupBy === 'wo' ? ((r.work_order ?? '').trim() || '(ไม่ระบุ WO)')
              : groupBy === 'so' ? ((r.sale_order ?? '').trim() || '(ไม่ระบุ SO)')
              : ((r.item_code ?? '').trim() || (r.product_name ?? '').trim() || '(ไม่ระบุสินค้า)')
            const map = new Map<string, any[]>()
            for (const r of filtered) {
              const key = keyOf(r)
              if (!map.has(key)) map.set(key, [])
              map.get(key)!.push(r)
            }
            const groups = [...map.entries()].map(([key, items]) => ({
              key, items,
              totalKg: items.reduce((s, x) => s + (x.weight ?? 0), 0),
              prod: items.find(x => x.product_name)?.product_name ?? '',
              item: items.find(x => x.item_code)?.item_code ?? '',
              cust: items.find(x => x.customer)?.customer ?? '',
              title: groupBy === 'wo' ? `📋 WO ${key}` : groupBy === 'so' ? `🧾 SO ${key}` : (items.find(x => x.product_name)?.product_name ?? key),
              latest: items.reduce((mx, x) => {
                const t = x.rework_received_at || x.created_at || ''
                return t > mx ? t : mx
              }, ''),
            })).sort((a, b) => b.latest.localeCompare(a.latest))

            return (
              <div className="divide-y divide-slate-800/50">
                {groups.map(g => {
                  const gKey = `prod:${g.key}`
                  const open = openGroups[gKey] ?? defaultOpen
                  const allSel = g.items.length > 0 && g.items.every(x => selected.has(x.id))
                  const rows = [...g.items].sort((a, b) =>
                    (b.rework_received_at || b.created_at || '').localeCompare(a.rework_received_at || a.created_at || ''))
                  return (
                    <div key={g.key} className="bg-slate-900">
                      {/* ── หัวกลุ่มสินค้า ── */}
                      <div className="flex items-center gap-3 px-4 py-3 border-l-4 border-amber-500">
                        <input type="checkbox" checked={allSel} className="w-4 h-4 shrink-0"
                          onChange={e => toggleMany(g.items.map(x => x.id), e.target.checked)} title="เลือกทั้งสินค้า"/>
                        <button onClick={() => setOpenGroups(p => ({ ...p, [gKey]: !open }))}
                          className="flex-1 flex items-center gap-2 text-left min-w-0">
                          <span className="text-amber-400 text-sm">{open ? '▼' : '▶'}</span>
                          <div className="min-w-0">
                            <p className="text-white font-bold text-sm truncate">{g.title}</p>
                            <p className="text-xs text-slate-500 truncate">
                              {groupBy !== 'item' && g.prod ? `${g.prod} · ` : ''}{g.cust}{g.item && <span className="font-mono"> · {g.item}</span>}
                            </p>
                          </div>
                        </button>
                        <div className="text-right shrink-0">
                          <p className="text-orange-300 font-black text-base leading-none">{fmt(g.totalKg)} <span className="text-[10px] text-slate-500 font-normal">Kg</span></p>
                          <p className="text-[10px] text-slate-500">{g.items.length} ม้วน</p>
                        </div>
                      </div>

                      {/* ── แถวม้วน (คลิกทั้งแถวเพื่อเลือก) ── */}
                      {open && rows.map(r => {
                        const sel = selected.has(r.id)
                        return (
                          <div key={r.id} onClick={() => toggleSel(r.id)}
                            className={`flex items-center gap-3 px-4 py-2 cursor-pointer border-t border-slate-800/30 transition-colors ${sel ? 'bg-blue-500/15' : 'hover:bg-slate-800/30'}`}>
                            <input type="checkbox" checked={sel} onClick={e => e.stopPropagation()} onChange={() => toggleSel(r.id)} className="w-4 h-4 shrink-0"/>
                            <div className="w-16 shrink-0 text-right leading-none">
                              <p className="text-orange-300 font-black text-lg">{fmt(r.weight)}</p>
                              <p className="text-[9px] text-slate-500">Kg</p>
                            </div>
                            <div className="shrink-0 text-center bg-slate-800 rounded-lg px-2 py-1 w-14">
                              <p className="text-[8px] text-slate-500 leading-none">ม้วนที่</p>
                              <p className="text-white font-black text-base leading-tight">{r.roll_no}</p>
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap text-[10px] mb-0.5">
                                {(() => {
                                  const ti = inboundInfo(r.inbound_type)
                                  return <span className={`px-1.5 py-0.5 rounded font-bold ${ti.badge}`} title={ti.desc}>{ti.emoji} {ti.label}</span>
                                })()}
                                {(r.review_status === 'approved_rework' || r.review_decision_by) && (
                                  <span className="bg-purple-500/20 text-purple-200 px-1.5 py-0.5 rounded font-bold"
                                    title={`ผจก พิจารณาให้กรอ${r.review_decision_by ? ' · โดย '+r.review_decision_by : ''}${r.review_decision_at ? ' · '+fmtDateTime(r.review_decision_at) : ''}${r.review_action_reason ? '\nเหตุผล: '+r.review_action_reason : ''}`}>
                                    ⚖ ผจก พิจารณา{r.review_decision_by ? ` (${r.review_decision_by})` : ''}
                                  </span>
                                )}
                                {r.work_order && <span className="bg-amber-500/15 text-amber-300 px-1.5 py-0.5 rounded font-bold">WO {r.work_order}</span>}
                                {r.sale_order && <span className="bg-blue-500/15 text-blue-300 px-1.5 py-0.5 rounded font-bold">SO {r.sale_order}</span>}
                                {(r.width_cm || r.thick_mc) && <span className="bg-brand-500/20 text-brand-200 px-1.5 py-0.5 rounded font-bold">{(r.width_cm ?? '')}{r.thick_mc ? `×${r.thick_mc}` : ''}</span>}
                                <span className="font-mono text-slate-500">Lot {r.lot_no}</span>
                                <span className="text-slate-600">· เครื่อง {r.machine_no || '—'}</span>
                                <span className="text-slate-600">· {fmtDateTime(r.rework_received_at || r.created_at)}</span>
                                {r.is_legacy && <span className="text-purple-300">(เก่า)</span>}
                              </div>
                              <p className="text-xs text-slate-400 truncate" title={r.remark}>⚠ เหตุผล: {r.remark || '—'}</p>
                            </div>
                            <div className="flex gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                              <button onClick={() => setShowReturn(r)} title="ส่งคืนผลิต" className="text-[11px] bg-amber-600/80 hover:bg-amber-500 text-white px-2 py-1.5 rounded font-bold">↩</button>
                              <button onClick={() => setShowScrap(r)} title="ทำลายเป็นเศษ" className="text-[11px] bg-red-600/80 hover:bg-red-500 text-white px-2 py-1.5 rounded font-bold">🗑</button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            )
          })()}
        </div>
        )}

        {/* ── LOG: ประวัติการรับเข้ากรอ ─────────────────────────── */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
          <button onClick={() => setShowLog(v => !v)}
            className="w-full px-4 py-3 border-b border-slate-800 flex items-center justify-between hover:bg-slate-800/40 transition-colors text-left">
            <p className="text-white font-semibold text-sm flex items-center gap-2">
              <span className="text-emerald-400">{showLog ? '▼' : '▶'}</span>
              📋 ประวัติการรับเข้ากรอ (Log) — รับอะไรมา เท่าไหร่
            </p>
            <span className="flex items-center gap-2">
              <span className="text-slate-500 text-xs">
                {lq ? `${filteredLog.length}/${logRows.length}` : logRows.length} รายการ · รวม {fmt(filteredLog.reduce((s, r) => s + (r.weight ?? 0), 0))} Kg
              </span>
              <span onClick={e => e.stopPropagation()}>
                <ExportButton rows={filteredLog}
                  cols={[
                    { header:'รับเมื่อ', value: r => fmtDateTime(r.rework_received_at || r.created_at), width:18 },
                    { header:'ผู้เบิก', value: r => r.rework_received_by || r.transferred_by || '' },
                    { header:'ม้วนที่', value:'roll_no' },
                    { header:'WO', value:'work_order' },
                    { header:'SO', value:'sale_order' },
                    { header:'สินค้า', value:'product_name', width:30 },
                    { header:'ขนาด', value: r => r.width_cm && r.thick_mc ? `${r.width_cm}${r.width_unit ?? 'cm'}×${r.thick_mc}mc` : '', width:14 },
                    { header:'ลูกค้า', value:'customer', width:24 },
                    { header:'น้ำหนัก (kg)', value:'weight' },
                    { header:'เหตุ', value:'remark', width:24 },
                    { header:'เครื่องเดิม', value:'machine_no' },
                    { header:'สถานะ', value: r => reworkStatusLabel(r.rework_status).txt.replace(/[^฀-๿a-zA-Z ]/g,'').trim() },
                  ]}
                  fileName="ประวัติรับเข้ากรอ" sheetName="Log รับกรอ"
                  label="📥 Export Log"
                  className="flex items-center gap-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white px-2.5 py-1 rounded text-xs font-bold" />
              </span>
            </span>
          </button>

          {showLog && (
            logRows.length === 0 ? (
              <div className="py-10 text-center text-slate-600 text-sm">ยังไม่มีประวัติการรับเข้ากรอ</div>
            ) : (
              <div>
                <div className="px-3 py-2 border-b border-slate-800 bg-slate-900/40">
                  <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"/>
                    <input value={logSearch} onChange={e => setLogSearch(e.target.value)}
                      placeholder="ค้นหาใน log — ผู้เบิก / ม้วน / WO / SO / สินค้า / เหตุ / เครื่อง..."
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-9 pr-8 py-2 text-sm text-white outline-none focus:border-emerald-500 placeholder-slate-500"/>
                    {logSearch && <button onClick={() => setLogSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"><X size={14}/></button>}
                  </div>
                </div>
                <div className="overflow-auto max-h-[60vh]">
                {filteredLog.length === 0 ? (
                  <div className="py-10 text-center text-slate-600 text-sm">ไม่พบรายการที่ค้นหา "{logSearch}"</div>
                ) : (
                <table className="w-full text-sm">
                  <thead className="text-[10px] text-slate-500 uppercase tracking-wider border-b border-slate-800 bg-slate-900 sticky top-0 z-10">
                    <tr>
                      {['รับเมื่อ','👤 ผู้เบิก','ม้วนที่','WO','SO','สินค้า','ขนาด','นน. (Kg)','เหตุ','เครื่องเดิม','สถานะ'].map(h => (
                        <th key={h} className="px-3 py-2 text-left font-semibold whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/40">
                    {filteredLog.map(r => {
                      const st = reworkStatusLabel(r.rework_status)
                      const sz = r.width_cm && r.thick_mc ? `${r.width_cm}${r.width_unit ?? 'cm'}×${r.thick_mc}mc` : '—'
                      return (
                        <tr key={r.id} className="hover:bg-slate-800/30">
                          <td className="px-3 py-1.5 text-slate-400 whitespace-nowrap text-xs">{fmtDateTime(r.rework_received_at || r.created_at)}</td>
                          <td className="px-3 py-1.5 whitespace-nowrap"><span className="text-emerald-300 font-bold text-xs bg-emerald-500/10 px-2 py-0.5 rounded">{r.rework_received_by || r.transferred_by || '—'}</span></td>
                          <td className="px-3 py-1.5 text-white font-bold whitespace-nowrap">#{r.roll_no ?? '—'}</td>
                          <td className="px-3 py-1.5 text-amber-300 text-xs whitespace-nowrap">{r.work_order || '—'}</td>
                          <td className="px-3 py-1.5 text-blue-300 text-xs whitespace-nowrap">{r.sale_order || '—'}</td>
                          <td className="px-3 py-1.5 text-slate-300 text-xs max-w-[180px] truncate" title={r.product_name}>{r.product_name || '—'}</td>
                          <td className="px-3 py-1.5 text-brand-300 text-xs whitespace-nowrap">{sz}</td>
                          <td className="px-3 py-1.5 text-orange-300 font-bold whitespace-nowrap">{fmt(r.weight)}</td>
                          <td className="px-3 py-1.5 text-rose-300/80 text-xs max-w-[160px] truncate" title={r.remark}>{r.remark || '—'}</td>
                          <td className="px-3 py-1.5 text-slate-400 font-bold whitespace-nowrap">{r.machine_no || '—'}</td>
                          <td className="px-3 py-1.5"><span className={`text-[10px] font-bold px-2 py-0.5 rounded whitespace-nowrap ${st.cls}`}>{st.txt}</span></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                )}
                </div>
              </div>
            )
          )}
        </div>

      </div>

      {/* ── แถบเบิกม้วน (ลอยล่าง โผล่เมื่อเลือก) ── */}
      {selected.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-slate-900 border-t-2 border-blue-500 shadow-2xl px-5 py-3">
          <div className="max-w-6xl mx-auto flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-3xl font-black text-blue-300">{selected.size}</span>
              <div className="leading-tight">
                <p className="text-white text-sm font-bold">ม้วนที่เลือกเบิก</p>
                <p className="text-slate-400 text-xs">รวม {fmt(rolls.filter(r => selected.has(r.id)).reduce((s, r) => s + (r.weight ?? 0), 0))} Kg</p>
              </div>
            </div>
            <button onClick={() => setSelected(new Set())} className="text-xs text-slate-400 hover:text-white underline">ล้าง</button>
            <label className={`flex items-center gap-1.5 text-xs font-bold cursor-pointer px-2.5 py-1.5 rounded-lg border ${newSystem ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50' : 'bg-slate-800 text-slate-400 border-slate-700'}`}>
              <input type="checkbox" checked={newSystem} onChange={e => setNewSystem(e.target.checked)} />
              ✨ ชุดระบบใหม่
            </label>
            <div className="flex-1 min-w-[180px]">
              <input value={withdrawBy} onChange={e => setWithdrawBy(e.target.value)}
                placeholder="ชื่อผู้เบิก *"
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-blue-500"/>
            </div>
            <button onClick={withdrawSelected} disabled={withdrawing}
              className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white px-6 py-2.5 rounded-lg text-sm font-black flex items-center gap-2">
              {withdrawing ? 'กำลังเบิก...' : <>📥 เบิก {selected.size} ม้วน → สร้างงานกรอ</>}
            </button>
          </div>
        </div>
      )}

      {/* Modal: เริ่มกรอ (กรอกผู้รับ) */}
      {showReceive && (
        <ReceiveModal roll={showReceive} onClose={() => { setShowReceive(null); load() }}/>
      )}

      {/* Modal: คืนเป่า (ทำลาย) */}
      {showScrap && (
        <ScrapModal roll={showScrap} onClose={() => { setShowScrap(null); load() }}/>
      )}

      {/* Modal: ส่งคืนผลิต — กลับไปอยู่ที่ "รอ ผจก พิจารณา" */}
      {showReturn && (
        <ReturnToProductionModal
          roll={showReturn}
          onClose={() => { setShowReturn(null); load() }}
        />
      )}

    </div>
  )
}

// ─── ส่งคืนผลิต — แผนกกรอตรวจสอบแล้วว่ากรอไม่ได้ ─────────────────────────────
function ReturnToProductionModal({ roll, onClose }: { roll: any; onClose: () => void }) {
  const [reason, setReason] = useState('')
  const [by, setBy] = useState('')
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!reason.trim()) { alert('กรอกเหตุผลที่ส่งคืน'); return }
    if (!by.trim())     { alert('กรอกชื่อผู้ส่งคืน'); return }
    setSaving(true)
    const newRemark = `[แผนกกรอส่งคืน: ${reason.trim()}] ` + (roll.remark || '')
    const { error } = await supabase.from('production_rolls').update({
      review_status:        'pending_review',
      review_action:        null,
      review_action_reason: null,
      review_decision_by:   null,
      review_decision_at:   null,
      // ยกเลิก rework chain — กลับไปอยู่ในงานเดิม
      rework_status:        null,
      rework_received_by:   null,
      rework_received_at:   null,
      rework_remark:        null,
      inbound_type:         null,
      // ปลด transferred → กลับไปอยู่ในงานเดิม (ผลิตจะเห็นในคอลัมน์ "รอ ผจก")
      transferred:          false,
      transferred_by:       null,
      transferred_at:       null,
      transfer_doc_id:      null,
      remark:               newRemark,
    }).eq('id', roll.id)
    setSaving(false)
    if (error) { alert('ส่งคืนไม่สำเร็จ: ' + error.message); return }
    alert(`✓ ส่งคืนม้วน #${roll.roll_no} (${roll.weight} Kg) ไปที่ "รอ ผจก พิจารณา" ของงาน ${roll.machine_no} · Lot ${roll.lot_no} แล้ว`)
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-amber-500/40 rounded-2xl w-full max-w-md p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <p className="text-white font-bold flex items-center gap-2">↩ ส่งคืนผลิต (รอพิจารณาใหม่)</p>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={18}/></button>
        </div>

        <div className="bg-slate-800/50 rounded-lg p-3 mb-3 text-xs space-y-0.5">
          <p className="text-slate-400">เครื่องเดิม: <b className="text-white">{roll.machine_no}</b> · Lot: <b className="text-white font-mono">{roll.lot_no}</b></p>
          <p className="text-slate-400">ม้วน <b className="text-white">#{roll.roll_no}</b> · นน. <b className="text-orange-300">{fmt(roll.weight)} Kg</b></p>
          <p className="text-slate-400">สินค้า: <b className="text-white">{roll.product_name || '—'}</b></p>
          <p className="text-slate-400">เหตุผลเดิม: <b className="text-slate-200">{roll.remark || '—'}</b></p>
        </div>

        <label className="block text-xs text-slate-400 mb-1">เหตุผลที่กรอไม่ได้ *</label>
        <input value={reason} onChange={e => setReason(e.target.value)}
          placeholder="เช่น สีเพี้ยน, ขอบเสีย, ม้วนไม่ตรง, ไม่มีฉลาก..."
          autoFocus
          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-amber-500 mb-3"/>

        <label className="block text-xs text-slate-400 mb-1">ชื่อผู้ส่งคืน (แผนกกรอ) *</label>
        <input value={by} onChange={e => setBy(e.target.value)}
          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-amber-500"/>

        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-2.5 mt-3 text-xs text-amber-200">
          💡 ม้วนนี้จะกลับไปอยู่ในคอลัมน์ <b>"รอ ผจก พิจารณา"</b> ของงานเดิม ({roll.machine_no} · Lot {roll.lot_no}) — รอ ผจก ตัดสินใจอีกครั้ง
        </div>

        <div className="flex gap-2 mt-4">
          <button onClick={onClose} className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 py-2.5 rounded-lg text-sm">ยกเลิก</button>
          <button onClick={save} disabled={saving} className="flex-1 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white py-2.5 rounded-lg text-sm font-bold">
            {saving ? 'กำลังส่งคืน...' : '↩ ส่งคืนผลิต'}
          </button>
        </div>
      </div>
    </div>
  )
}


// ─── เริ่มกรอ — สร้าง rework_job (ไม่ผูกเครื่อง — เลือกเครื่องตอนชั่ง) ──
function ReceiveModal({ roll, onClose }: { roll: any; onClose: () => void }) {
  const [by, setBy] = useState('')
  const [reworkReason, setReworkReason] = useState('')
  const [rewinder, setRewinder] = useState('')
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!by.trim()) { alert('กรอกชื่อผู้รับ'); return }
    if (!reworkReason.trim()) { alert('กรอกสาเหตุ/วิธีที่กรอได้'); return }
    setSaving(true)
    const rollKg = parseFloat((roll.weight ?? 0).toFixed(2))

    // 0) เช็คว่ามีงานกรอ active ของ Lot ผลิตเดียวกันอยู่แล้วไหม → ถ้ามี รวมเข้างานเดิม (1 งานต่อ 1 Lot ต้นทาง)
    const srcLot = (roll.lot_no ?? '').trim()
    let mergedInto: any = null
    if (srcLot) {
      const { data: existing } = await supabase.from('rework_jobs')
        .select('*')
        .eq('status', 'active')
        .eq('source', 'from_production')
        .eq('source_lot_no', srcLot)
        .limit(1)
      mergedInto = existing && existing[0] ? existing[0] : null
    }

    let jobErr: any = null
    if (mergedInto) {
      // รวมม้วน: บวกเป้าผลิต + เพิ่มจำนวนม้วน
      const prevQty   = parseFloat(mergedInto.planned_qty ?? '0') || 0
      const prevCount = mergedInto.source_roll_count ?? 1
      const { error } = await supabase.from('rework_jobs').update({
        planned_qty:      (prevQty + rollKg).toFixed(2),
        source_roll_count: prevCount + 1,
      }).eq('id', mergedInto.id)
      jobErr = error
    } else {
      // สร้าง rework_job ใหม่ (operator จะเลือกเครื่องตอนเข้าชั่ง)
      const { error } = await supabase.from('rework_jobs').insert({
        lot_no:        '',  // สร้างตอนเลือกเครื่อง (yy+เครื่อง+ลูกค้า+เดือน)
        sale_order:    roll.sale_order ?? '',
        work_order:    roll.work_order ?? '',
        item_code:     roll.item_code  ?? '',
        mat_code:      roll.mat_code   ?? '',
        product_code:  roll.product_code ?? '',
        product_name:  roll.product_name ?? '',
        width_cm:      roll.width_cm   ?? '',
        width_unit:    roll.width_unit ?? 'cm',
        thick_mc:      roll.thick_mc   ?? '',
        cust_code:     roll.cust_code  ?? '',
        cust_name:     roll.customer   ?? '',
        cust_branch:   roll.cust_branch ?? '',
        core_weight:   ((roll.core_weight ?? '').toString().trim() || '1.25'),
        decimal_places: 2,
        planned_qty:   rollKg.toString(),
        inspector:     by.trim(),
        label_size:    'long',
        // ✨ หัวใบของผลิต ติดมากับงานกรอ → ใบที่ปริ้นจากกรอ หัวบริษัทเหมือนใบผลิต
        header_text:   roll.header_text  ?? '',
        blank_header:  roll.blank_header ?? false,
        source:        'from_production',
        source_roll_id: roll.id,
        source_lot_no:  srcLot,                   // Lot ต้นทาง — ใช้รวมม้วน Lot เดียวกัน
        source_roll_count: 1,
        source_defect_reason: roll.remark ?? '',  // สาเหตุที่ม้วนเสีย (จาก ม้วนต้นทาง)
        rework_reason: reworkReason.trim(),       // สาเหตุ/วิธีที่กรอได้
        rewinder_name: rewinder.trim() || by.trim(),  // คนกรอ (ถ้าไม่กรอก = คนรับ)
        status:        'active',
        created_by:    by.trim(),
        created_at:    new Date().toISOString(),
      })
      jobErr = error
    }

    // 2) mark ม้วนต้นทาง = reworking
    const { error } = await supabase.from('production_rolls')
      .update({
        rework_status:      'reworking',
        rework_received_by: by.trim(),
        rework_received_at: new Date().toISOString(),
        rework_remark:      mergedInto ? `รวมเข้างานกรอ Lot ${srcLot} (เดิม)` : `สร้าง rework_job (รอเลือกเครื่อง/Lot ตอนชั่ง)`,
      })
      .eq('id', roll.id)

    setSaving(false)
    if (jobErr || error) { alert('บันทึกไม่สำเร็จ: ' + (jobErr?.message ?? error?.message)); return }
    alert(mergedInto
      ? `✓ รวมม้วนนี้เข้างานกรอเดิม (Lot ต้นทาง ${srcLot})\n\nเป้าผลิตรวมเพิ่มเป็น: ${fmt((parseFloat(mergedInto.planned_qty ?? '0')||0) + rollKg)} Kg\n\n→ ชั่งที่งานเดียวกันในหน้า "ชั่งน้ำหนัก"`
      : `✓ สร้างงานกรอเรียบร้อย\n\nเป้าผลิต: ${fmt(roll.weight)} Kg\n\n→ ไปหน้า "ชั่งน้ำหนัก" (แผนกกรอ) → คลิก card งานนี้ → เลือกเครื่อง → Lot จะถูกสร้างให้ → ชั่งม้วนใหม่`)
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-blue-700 rounded-2xl w-full max-w-md p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-4">
          <Wrench size={18} className="text-blue-400"/>
          <p className="text-white font-bold">🔧 เริ่มกรอม้วนนี้</p>
        </div>

        {/* ข้อมูลม้วนต้นทาง */}
        <div className="bg-slate-800/50 rounded-lg p-3 mb-3 text-xs space-y-1">
          <p className="text-slate-500 text-[10px] font-bold uppercase tracking-wider mb-1">ม้วนต้นทาง</p>
          <p className="text-slate-400">เครื่องเดิม: <b className="text-white">{roll.machine_no}</b> · Lot: <b className="text-white font-mono">{roll.lot_no}</b></p>
          <p className="text-slate-400">สินค้า: <b className="text-white">{roll.product_name || '—'}</b></p>
          <p className="text-slate-400">ลูกค้า: <b className="text-white">{roll.customer || '—'}</b></p>
          <p className="text-slate-400">นน.: <b className="text-orange-300">{fmt(roll.weight)} Kg</b> · เหตุผลกรอ: <b className="text-white">{roll.remark || '—'}</b></p>
        </div>

        {/* Lot info */}
        <div className="bg-brand-500/10 border border-brand-500/30 rounded-lg px-3 py-2 mb-3 text-xs">
          <span className="text-slate-400">Lot กรอใหม่: </span>
          <span className="text-brand-300 font-bold">จะถูกสร้างตอนเลือกเครื่อง (เช่น 69S01000105)</span>
        </div>

        <label className="block text-xs text-slate-400 mb-1">สาเหตุ/วิธีที่กรอได้ *</label>
        <input value={reworkReason} onChange={e => setReworkReason(e.target.value)} autoFocus
          placeholder="เช่น ตัดขอบเสียออก, กรอใหม่ลด tension..."
          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-blue-500 mb-3"/>

        <div className="grid grid-cols-2 gap-2 mb-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">ผู้รับ *</label>
            <input value={by} onChange={e => setBy(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-blue-500"/>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">คนกรอ <span className="text-slate-600">(ไม่กรอก = ผู้รับ)</span></label>
            <input value={rewinder} onChange={e => setRewinder(e.target.value)}
              placeholder={by || 'ชื่อคนกรอ'}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-blue-500"/>
          </div>
        </div>

        <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-2.5 mt-3 text-xs text-blue-200">
          💡 ระบบจะสร้าง <b>job</b> ใหม่ในรายการแผนกกรอ — operator คลิก card → เลือกเครื่อง S01-S04 → ชั่งได้เลย<br/>
          กดเข้า-ออกระหว่างหลาย job ได้ตามต้องการ (job ไม่ผูกเครื่อง)
        </div>

        <div className="flex gap-2 mt-4">
          <button onClick={onClose} className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 py-2 rounded-lg text-sm">ยกเลิก</button>
          <button onClick={save} disabled={saving} className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white py-2 rounded-lg text-sm font-bold">
            {saving ? 'บันทึก...' : '✓ ยืนยัน → สร้าง job'}
          </button>
        </div>
      </div>
    </div>
  )
}


// ─── ทำลาย (คืนเป่ากำจัดเป็นเศษ) ────────────────────────────────────
function ScrapModal({ roll, onClose }: { roll: any; onClose: () => void }) {
  const [by, setBy] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!by.trim()) { alert('กรอกชื่อผู้ส่ง'); return }
    if (!reason.trim()) { alert('ระบุเหตุผลที่ทำลาย'); return }
    setSaving(true)
    const { error } = await supabase.from('production_rolls')
      .update({
        rework_status: 'scrapped',
        rework_remark: reason.trim(),
        rework_received_by: roll.rework_received_by ?? by.trim(),
        rework_received_at: roll.rework_received_at ?? new Date().toISOString(),
      })
      .eq('id', roll.id)
    setSaving(false)
    if (error) { alert('บันทึกไม่สำเร็จ: ' + error.message); return }
    alert(`✓ ม้วน "${roll.lot_no}" ถูกส่งคืนเป่าเพื่อกำจัดเป็นเศษ`)
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-red-700 rounded-2xl w-full max-w-sm p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-4">
          <Trash2 size={18} className="text-red-400"/>
          <p className="text-white font-bold">🗑 คืนเป่า — ทำลายเป็นเศษ</p>
        </div>
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-3 text-xs text-red-200">
          ⚠ การกระทำนี้บันทึกว่า "แก้ไขไม่ได้" — ม้วนจะถูกส่งคืนแผนกเป่าเพื่อกำจัดเป็นเศษเสีย
        </div>
        <div className="bg-slate-800/50 rounded-lg p-3 mb-3 text-xs space-y-1">
          <p className="text-slate-400">Lot: <b className="text-white font-mono">{roll.lot_no}</b></p>
          <p className="text-slate-400">น้ำหนัก: <b className="text-orange-300">{fmt(roll.weight)} Kg</b></p>
        </div>
        <label className="block text-xs text-slate-400 mb-1">ชื่อผู้ส่งคืน *</label>
        <input value={by} onChange={e => setBy(e.target.value)} autoFocus
          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-red-500 mb-3"/>
        <label className="block text-xs text-slate-400 mb-1">เหตุผลที่ทำลาย *</label>
        <input value={reason} onChange={e => setReason(e.target.value)}
          placeholder="เช่น ตัดต่อมาก, ม้วนไม่สมดุล, เสียหายเกินกู้คืน..."
          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-red-500"/>
        <div className="flex gap-2 mt-4">
          <button onClick={onClose} className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 py-2 rounded-lg text-sm">ยกเลิก</button>
          <button onClick={save} disabled={saving} className="flex-1 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white py-2 rounded-lg text-sm font-bold">
            {saving ? 'บันทึก...' : '🗑 ยืนยันทำลาย'}
          </button>
        </div>
      </div>
    </div>
  )
}
