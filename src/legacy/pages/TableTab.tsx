import type { ProductionRecord } from '../lib/types'
import { fmt, MACHINE_COLORS } from '../lib/utils'

interface Props { data: ProductionRecord[] }

export default function TableTab({ data }: Props) {
  return (
    <div className="bg-white rounded-xl shadow-sm p-5">
      <div className="flex items-center justify-between mb-4">
        <p className="font-bold text-gray-800 text-sm">📋 ตารางข้อมูลการผลิต</p>
        <span className="text-xs text-gray-400">{data.length.toLocaleString()} รายการ</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              {['วันที่', 'เครื่อง', 'กะ', 'ลูกค้า', 'ขนาด', 'รหัสสินค้า', 'FG (kg)', 'ม้วน', 'เสีย (kg)', 'ซ่อม (kg)', 'อาการ', 'สาเหตุ'].map(h => (
                <th key={h} className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {data.slice(0, 500).map((r, i) => (
              <tr key={i} className="hover:bg-gray-50">
                <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{r.production_date ?? '-'}</td>
                <td className="px-3 py-2 font-bold" style={{ color: MACHINE_COLORS[r.machine] ?? '#374151' }}>{r.machine ?? '-'}</td>
                <td className="px-3 py-2 text-gray-500">{r.shift ?? '-'}</td>
                <td className="px-3 py-2 text-gray-700">{r.customer ?? '-'}</td>
                <td className="px-3 py-2 text-gray-400 text-xs">{r.size ?? '-'}</td>
                <td className="px-3 py-2 text-gray-400 text-xs">{r.product_code ?? '-'}</td>
                <td className="px-3 py-2 text-right font-medium text-gray-700">{r.fg_kg ? fmt(r.fg_kg) : '-'}</td>
                <td className="px-3 py-2 text-right text-gray-500">{r.fg_rolls ?? '-'}</td>
                <td className="px-3 py-2 text-right text-red-500">{r.scrap_kg ? fmt(r.scrap_kg) : '-'}</td>
                <td className="px-3 py-2 text-right text-orange-500">{r.rework_kg ? fmt(r.rework_kg) : '-'}</td>
                <td className="px-3 py-2 text-gray-500 text-xs max-w-32 truncate">{r.symptom ?? '-'}</td>
                <td className="px-3 py-2 text-gray-400 text-xs max-w-32 truncate">{r.cause ?? '-'}</td>
              </tr>
            ))}
            {data.length === 0 && (
              <tr><td colSpan={12} className="py-10 text-center text-gray-300">ไม่มีข้อมูล</td></tr>
            )}
          </tbody>
        </table>
        {data.length > 500 && (
          <p className="text-center text-xs text-gray-400 mt-3">แสดง 500 แถวแรก จาก {data.length.toLocaleString()} แถว</p>
        )}
      </div>
    </div>
  )
}
