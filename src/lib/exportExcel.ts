import * as XLSX from 'xlsx'

export type ExportColumn<T> = {
  header: string
  /** key ใน object หรือฟังก์ชันดึงค่า */
  value: keyof T | ((row: T) => any)
  width?: number
}

function cell<T>(row: T, col: ExportColumn<T>): any {
  const v = typeof col.value === 'function' ? (col.value as (r: T) => any)(row) : (row as any)[col.value]
  if (v == null) return ''
  if (v instanceof Date) return v
  return v
}

/**
 * Export ข้อมูลเป็นไฟล์ .xlsx (ชีตเดียว)
 * @param rows   ข้อมูล
 * @param cols   นิยามคอลัมน์ (header + วิธีดึงค่า)
 * @param opts   ชื่อไฟล์ / ชื่อชีต
 */
export function exportToExcel<T>(
  rows: T[],
  cols: ExportColumn<T>[],
  opts: { fileName: string; sheetName?: string } ,
) {
  const aoa: any[][] = [cols.map(c => c.header)]
  for (const r of rows) aoa.push(cols.map(c => cell(r, c)))

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = cols.map(c => ({ wch: c.width ?? Math.max(10, c.header.length + 2) }))

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, (opts.sheetName ?? 'ข้อมูล').slice(0, 31))

  const stamp = new Date().toISOString().slice(0, 10)
  const name = opts.fileName.endsWith('.xlsx') ? opts.fileName : `${opts.fileName}_${stamp}.xlsx`
  XLSX.writeFile(wb, name)
}

/** Export หลายชีตในไฟล์เดียว */
export function exportSheetsToExcel(
  sheets: { name: string; aoa: any[][]; colWidths?: number[] }[],
  fileName: string,
) {
  const wb = XLSX.utils.book_new()
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(s.aoa)
    if (s.colWidths) ws['!cols'] = s.colWidths.map(w => ({ wch: w }))
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31))
  }
  const stamp = new Date().toISOString().slice(0, 10)
  const name = fileName.endsWith('.xlsx') ? fileName : `${fileName}_${stamp}.xlsx`
  XLSX.writeFile(wb, name)
}
