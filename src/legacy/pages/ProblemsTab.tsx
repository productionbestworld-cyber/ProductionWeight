import type { ProductionRecord } from '../lib/types'
import { fmt, symptomAgg, machineCauseAgg, machineColor, NO_SYMPTOM } from '../lib/utils'

interface Props { data: ProductionRecord[] }

export default function ProblemsTab({ data }: Props) {
  const allSymptoms = symptomAgg(data)
  const machineCauses = machineCauseAgg(data)

  // ตัวหารต้องเป็น loss ทั้งหมด ไม่ใช่แค่ Top 15 มิฉะนั้นสัดส่วนแถบจะเกินความจริง
  const totalLoss = allSymptoms.reduce((s, r) => s + r.l, 0)
  const unlabelled = allSymptoms.find(s => s.s === NO_SYMPTOM)
  const symptoms = allSymptoms.filter(s => s.s !== NO_SYMPTOM).slice(0, 15)
  const shown = symptoms.reduce((s, r) => s + r.l, 0)

  // "ของเสีย" (ทิ้งจริง) กับ "ของส่งกรอ" (ยังกู้กลับเป็น FG ได้) ต้องแยกให้ชัด
  // ไม่งั้นตัวเลขรวมจะถูกอ่านว่าโรงงานทิ้งของทั้งหมดนั้น
  const scrapKg  = data.reduce((s, r) => s + (r.scrap_kg ?? 0), 0)
  const reworkKg = data.reduce((s, r) => s + (r.rework_kg ?? 0), 0)

  return (
    <div className="space-y-5">
      {/* Top symptoms */}
      <div className="bg-white rounded-xl shadow-sm p-5">
        <p className="font-bold text-gray-800 text-sm mb-1">⚠️ อาการที่พบบ่อย (Top 15)</p>
        <p className="text-xs text-gray-500 mb-3">
          จัดอันดับตามน้ำหนักที่มีปัญหา = <b className="text-red-600">ของเสียทิ้ง {fmt(scrapKg, 1)} kg</b>
          {' + '}<b className="text-orange-600">ของส่งกรอ {fmt(reworkKg, 1)} kg</b>
          {' = '}<b className="text-gray-700">{fmt(totalLoss, 1)} kg</b>
          <span className="text-gray-400">{' · '}Top 15 ครอบคลุม {totalLoss > 0 ? (shown / totalLoss * 100).toFixed(1) : '0.0'}%</span>
        </p>
        <p className="text-[11px] text-gray-400 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 mb-3">
          ℹ️ "ของส่งกรอ" ไม่ใช่ของที่ทิ้ง — ส่วนใหญ่กรอกลับมาเป็นม้วนดีและถูกนับใน FG แล้ว
          ตัวเลขที่เสียทิ้งจริงคือ {fmt(scrapKg, 1)} kg
        </p>
        {unlabelled && (
          <p className="text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mb-3">
            ⚠️ มี {unlabelled.n.toLocaleString()} รายการ ({fmt(unlabelled.l, 1)} kg ·{' '}
            {(unlabelled.l / totalLoss * 100).toFixed(1)}%) ที่ <b>ไม่ได้บันทึกอาการ</b> —
            ตารางนี้จึงยังไม่ครอบคลุมทั้งหมด
          </p>
        )}
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
          {Object.keys(machineCauses).map(bl => (
            <div key={bl} className="bg-gray-50 border border-gray-100 rounded-xl p-4">
              <p className="font-bold text-sm mb-3 pb-2 border-b-2" style={{ color: machineColor(bl), borderColor: machineColor(bl) }}>
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
