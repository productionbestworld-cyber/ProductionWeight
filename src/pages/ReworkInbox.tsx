import { useEffect, useState } from 'react'
import { Wrench, Trash2, Plus, RefreshCw, Search, X, ArrowLeft } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { fetchProducts, type Product } from './Products'

function fmt(n: number | null | undefined, d = 2) {
  if (n == null || isNaN(n as number)) return (0).toFixed(d)
  return (n as number).toLocaleString('th-TH', { minimumFractionDigits: d, maximumFractionDigits: d })
}
function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('th-TH', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' })
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
  // ── ระบบกรอ 2 แบบ: 'production' (จากเป่า) | 'external' (นอกระบบ/ม้วนเก่า) ──
  const [system, setSystem] = useState<'production' | 'external'>('production')
  const [tab, setTab] = useState<Tab>('queue')
  const [rolls, setRolls] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [showLegacy, setShowLegacy] = useState(false)
  const [showScrap, setShowScrap] = useState<any | null>(null)
  const [showReceive, setShowReceive] = useState<any | null>(null)
  const [showReadyWeigh, setShowReadyWeigh] = useState<any | null>(null)
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})
  const [allRolls, setAllRolls] = useState<any[]>([])  // ทุกม้วน bad ใน system นี้ (ทุกสถานะ)

  async function load() {
    if (!selectedType) return
    setLoading(true)
    // โหลดทุกม้วน bad ของระบบ (ทุกสถานะ) ใช้สำหรับ status badges
    const { data: allData } = await supabase.from('production_rolls').select('*')
      .eq('roll_type', 'bad').eq('transferred', true).order('created_at', { ascending: false })
    const allRows = (allData ?? []).filter(r =>
      system === 'production' ? !r.is_legacy : !!r.is_legacy
    )
    setAllRolls(allRows)

    // กรองตาม tab สำหรับแสดงในตาราง
    const filtered = allRows.filter(r => {
      if (tab === 'queue')   return !r.rework_status || r.rework_status === 'pending'
      if (tab === 'working') return r.rework_status === 'reworking'
      return r.rework_status === 'reworked' || r.rework_status === 'scrapped'
    })
    setRolls(filtered)
    setLoading(false)
  }

  useEffect(() => { load() }, [tab, selectedType, system])

  // ── โหลดจำนวนต่อประเภท (สำหรับ badge บนการ์ด) ─────────────────────
  const [counts, setCounts] = useState<Record<InboundType, number>>({
    internal:0, return_no_cn:0, return_with_cn:0, qc_reject:0, warehouse_damage:0,
  })
  useEffect(() => {
    supabase.from('production_rolls')
      .select('inbound_type, rework_status, transferred')
      .eq('roll_type', 'bad')
      .then(({ data }) => {
        const c: Record<InboundType, number> = { internal:0, return_no_cn:0, return_with_cn:0, qc_reject:0, warehouse_damage:0 }
        for (const r of data ?? []) {
          const isQueue = r.transferred && (!r.rework_status || r.rework_status === 'pending')
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
    const blob = `${r.machine_no} ${r.lot_no} ${r.product_name} ${r.customer} ${r.item_code} ${r.mat_code}`.toLowerCase()
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

  return (
    <div className="bg-[#0a0f1e] p-5">
      <div className="max-w-6xl mx-auto space-y-4">

        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-white font-bold text-xl flex items-center gap-2">
              <Wrench size={22} className="text-amber-400"/> ม้วนรอกรอ — แผนกกรอ
            </h1>
            <p className="text-slate-400 text-xs mt-0.5">
              {system === 'production'
                ? '🏭 กรอจากเป่า — รับม้วนจากผลิตที่โอนมารอแก้'
                : '📦 กรอนอกระบบ — ม้วนเก่าที่กรอกข้อมูลเอง'}
            </p>
          </div>
          <div className="flex gap-2">
            {system === 'external' && (
              <button onClick={() => setShowLegacy(true)}
                className="flex items-center gap-1.5 bg-purple-600 hover:bg-purple-500 text-white text-xs px-3 py-2 rounded-lg font-bold">
                <Plus size={12}/> เพิ่มม้วนเก่า
              </button>
            )}
            <button onClick={load}
              className="flex items-center gap-1.5 text-slate-400 hover:text-white text-xs bg-slate-800 hover:bg-slate-700 px-3 py-2 rounded-lg">
              <RefreshCw size={12}/> รีเฟรช
            </button>
          </div>
        </div>

        {/* System switcher — 2 ระบบกรอ */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-2 flex gap-1.5">
          {([
            { key: 'production', label: '🏭 กรอจากเป่า',  desc: 'ม้วนที่ผลิตโอนมา',         color: 'bg-blue-600' },
            { key: 'external',   label: '⚙ ตั้งค่าชั่งเอง', desc: 'ตั้งค่าเครื่องโดยตรง — ข้ามคิว', color: 'bg-purple-600' },
          ] as const).map(s => (
            <button key={s.key} onClick={() => setSystem(s.key)}
              className={`flex-1 px-4 py-3 rounded-lg text-left transition-colors ${
                system === s.key ? `${s.color} text-white shadow-lg` : 'bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700'
              }`}>
              <div className="font-bold text-sm">{s.label}</div>
              <div className={`text-[10px] mt-0.5 ${system === s.key ? 'text-white/80' : 'text-slate-500'}`}>{s.desc}</div>
            </button>
          ))}
        </div>

        {/* ── ถ้า system = 'external' ข้าม tabs/search/list — ไปเลือกเครื่องด้านล่างเลย ── */}
        {system === 'external' ? (
          <div className="bg-purple-500/10 border-2 border-purple-500/40 rounded-xl p-5">
            <div className="flex items-center gap-3">
              <span className="text-4xl">⚙</span>
              <div>
                <p className="text-white font-bold text-lg">ตั้งค่าชั่งเอง — ข้ามคิว</p>
                <p className="text-purple-200/80 text-sm mt-0.5">เลื่อนลงด้านล่าง → คลิกเครื่อง S01-S04 → กรอกข้อมูลงานเอง → เริ่มชั่ง</p>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Tabs */}
            <div className="flex gap-1 bg-slate-900 border border-slate-800 rounded-xl p-1 w-fit">
              {([
                { key:'queue',   label:'📥 รอกรอ',   color:'bg-amber-600' },
                { key:'working', label:'⚙ กำลังกรอ', color:'bg-blue-600' },
                { key:'done',    label:'✓ ปิดงาน',   color:'bg-green-700' },
              ] as const).map(t => (
                <button key={t.key} onClick={() => setTab(t.key)}
                  className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors ${tab===t.key ? `${t.color} text-white` : 'text-slate-400 hover:text-white'}`}>
                  {t.label}
                </button>
              ))}
            </div>

            {/* Search */}
            <div className="relative w-72">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"/>
              <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                placeholder="ค้นหา เครื่อง/ลูกค้า/สินค้า/Lot..."
                className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-sm text-white outline-none focus:border-amber-500"/>
            </div>
          </>
        )}

        {/* Status badges — รวมทุกสถานะของระบบนี้ (ไม่ผูกกับ tab) */}
        {system !== 'external' && (() => {
          const reworked  = allRolls.filter(r => r.rework_status === 'reworked')
          const scrapped  = allRolls.filter(r => r.rework_status === 'scrapped')
          const reworking = allRolls.filter(r => r.rework_status === 'reworking')
          const pending   = allRolls.filter(r => !r.rework_status || r.rework_status === 'pending')
          const sumKg = (arr: any[]) => arr.reduce((s, r) => s + (r.weight ?? 0), 0)
          return (
            <div className="grid grid-cols-4 gap-2">
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3">
                <div className="flex items-center justify-between"><span className="text-amber-400 text-[10px] font-bold uppercase">📥 รอกรอ</span><span className="text-amber-300 font-black text-lg">{pending.length}</span></div>
                <p className="text-amber-200/70 text-[10px] mt-0.5">{fmt(sumKg(pending))} Kg</p>
              </div>
              <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-3">
                <div className="flex items-center justify-between"><span className="text-blue-400 text-[10px] font-bold uppercase">⚙ กำลังกรอ</span><span className="text-blue-300 font-black text-lg">{reworking.length}</span></div>
                <p className="text-blue-200/70 text-[10px] mt-0.5">{fmt(sumKg(reworking))} Kg</p>
              </div>
              <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-3">
                <div className="flex items-center justify-between"><span className="text-green-400 text-[10px] font-bold uppercase">✓ กรอสำเร็จ</span><span className="text-green-300 font-black text-lg">{reworked.length}</span></div>
                <p className="text-green-200/70 text-[10px] mt-0.5">{fmt(sumKg(reworked))} Kg</p>
              </div>
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3">
                <div className="flex items-center justify-between"><span className="text-red-400 text-[10px] font-bold uppercase">🗑 ทำลาย</span><span className="text-red-300 font-black text-lg">{scrapped.length}</span></div>
                <p className="text-red-200/70 text-[10px] mt-0.5">{fmt(sumKg(scrapped))} Kg</p>
              </div>
            </div>
          )
        })()}

        {/* List — ซ่อนถ้า external */}
        {system !== 'external' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
            <p className="text-white font-semibold text-sm">
              {tab === 'queue' && '📥 ม้วนกรอที่รอแก้ไข'}
              {tab === 'working' && '⚙ กำลังกรออยู่'}
              {tab === 'done' && '✓ ปิดงานแล้ว (กรอสำเร็จ + ทำลาย)'}
            </p>
            <span className="text-slate-500 text-xs">{filtered.length} รายการ · รวม {fmt(filtered.reduce((s, r) => s + (r.weight ?? 0), 0))} Kg</span>
          </div>

          {loading ? (
            <div className="py-16 text-center text-slate-500 text-sm">กำลังโหลด...</div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center text-slate-600">ไม่มีรายการ</div>
          ) : (() => {
            // จัดกลุ่ม WO > SO > Lot (3 ระดับ)
            type LotGrp = { lot: string; items: any[]; totalKg: number }
            type SoGrp  = { so: string;  lots: LotGrp[];  totalKg: number; totalItems: number }
            type WoGrp  = { wo: string;  sos: SoGrp[];   totalKg: number; totalItems: number; cust: string; prod: string; item: string; latest: string }

            const woMap = new Map<string, Map<string, Map<string, any[]>>>()
            for (const r of filtered) {
              const wo  = (r.work_order ?? '').trim() || '(ไม่ระบุ WO)'
              const so  = (r.sale_order ?? '').trim() || '(ไม่ระบุ SO)'
              const lot = r.lot_no ?? '(ไม่ระบุ Lot)'
              if (!woMap.has(wo))      woMap.set(wo,  new Map())
              if (!woMap.get(wo)!.has(so)) woMap.get(wo)!.set(so, new Map())
              if (!woMap.get(wo)!.get(so)!.has(lot)) woMap.get(wo)!.get(so)!.set(lot, [])
              woMap.get(wo)!.get(so)!.get(lot)!.push(r)
            }

            const woList: WoGrp[] = [...woMap.entries()].map(([wo, soMap]) => {
              const sos: SoGrp[] = [...soMap.entries()].map(([so, lotMap]) => {
                const lots: LotGrp[] = [...lotMap.entries()].map(([lot, items]) => ({
                  lot, items, totalKg: items.reduce((s, x) => s + (x.weight ?? 0), 0),
                }))
                const totalKg = lots.reduce((s, l) => s + l.totalKg, 0)
                const totalItems = lots.reduce((s, l) => s + l.items.length, 0)
                return { so, lots, totalKg, totalItems }
              })
              const allItems = sos.flatMap(s => s.lots.flatMap(l => l.items))
              return {
                wo,
                sos,
                totalKg: sos.reduce((s, x) => s + x.totalKg, 0),
                totalItems: sos.reduce((s, x) => s + x.totalItems, 0),
                cust: allItems.find(x => x.customer)?.customer ?? '',
                prod: allItems.find(x => x.product_name)?.product_name ?? '',
                item: allItems.find(x => x.item_code)?.item_code ?? '',
                latest: allItems.reduce((mx, x) => {
                  const t = x.rework_received_at || x.created_at
                  return t > mx ? t : mx
                }, allItems[0]?.rework_received_at || allItems[0]?.created_at || ''),
              }
            }).sort((a, b) => b.latest.localeCompare(a.latest))

            return (
              <div className="divide-y divide-slate-800/50">
                {woList.map(wg => {
                  const woKey  = `wo:${wg.wo}`
                  const woOpen = openGroups[woKey] ?? true
                  return (
                    <div key={wg.wo} className="bg-slate-900">
                      {/* ── WO LEVEL (ใหญ่สุด) ─────────────────── */}
                      <button onClick={() => setOpenGroups(p => ({ ...p, [woKey]: !woOpen }))}
                        className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-slate-800/40 transition-colors text-left border-l-4 border-amber-500">
                        <span className="text-amber-400 text-base font-bold">{woOpen ? '▼' : '▶'}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <span className="text-sm font-black px-3 py-1 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-lg">📋 WO {wg.wo}</span>
                            <span className="text-[10px] bg-slate-700 text-slate-200 px-2 py-0.5 rounded font-bold">{wg.sos.length} SO</span>
                            <span className="text-[10px] bg-orange-500/20 text-orange-300 px-2 py-0.5 rounded font-bold">{wg.totalItems} ม้วน</span>
                            <span className="text-xs text-slate-300">รวม <b className="text-orange-300 text-base">{fmt(wg.totalKg)}</b> Kg</span>
                          </div>
                          <div className="text-xs text-slate-500 flex gap-3 flex-wrap">
                            {wg.cust && <span>👥 {wg.cust}</span>}
                            {wg.prod && <span className="truncate max-w-[260px]">📦 {wg.prod}</span>}
                            {wg.item && <span className="font-mono">{wg.item}</span>}
                          </div>
                        </div>
                      </button>

                      {woOpen && wg.sos.map(sg => {
                        const soKey  = `${woKey}|so:${sg.so}`
                        const soOpen = openGroups[soKey] ?? true
                        return (
                          <div key={sg.so} className="ml-6 border-l-2 border-blue-500/30">
                            {/* ── SO LEVEL ─────────────────── */}
                            <button onClick={() => setOpenGroups(p => ({ ...p, [soKey]: !soOpen }))}
                              className="w-full flex items-center gap-3 px-4 py-2 bg-slate-900/60 hover:bg-slate-800/40 transition-colors text-left">
                              <span className="text-blue-400 text-sm">{soOpen ? '▼' : '▶'}</span>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-xs font-bold px-2 py-0.5 rounded bg-blue-500/30 text-blue-200">SO {sg.so}</span>
                                  <span className="text-[10px] bg-slate-700 text-slate-300 px-2 py-0.5 rounded">{sg.lots.length} Lot</span>
                                  <span className="text-[10px] text-slate-400">{sg.totalItems} ม้วน · <b className="text-orange-300">{fmt(sg.totalKg)}</b> Kg</span>
                                </div>
                              </div>
                            </button>

                            {soOpen && sg.lots.map(lg => {
                              const lotKey  = `${soKey}|lot:${lg.lot}`
                              const lotOpen = openGroups[lotKey] ?? true
                              return (
                                <div key={lg.lot} className="ml-6 border-l-2 border-slate-700">
                                  {/* ── LOT LEVEL ─────────────────── */}
                                  <button onClick={() => setOpenGroups(p => ({ ...p, [lotKey]: !lotOpen }))}
                                    className="w-full flex items-center gap-2 px-4 py-1.5 hover:bg-slate-800/30 transition-colors text-left">
                                    <span className="text-slate-500 text-xs">{lotOpen ? '▼' : '▶'}</span>
                                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-700 text-slate-200">Lot {lg.lot}</span>
                                    <span className="text-[10px] text-slate-500">{lg.items.length} ม้วน · {fmt(lg.totalKg)} Kg</span>
                                  </button>

                                  {lotOpen && (
                                    <div className="px-4 pb-3 overflow-x-auto">
                                      <table className="w-full text-sm">
                                        <thead className="text-[10px] text-slate-500 uppercase tracking-wider border-b border-slate-800">
                                          <tr>
                                            {['วันที่','แหล่ง','เครื่องเดิม','นน. (Kg)','เหตุผลกรอ','ผู้รับ', tab === 'done' ? 'ผลลัพธ์' : 'การจัดการ'].map(h => (
                                              <th key={h} className="px-2 py-1.5 text-left font-semibold whitespace-nowrap">{h}</th>
                                            ))}
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-800/40">
                                          {lg.items.map(r => (
                                <tr key={r.id} className="hover:bg-slate-800/30">
                                  <td className="px-2 py-1.5 text-slate-400 whitespace-nowrap text-xs">{fmtDateTime(r.rework_received_at || r.created_at)}</td>
                                  <td className="px-2 py-1.5">
                                    {(() => {
                                      const ti = inboundInfo(r.inbound_type)
                                      return <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${ti.badge}`} title={`${ti.no} ${ti.label}`}>{ti.emoji} {ti.no}</span>
                                    })()}
                                    {r.is_legacy && <span className="ml-1 text-[9px] text-purple-300">(เก่า)</span>}
                                  </td>
                                  <td className="px-2 py-1.5 text-white font-bold">{r.machine_no || '—'}</td>
                                  <td className="px-2 py-1.5 text-orange-300 font-bold">{fmt(r.weight)}</td>
                                  <td className="px-2 py-1.5 text-slate-400 text-xs max-w-[160px] truncate" title={r.remark}>{r.remark || '—'}</td>
                                  <td className="px-2 py-1.5 text-slate-300 text-xs">{r.rework_received_by || r.transferred_by || '—'}</td>
                                  <td className="px-2 py-1.5">
                                    {tab === 'queue' && (
                                      <div className="flex gap-1">
                                        <button onClick={() => setShowReceive(r)} className="text-[10px] bg-blue-600 hover:bg-blue-500 text-white px-2 py-1 rounded font-bold">🔧 เริ่มกรอ</button>
                                        <button onClick={() => setShowScrap(r)}   className="text-[10px] bg-red-600 hover:bg-red-500 text-white px-2 py-1 rounded font-bold">🗑 คืนเป่า</button>
                                      </div>
                                    )}
                                    {tab === 'working' && (
                                      <div className="flex gap-1 flex-wrap items-center">
                                        {r.rework_remark?.includes('ส่งไปกรอที่') && (
                                          <span className="text-[10px] bg-blue-500/20 text-blue-300 px-2 py-1 rounded font-bold whitespace-nowrap">
                                            {r.rework_remark.replace('ส่งไปกรอที่ ', '').split(' · ')[0]}
                                          </span>
                                        )}
                                        <button onClick={() => setShowReadyWeigh(r)} className="text-[10px] bg-brand-600 hover:bg-brand-500 text-white px-2 py-1 rounded font-bold whitespace-nowrap">⚖ พร้อมชั่ง</button>
                                        <button onClick={async () => {
                                          if (!confirm(`ปิดงาน "${r.lot_no}" — ม้วนนี้กรอเป็น FG ใหม่เรียบร้อยแล้ว?`)) return
                                          await supabase.from('production_rolls').update({ rework_status: 'reworked' }).eq('id', r.id)
                                          load()
                                        }} className="text-[10px] bg-green-600 hover:bg-green-500 text-white px-2 py-1 rounded font-bold">✓ ปิดงาน</button>
                                        <button onClick={() => setShowScrap(r)} className="text-[10px] bg-red-600 hover:bg-red-500 text-white px-2 py-1 rounded font-bold">🗑 คืน</button>
                                      </div>
                                    )}
                                    {tab === 'done' && (
                                      r.rework_status === 'reworked'
                                        ? <span className="text-[10px] bg-green-500/20 text-green-300 px-2 py-1 rounded font-bold">✓ กรอสำเร็จ</span>
                                        : <span className="text-[10px] bg-red-500/20 text-red-300 px-2 py-1 rounded font-bold">🗑 ทำลายแล้ว</span>
                                    )}
                                          </td>
                                        </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  )}
                                </div>
                              )
                            })}
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

        {system !== 'external' && (
        <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-3 text-xs text-slate-400 space-y-1">
          <p><b className="text-amber-300">💡 ขั้นตอน:</b></p>
          <p>1. <b className="text-blue-300">🔧 เริ่มกรอ</b> → กรอกผู้รับ → ม้วนเข้าสถานะ "กำลังกรอ" → ใช้เครื่อง S01-S04 ชั่งม้วนใหม่ที่หน้า "ชั่งน้ำหนัก"</p>
          <p>2. หลังชั่งเสร็จ ระบบบันทึกเป็น FG ใหม่ → โอนเข้าคลังตามปกติ</p>
          <p>3. <b className="text-red-300">🗑 คืนเป่า</b> → ถ้าแก้ไม่ได้ ระบบจะ mark ม้วนเป็น "ทำลาย" + บันทึกเหตุผล</p>
        </div>
        )}
      </div>

      {/* Modal: เพิ่มม้วน (Manual Entry — Phase 2.2) */}
      {showLegacy && <LegacyRollModal inboundType={selectedType!} onClose={() => { setShowLegacy(false); load() }}/>}

      {/* Modal: เริ่มกรอ (กรอกผู้รับ) */}
      {showReceive && (
        <ReceiveModal roll={showReceive} onClose={() => { setShowReceive(null); load() }}/>
      )}

      {/* Modal: คืนเป่า (ทำลาย) */}
      {showScrap && (
        <ScrapModal roll={showScrap} onClose={() => { setShowScrap(null); load() }}/>
      )}

      {/* Modal: พร้อมชั่ง — อัปเดต Lot/วันที่ใหม่ + jump เข้าเครื่องชั่ง */}
      {showReadyWeigh && (
        <ReadyWeighModal
          roll={showReadyWeigh}
          onClose={() => { setShowReadyWeigh(null); load() }}
          onJump={onJumpToMachine}
        />
      )}

    </div>
  )
}

