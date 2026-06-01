# BWP Scale Bridge

โปรแกรมเล็กๆ ที่อ่านน้ำหนักจากเครื่องชั่ง (RS232/USB) แล้วส่งให้ Web App ผ่าน WebSocket

---

## สำหรับผู้ใช้งาน (เครื่องที่ต่อเครื่องชั่ง)

**ใช้แค่ 2 ไฟล์นี้ — ดับเบิลคลิกแล้วจบ:**

| ดับเบิลคลิก | ผลลัพธ์ |
|------|-----------|
| 🟢 **`เปิดเครื่องชั่ง.bat`** | เปิด + เด้งหน้าเว็บให้ |
| 🔴 **`ปิดเครื่องชั่ง.bat`** | ปิด |

แค่นั้น ไม่มีเมนู ไม่ต้องพิมพ์อะไร

- ครั้งแรก: ดับเบิลคลิก `เปิดเครื่องชั่ง.bat` → หน้าเว็บเด้งขึ้น → เลือก COM port + Baud rate → บันทึก
- เคล็ดลับ: คลิกขวาทั้ง 2 ไฟล์ → Send to → Desktop เพื่อทำ shortcut ไว้หน้าจอ

> อยากได้ตัวเลือกเพิ่ม (เช็คสถานะ / ตั้งให้เปิดเองทุกครั้งที่เปิดเครื่อง) → ใช้ `Bridge-Control.bat` แทน ได้เมนูเต็ม (กด 4 = ตั้งเปิดเอง)

---

## เปิดให้ PC อื่นในเครือข่ายใช้ได้

หา IP เครื่องนี้:
```cmd
ipconfig
```
PC อื่นเปิด `http://<IP>:8080` ได้เลย — ใน Web App กด ⚙ แล้วใส่ `ws://<IP>:8080`

---

## สำหรับ Dev (สร้างไฟล์ใหม่)

ไฟล์ในโฟลเดอร์ source:

| ไฟล์ | คำอธิบาย |
|------|---------|
| `server.js` | โค้ดหลัก |
| `package.json` / `package-lock.json` | dependencies |
| `installer/Bridge-Control.bat` | ต้นฉบับแผงควบคุม |
| `BUILD-AND-INSTALL.bat` | build `.exe` + แพ็ค `BWPScaleBridge-Setup.zip` |

ขั้นตอน build (ต้องมี Node.js):
1. คลิกขวา `BUILD-AND-INSTALL.bat` → **Run as administrator**
2. ได้ `dist\BWPScaleBridge.exe` + `BWPScaleBridge-Setup.zip` (มี exe + Bridge-Control.bat + README)
3. ส่ง zip ให้เครื่องที่ต่อเครื่องชั่ง แตกไฟล์แล้วใช้ `Bridge-Control.bat` ได้เลย

---

## แก้ปัญหา

- **เปิดไม่ขึ้น / น้ำหนักไม่มา** → กด **3** เช็คว่าเลือก COM port ถูกไหม
- **เช็คว่ารันอยู่ไหม** → เปิด `Bridge-Control.bat` ดูบรรทัด "สถานะ"
- **เช็ค auto-start task** → `schtasks /query /tn "BWPScaleBridge"`
