'use strict';
/**
 * Data Management Layer — ฐานข้อมูล SQLite (ใช้ node:sqlite ที่มากับ Node.js 22.13+ ไม่ต้องติดตั้งเพิ่ม)
 * โครงสร้างตาราง 4 ตารางตามสไลด์ Project-1 หน้า 15-17 (Data Modeling / Entity Diagram / Conceptual Object Model)
 *
 *   PROVINCE 1──< TRADE_RECORD >──1 GOODS_CATEGORY
 *   PROVINCE 1──< PRIORITY_SCORE
 */
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = process.env.DSS_DB || path.join(__dirname, '..', 'data', 'dss.db');

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS PROVINCE (
    ProvinceID       INTEGER PRIMARY KEY,
    ProvinceName_TH  TEXT NOT NULL UNIQUE,
    ProvinceName_EN  TEXT
  );

  CREATE TABLE IF NOT EXISTS GOODS_CATEGORY (
    GoodsCategoryID       INTEGER PRIMARY KEY,
    CategoryName_TH       TEXT NOT NULL UNIQUE,
    CategoryName_EN       TEXT,
    OriginalGoodsMapping  TEXT
  );

  CREATE TABLE IF NOT EXISTS TRADE_RECORD (
    RecordID             INTEGER PRIMARY KEY,
    Year_BE              INTEGER NOT NULL,
    Year_AD              INTEGER NOT NULL,
    ProvinceID           INTEGER NOT NULL REFERENCES PROVINCE(ProvinceID),
    ProcessingIndicator  TEXT NOT NULL CHECK (ProcessingIndicator IN ('import', 'export')),
    GoodsCategoryID      INTEGER NOT NULL REFERENCES GOODS_CATEGORY(GoodsCategoryID),
    TotalWeight          REAL NOT NULL
  );

  -- AvgVolumeTon เพิ่มจาก ER เดิม: กฎจัดชั้นข้อ 1/2 ต้องใช้ปริมาณเฉลี่ย และไฟล์แบบ "มีคะแนนมาแล้ว" ไม่มี TRADE_RECORD ให้คำนวณ
  CREATE TABLE IF NOT EXISTS PRIORITY_SCORE (
    ScoreID             INTEGER PRIMARY KEY,
    ProvinceID          INTEGER NOT NULL REFERENCES PROVINCE(ProvinceID),
    Year_AD             INTEGER,
    VolumeScore         REAL NOT NULL,
    GrowthScore         REAL NOT NULL,
    DiversityScore      REAL NOT NULL,
    BalanceScore        REAL NOT NULL,
    StabilityScore      REAL NOT NULL,
    FinalPriorityScore  REAL NOT NULL,
    Rank                INTEGER NOT NULL,
    AvgVolumeTon        REAL NOT NULL
  );

  -- ข้อมูลประกอบ: ชุดข้อมูลที่ใช้อยู่ปัจจุบันมาจากไฟล์ไหน นำเข้าเมื่อไร
  CREATE TABLE IF NOT EXISTS DATASET_INFO (
    id          INTEGER PRIMARY KEY CHECK (id = 1),
    FileName    TEXT,
    ImportedAt  TEXT,
    Mode        TEXT,
    ProvidedIndicators TEXT  -- ตัวชี้วัดที่มากับไฟล์ (ไม่ได้คำนวณเอง) เช่น "G,S"
  );