// ─── เพิ่มม้วนเก่านอกระบบ ─────────────────────────────────────────────
function LegacyRollModal({ inboundType, onClose }: { inboundType: InboundType; onClose: () => void }) {
  const [products, setProducts] = useState<Product[]>([])
  const [form, setForm] = useState({
    itemCode: '', productName: '', customer: '', custCode: '',
    weight: '', widthCm: '', thickMc: '', remark: '', receivedBy: '',
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => { fetchProducts().then(setProducts) }, [])

  function pickItem(code: string) {
    const p = products.find(x => x.item_code === code.trim())
    if (p) {
      setForm(f => ({
        ...f,
        itemCode: p.item_code,
        productName: p.product_name,
        customer: p.cust_name ?? '',
        custCode: p.cust_code,
        widthCm: p.width_cm,
        thickMc: p.thick_mc,
      }))
    } else {
      setForm(f => ({ ...f, itemCode: code }))
    }
  }

  async function save() {
    if (!form.weight || +form.weight <= 0) { alert('กรอกน้ำหนัก'); return }
    if (!form.receivedBy.trim()) { alert('กรอกชื่อผู้รับ'); return }
    if (!form.productName.trim()) { alert('ระบุสินค้า'); return }
    if (!form.customer.trim())   { alert('ระบุลูกค้า'); return }
    setSaving(true)
    const { error } = await supabase.from('production_rolls').insert({
      roll_type: 'bad',
      roll_no: 0,
      weight: parseFloat(form.weight),
      gross_weight: parseFloat(form.weight),
      core_weight: 0,
      machine_no: '—',
      lot_no: 'LEGACY-' + Date.now().toString().slice(-8),
      product_name: form.productName,
      customer: form.customer,
      cust_code: form.custCode,
      item_code: form.itemCode,
      width_cm: form.widthCm,
      thick_mc: form.thickMc,
      remark: form.remark || 'ม้วนเก่านอกระบบ',
      section: 'rewind',
      is_legacy: true,
      inbound_type: inboundType,
      transferred: true,
      transferred_by: form.receivedBy,
      transferred_at: new Date().toISOString(),
      rework_status: 'pending',
      rework_received_by: form.receivedBy,
      rework_received_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    })
    setSaving(false)
    if (error) { alert('บันทึกไม่สำเร็จ: ' + error.message); return }
    alert('✓ เพิ่มม้วนเก่าเข้าคิวกรอแล้ว')
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <p className="text-white font-bold text-base flex items-center gap-2"><Plus size={16} className="text-purple-400"/> เพิ่มม้วน (Manual Entry)</p>
          <button onClick={onClose} className="text-slate-500 hover:text-white"><X size={18}/></button>
        </div>

        {/* Category info */}
        {(() => {
          const ti = inboundInfo(inboundType)
          return (
            <div className={`border rounded-lg p-2.5 mb-3 ${ti.ring}`}>
              <div className="flex items-center gap-2">
                <span className="text-xl">{ti.emoji}</span>
                <div>
                  <p className="text-white text-xs font-bold">{ti.no} {ti.label}</p>
                  <p className="text-slate-400 text-[10px]">{ti.desc}</p>
                </div>
              </div>
            </div>
          )
        })()}

        <div className="space-y-2.5">
          <div>
            <label className="block text-[10px] text-slate-500 mb-1">Item Code (ถ้ามี)</label>
            <input value={form.itemCode}
              onChange={e => pickItem(e.target.value)}
              list="legacy-items"
              placeholder="พิมพ์ Item Code หรือเลือก"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-purple-500"/>
            <datalist id="legacy-items">
              {products.map(p => <option key={p.item_code} value={p.item_code}>{p.product_name} · {p.cust_name}</option>)}
            </datalist>
          </div>
          <div>
            <label className="block text-[10px] text-slate-500 mb-1">ลูกค้า *</label>
            <input value={form.customer} onChange={e => setForm(f => ({ ...f, customer: e.target.value }))}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-purple-500"/>
          </div>
          <div>
            <label className="block text-[10px] text-slate-500 mb-1">ชื่อสินค้า *</label>
            <input value={form.productName} onChange={e => setForm(f => ({ ...f, productName: e.target.value }))}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-purple-500"/>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] text-slate-500 mb-1">กว้าง (cm)</label>
              <input value={form.widthCm} onChange={e => setForm(f => ({ ...f, widthCm: e.target.value }))}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-purple-500"/>
            </div>
            <div>
              <label className="block text-[10px] text-slate-500 mb-1">หนา (mc)</label>
              <input value={form.thickMc} onChange={e => setForm(f => ({ ...f, thickMc: e.target.value }))}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-purple-500"/>
            </div>
          </div>
          <div>
            <label className="block text-[10px] text-slate-500 mb-1">น้ำหนัก (Kg) *</label>
            <input type="number" step="0.01" value={form.weight} onChange={e => setForm(f => ({ ...f, weight: e.target.value }))}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-lg text-white font-bold text-center outline-none focus:border-purple-500"/>
          </div>
          <div>
            <label className="block text-[10px] text-slate-500 mb-1">หมายเหตุ / สภาพม้วน</label>
            <input value={form.remark} onChange={e => setForm(f => ({ ...f, remark: e.target.value }))}
              placeholder="เช่น ขอบเสีย, ถุงดำ, ไม่มีฉลาก..."
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-purple-500"/>
          </div>
          <div>
            <label className="block text-[10px] text-slate-500 mb-1">ชื่อผู้รับ *</label>
            <input value={form.receivedBy} onChange={e => setForm(f => ({ ...f, receivedBy: e.target.value }))}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-purple-500"/>
          </div>
        </div>

        <button onClick={save} disabled={saving}
          className="w-full mt-4 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white py-2.5 rounded-xl font-bold text-sm">
          {saving ? 'กำลังบันทึก...' : '💾 บันทึก'}
        </button>
      </div>
    </div>
  )
}

// ─── เริ่มกรอ — โหลดข้อมูลม้วนเข้าเครื่อง S0X → ไปหน้าชั่งน้ำหนัก ──
function ReceiveModal({ roll, onClose }: { roll: any; onClose: () => void }) {
  const [machines, setMachines] = useState<any[]>([])
  const [machine,  setMachine]  = useState('')
  const [by, setBy] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    supabase.from('machine_profiles')
      .select('*').eq('section', 'rewind').order('machine_no')
      .then(({ data }) => {
        const list = data ?? []
        setMachines(list)
        // เลือกเครื่องว่างเป็นเครื่องแรก (ไม่มี lot_no)
        const empty = list.find((m: any) => !m.lot_no)
        if (empty) setMachine(empty.machine_no)
        else if (list[0]) setMachine(list[0].machine_no)
      })
  }, [])

  function genLot(machineName: string): string {
    const yy = String((new Date().getFullYear() + 543) % 100).padStart(2, '0')
    const mm = String(new Date().getMonth() + 1).padStart(2, '0')
    const cc = String(roll.cust_code ?? '').replace(/\D/g, '').padStart(4, '0').slice(-4)
    return `${yy}${machineName}${cc || '0000'}${mm}`
  }

  async function save() {
    if (!machine) { alert('เลือกเครื่องกรอ'); return }
    if (!by.trim()) { alert('กรอกชื่อผู้รับ'); return }

    // ถ้าเครื่องนี้มีงานอยู่แล้ว — เตือน
    const current = machines.find(m => m.machine_no === machine)
    if (current?.lot_no) {
      if (!confirm(`เครื่อง ${machine} กำลังมีงานอยู่ (Lot: ${current.lot_no})\nต้องการเขียนทับด้วยงานกรอใหม่นี้หรือไม่?`)) return
    }

    setSaving(true)

    // 1) อัปเดต machine_profile ของเครื่องกรอ ให้พร้อมชั่ง
    const newLot = genLot(machine)
    await supabase.from('machine_profiles').upsert({
      machine_no:    machine,
      section:       'rewind',
      cust_code:     roll.cust_code     ?? '',
      cust_name:     roll.customer      ?? '',
      cust_address:  '',
      item_code:     roll.item_code     ?? '',
      mat_code:      roll.mat_code      ?? '',
      product_code:  roll.product_code  ?? '',
      product_name:  roll.product_name  ?? '',
      width_cm:      roll.width_cm      ?? '',
      thick_mc:      roll.thick_mc      ?? '',
      lot_no:        newLot,
      planned_qty:   parseFloat((roll.weight ?? 0).toFixed(2)), // ตั้งเป้า = นน.ม้วนต้นทาง
      inspector:     by.trim(),
      core_weight:   '1.25',
      label_size:    'long',
      decimal_places: 2,
      locked:        false,
      updated_at:    new Date().toISOString(),
    }, { onConflict: 'machine_no' })

    // 2) mark ม้วนต้นทาง = reworking + เก็บข้อมูล
    const { error } = await supabase.from('production_rolls')
      .update({
        rework_status:      'reworking',
        rework_received_by: by.trim(),
        rework_received_at: new Date().toISOString(),
        rework_remark:      `ส่งไปกรอที่ ${machine} · Lot ${newLot}`,
      })
      .eq('id', roll.id)

    setSaving(false)
    if (error) { alert('บันทึกไม่สำเร็จ: ' + error.message); return }
    alert(`✓ โหลดข้อมูลเข้าเครื่อง ${machine} เรียบร้อย\n\nLot: ${newLot}\nเป้าผลิต: ${fmt(roll.weight)} Kg\n\n→ ไปหน้า "ชั่งน้ำหนัก" → เลือกเครื่อง ${machine} → ชั่งม้วนใหม่ตามปกติเหมือนผลิตเป่า`)
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

        {/* เลือกเครื่องกรอ */}
        <div className="mb-3">
          <label className="block text-xs text-slate-400 mb-1.5">เลือกเครื่องกรอ *</label>
          <div className="grid grid-cols-4 gap-1.5">
            {machines.map(m => {
              const busy = !!m.lot_no
              return (
                <button key={m.machine_no} onClick={() => setMachine(m.machine_no)}
                  className={`py-2.5 rounded-lg text-sm font-bold border transition-colors relative ${
                    machine === m.machine_no
                      ? 'bg-blue-600 border-blue-500 text-white'
                      : busy
                        ? 'bg-slate-800 border-amber-500/40 text-amber-300 hover:bg-slate-700'
                        : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                  }`}
                  title={busy ? `มีงาน: ${m.lot_no}` : 'ว่าง'}>
                  {m.machine_no}
                  {busy && <span className="absolute top-0 right-0 w-1.5 h-1.5 bg-amber-400 rounded-full"/>}
                </button>
              )
            })}
          </div>
          {machines.length === 0 && <p className="text-red-400 text-[10px] mt-1">⚠ ยังไม่มีเครื่องกรอ — ไปตั้งค่าเครื่องก่อน</p>}
          <p className="text-[10px] text-slate-500 mt-1">🟡 = มีงานอยู่ · ว่าง = พร้อมใช้</p>
        </div>

        {/* Lot preview */}
        {machine && (
          <div className="bg-brand-500/10 border border-brand-500/30 rounded-lg px-3 py-2 mb-3 text-xs">
            <span className="text-slate-400">Lot ใหม่: </span>
            <span className="font-mono text-brand-300 font-bold">{genLot(machine)}</span>
          </div>
        )}

        <label className="block text-xs text-slate-400 mb-1">ชื่อผู้รับ / ผู้ตรวจสอบ *</label>
        <input value={by} onChange={e => setBy(e.target.value)} autoFocus
          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-blue-500"/>

        <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-2.5 mt-3 text-xs text-blue-200">
          💡 หลังกดยืนยัน → ระบบจะโหลดข้อมูลสินค้า/ลูกค้าเข้าเครื่องนี้ → ไปหน้า <b>"ชั่งน้ำหนัก"</b> → ชั่งม้วนใหม่ตามปกติเหมือนผลิตเป่า
        </div>

        <div className="flex gap-2 mt-4">
          <button onClick={onClose} className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 py-2 rounded-lg text-sm">ยกเลิก</button>
          <button onClick={save} disabled={saving || !machine} className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white py-2 rounded-lg text-sm font-bold">
            {saving ? 'บันทึก...' : '✓ ยืนยัน → เริ่มกรอ'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── พร้อมชั่ง — อัปเดต Lot + วันที่ตามวันที่ชั่งจริง + กระโดดเข้าหน้าชั่ง ──
function ReadyWeighModal({ roll, onClose, onJump }: { roll: any; onClose: () => void; onJump?: (machine: string) => void }) {
  // หาเครื่องที่งานนี้อยู่ จาก rework_remark
  const machineFromRemark = (() => {
    const m = roll.rework_remark?.match(/ส่งไปกรอที่ (S\d+)/)
    return m ? m[1] : ''
  })()

  const [machines, setMachines] = useState<any[]>([])
  const [machine,  setMachine]  = useState(machineFromRemark)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    supabase.from('machine_profiles')
      .select('*').eq('section', 'rewind').order('machine_no')
      .then(({ data }) => {
        setMachines(data ?? [])
        if (!machine && data?.[0]) setMachine(data[0].machine_no)
      })
  }, [])

  function genLot(machineName: string): string {
    const yy = String((new Date().getFullYear() + 543) % 100).padStart(2, '0')
    const mm = String(new Date().getMonth() + 1).padStart(2, '0')
    const cc = String(roll.cust_code ?? '').replace(/\D/g, '').padStart(4, '0').slice(-4)
    return `${yy}${machineName}${cc || '0000'}${mm}`
  }

  const oldLot = (() => {
    const cur = machines.find(m => m.machine_no === machine)
    return cur?.lot_no ?? ''
  })()
  const newLot = machine ? genLot(machine) : ''
  const lotChanged = oldLot && newLot && oldLot !== newLot

  async function confirm() {
    if (!machine) { alert('เลือกเครื่อง'); return }
    setSaving(true)

    // อัปเดต machine_profile ใหม่ — Lot ใหม่ + ข้อมูลจากม้วนต้นทาง (ไม่ต้องตั้งค่าซ้ำ)
    await supabase.from('machine_profiles').update({
      lot_no:        newLot,
      cust_code:     roll.cust_code     ?? '',
      cust_name:     roll.customer      ?? '',
      item_code:     roll.item_code     ?? '',
      mat_code:      roll.mat_code      ?? '',
      product_code:  roll.product_code  ?? '',
      product_name:  roll.product_name  ?? '',
      width_cm:      roll.width_cm      ?? '',
      thick_mc:      roll.thick_mc      ?? '',
      work_order:    roll.work_order    ?? '',
      sale_order:    roll.sale_order    ?? '',
      planned_qty:   parseFloat((roll.weight ?? 0).toFixed(2)),
      inspector:     roll.rework_received_by ?? '',
      updated_at:    new Date().toISOString(),
    }).eq('machine_no', machine)

    // อัปเดต rework_remark ของม้วนต้นทาง
    await supabase.from('production_rolls').update({
      rework_remark: `ส่งไปกรอที่ ${machine} · Lot ${newLot}`,
    }).eq('id', roll.id)

    setSaving(false)

    // ถ้ามี callback → กระโดดเข้าหน้าชั่งทันที (ไม่ต้องไป navigate เอง)
    if (onJump) {
      onJump(machine)
      onClose()
    } else {
      alert(`✓ พร้อมชั่งแล้ว — เครื่อง ${machine} · Lot ${newLot}\n\nไปหน้า "ชั่งน้ำหนัก" เพื่อเริ่มชั่ง`)
      onClose()
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-slate-900 border-2 border-brand-600 rounded-2xl w-full max-w-md p-5 shadow-2xl shadow-brand-500/20" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <p className="text-white font-bold text-base flex items-center gap-2">
            <span className="text-2xl">⚖</span> พร้อมชั่ง — อัปเดต Lot/วันที่
          </p>
          <button onClick={onClose} className="text-slate-500 hover:text-white"><X size={18}/></button>
        </div>

        <div className="bg-slate-800/50 rounded-lg p-3 mb-3 text-xs space-y-0.5">
          <p className="text-slate-500 text-[10px] font-bold uppercase tracking-wider mb-1">ม้วนที่กรอเสร็จ</p>
          <p className="text-slate-400">เครื่องเดิม: <b className="text-white">{roll.machine_no}</b> · Lot เดิม: <b className="text-white font-mono">{roll.lot_no}</b></p>
          <p className="text-slate-400">สินค้า: <b className="text-white">{roll.product_name}</b></p>
          <p className="text-slate-400">ลูกค้า: <b className="text-white">{roll.customer}</b></p>
        </div>

        {/* เลือกเครื่อง */}
        <div className="mb-3">
          <label className="block text-xs text-slate-400 mb-1.5">เครื่องกรอ (ที่จะชั่ง)</label>
          <div className="grid grid-cols-4 gap-1.5">
            {machines.map(m => (
              <button key={m.machine_no} onClick={() => setMachine(m.machine_no)}
                className={`py-2.5 rounded-lg text-sm font-bold border transition-colors ${
                  machine === m.machine_no
                    ? 'bg-brand-600 border-brand-500 text-white'
                    : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                }`}>
                {m.machine_no}
              </button>
            ))}
          </div>
        </div>

        {/* แสดงการเปลี่ยน Lot */}
        {machine && (
          <div className="space-y-2 mb-3">
            {oldLot && (
              <div className="flex items-center gap-2 text-xs bg-slate-800/60 rounded-lg px-3 py-2">
                <span className="text-slate-500 w-20">Lot เก่า:</span>
                <span className="font-mono text-slate-300">{oldLot}</span>
              </div>
            )}
            <div className={`flex items-center gap-2 text-sm rounded-lg px-3 py-2.5 border ${lotChanged ? 'bg-amber-500/10 border-amber-500/40 animate-pulse' : 'bg-brand-500/10 border-brand-500/30'}`}>
              <span className="text-slate-400 w-20 text-xs">Lot ใหม่:</span>
              <span className={`font-mono font-black ${lotChanged ? 'text-amber-300' : 'text-brand-300'}`}>{newLot}</span>
              {lotChanged && <span className="ml-auto text-[10px] text-amber-400 font-bold">🔄 เปลี่ยน</span>}
            </div>
            <div className="flex items-center gap-2 text-xs bg-slate-800/60 rounded-lg px-3 py-2">
              <span className="text-slate-500 w-20">วันที่ชั่ง:</span>
              <span className="text-white font-semibold">{new Date().toLocaleDateString('th-TH', { day:'2-digit', month:'2-digit', year:'numeric' })}</span>
            </div>
          </div>
        )}

        <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-2.5 text-xs text-blue-200">
          💡 หลังกดยืนยัน → ไปหน้า <b>"ชั่งน้ำหนัก"</b> → เลือกเครื่อง {machine || 'S0X'} → ชั่งม้วนใหม่ตามปกติ (Lot และวันที่จะถูกอัปเดตเป็นปัจจุบัน)
        </div>

        <div className="flex gap-2 mt-4">
          <button onClick={onClose} className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 py-2.5 rounded-lg text-sm">ยกเลิก</button>
          <button onClick={confirm} disabled={saving || !machine} className="flex-1 bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-white py-2.5 rounded-lg text-sm font-bold">
            {saving ? 'บันทึก...' : '✓ ยืนยัน → ไปชั่ง'}
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
