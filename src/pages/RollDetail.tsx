// หน้านี้แสดงเมื่อสแกน QR — URL: /?roll=<uuid>
import { useEffect, useState } from 'react'
import QRCode from 'react-qr-code'
import { supabase } from '../lib/supabase'

function fmt(n: number | null | undefined, d = 2) {
  if (n == null || isNaN(n as number)) return '—'
  return (n as number).toLocaleString('th-TH', { minimumFractionDigits: d, maximumFractionDigits: d })
}

export default function RollDetail() {
  const raw = new URLSearchParams(window.location.search).get('roll')
  const [roll, setRoll]   = useState<any>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!raw) { setError('ไม่พบข้อมูล'); return }

    // UUID format → ดึงจาก DB
    const uuidRe = /^[0-9a-f-]{36}$/i
    if (uuidRe.test(raw)) {
      supabase.from('production_rolls').select('*').eq('id', raw).single()
        .then(({ data, error: err }) => {
          if (err || !data) setError('ไม่พบม้วนนี้ในระบบ')
          else setRoll(data)
        })
    } else {
      // fallback: base64 JSON เก่า
      try {
        const d = JSON.parse(atob(raw))
        setRoll({
          roll_no:      d.roll,
          weight:       parseFloat(d.net)   || 0,
          gross_weight: parseFloat(d.gross) || 0,
          core_weight:  parseFloat(d.core)  || 0,
          machine_no:   d.machine,
          lot_no:       d.lot,
          product_name: d.product,
          customer:     d.customer,
          inspector:    d.inspector,
          created_at:   new Date().toISOString(),
          _legacy: true,
        })
      } catch {
        setError('ข้อมูล QR ไม่ถูกต้อง')
      }
    }
  }, [raw])

  if (error) return (
    <div className="min-h-screen bg-[#0a0f1e] flex items-center justify-center p-6">
      <div className="text-center">
        <p className="text-4xl mb-3">⚠️</p>
        <p className="text-red-400 font-bold">{error}</p>
        <p className="text-slate-500 text-sm mt-1">ลองสแกน QR ใหม่อีกครั้ง</p>
      </div>
    </div>
  )

  if (!roll) return (
    <div className="min-h-screen bg-[#0a0f1e] flex items-center justify-center">
      <div className="text-center">
        <div className="w-10 h-10 border-2 border-brand-500 border-t-transparent rounded-full animate-spin mx-auto mb-3"/>
        <p className="text-slate-400 text-sm">กำลังโหลดข้อมูล...</p>
      </div>
    </div>
  )

  const createdAt  = new Date(roll.created_at)
  const dateStr    = createdAt.toLocaleDateString('th-TH', { timeZone:'Asia/Bangkok', day:'2-digit', month:'2-digit', year:'numeric' })
  const timeStr    = createdAt.toLocaleTimeString('th-TH', { timeZone:'Asia/Bangkok', hour:'2-digit', minute:'2-digit' })
  const currentUrl = window.location.href
  // ลูกค้าหาดทิพย์ (รหัส 08) — รหัสลูกค้าฝังใน Lot 4 หลักก่อนเดือน เช่น 69BL06"0008"06
  // (ม้วนไม่ได้เก็บ cust_code → ถอดจาก Lot เป็นหลัก + เผื่อชื่อ/รหัส)
  const custFromLot = (() => { const m = (roll.lot_no ?? '').match(/(\d{4})\d{2}$/); return m ? parseInt(m[1], 10) : null })()
  const isHadthip  = custFromLot === 8 || (roll.cust_code ?? '').trim() === '08' || (roll.customer ?? '').includes('หาดทิพย์')
  // วันหมดอายุ = วันผลิต + 6 เดือน
  const expStr     = (() => { const d = new Date(roll.created_at); d.setMonth(d.getMonth() + 6); return d.toLocaleDateString('th-TH', { timeZone:'Asia/Bangkok', day:'2-digit', month:'2-digit', year:'numeric' }) })()

  const typeLabel  = roll.roll_type === 'good' ? 'FG ✓' : roll.roll_type === 'scrap' ? 'ของเสีย' : 'กรอ/ซ่อม'
  const typeBg     = roll.roll_type === 'good' ? 'bg-brand-700' : roll.roll_type === 'scrap' ? 'bg-red-800' : 'bg-amber-700'
  // ม้วนกรอ (ผลผลิตจากแผนกกรอ) — ลูกค้าสแกนต้องเห็นเป็นม้วนดีปกติ: ซ่อนหมายเหตุ/ที่มาที่บอกว่าเคยเสีย
  const isRework   = !!(roll.rework_source_lot || roll.rework_source_roll_id)
  const showRemark = !isRework && roll.remark && !/🔁|กรอจาก|เหตุผล/.test(String(roll.remark))

  return (
    <div className="min-h-screen bg-[#0a0f1e] flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">

        {/* Header */}
        <div className={`${typeBg} px-5 py-4 text-center`}>
          <p className="text-white/70 text-xs">บริษัท เบสท์เวิลด์ อินเตอร์พลาส จำกัด</p>
          <p className="text-white font-black text-xl mt-0.5">
            {roll.roll_no ? `ม้วนที่ ${roll.roll_no}` : typeLabel}
          </p>
          <p className="text-white/70 text-sm">{roll.machine_no} · {dateStr} {timeStr}</p>
          <span className="inline-block mt-1.5 text-[10px] bg-white/20 text-white px-2 py-0.5 rounded-full">{typeLabel}</span>
        </div>

        {/* น้ำหนัก */}
        <div className="grid grid-cols-3 divide-x divide-slate-800 border-b border-slate-800">
          {[
            { label:'นน.เต็ม',  val: fmt(roll.gross_weight), cls:'text-slate-300 text-lg' },
            { label:'นน.แกน',   val: fmt(roll.core_weight),  cls:'text-slate-500 text-lg' },
            { label:'นน.สุทธิ', val: fmt(roll.weight),       cls:'text-brand-400 font-black text-2xl' },
          ].map(item => (
            <div key={item.label} className="py-4 text-center">
              <p className="text-slate-500 text-[10px] uppercase tracking-wider mb-1">{item.label}</p>
              <p className={`font-bold ${item.cls}`}>{item.val}</p>
              <p className="text-slate-600 text-[9px]">Kgs.</p>
            </div>
          ))}
        </div>

        {/* รายละเอียด */}
        <div className="px-5 py-4 space-y-2.5 border-b border-slate-800">
          <Row label="ลูกค้า"      val={roll.customer     || '—'} />
          <Row label="สินค้า"      val={roll.product_name || '—'} />
          {roll.product_code && <Row label="รหัสสินค้า" val={roll.product_code} mono />}
          {roll.item_code && <Row label="Item Code"  val={roll.item_code} mono />}
          {roll.mat_code  && <Row label="Mat Code"   val={roll.mat_code}  mono />}
          <Row label="Lot No"      val={roll.lot_no       || '—'} mono />
          <Row label="เครื่องจักร" val={roll.machine_no   || '—'} />
          {roll.inspector && <Row label="ผู้ตรวจสอบ" val={roll.inspector} />}
          {showRemark     && <Row label="หมายเหตุ"   val={roll.remark} />}
          {/* หาดทิพย์ — โชว์ค่าเพิ่ม: วัสดุ + วันผลิต/วันหมดอายุต่อกัน */}
          {isHadthip && <Row label="HTC Material" val="LDPE" />}
          <Row label="วันที่ผลิต" val={isHadthip ? dateStr : `${dateStr}  ${timeStr}`} />
          {isHadthip && <Row label="วันหมดอายุ (EXP)" val={expStr} />}
          <Row label="สถานะโอน"   val={roll.transferred ? `✓ โอนแล้ว · ${roll.transferred_by || ''}` : 'รอโอนเข้าคลัง'} />
        </div>

        {/* QR สแกนซ้ำ */}
        <div className="flex flex-col items-center gap-2 px-5 py-4">
          <p className="text-slate-500 text-[10px] uppercase tracking-wider">QR Code ม้วนนี้</p>
          <div className="bg-white p-3 rounded-xl">
            <QRCode value={currentUrl} size={130} level="M" />
          </div>
          <p className="text-slate-600 text-[9px] text-center break-all">{currentUrl}</p>
        </div>

      </div>
    </div>
  )
}

function Row({ label, val, mono }: { label: string; val: string; mono?: boolean }) {
  return (
    <div className="flex justify-between items-baseline gap-2">
      <span className="text-slate-500 text-xs shrink-0">{label}</span>
      <span className={`text-right text-sm font-semibold text-slate-200 ${mono ? 'font-mono' : ''}`}>{val}</span>
    </div>
  )
}
