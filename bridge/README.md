# BWP Scale Bridge

Service ที่อ่านค่าน้ำหนักจาก Serial Port แล้ว broadcast ผ่าน WebSocket ให้ Web App

## ติดตั้ง

```bash
cd bridge
npm install
```

## รัน

```bash
npm start
```

จะเปิดที่ `http://localhost:8080` — เปิดเบราว์เซอร์เพื่อตั้งค่า COM port + Baud rate

## วิธีตั้งค่า

1. รัน `npm start`
2. เปิด `http://localhost:8080`
3. เลือก COM port ของเครื่องชั่ง + Baud rate
4. กด **บันทึก + เชื่อมต่อ**
5. ระบบจะเริ่มอ่านค่าและแสดงน้ำหนักสด

## ทำให้รันตอนเปิดเครื่อง (Windows Service)

ใช้ NSSM (Non-Sucking Service Manager):

```bash
# ดาวน์โหลด nssm.exe จาก https://nssm.cc
nssm install BWPScaleBridge "C:\Program Files\nodejs\node.exe" "C:\path\to\bridge\server.js"
nssm start BWPScaleBridge
```

หรือใช้ PM2:

```bash
npm install -g pm2 pm2-windows-startup
pm2-startup install
pm2 start server.js --name bwp-scale-bridge
pm2 save
```

## API

- `GET /status` → สถานะปัจจุบัน
- `GET /ports` → list COM ports
- `POST /config` → ตั้งค่า `{ comPort, baudRate }`
- `WS /` → WebSocket รับค่าน้ำหนักสด
