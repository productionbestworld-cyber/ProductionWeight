import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  BarChart as HBarChart, Cell
} from 'recharts'
import type { ProductionRecord, KpiData } from '../lib/types'
import { fmt, pct, machineAgg, customerAgg, MACHINE_COLORS, PALETTE } from '../lib/utils'

interface Props { data: ProductionRecord[]; kpi: KpiData }

function KpiCard({ label, value, unit, sub, color }: {
  label: string; value: string; unit: string; sub?: string; color: string
}) {
  return (
    <div className={`bg-white rounded-xl shadow-sm p-5 border-l-4`} style={{ borderLeftColor: color }}>
      <p className="text-xs text-gray-400 font-medium mb-1">{label}</p>
      <div>
        <span className="text-3xl font-bold text-gray-800">{value}</span>
        <span className="text-sm text-gray-400 ml-1">{unit}</span>
      </div>
      {sub && <p className="text-xs mt-1.5" style={{ color }}>{sub}</p>}
    </div>
  )
}

export default function DashboardTab({ data, kpi }: Props) {
  const machData = machineAgg(data)
  const custData = customerAgg(data)

  // machine summary table
  const machMap: Record<string, { fg: number; sc: number; rw: number; rolls: number; causes: Record<string, number> }> = {}
  data.forEach(r => {
    if (!r.machine) return
    if (!machMap[r.machine]) machMap[r.machine] = { fg: 0, sc: 0, rw: 0, rolls: 0, causes: {} }
    machMap[r.machine].fg    += r.fg_kg     ?? 0
    machMap[r.machine].sc    += r.scrap_kg  ?? 0
    machMap[r.machine].rw    += r.rework_kg ?? 0
    machMap[r.machine].rolls += r.fg_rolls  ?? 0
    if (r.cause && r.cause !== '-') {
      const c = r.cause.trim()
      machMap[r.machine].causes[c] = (machMap[r.machine].causes[c] ?? 0) + 1
    }
  })

  const machRows = Object.entries(machMap)
    .filter(([,v]) => v.fg > 0 || v.sc > 0)
    .sort((a, b) => b[1].fg - a[1].fg)
    .map(([m, v]) => ({
      m, ...v,
      scP: v.fg > 0 ? v.sc/v.fg*100 : 0,
      rwP: v.fg > 0 ? v.rw/v.fg*100 : 0,
      topCause: Object.entries(v.causes).sort((a,b)=>b[1]-a[1])[0]?.[0] ?? '-',
    }))

  return (
    <div className="space-y-5">
      {/* ── KPI ชุดที่ 1 — ผลิต (ออกจากเครื่อง) ── */}
      {(() => {
        const fgFirst   = Math.max(0, kpi.fg - kpi.rwFg)
        const prodScrap = Math.max(0, kpi.sc - kpi.rwScrap)
        const remain    = Math.max(0, kpi.rw - kpi.rwFg - kpi.rwScrap)
        const pOf = (v: number, base: number) => base > 0 ? pct(v/base*100) : '0%'
        return (
        <div className="space-y-3">
          <div>
            <p className="text-xs font-bold text-gray-500 mb-2">🏭 ผลิต (ออกจากเครื่อง)</p>
            <div className="grid grid-cols-4 gap-4">
              <KpiCard label="📦 ผลิตออกมาทั้งหมด" value={fmt(kpi.t, 1)} unit="kg" sub="FG ผลิตได้ + กรอ + เศษ" color="#8b5cf6" />
              <KpiCard label="✅ FG ผลิตได้เลย" value={fmt(fgFirst, 1)} unit="kg" sub={`${kpi.rolls.toLocaleString('th-TH')} ม้วน · ${pOf(fgFirst, kpi.t)} ของผลิต`} color="#6366f1" />
              <KpiCard label="🔄 กรอ (ม้วนเสีย)" value={fmt(kpi.rw, 1)} unit="kg" sub={`${pOf(kpi.rw, kpi.t)} ของผลิต`} color="#f97316" />
              <KpiCard label="🗑 เศษ (จากผลิต)" value={fmt(prodScrap, 1)} unit="kg" sub={`${pOf(prodScrap, kpi.t)} ของผลิต`} color="#ef4444" />
            </div>
          </div>
          {/* ── KPI ชุดที่ 2 — ผลของการกรอ ── */}
          <div>
            <p className="text-xs font-bold text-gray-500 mb-2">🔧 ผลของการกรอ (รับเข้ากรอ {fmt(kpi.rw, 1)} kg → ออกมาเป็น...)</p>
            <div className="grid grid-cols-4 gap-4">
              <KpiCard label="📥 รับเข้ากรอ" value={fmt(kpi.rw, 1)} unit="kg" sub="ม้วนเสียที่ส่งไปกรอ" color="#f59e0b" />
              <KpiCard label="✅ กรอคืนเป็น FG" value={fmt(kpi.rwFg, 1)} unit="kg" sub={`${pOf(kpi.rwFg, kpi.rw)} ของรับเข้า · ไปรวม FG`} color="#10b981" />
              <KpiCard label="🗑 กรอออกมาเป็นเศษ" value={fmt(kpi.rwScrap, 1)} unit="kg" sub={`${pOf(kpi.rwScrap, kpi.rw)} ของรับเข้า`} color="#ef4444" />
              <KpiCard label="⏳ เหลือรอกรอ" value={fmt(remain, 1)} unit="kg" sub={`${pOf(remain, kpi.rw)} ของรับเข้า`} color="#94a3b8" />
            </div>
          </div>
        </div>
        )
      })()}

      {/* Charts */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white rounded-xl shadow-sm p-5">
          <p className="font-bold text-gray-800 text-sm mb-4">🏭 ผลผลิตต่อเครื่องจักร (kg)</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={machData} margin={{ top: 15, right: 10, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="m" tick={{ fontSize: 11, fill: '#94a3b8' }} />
              <YAxis tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v} tick={{ fontSize: 10, fill: '#94a3b8' }} />
              <Tooltip formatter={(v: any, name: any) => [fmt(Number(v), 1) + " kg", String(name ?? "")]} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="fg" name="FG" fill="#6366f1" radius={[4,4,0,0]} label={{ position: 'top', fontSize: 9, fill: '#94a3b8', formatter: (v: any) => Number(v) >= 1000 ? `${(Number(v)/1000).toFixed(1)}k` : Number(v).toFixed(0) }} />
              <Bar dataKey="sc" name="ของเสีย" fill="#f87171" radius={[4,4,0,0]} />
              <Bar dataKey="rw" name="ซ่อม" fill="#fb923c" radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-5">
          <p className="font-bold text-gray-800 text-sm mb-4">👥 FG ต่อลูกค้า (kg)</p>
          <ResponsiveContainer width="100%" height={220}>
            <HBarChart data={[...custData].reverse()} layout="vertical" margin={{ top: 0, right: 50, bottom: 0, left: 30 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
              <XAxis type="number" tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v} tick={{ fontSize: 10, fill: '#94a3b8' }} />
              <YAxis dataKey="c" type="category" tick={{ fontSize: 11, fill: '#374151' }} width={35} />
              <Tooltip formatter={(v: any) => [fmt(Number(v), 1) + ' kg', 'FG']} />
              <Bar dataKey="fg" name="FG" label={{ position: 'right', fontSize: 9, fill: '#64748b', formatter: (v: any) => Number(v) >= 1000 ? `${(Number(v)/1000).toFixed(1)}k` : Number(v).toFixed(0) }} radius={[0, 4, 4, 0]}>
                {[...custData].reverse().map((_, i) => (
                  <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                ))}
              </Bar>
            </HBarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Machine Summary Table */}
      <div className="bg-white rounded-xl shadow-sm p-5">
        <p className="font-bold text-gray-800 text-sm mb-4">📊 สรุปต่อเครื่องจักร</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                {['เครื่อง', 'FG (kg)', 'ม้วน', 'เสีย (kg)', '%เสีย', 'ซ่อม (kg)', '%ซ่อม', 'สาเหตุหลัก'].map(h => (
                  <th key={h} className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {machRows.map(r => (
                <tr key={r.m} className="hover:bg-gray-50">
                  <td className="px-3 py-2 font-bold text-sm" style={{ color: MACHINE_COLORS[r.m] ?? '#374151' }}>{r.m}</td>
                  <td className="px-3 py-2 text-right font-medium text-gray-700">{fmt(r.fg, 1)}</td>
                  <td className="px-3 py-2 text-right text-gray-500">{r.rolls.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right text-red-600">{fmt(r.sc, 1)}</td>
                  <td className="px-3 py-2 text-right text-red-500 text-xs">{pct(r.scP)}</td>
                  <td className="px-3 py-2 text-right text-orange-500">{fmt(r.rw, 1)}</td>
                  <td className="px-3 py-2 text-right text-orange-400 text-xs">{pct(r.rwP)}</td>
                  <td className="px-3 py-2 text-gray-500 text-xs max-w-32 truncate">{r.topCause}</td>
                </tr>
              ))}
              {machRows.length === 0 && (
                <tr><td colSpan={8} className="py-8 text-center text-gray-300">ไม่มีข้อมูล</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
