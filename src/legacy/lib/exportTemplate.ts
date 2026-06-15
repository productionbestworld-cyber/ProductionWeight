import * as XLSX from 'xlsx'

export function exportTemplate() {
  const wb = XLSX.utils.book_new()

  const today = new Date().toISOString().slice(0, 10)

  // ── Sheet 1: Easy Entry ───────────────────────────────────────────────────────
  // ลำดับ: วันที่ | เลขที่ใบสั่ง | เครื่องจักร | กะ | รหัสสินค้า | ขนาด | ลูกค้า | แผน(kg) | FG(kg) | FG(ม้วน) | เสีย | ซ่อม | อาการ | สาเหตุ | การแก้ไข
  const easyHeaders = [
    'วันที่ผลิต *\n(YYYY-MM-DD)',  // 1
    'เลขที่ใบสั่ง',                // 2
    'เครื่องจักร *\n(BL01-BL11)', // 3
    'กะ *\n(A/B/C)',               // 4
    'รหัสสินค้า',                  // 5
    'ขนาด',                        // 6
    'ลูกค้า',                      // 7
    'แผน (kg)',                    // 8
    'FG (kg) *',                   // 9
    'FG (ม้วน)',                   // 10
    'ของเสีย (kg)',                // 11
    'ของซ่อม (kg)',               // 12
    'อาการ',                       // 13
    'สาเหตุ',                      // 14
    'การแก้ไข',                    // 15
  ]

  const easySamples = [
    //วันที่      ใบสั่ง     เครื่อง  กะ   รหัส         ขนาด    ลูกค้า  แผน   FG      ม้วน  เสีย   ซ่อม  อาการ          สาเหตุ           การแก้ไข
    [today,  'PO-001', 'BL01', 'A', '60004224', '57x80', 'COK', 5000, 4850.5, 195, 120.3, 30.2, 'จุดดำ', 'สิ่งปนเปื้อน', 'ทำความสะอาด'],
    [today,  'PO-001', 'BL02', 'A', '60004225', '60x80', 'TCF', 4500, 4420.0, 176,  60.0, 20.0, '',       '',              ''],
    [today,  'PO-002', 'BL03', 'B', '60004226', '57x80', 'THY', 5000, 4900.0, 196,  80.0, 20.0, '',       '',              ''],
  ]

  const wsEasy = XLSX.utils.aoa_to_sheet([easyHeaders, ...easySamples])
  wsEasy['!cols'] = easyHeaders.map((_, i) => ({ wch: i >= 12 ? 22 : i === 0 ? 16 : 13 }))
  wsEasy['!rows'] = [{ hpt: 36 }]

  XLSX.utils.book_append_sheet(wb, wsEasy, 'Easy Entry')

  // ── Sheet 3: Instructions ─────────────────────────────────────────────────────
  const infoRows = [
    ['📋 คำแนะนำการใช้ Template'],
    [''],
    ['Sheet "Easy Entry"', 'กรอกข้อมูลการผลิต — แล้วนำไปกรอกในหน้า "กรอกข้อมูล" หรืออัปโหลดผ่านระบบ'],
    [''],
    ['⚠️ ข้อสำคัญ'],
    ['วันที่', 'รูปแบบ YYYY-MM-DD เท่านั้น เช่น 2026-05-19'],
    ['เครื่องจักร', 'BL01 / BL02 / ... / BL11 เท่านั้น (ตัวพิมพ์ใหญ่)'],
    ['กะ', 'A หรือ B หรือ C เท่านั้น'],
    ['ตัวเลข', 'ไม่ต้องใส่ comma หรือ unit — ใส่เฉพาะตัวเลข เช่น 4850.5'],
    ['แถวที่ 1', 'เป็น header — ห้ามลบหรือแก้ไข'],
    [''],
    ['✅ วิธีใช้'],
    ['1. กรอกข้อมูลตั้งแต่แถวที่ 2 เป็นต้นไป (ใน Sheet Easy Entry)'],
    ['2. ไปที่ Tab "กรอกข้อมูล" บน Dashboard แล้วกด "+ เพิ่มข้อมูล"'],
    ['3. หรือบันทึกไฟล์แล้วกด "+ อัปโหลดเพิ่ม" เพื่ออัปโหลดทีเดียว'],
  ]

  const wsInfo = XLSX.utils.aoa_to_sheet(infoRows)
  wsInfo['!cols'] = [{ wch: 20 }, { wch: 60 }]
  XLSX.utils.book_append_sheet(wb, wsInfo, 'คำแนะนำ')

  // Download
  XLSX.writeFile(wb, `BWP_Production_Template_${new Date().toISOString().slice(0,10)}.xlsx`)
}