`);

// ฐานข้อมูลที่สร้างจากเวอร์ชันก่อนยังไม่มีคอลัมน์นี้
if (!db.prepare('PRAGMA table_info(DATASET_INFO)').all().some((c) => c.name === 'ProvidedIndicators')) {
  db.exec('ALTER TABLE DATASET_INFO ADD COLUMN ProvidedIndicators TEXT');
}

function isEmpty() {
  return db.prepare('SELECT COUNT(*) AS n FROM PROVINCE').get().n === 0;
}

/**
 * แทนที่ข้อมูลทั้งชุดด้วยชุดใหม่ (ใน transaction เดียว ถ้าพังกลางทางจะ rollback ข้อมูลเดิมยังอยู่ครบ)
 * @param {{mode, records, indicators, provided, providedKeys}} dataset - ผลจาก importer.parseDataset()
 * @param {{buildMetrics, normalize, rank}} model - ฟังก์ชันจาก calc.js
 *   buildMetrics(records, provided) → คำนวณตัวชี้วัดจาก TRADE_RECORD (ใช้ค่าจากไฟล์แทนตัวที่มี) แล้วปรับสเกล
 *   normalize(list) → ปรับสเกลค่าตัวชี้วัดที่มากับไฟล์ (กรณีไม่มีข้อมูลดิบ)
 *   rank(metrics) → คะแนนรวมตามน้ำหนักเริ่มต้น + อันดับ
 */
function replaceDataset(dataset, fileName, model) {
  db.exec('BEGIN');
  try {
    db.exec('DELETE FROM PRIORITY_SCORE; DELETE FROM TRADE_RECORD; DELETE FROM GOODS_CATEGORY; DELETE FROM PROVINCE;');

    const insProvince = db.prepare('INSERT INTO PROVINCE (ProvinceName_TH, ProvinceName_EN) VALUES (?, ?)');
    const provinceIds = new Map();
    const ensureProvince = (th, en) => {
      if (!provinceIds.has(th)) provinceIds.set(th, Number(insProvince.run(th, en || null).lastInsertRowid));
      return provinceIds.get(th);
    };

    let metrics;
    let scoreYear = null;

    if (dataset.mode === 'raw') {
      // GOODS_CATEGORY: OriginalGoodsMapping = รายชื่อสินค้าเดิมที่ถูกจัดเข้าหมวดนี้ (ถ้าไฟล์มีคอลัมน์นี้)
      const catInfo = new Map();
      for (const r of dataset.records) {
        if (!catInfo.has(r.categoryTh)) catInfo.set(r.categoryTh, { en: r.categoryEn, originals: new Set() });
        if (r.originalGoods) catInfo.get(r.categoryTh).originals.add(r.originalGoods);
      }
      const insCat = db.prepare('INSERT INTO GOODS_CATEGORY (CategoryName_TH, CategoryName_EN, OriginalGoodsMapping) VALUES (?, ?, ?)');
      const catIds = new Map();
      for (const [th, info] of catInfo) {
        const mapping = info.originals.size ? [...info.originals].join('; ') : null;
        catIds.set(th, Number(insCat.run(th, info.en || null, mapping).lastInsertRowid));
      }

      const insRec = db.prepare(`INSERT INTO TRADE_RECORD (Year_BE, Year_AD, ProvinceID, ProcessingIndicator, GoodsCategoryID, TotalWeight)
                                 VALUES (?, ?, ?, ?, ?, ?)`);
      for (const r of dataset.records) {
        const pid = ensureProvince(r.provinceTh, r.provinceEn);
        insRec.run(r.yearBE, r.yearAD, pid, r.direction, catIds.get(r.categoryTh), r.weightTon);
      }

      metrics = model.buildMetrics(loadTradeRecords(), dataset.provided);
      scoreYear = Math.max(...dataset.records.map((r) => r.yearAD));
    } else {
      metrics = model.normalize(dataset.indicators.map((s) => ({
        id: ensureProvince(s.provinceTh, s.provinceEn),
        nameTh: s.provinceTh,
        nameEn: s.provinceEn,
        avgYearlyTotalTon: s.avgYearlyTotalTon,
        raw: s.raw,
      })));
      const years = dataset.indicators.map((s) => s.yearAD).filter(Boolean);
      scoreYear = years.length ? Math.max(...years) : null;
    }

    // PRIORITY_SCORE เก็บผลตามน้ำหนักเริ่มต้น (ค่าฐาน) — การปรับน้ำหนัก What-if คำนวณสดจากค่านี้ ไม่ทับค่าฐาน
    const insScore = db.prepare(`INSERT INTO PRIORITY_SCORE
      (ProvinceID, Year_AD, VolumeScore, GrowthScore, DiversityScore, BalanceScore, StabilityScore, FinalPriorityScore, Rank, AvgVolumeTon)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const m of model.rank(metrics)) {
      insScore.run(m.id, scoreYear, m.V, m.G, m.D, m.B, m.S, m.finalScore, m.rank, m.avgYearlyTotalTon);
    }

    db.prepare(`INSERT INTO DATASET_INFO (id, FileName, ImportedAt, Mode, ProvidedIndicators) VALUES (1, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET FileName = excluded.FileName, ImportedAt = excluded.ImportedAt,
                  Mode = excluded.Mode, ProvidedIndicators = excluded.ProvidedIndicators`)
      .run(fileName, new Date().toISOString(), dataset.mode, dataset.providedKeys.join(','));

    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function clearAll() {
  db.exec('BEGIN');
  try {
    db.exec('DELETE FROM PRIORITY_SCORE; DELETE FROM TRADE_RECORD; DELETE FROM GOODS_CATEGORY; DELETE FROM PROVINCE; DELETE FROM DATASET_INFO;');
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function loadTradeRecords() {
  return db.prepare(`
    SELECT t.ProvinceID AS provinceId, p.ProvinceName_TH AS provinceTh, p.ProvinceName_EN AS provinceEn,
           t.Year_BE AS yearBE, t.Year_AD AS yearAD, t.ProcessingIndicator AS direction,
           g.CategoryName_TH AS categoryTh, t.TotalWeight AS weightTon
    FROM TRADE_RECORD t
    JOIN PROVINCE p ON p.ProvinceID = t.ProvinceID
    JOIN GOODS_CATEGORY g ON g.GoodsCategoryID = t.GoodsCategoryID
  `).all();
}

function loadScores() {
  return db.prepare(`
    SELECT s.ProvinceID AS id, p.ProvinceName_TH AS nameTh, p.ProvinceName_EN AS nameEn, s.Year_AD AS yearAD,
           s.VolumeScore AS V, s.GrowthScore AS G, s.DiversityScore AS D, s.BalanceScore AS B, s.StabilityScore AS S,
           s.FinalPriorityScore AS finalScore, s.Rank AS rank, s.AvgVolumeTon AS avgYearlyTotalTon
    FROM PRIORITY_SCORE s JOIN PROVINCE p ON p.ProvinceID = s.ProvinceID
    ORDER BY s.Rank
  `).all();
}

function loadDatasetInfo() {
  const info = db.prepare('SELECT FileName AS fileName, ImportedAt AS importedAt, Mode AS mode, ProvidedIndicators AS providedIndicators FROM DATASET_INFO WHERE id = 1').get();
  const counts = db.prepare(`SELECT
      (SELECT COUNT(*) FROM PROVINCE) AS provinces,
      (SELECT COUNT(*) FROM TRADE_RECORD) AS records,
      (SELECT COUNT(*) FROM GOODS_CATEGORY) AS categories`).get();
  return { ...(info || {}), ...counts };
}

module.exports = { isEmpty, replaceDataset, clearAll, loadTradeRecords, loadScores, loadDatasetInfo, DB_PATH };
