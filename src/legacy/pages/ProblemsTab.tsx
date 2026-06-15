import type { ProductionRecord } from '../lib/types'
import { fmt, symptomAgg, machineCauseAgg, BLS, MACHINE_COLORS } from '../lib/utils'

interface Props { data: ProductionRecord[] }

export default function ProblemsTab({ data }: Props) {
  const symptoms = symptomAgg(data)
  const machineCauses = machineCauseAgg(data)

  const totalLoss = symptoms.reduce((s, r) => s + r.l, 0)

  return (
    <div className="space-y-5">
      {/* Top symptoms */}
      <div className="bg-white rounded-xl shadow-sm p-5">
        <p className="font-bold text-gray-800 text-sm mb-4">⚠️ อาการที่พบบ่อย (Top 15)</p>
        <div className="space-y-2.5">
          {symptoms.map((s, i) => {
            const w = totalLoss > 0 ? (s.l / totalLoss) * 100 : 0
            return (
              <div key={s.s}>
                <div className="flex justify-between items-baseline mb-1">
                  <span className="text-sm font-medium text-gray-700">{i+1}. {s.s}</span>
                  <div className="flex gap-4 text-xs text-gray-400">
                    <span>{s.n} ครั้ง</span>
                    <span className="text-red-500 font-semibold">{fmt(s.l, 1)} kg</span>
                  </div>
                </div>
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-red-400 rounded-full" style={{ width: `${w}%` }} />
                </div>
              </div>
            )
          })}
          {symptoms.length === 0 && <p className="text-gray-300 text-center py-6">ไม่มีข้อมูล</p>}
        </div>
      </div>

      {/* Cause per machine */}
      <div className="bg-white rounded-xl shadow-sm p-5">
        <p className="font-bold text-gray-800 text-sm mb-4">⚙️ สาเหตุต่อเครื่องจักร</p>
        <div className="grid grid-cols-3 gap-3">
          {BLS.filter(bl => machineCauses[bl]).map(bl => (
            <div key={bl} className="bg-gray-50 border border-gray-100 rounded-xl p-4">
              <p className="font-bold text-sm mb-3 pb-2 border-b-2" style={{ color: MACHINE_COLORS[bl], borderColor: MACHINE_COLORS[bl] }}>
                {bl}
              </p>
              {machineCauses[bl].slice(0, 5).map(c => (
                <div key={c.c} className="mb-2.5">
                  <div className="flex justify-between items-baseline mb-0.5">
                    <span className="text-xs font-medium text-gray-700 truncate max-w-36">{c.c}</span>
                    <span className="text-xs text-red-500 font-semibold ml-2 shrink-0">{fmt(c.l, 1)} kg</span>
                  </div>
                  <p className="text-[10px] text-gray-400">{c.n} ครั้ง · {Object.entries(c.syms).sort((a,b)=>b[1]-a[1])[0]?.[0] ?? ''}</p>
                </div>
              ))}
            </div>
          ))}
        </div>
        {Object.keys(machineCauses).length === 0 && (
          <p className="text-gray-300 text-center py-6">ไม่มีข้อมูล</p>
        )}
      </div>
    </div>
  )
}
