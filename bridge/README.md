# BWP Scale Bridge — Installer

Service ที่อ่านน้ำหนักจากเครื่องชั่ง (RS232/USB) แล้วส่งให้ Web App ผ่าน WebSocket

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
