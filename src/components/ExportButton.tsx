import { exportToExcel, type ExportColumn } from '../lib/exportExcel'

/** ปุ่ม Export Excel สำเร็จรูป — ใช้ซ้ำได้ทุกหน้า */
export default function ExportButton<T>({
  rows, cols, fileName, sheetName, label = '📥 Export Excel', className, disabled,
}: {
  rows: T[]
  cols: ExportColumn<T>[]
  fileName: string
  sheetName?: string
  label?: string
  className?: string
  disabled?: boolean
}) {
  const empty = !rows || rows.length === 0
  return (
    <button
      onClick={() => exportToExcel(rows, cols, { fileName, sheetName })}
      disabled={disabled || empty}
      title={empty ? 'ไม่มีข้อมูลให้ export' : `ดาวน์โหลด ${rows.length} แถวเป็น Excel`}
      className={className ??
        'flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white px-3 py-2 rounded-lg text-sm font-bold whitespace-nowrap'}>
      {label}{!empty && <span className="opacity-80 font-normal">({rows.length})</span>}
    </button>
  )
}
