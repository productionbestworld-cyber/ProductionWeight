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
  const [rolls, setRolls] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [showScrap, setShowScrap] = useState<any | null>(null)
  const [showReceive, setShowReceive] = useState<any | null>(null)
  const [showReturn, setShowReturn] = useState<any | null>(null)  // ส่งคืนผลิต — ให้ ผจก พิจารณา
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})
  const [logRows, setLogRows] = useState<any[]>([])   // ประวัติการรับเข้ากรอ (รับไปแล้ว)
  const [showLog, setShowLog] = useState(true)

  async function load() {
    if (!selectedType) return
    setLoading(true)
    // โหลดม้วน bad ทุกใบ (ไม่ต้องรอกดโอนเป็นทางการ — ม้วนกรอ = รอแก้ทันที)
    const { data: allData } = await supabase.from('production_rolls').select('*')
      .eq('roll_type', 'bad').order('created_at', { ascending: false })
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
    supabase.from('production_rolls')
      .select('inbound_type, rework_status, transferred')
      .eq('roll_type', 'bad')
      .then(({ data }) => {
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
              🏭 รับม้วนเสียจากผลิต → กดเริ่มกรอ (สร้างงาน) หรือ ส่งคืนผลิต · การชั่ง/สร้างงานเองอยู่ที่เมนู "ชั่งน้ำหนัก"
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={load}
              className="flex items-center gap-1.5 text-slate-400 hover:text-white text-xs bg-slate-800 hover:bg-slate-700 px-3 py-2 rounded-lg">
              <RefreshCw size={12}/> รีเฟรช
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"/>
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="ค้นหา lot/สินค้า/ลูกค้า..."
              className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-9 pr-3 py-1.5 text-sm text-white outline-none focus:border-amber-500"/>
          </div>
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
                                            {['วันที่','แหล่ง','เครื่องเดิม','นน. (Kg)','เหตุผลกรอ','ผู้รับ', 'การจัดการ'].map(h => (
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
                                    <div className="flex gap-1 flex-wrap">
                                      <button onClick={() => setShowReceive(r)} className="text-[10px] bg-blue-600 hover:bg-blue-500 text-white px-2 py-1 rounded font-bold">🔧 เริ่มกรอ</button>
                                      <button onClick={() => setShowReturn(r)}  className="text-[10px] bg-amber-600 hover:bg-amber-500 text-white px-2 py-1 rounded font-bold whitespace-nowrap">↩ ส่งคืนผลิต</button>
                                      <button onClick={() => setShowScrap(r)}   className="text-[10px] bg-red-600 hover:bg-red-500 text-white px-2 py-1 rounded font-bold">🗑 เศษ</button>
                                    </div>
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

        {/* ── LOG: ประวัติการรับเข้ากรอ ─────────────────────────── */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
          <button onClick={() => setShowLog(v => !v)}
            className="w-full px-4 py-3 border-b border-slate-800 flex items-center justify-between hover:bg-slate-800/40 transition-colors text-left">
            <p className="text-white font-semibold text-sm flex items-center gap-2">
              <span className="text-emerald-400">{showLog ? '▼' : '▶'}</span>
              📋 ประวัติการรับเข้ากรอ (Log) — รับอะไรมา เท่าไหร่
            </p>
            <span className="text-slate-500 text-xs">
              {logRows.length} รายการ · รวม {fmt(logRows.reduce((s, r) => s + (r.weight ?? 0), 0))} Kg
            </span>
          </button>

          {showLog && (
            logRows.length === 0 ? (
              <div className="py-10 text-center text-slate-600 text-sm">ยังไม่มีประวัติการรับเข้ากรอ</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-[10px] text-slate-500 uppercase tracking-wider border-b border-slate-800 bg-slate-900/60">
                    <tr>
                      {['รับเมื่อ','เครื่องเดิม','Lot','สินค้า','ลูกค้า','นน. (Kg)','สถานะ','ผู้รับ'].map(h => (
                        <th key={h} className="px-3 py-2 text-left font-semibold whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/40">
                    {logRows.map(r => {
                      const st = reworkStatusLabel(r.rework_status)
                      return (
                        <tr key={r.id} className="hover:bg-slate-800/30">
                          <td className="px-3 py-1.5 text-slate-400 whitespace-nowrap text-xs">{fmtDateTime(r.rework_received_at || r.created_at)}</td>
                          <td className="px-3 py-1.5 text-white font-bold whitespace-nowrap">{r.machine_no || '—'}</td>
                          <td className="px-3 py-1.5 text-slate-300 font-mono text-xs whitespace-nowrap">{r.lot_no || '—'}</td>
                          <td className="px-3 py-1.5 text-slate-300 text-xs max-w-[200px] truncate" title={r.product_name}>{r.product_name || '—'}</td>
                          <td className="px-3 py-1.5 text-slate-400 text-xs max-w-[140px] truncate" title={r.customer}>{r.customer || '—'}</td>
                          <td className="px-3 py-1.5 text-orange-300 font-bold whitespace-nowrap">{fmt(r.weight)}</td>
                          <td className="px-3 py-1.5"><span className={`text-[10px] font-bold px-2 py-0.5 rounded whitespace-nowrap ${st.cls}`}>{st.txt}</span></td>
                          <td className="px-3 py-1.5 text-slate-300 text-xs whitespace-nowrap">{r.rework_received_by || r.transferred_by || '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )
          )}
        </div>

      </div>

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
        core_weight:   '1.25',
        decimal_places: 2,
        planned_qty:   rollKg.toString(),
        inspector:     by.trim(),
        label_size:    'long',
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
