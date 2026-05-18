import { useEffect, useState } from 'react'
import { History as HistoryIcon, Search, RefreshCw, X, FileText, Download } from 'lucide-react'
import { supabase } from '../lib/supabase'

function fmt(n: number | null | undefined, d = 2) {
  if (n == null || isNaN(n as number)) return (0).toFixed(d)
  return (n as number).toLocaleString('th-TH', { minimumFractionDigits: d, maximumFractionDigits: d })
}
function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('th-TH', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' })
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('th-TH', { day:'2-digit', month:'2-digit', year:'numeric' })
}

export default function History({ dept }: { dept?: 'blow'|'print' }) {
  const [summaries, setSummaries] = useState<any[]>([])
  const [loading,   setLoading]   = useState(true)
  const [selected,  setSelected]  = useState<any|null>(null)
  const [detailRolls, setDetailRolls] = useState<any[]>([])
  const [search,    setSearch]    = useState('')
  const [machineFilter, setMachineFilter] = useState<string>('')
  const [dateFrom, setDateFrom]   = useState('')
  const [dateTo,   setDateTo]     = useState('')

  async function load() {
    setLoading(true)
    let q = supabase.from('job_summaries').select('*').order('closed_at',{ ascending: false })
    if (dateFrom) q = q.gte('closed_at', dateFrom)
    if (dateTo)   q = q.lte('closed_at', dateTo + 'T23:59:59')
    if (dept)     q = q.eq('section', dept)
    const { data } = await q
    setSummaries(data ?? [])
    setLoading(false)
  }
  useEffect(() => { load() }, [dateFrom, dateTo, dept])

  async function openDetail(s: any) {
    setSelected(s)
    const { data } = await supabase.from('production_rolls')
      .select('*').eq('machine_no', s.machine_no).eq('lot_no', s.lot_no)
      .order('created_at',{ ascending: true })
    setDetailRolls(data ?? [])
  }

  // unique machines for filter
  const machines = Array.from(new Set(summaries.map(s => s.machine_no).filter(Boolean))).sort()

  const filtered = summaries.filter(s => {
    if (machineFilter && s.machine_no !== machineFilter) return false
    if (search) {
      const q = search.toLowerCase()
      const blob = `${s.customer} ${s.product_name} ${s.mat_code} ${s.lot_no} ${s.closed_by}`.toLowerCase()
      if (!blob.includes(q)) return false
    }
    return true
  })

  // KPI
  const totalKg     = filtered.reduce((s,r)=>s+(r.good_kg??0),0)
  const totalScrap  = filtered.reduce((s,r)=>s+(r.scrap_kg??0)+(r.bad_kg??0),0)
  const avgYield    = filtered.length > 0 ? Math.round(filtered.reduce((s,r)=>s+(r.yield_pct??0),0) / filtered.length) : 0

  function exportCSV() {
    if (filtered.length === 0) return
    const headers = ['วันที่ปิด','เครื่อง','ลูกค้า','สินค้า','Mat Code','Lot','สั่ง (kg)','ผลิตดี (kg)','ม้วนดี','กรอ (kg)','เศษ (kg)','โอน (kg)','Yield%','ผู้ปิด']
    const rows = filtered.map(s => [
      fmtDateTime(s.closed_at), s.machine_no, s.customer, s.product_name,
      s.mat_code, s.lot_no,
      s.planned_qty, s.good_kg, s.good_rolls, s.bad_kg, s.scrap_kg, s.transferred_kg,
      s.yield_pct + '%', s.closed_by
    ])
    const csv = '﻿' + [headers, ...rows].map(r => r.map(c => `"${(c??'').toString().replace(/"/g,'""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `production_history_${new Date().toISOString().slice(0,10)}.csv`
    a.click()
  }

  return (
    <div className="min-h-[calc(100vh-48px)] bg-[#0a0f1e] p-5">
      <div className="max-w-6xl mx-auto space-y-4">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-white font-bold text-xl flex items-center gap-2">
              <HistoryIcon size={22} className="text-brand-400" /> ประวัติการผลิต
              {dept && (
                <span className={`text-sm font-bold px-2.5 py-0.5 rounded-full border ${
                  dept==='blow' ? 'bg-blue-500/15 text-blue-300 border-blue-500/30' : 'bg-purple-500/15 text-purple-300 border-purple-500/30'
                }`}>{dept==='blow' ? '🌬 ฝั่งเป่า' : '🖨 ฝั่งพิม'}</span>
              )}
            </h1>
            <p className="text-slate-400 text-xs mt-0.5">งานที่ปิดแล้ว — ข้อมูลถาวร</p>
          </div>
          <div className="flex gap-2">
            <button onClick={exportCSV}
              className="flex items-center gap-1.5 text-slate-300 hover:text-white text-xs bg-slate-700 hover:bg-slate-600 px-3 py-1.5 rounded-lg">
              <Download size={12}/> Export CSV
            </button>
            <button onClick={load} className="flex items-center gap-1.5 text-slate-400 hover:text-white text-xs bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg">
              <RefreshCw size={12}/> รีเฟรช
            </button>
          </div>
        </div>

        {/* KPI */}
        <div className="grid grid-cols-4 gap-3">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl px-4 py-3">
            <p className="text-slate-500 text-xs">งานที่ปิดแล้ว</p>
            <p className="text-white text-2xl font-black">{filtered.length} <span className="text-sm font-normal text-slate-400">งาน</span></p>
          </div>
          <div className="bg-green-500/10 border border-green-500/25 rounded-2xl px-4 py-3">
            <p className="text-green-400 text-xs">ผลิตได้ดี</p>
            <p className="text-green-300 text-2xl font-black">{fmt(totalKg,0)} <span className="text-sm font-normal text-slate-400">Kgs.</span></p>
          </div>
          <div className="bg-orange-500/10 border border-orange-500/25 rounded-2xl px-4 py-3">
            <p className="text-orange-400 text-xs">กรอ + เศษ</p>
            <p className="text-orange-300 text-2xl font-black">{fmt(totalScrap,0)} <span className="text-sm font-normal text-slate-400">Kgs.</span></p>
          </div>
          <div className="bg-brand-500/10 border border-brand-500/25 rounded-2xl px-4 py-3">
            <p className="text-brand-400 text-xs">Yield เฉลี่ย</p>
            <p className="text-brand-300 text-2xl font-black">{avgYield}<span className="text-sm font-normal text-slate-400">%</span></p>
          </div>
        </div>

        {/* Filter */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 grid grid-cols-4 gap-3">
          <div className="col-span-2">
            <label className="block text-[10px] text-slate-500 mb-1">ค้นหา</label>
            <div className="relative">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500"/>
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="ลูกค้า, สินค้า, Mat Code, Lot, ผู้ปิด..."
                className="w-full bg-slate-800 border border-slate-700 rounded-xl pl-8 pr-3 py-2 text-sm text-white outline-none focus:border-brand-500" />
            </div>
          </div>
          <div>
            <label className="block text-[10px] text-slate-500 mb-1">เครื่อง</label>
            <select value={machineFilter} onChange={e => setMachineFilter(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-brand-500">
              <option value="">ทุกเครื่อง</option>
              {machines.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] text-slate-500 mb-1">จากวันที่</label>
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-2 py-2 text-xs text-white outline-none focus:border-brand-500" />
            </div>
            <div>
              <label className="block text-[10px] text-slate-500 mb-1">ถึงวันที่</label>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-2 py-2 text-xs text-white outline-none focus:border-brand-500" />
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
          {loading ? (
            <div className="py-16 text-center text-slate-500">กำลังโหลด...</div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center">
              <HistoryIcon size={36} className="text-slate-700 mx-auto mb-2"/>
              <p className="text-slate-500">ไม่พบข้อมูล</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-800/30 text-[10px]">
                    {['ปิดเมื่อ','เครื่อง','ลูกค้า','สินค้า','Lot','สั่ง','ผลิตดี','กรอ','เศษ','Yield','ผู้ปิด',''].map(h=>(
                      <th key={h} className="px-3 py-2 text-left text-slate-500 font-semibold uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                  {filtered.map(s => (
                    <tr key={s.id} className="hover:bg-slate-800/40 cursor-pointer" onClick={() => openDetail(s)}>
                      <td className="px-3 py-2.5 text-slate-300 text-xs">{fmtDate(s.closed_at)}</td>
                      <td className="px-3 py-2.5"><span className="text-[10px] bg-brand-500/20 text-brand-300 font-bold px-1.5 py-0.5 rounded">{s.machine_no}</span></td>
                      <td className="px-3 py-2.5 text-slate-300 text-xs truncate max-w-[120px]">{s.customer}</td>
                      <td className="px-3 py-2.5 text-slate-400 text-xs truncate max-w-[140px]">{s.product_name}</td>
                      <td className="px-3 py-2.5 text-slate-500 text-xs font-mono">{s.lot_no?.slice(-6) ?? '—'}</td>
                      <td className="px-3 py-2.5 text-slate-300 text-xs">{fmt(s.planned_qty,0)}</td>
                      <td className="px-3 py-2.5 text-green-300 font-black">{fmt(s.good_kg)}</td>
                      <td className="px-3 py-2.5 text-orange-300 text-xs">{fmt(s.bad_kg)}</td>
                      <td className="px-3 py-2.5 text-amber-300 text-xs">{fmt(s.scrap_kg)}</td>
                      <td className="px-3 py-2.5">
                        <span className={`text-xs font-bold ${(s.yield_pct??0)>=95?'text-green-300':(s.yield_pct??0)>=85?'text-amber-300':'text-red-300'}`}>{s.yield_pct ?? 0}%</span>
                      </td>
                      <td className="px-3 py-2.5 text-slate-400 text-xs">{s.closed_by}</td>
                      <td className="px-3 py-2.5 text-right">
                        <span className="text-slate-600 text-[10px]">ดูรายละเอียด →</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Detail Modal */}
      {selected && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-3xl max-h-[92vh] flex flex-col shadow-2xl">
            <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between shrink-0">
              <div>
                <p className="text-white font-bold flex items-center gap-2">
                  <FileText size={16} className="text-brand-400"/>
                  {selected.product_name}
                </p>
                <p className="text-slate-400 text-xs mt-0.5">
                  {selected.machine_no} · Lot {selected.lot_no} · ปิดเมื่อ {fmtDateTime(selected.closed_at)}
                </p>
              </div>
              <button onClick={() => setSelected(null)} className="text-slate-400 hover:text-white">
                <X size={18}/>
              </button>
            </div>

            <div className="px-5 py-4 overflow-y-auto space-y-3">
              {/* Summary */}
              <div className="grid grid-cols-4 gap-2">
                <div className="bg-slate-800 rounded-xl p-3 text-center">
                  <p className="text-slate-500 text-[10px]">ยอดสั่ง</p>
                  <p className="text-white font-black">{fmt(selected.planned_qty,0)}</p>
                </div>
                <div className="bg-green-500/10 border border-green-500/25 rounded-xl p-3 text-center">
                  <p className="text-green-400 text-[10px]">ผลิตดี</p>
                  <p className="text-green-300 font-black">{fmt(selected.good_kg)}</p>
                  <p className="text-slate-500 text-[9px]">{selected.good_rolls} ม้วน</p>
                </div>
                <div className="bg-orange-500/10 border border-orange-500/25 rounded-xl p-3 text-center">
                  <p className="text-orange-400 text-[10px]">ม้วนกรอ</p>
                  <p className="text-orange-300 font-black">{fmt(selected.bad_kg)}</p>
                  <p className="text-slate-500 text-[9px]">{selected.bad_rolls} ม้วน</p>
                </div>
                <div className="bg-brand-500/10 border border-brand-500/25 rounded-xl p-3 text-center">
                  <p className="text-brand-400 text-[10px]">Yield</p>
                  <p className="text-brand-300 font-black">{selected.yield_pct}%</p>
                </div>
              </div>

              <div className="bg-slate-800 rounded-xl p-3 space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-slate-500">ลูกค้า</span><b className="text-white">{selected.customer}</b></div>
                <div className="flex justify-between"><span className="text-slate-500">Mat Code</span><b className="text-white font-mono">{selected.mat_code}</b></div>
                <div className="flex justify-between"><span className="text-slate-500">เศษเสีย</span><b className="text-amber-300">{fmt(selected.scrap_kg)} Kgs.</b></div>
                <div className="flex justify-between"><span className="text-slate-500">โอนเข้าคลัง</span><b className="text-green-300">{fmt(selected.transferred_kg)} Kgs.</b></div>
                <div className="flex justify-between"><span className="text-slate-500">ผู้ปิดงาน</span><b className="text-white">{selected.closed_by}</b></div>
              </div>

              {/* Rolls list */}
              {detailRolls.length > 0 && (
                <div>
                  <p className="text-slate-400 text-xs font-semibold mb-2">รายม้วน ({detailRolls.length})</p>
                  <div className="bg-slate-800 rounded-xl overflow-hidden max-h-64 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-700/50 sticky top-0">
                        <tr>
                          {['เวลา','ประเภท','ม้วน','สุทธิ','โอน','ผู้ตรวจ'].map(h => (
                            <th key={h} className="px-2 py-1.5 text-left text-slate-500 text-[9px] uppercase font-semibold">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-700/30">
                        {detailRolls.map(r => {
                          const labels: Record<string,string> = {
                            good:'ดี', bad:'กรอ', scrap_clear:'เศษใส', scrap_color:'เศษสี', scrap_lump:'เศษก้อน'
                          }
                          return (
                            <tr key={r.id}>
                              <td className="px-2 py-1.5 text-slate-500">{new Date(r.created_at).toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'})}</td>
                              <td className="px-2 py-1.5 text-slate-400">{labels[r.roll_type]||r.roll_type}</td>
                              <td className="px-2 py-1.5 text-white font-mono">{r.roll_no??'—'}</td>
                              <td className="px-2 py-1.5 text-brand-300 font-bold">{fmt(r.weight)}</td>
                              <td className="px-2 py-1.5">{r.transferred ? <span className="text-green-400">✓</span> : <span className="text-slate-700">—</span>}</td>
                              <td className="px-2 py-1.5 text-slate-400">{r.inspector||'—'}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
