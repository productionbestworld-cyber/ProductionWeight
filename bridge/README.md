# BWP Scale Bridge — Installer

Service ที่อ่านน้ำหนักจากเครื่องชั่ง (RS232/USB) แล้วส่งให้ Web App ผ่าน WebSocket

---

## วิธีง่ายที่สุด — เปิด/ปิดด้วยคลิกเดียว ⭐

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
- อยากให้เปิดเองทุกครั้งที่เปิดเครื่อง → คลิกขวา **Run as administrator** แล้วกด **4**
- วางไฟล์นี้ไว้ข้าง `BWPScaleBridge.exe` (หรือหลังติดตั้งแล้วใช้จากที่ไหนก็ได้)

> เคล็ดลับ: คลิกขวา `Bridge-Control.bat` → Send to → Desktop เพื่อสร้าง shortcut ไว้หน้าจอ

---

## ติดตั้ง (1 ครั้ง)

### ก่อนติดตั้ง

ติดตั้ง **Node.js** จาก https://nodejs.org (LTS version) ก่อน

### ขั้นตอน

1. คลิกขวาที่ **`install.bat`** → เลือก **"Run as administrator"**
2. รอจนเสร็จ — เปิด `http://localhost:8080` อัตโนมัติ
3. เลือก COM port + Baud rate ในหน้าเว็บ → กดบันทึก
4. **เสร็จ!** Bridge จะรันทุกครั้งที่เปิดเครื่อง

---

## ไฟล์ที่มี

| ไฟล์ | คำอธิบาย |
|------|---------|
| `Bridge-Control.bat` | ⭐ แผงควบคุม เปิด/ปิด คลิกเดียว |
| `install.bat` | ติดตั้งเป็น Auto-start Task |
| `uninstall.bat` | ถอนการติดตั้ง |
| `start.bat` | รันชั่วคราว (ไม่ติดตั้ง) |
| `server.js` | Source code |

---

## หาก Service ไม่ทำงาน

ลองรัน `start.bat` ดูว่ามี error อะไร

### เช็ค Task

```cmd
schtasks /query /tn "BWPScaleBridge"
```

### เปิด Task Scheduler

```cmd
taskschd.msc
```
มองหา "BWPScaleBridge" → Run

---

## เปิด Bridge ให้ PC อื่นใช้ได้

หา IP ของเครื่อง:
```cmd
ipconfig
```

PC อื่นในเครือข่ายเปิด `http://<IP>:8080` ได้เลย
ใน Web App กดปุ่ม ⚙ → ใส่ `ws://<IP>:8080`

---

## ถอนการติดตั้ง

คลิกขวาที่ **`uninstall.bat`** → **"Run as administrator"**
