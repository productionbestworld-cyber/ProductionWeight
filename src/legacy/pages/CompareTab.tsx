import { useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import type { ProductionRecord } from '../lib/types'
import { fmt, kpiCalc, machineAgg, machineOrder } from '../lib/utils'

interface Props { allData: ProductionRecord[] }

export default function CompareTab({ allData }: Props) {
  const [from1, setFrom1] = useState('')
  const [to1,   setTo1]   = useState('')
  const [from2, setFrom2] = useState('')
  const [to2,   setTo2]   = useState('')

  const d1 = allData.filter(r => (!from1 || r.production_date >= from1) && (!to1 || r.production_date <= to1))
  const d2 = allData.filter(r => (!from2 || r.production_date >= from2) && (!to2 || r.production_date <= to2))
  const k1 = kpiCalc(d1)
  const k2 = kpiCalc(d2)
  const m1 = machineAgg(d1)
  const m2 = machineAgg(d2)

  const m1Map = Object.fromEntries(m1.map(r => [r.m, r]))
  const m2Map = Object.fromEntries(m2.map(r => [r.m, r]))
  // FG = 0 → %เสีย คำนวณไม่ได้ (เดิมหารด้วย 1 ทำให้ได้ค่าเป็นหมื่น %)
  const scrapPct = (r?: { sc: number; fg: number }) =>
    r && r.fg > 0 ? parseFloat(((r.sc / r.fg) * 100).toFixed(2)) : 0
  const scrapData = machineOrder([...new Set([...Object.keys(m1Map), ...Object.keys(m2Map)])]).map(bl => ({
    m: bl,
    '%เสีย ช่วง 1': scrapPct(m1Map[bl]),
    '%เสีย ช่วง 2': scrapPct(m2Map[bl]),
  }))

  function KpiRow({ label, v1, v2, unit }: { label: string; v1: number; v2: number; unit?: string }) {
    const diff = v2 - v1
    const better = diff < 0
    return (
      <tr className="border-b border-gray-50">
        <td className="px-4 py-2.5 text-sm text-gray-600">{label}</td>
        <td className="px-4 py-2.5 text-right font-medium text-gray-800">{fmt(v1)}{unit}</td>
        <td className="px-4 py-2.5 text-right font-medium text-gray-800">{fmt(v2)}{unit}</td>
        <td className={`px-4 py-2.5 text-right text-sm font-semibold ${diff === 0 ? 'text-gray-400' : better ? 'text-green-600' : 'text-red-500'}`}>
          {diff > 0 ? '+' : ''}{fmt(diff)}{unit}
        </td>
      </tr>
    )
  }

  return (
    <div className="space-y-5">
      {/* Date pickers */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white rounded-xl shadow-sm p-4">
          <p className="text-xs font-semibold text-gray-500 mb-3">📅 ช่วงที่ 1</p>
          <div className="flex gap-2 items-center">
            <input type="date" value={from1} onChange={e => setFrom1(e.target.value)}
              className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 outline-none focus:border-blue-400" />
            <span className="text-gray-400">—</span>
            <input type="date" value={to1} onChange={e => setTo1(e.target.value)}
              className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 outline-none focus:border-blue-400" />
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-4">
          <p className="text-xs font-semibold text-gray-500 mb-3">📅 ช่วงที่ 2</p>
          <div className="flex gap-2 items-center">
            <input type="date" value={from2} onChange={e => setFrom2(e.target.value)}
              className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 outline-none focus:border-blue-400" />
            <span className="text-gray-400">—</span>
            <input type="date" value={to2} onChange={e => setTo2(e.target.value)}
              className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 outline-none focus:border-blue-400" />
          </div>
        </div>
      </div>

      {/* KPI Comparison */}
      <div className="bg-white rounded-xl shadow-sm p-5">
        <p className="font-bold text-gray-800 text-sm mb-4">📊 เปรียบเทียบ KPI</p>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">รายการ</th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold text-blue-500">ช่วงที่ 1</th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold text-purple-500">ช่วงที่ 2</th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500">เปลี่ยนแปลง</th>
            </tr>
          </thead>
          <tbody>
            <KpiRow label="FG (kg)"      v1={k1.fg} v2={k2.fg} />
            <KpiRow label="Scrap (kg)"   v1={k1.sc} v2={k2.sc} />
            <KpiRow label="Rework (kg)"  v1={k1.rw} v2={k2.rw} />
            <KpiRow label="%เสีย"        v1={k1.scP} v2={k2.scP} unit="%" />
            <KpiRow label="%ซ่อม"        v1={k1.rwP} v2={k2.rwP} unit="%" />
          </tbody>
        </table>
      </div>

      {/* Scrap % per machine chart */}
      {scrapData.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm p-5">
          <p className="font-bold text-gray-800 text-sm mb-4">%เสีย ต่อเครื่อง: เปรียบเทียบ</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={scrapData} margin={{ top: 15, right: 10, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="m" tick={{ fontSize: 11, fill: '#94a3b8' }} />
              <YAxis tickFormatter={v => v+'%'} tick={{ fontSize: 10, fill: '#94a3b8' }} />
              <Tooltip formatter={(v: any, name: any) => [Number(v) + '%', String(name ?? '')]} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="%เสีย ช่วง 1" fill="#6366f1" radius={[4,4,0,0]} />
              <Bar dataKey="%เสีย ช่วง 2" fill="#10b981" radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
