import { useState, useRef } from 'react'
import { X, Upload, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabase'
import { parseExcelRows } from '../lib/utils'

interface Props { onClose: () => void; onDone: () => void }

type Step = 'idle' | 'parsing' | 'uploading' | 'done' | 'error'

export default function UploadModal({ onClose, onDone }: Props) {
  const [step, setStep]       = useState<Step>('idle')
  const [msg, setMsg]         = useState('')
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function processFile(file: File) {
    setStep('parsing')
    setMsg('กำลังอ่านไฟล์ Excel...')
    try {
      const buf  = await file.arrayBuffer()
      const wb   = XLSX.read(buf, { type: 'array' })
      // find sheet: Data > All_Data > BL*
      const name = wb.SheetNames.find(n => /^data$/i.test(n))
        ?? wb.SheetNames.find(n => /all.?data/i.test(n))
        ?? wb.SheetNames.find(n => /^bl\d/i.test(n))
        ?? wb.SheetNames[0]
      const ws   = wb.Sheets[name]
      const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null })
      const allRecords = parseExcelRows(rows) // header detection handled inside

      // 1) dedupe ในไฟล์เดียวกัน (กันคนพิมพ์ซ้ำในไฟล์)
      const fileSeen = new Map<string, typeof allRecords[0]>()
      allRecords.forEach(r => { if (r.row_key) fileSeen.set(r.row_key, r) })
      const uniqInFile = [...fileSeen.values()]

      // 2) ดึง row_key ที่มีอยู่ใน DB ในช่วงวันที่ของไฟล์
      setMsg(`ตรวจสอบข้อมูลซ้ำ...`)
      const dates = uniqInFile.map(r => r.production_date).filter(Boolean) as string[]
      const minDate = dates.reduce((a, b) => a < b ? a : b)
      const maxDate = dates.reduce((a, b) => a > b ? a : b)
      const existingKeys = new Set<string>()
      const PAGE = 1000
      let from = 0
      while (true) {
        const { data } = await supabase.from('production_records')
          .select('row_key')
          .gte('production_date', minDate)
          .lte('production_date', maxDate)
          .range(from, from + PAGE - 1)
        if (!data || data.length === 0) break
        data.forEach(r => { if (r.row_key) existingKeys.add(r.row_key) })
        if (data.length < PAGE) break
        from += PAGE
      }

      // 3) แถวใหม่เท่านั้น
      const newRecords = uniqInFile.filter(r => r.row_key && !existingKeys.has(r.row_key))
      const skipped    = uniqInFile.length - newRecords.length

      if (newRecords.length === 0) {
        setStep('done')
        setMsg(`ไม่มีแถวใหม่ — ข้ามแถวซ้ำ ${skipped.toLocaleString()} แถวทั้งหมด`)
        setTimeout(() => { onDone(); onClose() }, 1800)
        return
      }

      setMsg(`เพิ่มข้อมูลใหม่ ${newRecords.length.toLocaleString()} แถว (ข้าม ${skipped.toLocaleString()} แถวซ้ำ)`)
      setStep('uploading')

      const BATCH = 500
      let done = 0
      setProgress({ done: 0, total: newRecords.length })
      for (let i = 0; i < newRecords.length; i += BATCH) {
        const b = newRecords.slice(i, i + BATCH)
        const { error } = await supabase.from('production_records').insert(b)
        if (error) throw new Error(error.message)
        done += b.length
        setProgress({ done, total: newRecords.length })
      }
      setStep('done')
      setMsg(`✓ เพิ่มสำเร็จ ${newRecords.length.toLocaleString()} แถวใหม่ · ข้าม ${skipped.toLocaleString()} แถวซ้ำ`)
      setTimeout(() => { onDone(); onClose() }, 2000)
    } catch (e: any) {
      setStep('error')
      setMsg(e?.message ?? 'เกิดข้อผิดพลาด')
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files[0]
    if (f) processFile(f)
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (f) processFile(f)
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-bold text-gray-800 text-lg">อัปโหลดข้อมูล Excel</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors"><X size={20} /></button>
        </div>

        <div className="p-6">
          {step === 'idle' && (
            <>
              <div
                onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
                onClick={() => inputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
                  dragOver ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:border-blue-300 hover:bg-gray-50'
                }`}>
                <Upload size={36} className="text-gray-400 mx-auto mb-3" />
                <p className="font-semibold text-gray-700 text-sm">ลากไฟล์มาวาง หรือคลิกเพื่อเลือก</p>
                <p className="text-gray-400 text-xs mt-1">รองรับ .xlsx / .xls</p>
                <input ref={inputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={onFileChange} />
              </div>
              <div className="bg-green-50 border border-green-200 rounded-xl p-3 mt-4 text-xs text-green-700 leading-relaxed">
                ✓ ระบบจะตรวจสอบและเพิ่มเฉพาะแถวใหม่ — แถวที่อัปโหลดไปแล้วจะถูกข้าม<br/>
                ✓ พนักงานสามารถใช้ไฟล์เดิม เพิ่มข้อมูลวันใหม่แล้วอัปโหลดได้เลย
              </div>
            </>
          )}

          {(step === 'parsing' || step === 'uploading') && (
            <div className="text-center py-6">
              <Loader2 size={36} className="text-blue-500 mx-auto mb-4 animate-spin" />
              <p className="font-semibold text-gray-700">{msg}</p>
              {step === 'uploading' && progress.total > 0 && (
                <div className="mt-4">
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full transition-all"
                      style={{ width: `${(progress.done / progress.total) * 100}%` }} />
                  </div>
                  <p className="text-xs text-gray-400 mt-1">
                    {progress.done.toLocaleString()} / {progress.total.toLocaleString()} แถว
                  </p>
                </div>
              )}
            </div>
          )}

          {step === 'done' && (
            <div className="text-center py-6">
              <CheckCircle2 size={36} className="text-green-500 mx-auto mb-4" />
              <p className="font-semibold text-green-700">{msg}</p>
            </div>
          )}

          {step === 'error' && (
            <div className="text-center py-6">
              <AlertCircle size={36} className="text-red-500 mx-auto mb-4" />
              <p className="font-semibold text-red-600 mb-4">{msg}</p>
              <button onClick={() => setStep('idle')}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm font-medium transition-colors">
                ลองใหม่
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
