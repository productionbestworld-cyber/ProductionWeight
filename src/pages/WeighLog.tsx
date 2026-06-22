// ════════════════════════════════════════════════════════════════════════
//  Log การชั่ง — บันทึกทุกการชั่งตามจริง (อ่านอย่างเดียว · READ-ONLY)
//  เปิดผ่าน  ?weighlog=1  หรือ  /weighlog
//  ดึงจาก weigh_logs (เขียนทุกครั้งที่กดบันทึกชั่ง) — แสดง WO/SO/เวลา/นน./ผู้ชั่ง ครบ
// ════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from 'react'
import { supabase, fetchAll } from '../lib/supabase'

type Log = {
  id: string; machine_no: string | null; lot_no: string | null
  work_order: string | null; sale_order: string | null
  item_code: string | null; product_name: string | null; customer: string | null
  roll_no: number | null; roll_type: string | null
  gross_weight: number | null; core_weight: number | null; net_weight: number | null
  remark: string | null; inspector: string | null; weighed_at: string | null
}

const TZ = 'Asia/Bangkok'
const nf = (n: number, d = 2) => (n ?? 0).toLocaleString('th-TH', { minimumFractionDigits: d, maximumFractionDigits: d })
const fmtTime = (iso: string | null) => iso
  ? new Date(iso).toLocaleString('th-TH', { timeZone: TZ, day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
  : '—'

const TYPE: Record<string, { label: string; cls: string }> = {
  good:        { label: 'ม้วนดี',  cls: 'bg-green-500/15 text-green-300' },
  bad:         { label: 'ม้วนกรอ', cls: 'bg-amber-500/15 text-amber-300' },
  scrap_clear: { label: 'เศษใส',   cls: 'bg-slate-500/15 text-slate-300' },
  scrap_color: { label: 'เศษสี',   cls: 'bg-slate-500/15 text-slate-300' },
  scrap_lump:  { label: 'เศษก้อน', cls: 'bg-slate-500/15 text-slate-300' },
}
const typeOf = (t: string | null) => TYPE[t ?? ''] ?? { label: t ?? '—', cls: 'bg-slate-700 text-slate-300' }

type RangeKey = 'today' | '7d' | '30d' | 'all'
function sinceISO(k: RangeKey): string | null {
  const d = new Date()
  if (k === 'today') { d.setHours(0, 0, 0, 0); return new Date(d.getTime() - 7 * 3600e3).toISOString() }
  if (k === '7d') { d.setDate(d.getDate() - 7); return d.toISOString() }
  if (k === '30d') { d.setDate(d.getDate() - 30); return d.toISOString() }
  return null
}

export default function WeighLog() {
  const [logs, setLogs] = useState<Log[]>([])
  const [loading, setLoading] = useState(true)
  const [range, setRange] = useState<RangeKey>('today')
  const [machine, setMachine] = useState('')
  const [type, setType] = useState('')
  const [q, setQ] = useState('')
  const [updated, setUpdated] = useState<Date | null>(null)

  async function load() {
    setLoading(true)
    const since = sinceISO(range)
    const rows = await fetchAll<Log>(() => {
      let qq = supabase.from('weigh_logs')
        .select('id,machine_no,lot_no,work_order,sale_order,item_code,product_name,customer,roll_no,roll_type,gross_weight,core_weight,net_weight,remark,inspector,weighed_at')
        .order('weighed_at', { ascending: false })
      if (since) qq = qq.gte('weighed_at', since)
      return qq
    })
    setLogs(rows); setUpdated(new Date()); setLoading(false)
  }
  useEffect(() => { load() }, [range]) // eslint-disable-line react-hooks/exhaustive-deps

  const machines = useMemo(() => Array.from(new Set(logs.map(l => l.machine_no).filter(Boolean))).sort() as string[], [logs])

  const filtered = useMemo(() => logs.filter(l => {
    if (machine && l.machine_no !== machine) return false
    if (type && l.roll_type !== type) return false
    if (q) {
      const s = q.toLowerCase()
      const blob = `${l.work_order} ${l.sale_order} ${l.lot_no} ${l.product_name} ${l.customer} ${l.inspector} ${l.item_code} #${l.roll_no}`.toLowerCase()
      if (!blob.includes(s)) return false
    }
    return true
  }), [logs, machine, type, q])

  const totNet = filtered.reduce((s, l) => s + (l.net_weight ?? 0), 0)

  const exportCsv = () => {
    const head = ['เวลาชั่ง', 'เครื่อง', 'Lot', 'WO', 'SO', 'สินค้า', 'ลูกค้า', 'ม้วนที่', 'ชนิด', 'นน.เต็ม', 'แกน', 'นน.สุทธิ', 'ผู้ชั่ง', 'หมายเหตุ']
    const lines = filtered.map(l => [fmtTime(l.weighed_at), l.machine_no, l.lot_no, l.work_order, l.sale_order, l.product_name, l.customer,
      l.roll_no, typeOf(l.roll_type).label, l.gross_weight, l.core_weight, l.net_weight, l.inspector, l.remark]
      .map(x => `"${(x ?? '').toString().replace(/"/g, '""')}"`).join(','))
    const blob = new Blob(['﻿' + [head.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
    a.download = `log_การชั่ง_${new Date().toISOString().slice(0, 10)}.csv`; a.click()
  }

  return (
    <div className="min-h-screen bg-[#0a0f1e] text-slate-200">
      <div className="sticky top-0 z-30 bg-[#0a0f1e]/95 backdrop-blur border-b border-slate-800 px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-2xl">📝</span>
            <div>
              <h1 className="text-white font-black text-lg leading-tight">Log การชั่ง</h1>
              <p className="text-slate-500 text-[11px]">บันทึกทุกการชั่งตามจริง · อ่านอย่างเดียว · WO / SO / เวลา / ผู้ชั่ง ครบ</p>
            </div>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <select value={machine} onChange={e => setMachine(e.target.value)} className="bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200">
              <option value="">ทุกเครื่อง</option>
              {machines.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <select value={type} onChange={e => setType(e.target.value)} className="bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200">
              <option value="">ทุกชนิด</option>
              <option value="good">ม้วนดี</option><option value="bad">ม้วนกรอ</option>
              <option value="scrap_clear">เศษใส</option><option value="scrap_color">เศษสี</option><option value="scrap_lump">เศษก้อน</option>
            </select>
            <div className="flex bg-slate-900 rounded-lg p-0.5 border border-slate-800">
              {([['today', 'วันนี้'], ['7d', '7 วัน'], ['30d', '30 วัน'], ['all', 'ทั้งหมด']] as const).map(([k, l]) => (
                <button key={k} onClick={() => setRange(k)} className={`px-2.5 py-1.5 rounded-md text-xs font-bold ${range === k ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-white'}`}>{l}</button>
              ))}
            </div>
            <button onClick={load} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700">⟳</button>
            <button onClick={exportCsv} disabled={!filtered.length} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-green-600/20 text-green-300 border border-green-600/40 hover:bg-green-600/30 disabled:opacity-40">⬇ Excel/CSV</button>
          </div>
        </div>
        <div className="mt-2 flex items-center gap-3">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="ค้นหา WO / SO / Lot / สินค้า / ลูกค้า / ผู้ชั่ง / ม้วน..."
            className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-sm text-white outline-none focus:border-brand-500" />
          <span className="text-xs text-slate-400 whitespace-nowrap">{nf(filtered.length, 0)} รายการ · รวมสุทธิ <b className="text-green-300">{nf(totNet, 1)}</b> kg{updated ? ` · ${updated.toLocaleTimeString('th-TH', { timeZone: TZ })}` : ''}</span>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-32 text-slate-500">
          <div className="w-10 h-10 border-4 border-brand-500/30 border-t-brand-500 rounded-full animate-spin mb-3" />กำลังโหลด...
        </div>
      ) : (
        <div className="p-3">
          <div className="overflow-x-auto rounded-xl border border-slate-800">
            <table className="w-full text-xs">
              <thead className="bg-slate-900 text-slate-500 sticky top-0">
                <tr>
                  {['เวลาชั่ง', 'เครื่อง', 'Lot', 'WO', 'SO', 'สินค้า', 'ลูกค้า', 'ม้วน', 'ชนิด', 'นน.เต็ม', 'แกน', 'นน.สุทธิ', 'ผู้ชั่ง', 'หมายเหตุ'].map(h => (
                    <th key={h} className="text-left px-2.5 py-2 whitespace-nowrap font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 2000).map(l => {
                  const t = typeOf(l.roll_type)
                  return (
                    <tr key={l.id} className="border-t border-slate-800/70 hover:bg-slate-800/40">
                      <td className="px-2.5 py-1.5 text-slate-400 whitespace-nowrap">{fmtTime(l.weighed_at)}</td>
                      <td className="px-2.5 py-1.5"><span className="text-brand-300 font-bold">{l.machine_no || '—'}</span></td>
                      <td className="px-2.5 py-1.5 text-slate-500 font-mono">{l.lot_no || '—'}</td>
                      <td className="px-2.5 py-1.5 text-amber-300 whitespace-nowrap">{l.work_order || '—'}</td>
                      <td className="px-2.5 py-1.5 text-blue-300 whitespace-nowrap">{l.sale_order || '—'}</td>
                      <td className="px-2.5 py-1.5 text-slate-400 max-w-[160px] truncate">{l.product_name || '—'}</td>
                      <td className="px-2.5 py-1.5 text-slate-300 max-w-[130px] truncate">{l.customer || '—'}</td>
                      <td className="px-2.5 py-1.5 text-white font-mono">{String(l.roll_type).startsWith('scrap') ? '—' : `#${l.roll_no}`}</td>
                      <td className="px-2.5 py-1.5"><span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${t.cls}`}>{t.label}</span></td>
                      <td className="px-2.5 py-1.5 text-right text-slate-400">{nf(l.gross_weight ?? 0)}</td>
                      <td className="px-2.5 py-1.5 text-right text-slate-500">{nf(l.core_weight ?? 0)}</td>
                      <td className="px-2.5 py-1.5 text-right text-green-300 font-bold">{nf(l.net_weight ?? 0)}</td>
                      <td className="px-2.5 py-1.5 text-slate-400 whitespace-nowrap">{l.inspector || '—'}</td>
                      <td className="px-2.5 py-1.5 text-slate-500 max-w-[200px] truncate" title={l.remark ?? ''}>{l.remark || ''}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {filtered.length > 2000 && <p className="text-center text-slate-500 text-xs py-3">แสดง 2,000 รายการล่าสุด · กด Excel/CSV เพื่อดูครบ {nf(filtered.length, 0)} รายการ</p>}
          {!filtered.length && <p className="text-center text-slate-500 py-16">ไม่มีรายการในช่วง/เงื่อนไขที่เลือก</p>}
        </div>
      )}
    </div>
  )
}
