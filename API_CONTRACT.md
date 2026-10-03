# DSS ท่าเรือ — API Contract (Backend ↔ Frontend)

ทุก response เป็น JSON (`Content-Type: application/json`) เปิด CORS · error ตอบ HTTP 400/404/500 พร้อม `{ "error": "ข้อความ", "details": [ ... ]? }` เสมอ

หน่วย: น้ำหนัก/ปริมาณเป็น **ตัน** · ปีใน API เป็น ค.ศ. (`yearsBE` สำหรับแสดงผล พ.ศ.)

## 1) GET /api/dashboard-data

```json
{
  "dataset": { "fileName": "port-trade-2565-2568.csv", "importedAt": "2026-10-04T...", "mode": "raw",
               "provinces": 23, "records": 618, "categories": 7 },
  "defaults": { "weights": { "V": 0.4, "G": 0.25, "D": 0.15, "B": 0.1, "S": 0.1 }, "volumeThresholdTon": 5000000 },
  "overview": { "totalLatestYearTon": 340574900, "pctChangeVsFirstYear": -8.0,
                "top2Provinces": ["ชลบุรี", "ระยอง"], "top2ShareOfTotal": 84.7, "provinceCount": 23 },
  "trends": {
    "years": [2022, 2023, 2024, 2025], "yearsBE": [2565, 2566, 2567, 2568],
    "categories": ["คอนเทนเนอร์และสินค้าเบ็ดเตล็ด", "..."],
    "all": { "import": [...], "export": [...], "byCategory": { "<หมวด>": [...] } },
    "provinces": [ { "id": 1, "nameTh": "กระบี่", "nameEn": "Krabi", "import": [...], "export": [...], "byCategory": {...} } ]
  },
  "provinces": [
    { "id": 3, "nameTh": "ชลบุรี", "nameEn": "Chon Buri", "yearAD": 2025,
      "V": 100, "G": 42, "D": 98.2, "B": 96.6, "S": 98.6,
      "finalScore": 84.8, "rank": 1, "avgYearlyTotalTon": 223780050, "tier": 1 }
  ]
}
```

- `mode`: `"raw"` (ข้อมูลดิบ คำนวณ V..S เอง) หรือ `"scored"` (คะแนนจากไฟล์) — ถ้าเป็น `"scored"` จะได้ `overview: null`, `trends: null`
- `provinces`: อันดับฐานจากตาราง PRIORITY_SCORE (น้ำหนักเริ่มต้น) เรียงตาม `rank`
- `id` = `ProvinceID` ในฐานข้อมูล (เปลี่ยนได้เมื่อนำเข้าชุดใหม่)

## 2) POST /api/recalculate

```json
{ "weights": { "V": 0.2, "G": 0.15, "D": 0.1, "B": 0.15, "S": 0.4 }, "volumeThresholdTon": 5000000 }
```
- น้ำหนัก 5 ตัว ≥ 0 รวมกัน 1.0 (±0.01) ไม่งั้นตอบ 400 · `volumeThresholdTon` ไม่บังคับ (ค่าเริ่มต้น 5,000,000)

Response: `{ weights, volumeThresholdTon, provinces: [ ...เหมือนข้อ 1 + "baseRank" ] }` เรียงตามอันดับใหม่

## 3) POST /api/import

```json
{ "fileName": "my-data.csv", "csv": "<เนื้อหาไฟล์ CSV ทั้งไฟล์>" }
```
- แทนที่ข้อมูลเดิมทั้งชุด แล้วคำนวณ PRIORITY_SCORE ใหม่ (ใน transaction เดียว)
- สำเร็จ: `{ "ok": true, "mode": "raw", "rowsImported": 618, "dataset": {...} }`
- ไฟล์ผิด: 400 `{ "error": "...", "details": ["แถว 3: น้ำหนัก \"abc\" ไม่ใช่ตัวเลข ≥ 0", ...] }` ข้อมูลเดิมไม่เปลี่ยน
- ขนาดสูงสุด 30 MB

## 4) POST /api/reset-sample

คืนค่าชุดข้อมูลตัวอย่าง `public/samples/port-trade-2565-2568.csv` → `{ "ok": true, "dataset": {...} }`

## 5) GET /api/health

`{ "ok": true, "provinces": 23, "records": 618, "dataset": "port-trade-2565-2568.csv" }`
