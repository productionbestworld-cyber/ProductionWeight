# BWP Scale Bridge

โปรแกรมเล็กๆ ที่อ่านน้ำหนักจากเครื่องชั่ง (RS232/USB) แล้วส่งให้ Web App ผ่าน WebSocket

---

## สำหรับผู้ใช้งาน (เครื่องที่ต่อเครื่องชั่ง)

ในโฟลเดอร์มีแค่ **2 ไฟล์ที่ต้องสน:**

| ไฟล์ | ใช้ทำอะไร |
|------|-----------|
| **`Bridge-Control.bat`** | ⭐ ดับเบิลคลิก = เมนูเปิด/ปิด คลิกเดียว |
| `BWPScaleBridge.exe` | ตัวโปรแกรม (ไม่ต้องเปิดเอง Control เรียกให้) |

### วิธีใช้

ดับเบิลคลิก **`Bridge-Control.bat`** จะได้เมนู:

```
   สถานะ:  [ กำลังทำงาน ●  ]   http://localhost:8080

   [1]  เปิด Bridge
   [2]  ปิด Bridge
   [3]  เปิดหน้าตั้งค่า (browser)
   [4]  ติดตั้งให้เปิดเองทุกครั้ง (ต้อง Admin)
   [5]  ยกเลิกเปิดเอง (ต้อง Admin)
   [0]  ออก
```

- กด **1** = เปิด, กด **2** = ปิด — แค่นั้น
- ครั้งแรก: กด **1** → กด **3** เพื่อเปิดหน้าเว็บ → เลือก COM port + Baud rate → บันทึก
- อยากให้เปิดเองทุกครั้งที่เปิดเครื่อง → คลิกขวา `Bridge-Control.bat` → **Run as administrator** → กด **4**

> เคล็ดลับ: คลิกขวา `Bridge-Control.bat` → Send to → Desktop เพื่อทำ shortcut ไว้หน้าจอ

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
