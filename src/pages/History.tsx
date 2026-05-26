import { useEffect, useState } from 'react'
import { History as HistoryIcon, Search, RefreshCw, X, FileText, Download, Trash2, Activity } from 'lucide-react'
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

export default function History({ dept }: { dept?: 'blow'|'print'|'rewind' }) {
  const [summaries, setSummaries] = useState<any[]>([])
  const [loading,   setLoading]   = useState(true)
  const [selected,  setSelected]  = useState<any|null>(null)
  const [detailRolls, setDetailRolls] = useState<any[]>([])
  const [search,    setSearch]    = useState('')
  const [machineFilter, setMachineFilter] = useState<string>('')
  const [dateFrom, setDateFrom]   = useState('')
  const [dateTo,   setDateTo]     = useState('')
  const [tab, setTab]             = useState<'history'|'deleted'|'machinelog'>('history')
  const [selectedRoll, setSelectedRoll] = useState<any|null>(null)
  const [deletedLogs, setDeletedLogs] = useState<any[]>([])
  const [loadingDel,  setLoadingDel]  = useState(false)
  const [machineLog,  setMachineLog]  = useState<any[]>([])
  const [loadingLog,  setLoadingLog]  = useState(false)
  const [machineProfiles, setMachineProfiles] = useState<Record<string,string>>({})

  async function loadMachineLog() {
    setLoadingLog(true)
    let q = supabase.from('machine_job_log').select('*')
    if (dept) q = q.eq('section', dept)
    const { data } = await q
    setMachineLog(data ?? [])
    // โหลด lot ปัจจุบันของแต่ละเครื่อง
    const { data: profiles } = await supabase.from('machine_profiles').select('machine_no,lot_no')
    const map: Record<string,string> = {}
    profiles?.forEach(p => { if (p.machine_no) map[p.machine_no] = p.lot_no ?? '' })
    setMachineProfiles(map)
    setLoadingLog(false)
  }

  async function loadDeletedLogs() {
    setLoadingDel(true)
    let q = supabase.from('roll_deletion_logs').select('*').order('deleted_at', { ascending: false })
    if (dept) q = q.or(`section.eq.${dept},section.is.null`)
    const { data, error } = await q
    if (error) console.warn('loadDeletedLogs error:', error.message)
    setDeletedLogs(data ?? [])
    setLoadingDel(false)
  }

  async function load() {
    setLoading(true)
    let q = supabase.from('job_summaries').select('*').order('closed_at',{ ascending: false })
    if (dateFrom) q = q.gte('closed_at', dateFrom)
    if (dateTo)   q = q.lte('closed_at', dateTo + 'T23:59:59')
    if (dept)     q = q.or(`section.eq.${dept},section.is.null`)
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
    const headers = ['วันที่ปิด','เครื่อง','ลูกค้า','รหัสสินค้า','สินค้า','Mat Code','Lot','สั่ง (kg)','ผลิตดี (kg)','ม้วนดี','กรอ (kg)','เศษ (kg)','โอน (kg)','Yield%','ผู้ปิด']
    const rows = filtered.map(s => [
      fmtDateTime(s.closed_at), s.machine_no, s.customer,
      s.product_code ?? '', s.product_name,
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
                  dept==='blow' ? 'bg-blue-500/15 text-blue-300 border-blue-500/30' : dept==='print' ? 'bg-purple-500/15 text-purple-300 border-purple-500/30' : 'bg-green-500/15 text-green-300 border-green-500/30'
                }`}>{dept==='blow' ? '🌬 ผลิต(เป่า)' : dept==='print' ? '🖨 ผลิต(พิมพ์)' : '🔁 กรอ(Rework)'}</span>
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

        {/* Tabs */}
        <div className="flex gap-2 border-b border-slate-800 pb-0">
          <button onClick={() => setTab('history')}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-t-lg transition-colors ${tab==='history' ? 'bg-slate-800 text-white border-b-2 border-brand-500' : 'text-slate-500 hover:text-white'}`}>
            <HistoryIcon size={13}/> ประวัติผลิต
          </button>
          <button onClick={() => { setTab('machinelog'); loadMachineLog() }}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-t-lg transition-colors ${tab==='machinelog' ? 'bg-slate-800 text-green-400 border-b-2 border-green-500' : 'text-slate-500 hover:text-green-400'}`}>
            <Activity size={13}/> Log เครื่อง
          </button>
          <button onClick={() => { setTab('deleted'); loadDeletedLogs() }}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-t-lg transition-colors ${tab==='deleted' ? 'bg-slate-800 text-red-400 border-b-2 border-red-500' : 'text-slate-500 hover:text-red-400'}`}>
            <Trash2 size={13}/> Log การลบม้วน
          </button>
        </div>

        {/* ── Tab: Log เครื่อง ── */}
        {tab === 'machinelog' && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
              <p className="text-sm font-semibold text-green-400 flex items-center gap-2"><Activity size={14}/>Log การทำงานของเครื่อง</p>
              <button onClick={loadMachineLog} className="text-slate-500 hover:text-white text-xs flex items-center gap-1">
                <RefreshCw size={11}/> รีเฟรช
              </button>
            </div>
            {loadingLog ? (
              <div className="py-8 text-center text-slate-500 text-sm">กำลังโหลด...</div>
            ) : machineLog.length === 0 ? (
              <div className="py-8 text-center text-slate-600 text-sm">ยังไม่มีข้อมูล</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-500 bg-slate-800/30">
                      {['สถานะ','เครื่อง','สินค้า','Lot','เริ่มชั่ง (ม้วนแรก)','ชั่งล่าสุด','ม้วนดี','ม้วนกรอ','น้ำหนักดี (Kgs.)'].map(h=>(
                        <th key={h} className="px-3 py-2 text-left font-semibold whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/50">
                    {machineLog.map((r,i) => {
                      const isRunning = machineProfiles[r.machine_no] === r.lot_no
                      const duration  = r.started_at && r.last_roll_at
                        ? Math.round((new Date(r.last_roll_at).getTime() - new Date(r.started_at).getTime()) / 60000)
                        : null
                      return (
                        <tr key={i} className={`hover:bg-slate-800/30 ${isRunning ? 'bg-green-500/3' : ''}`}>
                          <td className="px-3 py-2.5">
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                              isRunning ? 'bg-green-500/20 text-green-400' : 'bg-slate-700 text-slate-400'
                            }`}>
                              {isRunning ? '● กำลังเดิน' : '■ จบแล้ว'}
                            </span>
                          </td>
                          <td className="px-3 py-2.5">
                            <span className="font-black text-white bg-brand-600/30 px-2 py-0.5 rounded text-xs">{r.machine_no}</span>
                          </td>
                          <td className="px-3 py-2.5 text-slate-200 max-w-[160px] truncate">{r.product_name || '—'}</td>
                          <td className="px-3 py-2.5 text-slate-400 font-mono text-[10px]">{r.lot_no}</td>
                          <td className="px-3 py-2.5 text-slate-300 whitespace-nowrap">
                            {r.started_at ? fmtDateTime(r.started_at) : '—'}
                          </td>
                          <td className="px-3 py-2.5 whitespace-nowrap">
                            <div className="text-slate-300">{r.last_roll_at ? fmtDateTime(r.last_roll_at) : '—'}</div>
                            {duration !== null && (
                              <div className="text-[10px] text-slate-500">{duration < 60 ? `${duration} นาที` : `${Math.floor(duration/60)} ชม. ${duration%60} นาที`}</div>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-green-300 font-bold">{r.good_rolls ?? 0}</td>
                          <td className="px-3 py-2.5 text-orange-300">{r.bad_rolls ?? 0}</td>
                          <td className="px-3 py-2.5 text-brand-300 font-black">{fmt(r.good_kg ?? 0)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── Tab: Log การลบ ── */}
        {tab === 'deleted' && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
              <p className="text-sm font-semibold text-red-400 flex items-center gap-2"><Trash2 size={14}/>ประวัติการลบม้วน</p>
              <button onClick={loadDeletedLogs} className="text-slate-500 hover:text-white text-xs flex items-center gap-1">
                <RefreshCw size={11}/> รีเฟรช
              </button>
            </div>
            {loadingDel ? (
              <div className="py-8 text-center text-slate-500 text-sm">กำลังโหลด...</div>
            ) : deletedLogs.length === 0 ? (
              <div className="py-8 text-center text-slate-600 text-sm">ยังไม่มีประวัติการลบ</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-500">
                      {['วันที่ลบ','แผนก','เครื่อง','ม้วน','ประเภท','นน.สุทธิ','นน.รวม','Core','Length','ลูกค้า','สินค้า','Item Code','Mat Code','Size','Lot','ผู้ชั่ง','ผู้ลบ','เหตุผล'].map(h=>(
                        <th key={h} className="px-3 py-2 text-left font-semibold whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/50">
                    {deletedLogs.map(r => (
                      <tr key={r.id} className="hover:bg-slate-800/30">
                        <td className="px-3 py-2.5 text-slate-400 whitespace-nowrap">{fmtDateTime(r.deleted_at)}</td>
                        <td className="px-3 py-2.5 text-slate-400">{r.section ?? '—'}</td>
                        <td className="px-3 py-2.5 font-bold text-white">{r.machine_no}</td>
                        <td className="px-3 py-2.5 font-mono text-white">{r.roll_no}</td>
                        <td className="px-3 py-2.5 text-slate-400">{r.roll_type}</td>
                        <td className="px-3 py-2.5 text-red-400 font-bold">{(r.weight??0).toFixed(2)}</td>
                        <td className="px-3 py-2.5 text-slate-300">{r.gross_weight != null ? Number(r.gross_weight).toFixed(2) : '—'}</td>
                        <td className="px-3 py-2.5 text-slate-400">{r.core_weight ?? '—'}</td>
                        <td className="px-3 py-2.5 text-slate-400">{r.length ?? '—'}</td>
                        <td className="px-3 py-2.5 text-slate-300 max-w-[140px] truncate" title={r.cust_name}>{r.cust_name ?? '—'}</td>
                        <td className="px-3 py-2.5 text-slate-300 max-w-[160px] truncate" title={r.product_name}>{r.product_name ?? '—'}</td>
                        <td className="px-3 py-2.5 text-slate-400 font-mono text-[10px]">{r.item_code ?? '—'}</td>
                        <td className="px-3 py-2.5 text-slate-400 font-mono text-[10px]">{r.mat_code ?? '—'}</td>
                        <td className="px-3 py-2.5 text-slate-400 whitespace-nowrap">{(r.width_cm || r.thick_mc) ? `${r.width_cm ?? '?'}×${r.thick_mc ?? '?'}` : '—'}</td>
                        <td className="px-3 py-2.5 text-slate-400 font-mono text-[10px]">{r.lot_no}</td>
                        <td className="px-3 py-2.5 text-slate-300">{r.inspector ?? '—'}</td>
                        <td className="px-3 py-2.5 text-amber-300 font-semibold">{r.deleted_by}</td>
                        <td className="px-3 py-2.5 text-slate-300 max-w-[200px]" title={r.reason}>{r.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {tab === 'history' && <>{/* KPI */}
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
      </>}
      </div>{/* /max-w-6xl */}
      {/* Roll Detail Modal */}
      {selectedRoll && (
        <div className="fixed inset-0 bg-black/70 z-[60] flex items-center justify-center p-4"
          onClick={() => setSelectedRoll(null)}>
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-sm shadow-2xl"
            onClick={e => e.stopPropagation()}>
            {/* header */}
            <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
              <div>
                <p className="text-white font-bold text-sm">
                  ม้วน {selectedRoll.roll_no ?? '—'}
                  <span className={`ml-2 text-[10px] font-bold px-2 py-0.5 rounded ${
                    selectedRoll.roll_type==='good' ? 'bg-green-500/20 text-green-400' :
                    selectedRoll.roll_type==='bad'  ? 'bg-orange-500/20 text-orange-400' :
                    'bg-amber-500/20 text-amber-400'
                  }`}>
                    {({'good':'ม้วนดี','bad':'ม้วนกรอ','scrap_clear':'เศษใส','scrap_color':'เศษสี','scrap_lump':'เศษก้อน'} as any)[selectedRoll.roll_type] ?? selectedRoll.roll_type}
                  </span>
                </p>
                <p className="text-slate-400 text-xs mt-0.5">{selectedRoll.machine_no} · {fmtDateTime(selectedRoll.created_at)}</p>
              </div>
              <button onClick={() => setSelectedRoll(null)} className="text-slate-400 hover:text-white"><X size={18}/></button>
            </div>
            {/* body */}
            <div className="px-5 py-4 space-y-3">
              {/* น้ำหนัก */}
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-slate-800 rounded-xl p-3">
                  <p className="text-slate-500 text-[10px]">นน.เต็ม</p>
                  <p className="text-white font-black text-lg">{fmt((selectedRoll.weight??0)+(selectedRoll.core_weight??0))}</p>
                  <p className="text-slate-600 text-[10px]">Kgs.</p>
                </div>
                <div className="bg-slate-800 rounded-xl p-3">
                  <p className="text-slate-500 text-[10px]">แกน (Core)</p>
                  <p className="text-slate-300 font-bold text-lg">{fmt(selectedRoll.core_weight??0)}</p>
                  <p className="text-slate-600 text-[10px]">Kgs.</p>
                </div>
                <div className="bg-brand-500/10 border border-brand-500/25 rounded-xl p-3">
                  <p className="text-brand-400 text-[10px]">สุทธิ</p>
                  <p className="text-brand-300 font-black text-lg">{fmt(selectedRoll.weight??0)}</p>
                  <p className="text-slate-600 text-[10px]">Kgs.</p>
                </div>
              </div>
              {/* รายละเอียด */}
              <div className="bg-slate-800 rounded-xl p-3 space-y-2 text-sm">
                {[
                  { k:'สินค้า',      v: selectedRoll.product_name },
                  { k:'ลูกค้า',      v: selectedRoll.customer },
                  { k:'SO',          v: selectedRoll.sale_order || '—' },
                  { k:'Lot No',      v: selectedRoll.lot_no },
                  { k:'Mat Code',    v: selectedRoll.mat_code || selectedRoll.lot_no },
                  { k:'ผู้ตรวจสอบ', v: selectedRoll.inspector || '—' },
                  { k:'โอนเข้าคลัง', v: selectedRoll.transferred
                      ? `✓ โดย ${selectedRoll.transferred_by || '—'}`
                      : '— ยังไม่โอน' },
                  { k:'หมายเหตุ',   v: selectedRoll.remark || '—' },
                ].map(({ k, v }) => (
                  <div key={k} className="flex justify-between gap-2">
                    <span className="text-slate-500 shrink-0">{k}</span>
                    <span className={`text-right font-semibold ${k==='โอนเข้าคลัง' ? (selectedRoll.transferred ? 'text-green-400' : 'text-slate-500') : 'text-white'}`}>{v || '—'}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

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
                  <p className="text-slate-400 text-xs font-semibold mb-2">รายม้วน ({detailRolls.length}) — <span className="text-slate-500">คลิกม้วนเพื่อดูรายละเอียด</span></p>
                  <div className="bg-slate-800 rounded-xl overflow-hidden max-h-72 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-700/50 sticky top-0">
                        <tr>
                          {['วันที่/เวลา','ประเภท','ม้วน','นน.เต็ม','สุทธิ','โอน','ผู้ตรวจ',''].map(h => (
                            <th key={h} className="px-2 py-1.5 text-left text-slate-500 text-[9px] uppercase font-semibold">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-700/30">
                        {detailRolls.map(r => {
                          const labels: Record<string,string> = {
                            good:'ดี', bad:'กรอ', scrap_clear:'เศษใส', scrap_color:'เศษสี', scrap_lump:'เศษก้อน'
                          }
                          const d = new Date(r.created_at)
                          const dateShort = `${d.getDate()}/${d.getMonth()+1}`
                          const timeStr   = d.toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'})
                          return (
                            <tr key={r.id} onClick={() => setSelectedRoll(r)}
                              className="hover:bg-slate-700/50 cursor-pointer transition-colors">
                              <td className="px-2 py-2 text-slate-500 leading-tight">
                                <div className="text-[9px] text-slate-600">{dateShort}</div>
                                <div>{timeStr}</div>
                              </td>
                              <td className="px-2 py-2">
                                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                  r.roll_type==='good' ? 'bg-green-500/20 text-green-400' :
                                  r.roll_type==='bad'  ? 'bg-orange-500/20 text-orange-400' :
                                  'bg-amber-500/20 text-amber-400'
                                }`}>{labels[r.roll_type]||r.roll_type}</span>
                              </td>
                              <td className="px-2 py-2 text-white font-mono font-bold">{r.roll_no??'—'}</td>
                              <td className="px-2 py-2 text-slate-400">{fmt((r.weight??0)+(r.core_weight??0))}</td>
                              <td className="px-2 py-2 text-brand-300 font-bold">{fmt(r.weight)}</td>
                              <td className="px-2 py-2">{r.transferred ? <span className="text-green-400 font-bold">✓</span> : <span className="text-slate-700">—</span>}</td>
                              <td className="px-2 py-2 text-slate-400">{r.inspector||'—'}</td>
                              <td className="px-2 py-2 text-slate-600 text-[10px]">→</td>
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
