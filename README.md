# DSS ท่าเรือ — ระบบสนับสนุนการตัดสินใจจัดลำดับความสำคัญการลงทุนท่าเรือ

Project 2 · T1-2569-273453 Decision Support Systems (Sec1)

ระบบสนับสนุนการตัดสินใจจัดลำดับความสำคัญการลงทุนท่าเรือ ตามปริมาณสินค้านำเข้า-ส่งออก ผู้ใช้นำเข้าข้อมูลการค้า (CSV) → ดูแนวโน้ม → ปรับน้ำหนักเกณฑ์ → ระบบคำนวณคะแนน Weighted Scoring (V/G/D/B/S) จัดอันดับ และจัดชั้นตามตารางกฎการตัดสินใจ 4 ข้อ → ดูผล/ส่งออกรายงาน

## วิธีรัน (ไม่ต้องติดตั้งอะไรเพิ่ม)

ใช้ **Node.js core เท่านั้น ไม่มี dependency ภายนอก** (ไม่ต้อง `npm install`) ฐานข้อมูลใช้ SQLite ที่มากับ Node.js (`node:sqlite`)

ต้องมี [Node.js](https://nodejs.org) **เวอร์ชัน 22.13 ขึ้นไป** (เช็คด้วย `node -v`)

```bash
node server/index.js      # หรือ npm start
```

เปิดเบราว์เซอร์ไปที่ **http://localhost:3000** (ต้องเปิดผ่านเซิร์ฟเวอร์ ดับเบิลคลิก index.html ไม่ได้) · หยุดด้วย `Ctrl+C`

ครั้งแรกที่รัน ระบบจะสร้างฐานข้อมูล `server/data/dss.db` และโหลดชุดข้อมูลตัวอย่าง (23 พื้นที่ ปี 2565–2568) ให้อัตโนมัติ ถ้าอยากเริ่มใหม่หมด ลบไฟล์ `dss.db` แล้วรันใหม่ หรือกด "คืนค่าเป็นชุดข้อมูลตัวอย่าง" ในหน้านำเข้าข้อมูล

## หน้าจอ (ตาม Use Case / Swim lane สไลด์หน้า 14)

| ขั้น | หน้าจอ | Use Case | FR |
|---|---|---|---|
| 1 | นำเข้าข้อมูล | นำเข้า/ปรับปรุงข้อมูลการค้า (CSV) | ข้อมูลตั้งต้น |
| 2 | แนวโน้มปริมาณการค้า | ดูกราฟ/ตารางแนวโน้มรายจังหวัดและหมวดสินค้า | FR1, FR2 |
| 3 | ปรับน้ำหนัก (What-if) | ปรับน้ำหนัก 5 ปัจจัย + เกณฑ์ปริมาณ | FR3 |
| 4 | จัดลำดับความสำคัญ | ดูอันดับ/ชั้น + ส่งออก CSV / PDF | FR4, FR5, FR6 |
| 5 | คะแนนตัวชี้วัดรายพื้นที่ | ดูคะแนน V,G,D,B,S รายพื้นที่ | FR6 |

น้ำหนักที่ตั้งในหน้า What-if ใช้ร่วมกันทุกหน้า — ปรับแล้วหน้าจัดลำดับและหน้าคะแนนตัวชี้วัดเปลี่ยนตามทันที

## รูปแบบไฟล์ที่นำเข้าได้ (CSV)

ระบบตรวจรูปแบบจากหัวคอลัมน์ให้เอง การนำเข้าจะ **แทนที่ข้อมูลเดิมทั้งชุด** (ถ้าต้องการเก็บปีเก่า ให้รวมไว้ในไฟล์เดียวกัน) ถ้าไฟล์มีข้อผิดพลาด ระบบบอกเลขแถวที่ผิดและไม่แตะข้อมูลเดิม

1. **ข้อมูลดิบ** → ระบบคำนวณ V,G,D,B,S เอง: `Year_BE, ProvinceName_TH, ProcessingIndicator (นำเข้า/ส่งออก), CategoryName_TH, TotalWeight (ตัน)` (ไม่บังคับ: `ProvinceName_EN, CategoryName_EN, OriginalGoodsMapping`) ต้องมีอย่างน้อย 2 ปี — ตัวอย่าง `public/samples/port-trade-2565-2568.csv`
2. **มีคะแนนมาแล้ว** → ใช้ค่าตามไฟล์: `ProvinceName_TH, V, G, D, B, S, AvgVolumeTon` (ไม่บังคับ: `Year_BE, ProvinceName_EN`) — ตัวอย่าง `public/samples/template-scored.csv`

รองรับหัวคอลัมน์ภาษาไทย (ปี, จังหวัด, นำเข้า/ส่งออก, หมวดสินค้า, น้ำหนัก) ปี พ.ศ./ค.ศ. และไฟล์ที่ Excel บันทึกเป็น UTF-8 หรือ ANSI ภาษาไทย (windows-874)

## โครงสร้างโปรเจกต์

```
dss-project2/
├── server/
│   ├── index.js            เซิร์ฟเวอร์ (Node http) + REST API + เสิร์ฟหน้าเว็บ
│   ├── lib/
│   │   ├── db.js           Data layer: SQLite 4 ตารางตาม ER สไลด์หน้า 15-17
│   │   ├── importer.js     อ่าน/ตรวจไฟล์ CSV ที่นำเข้า (2 รูปแบบ)
│   │   ├── csv.js          parser/writer CSV (เขียนเอง ไม่ใช้ library)
│   │   └── calc.js         Model layer: คำนวณ V,G,D,B,S, Weighted Scoring, ตารางกฎจัดชั้น
│   └── data/dss.db         ฐานข้อมูล (สร้างอัตโนมัติ ไม่ต้อง commit)
├── public/                 Frontend (HTML/CSS/JS ล้วน)
│   ├── index.html, css/style.css, js/app.js
│   └── samples/            ไฟล์ CSV ตัวอย่างสำหรับดาวน์โหลด/นำเข้า
├── API_CONTRACT.md         สัญญา API
└── README_CALC_NOTES.md    หมายเหตุการคำนวณ (อ่านก่อนนำเสนอ!)
```

## สถาปัตยกรรม 3 ชั้นของ DSS

1. **Data Management** — `server/lib/db.js` + `importer.js`: SQLite 4 ตาราง `PROVINCE`, `GOODS_CATEGORY`, `TRADE_RECORD`, `PRIORITY_SCORE` (PK/FK ตาม ER) นำเข้าข้อมูลจาก CSV แบบ transaction (พังกลางทาง = rollback ข้อมูลเดิมไม่หาย)
2. **Model/Analytics** — `server/lib/calc.js`: V (log ปริมาณเฉลี่ย), G (YoY growth เฉลี่ย), D (1−HHI ของ 7 หมวด), B (ความสมดุลนำเข้า-ส่งออก), S (1/(1+CV)) → min-max 0-100 → Weighted Scoring → ตารางกฎ 4 ข้อ
3. **UI & Visualization** — `public/`: 5 หน้าจอตาม Use Case

## API (รายละเอียดใน `API_CONTRACT.md`)

- `GET /api/dashboard-data` — ข้อมูลชุดปัจจุบัน แนวโน้ม และอันดับฐาน
- `POST /api/recalculate` — `{ weights: {V,G,D,B,S}, volumeThresholdTon? }` → อันดับใหม่ + `baseRank`
- `POST /api/import` — `{ fileName, csv }` → นำเข้าแทนที่ข้อมูลเดิมและคำนวณใหม่
- `POST /api/reset-sample` — คืนค่าชุดข้อมูลตัวอย่าง
- `GET /api/health`
