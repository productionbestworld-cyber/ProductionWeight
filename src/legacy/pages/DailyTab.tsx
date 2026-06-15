import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import type { ProductionRecord } from '../lib/types'
import { fmt, dailyAgg } from '../lib/utils'

interface Props { data: ProductionRecord[] }

export default function DailyTab({ data }: Props) {
  const daily = dailyAgg(data)

  // per-machine per-day
  const machDays: Record<string, Record<string, number>> = {}
  data.forEach(r => {
    if (!r.production_date || !r.machine) return
    if (!machDays[r.production_date]) machDays[r.production_date] = {}
    machDays[r.production_date][r.machine] = (machDays[r.production_date][r.machine] ?? 0) + (r.fg_kg ?? 0)
  })
  const machines = [...new Set(data.map(r => r.machine).filter(Boolean))]

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-xl shadow-sm p-5">
        <p className="font-bold text-gray-800 text-sm mb-4">📅 FG / เสีย / ซ่อม รายวัน (kg)</p>
        <ResponsiveContainer width="100%" height={250}>
          <LineChart data={daily} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="d" tick={{ fontSize: 10, fill: '#94a3b8' }} />
            <YAxis tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v} tick={{ fontSize: 10, fill: '#94a3b8' }} />
            <Tooltip formatter={(v: any, name: any) => [fmt(Number(v), 1) + " kg", String(name ?? "")]} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="fg" name="FG" stroke="#6366f1" strokeWidth={2.5} dot={false} />
            <Line type="monotone" dataKey="sc" name="เสีย" stroke="#f87171" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
            <Line type="monotone" dataKey="rw" name="ซ่อม" stroke="#fb923c" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="bg-white rounded-xl shadow-sm p-5">
        <p className="font-bold text-gray-800 text-sm mb-4">📋 ตารางรายวัน</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                {['วันที่', 'FG (kg)', 'เสีย (kg)', 'ซ่อม (kg)', '%เสีย', '%ซ่อม'].map(h => (
                  <th key={h} className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {daily.map(r => {
                const scP = r.fg > 0 ? r.sc/r.fg*100 : 0
                const rwP = r.fg > 0 ? r.rw/r.fg*100 : 0
                return (
                  <tr key={r.d} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-medium text-gray-700">{r.d}</td>
                    <td className="px-3 py-2 text-right font-semibold text-blue-600">{fmt(r.fg, 1)}</td>
                    <td className="px-3 py-2 text-right text-red-500">{r.sc > 0 ? fmt(r.sc, 1) : '-'}</td>
                    <td className="px-3 py-2 text-right text-orange-500">{r.rw > 0 ? fmt(r.rw, 1) : '-'}</td>
                    <td className="px-3 py-2 text-right text-xs text-red-400">{scP > 0 ? scP.toFixed(2)+'%' : '-'}</td>
                    <td className="px-3 py-2 text-right text-xs text-orange-400">{rwP > 0 ? rwP.toFixed(2)+'%' : '-'}</td>
                  </tr>
                )
              })}
              {daily.length === 0 && (
                <tr><td colSpan={6} className="py-8 text-center text-gray-300">ไม่มีข้อมูล</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
