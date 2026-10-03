'use strict';
/**
 * แปลงไฟล์ CSV ที่ผู้ใช้อัปโหลด → ข้อมูลพร้อมบันทึกลงฐานข้อมูล (Use Case: นำเข้า/ปรับปรุงข้อมูลการค้า)
 *
 * รองรับ 2 รูปแบบ (ระบบตรวจจากหัวคอลัมน์ให้อัตโนมัติ):
 *  1) "raw"    ข้อมูลดิบรายการค้า 1 แถว = ปี/จังหวัด/นำเข้า-ส่งออก/หมวดสินค้า/น้ำหนัก (ตัน)
 *              → ระบบคำนวณ V,G,D,B,S ให้เอง
 *  2) "scored" มีคอลัมน์ V,G,D,B,S มาแล้ว 1 แถว = 1 จังหวัด → ใช้ค่าตามไฟล์ ไม่คำนวณซ้ำ
 *              (ต้องมีปริมาณเฉลี่ยต่อปีด้วย เพราะกฎจัดชั้นข้อ 1/2 ต้องใช้)
 */
const { parseCsv } = require('./csv');

// ชื่อหัวคอลัมน์ที่ยอมรับได้ (เทียบแบบไม่สนตัวพิมพ์/ช่องว่าง/ขีดล่าง)
const ALIASES = {
  year: ['year', 'year_be', 'year_ad', 'ปี', 'ปีพ.ศ.', 'พ.ศ.', 'ปีพศ'],
  province: ['provincename_th', 'province', 'จังหวัด', 'พื้นที่', 'ท่าเรือ', 'จังหวัด/ท่าเรือ'],
  provinceEn: ['provincename_en', 'province_en', 'area_en'],
  direction: ['processingindicator', 'direction', 'ทิศทาง', 'ประเภท', 'นำเข้า/ส่งออก', 'ขาเข้า/ขาออก'],
  category: ['categoryname_th', 'goodscategory', 'category', 'หมวดสินค้า', 'หมวด'],
  categoryEn: ['categoryname_en', 'category_en'],
  originalGoods: ['originalgoodsmapping', 'originalgoods', 'ชื่อสินค้าเดิม', 'สินค้า'],
  weight: ['totalweight', 'weight', 'weightton', 'น้ำหนัก', 'ปริมาณ', 'ปริมาณ(ตัน)', 'น้ำหนัก(ตัน)'],
  V: ['v', 'volumescore'],
  G: ['g', 'growthscore'],
  D: ['d', 'diversityscore'],
  B: ['b', 'balancescore'],
  S: ['s', 'stabilityscore'],
  avgVolume: ['avgvolumeton', 'avgyearlyvolumeton', 'ปริมาณเฉลี่ย', 'ปริมาณเฉลี่ยต่อปี', 'ปริมาณเฉลี่ย(ตัน/ปี)'],
};

const IMPORT_WORDS = ['import', 'imp', 'im', 'i', 'นำเข้า', 'ขาเข้า', 'เข้า'];
const EXPORT_WORDS = ['export', 'exp', 'ex', 'e', 'ส่งออก', 'ขาออก', 'ออก'];

const norm = (s) => String(s || '').trim().toLowerCase().replace(/[\s_]/g, '');

function mapHeader(header) {
  const idx = {};
  header.forEach((h, i) => {
    const key = norm(h);
    for (const [field, names] of Object.entries(ALIASES)) {
      if (idx[field] === undefined && names.some((n) => norm(n) === key)) idx[field] = i;
    }
  });
  return idx;
}

function toNumber(s) {
  if (s === undefined || s === null) return NaN;
  const t = String(s).replace(/,/g, '').trim();
  return t === '' ? NaN : Number(t);
}

// ปี > 2400 ถือเป็น พ.ศ. ไม่งั้นเป็น ค.ศ.
function toYears(raw) {
  const y = toNumber(raw);
  if (!Number.isInteger(y)) return null;
  return y > 2400 ? { yearBE: y, yearAD: y - 543 } : { yearBE: y + 543, yearAD: y };
}

function toDirection(raw) {
  const v = norm(raw);
  if (IMPORT_WORDS.includes(v)) return 'import';
  if (EXPORT_WORDS.includes(v)) return 'export';
  return null;
}

const MAX_ERRORS = 15;

function parseDataset(csvText) {
  const rows = parseCsv(csvText);
  if (rows.length < 2) throw new ImportError('ไฟล์ว่าง หรือมีแต่หัวคอลัมน์ ไม่มีข้อมูล');

  const header = rows[0];
  const col = mapHeader(header);
  const hasScores = ['V', 'G', 'D', 'B', 'S'].every((k) => col[k] !== undefined);
  const hasRaw = ['year', 'province', 'direction', 'category', 'weight'].every((k) => col[k] !== undefined);

  if (hasScores) return parseScored(rows, col);
  if (hasRaw) return parseRaw(rows, col);

  const missingRaw = ['year', 'province', 'direction', 'category', 'weight'].filter((k) => col[k] === undefined);
  throw new ImportError(
    'ไม่รู้จักรูปแบบไฟล์ — ต้องเป็นข้อมูลดิบ (ปี, จังหวัด, นำเข้า/ส่งออก, หมวดสินค้า, น้ำหนัก) ' +
    'หรือไฟล์ที่มีคอลัมน์ V,G,D,B,S ครบ (ดาวน์โหลดไฟล์ตัวอย่างในหน้านี้ได้)',
    [`หัวคอลัมน์ที่พบ: ${header.join(', ')}`, `คอลัมน์ข้อมูลดิบที่ขาด: ${missingRaw.join(', ')}`]
  );
}

function parseRaw(rows, col) {
  const records = [];
  const errors = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const line = i + 1;
    const years = toYears(r[col.year]);
    const provinceTh = (r[col.province] || '').trim();
    const direction = toDirection(r[col.direction]);
    const categoryTh = (r[col.category] || '').trim();
    const weight = toNumber(r[col.weight]);

    const problems = [];
    if (!years) problems.push(`ปี "${r[col.year] || ''}" ไม่ถูกต้อง`);
    if (!provinceTh) problems.push('ไม่มีชื่อจังหวัด');
    if (!direction) problems.push(`นำเข้า/ส่งออก "${r[col.direction] || ''}" ไม่รู้จัก`);
    if (!categoryTh) problems.push('ไม่มีหมวดสินค้า');
    if (!Number.isFinite(weight) || weight < 0) problems.push(`น้ำหนัก "${r[col.weight] || ''}" ไม่ใช่ตัวเลข ≥ 0`);
    if (problems.length) {
      errors.push(`แถว ${line}: ${problems.join(', ')}`);
      if (errors.length >= MAX_ERRORS) break;
      continue;
    }
    records.push({
      ...years,
      provinceTh,
      provinceEn: col.provinceEn !== undefined ? (r[col.provinceEn] || '').trim() : '',
      direction,
      categoryTh,
      categoryEn: col.categoryEn !== undefined ? (r[col.categoryEn] || '').trim() : '',
      originalGoods: col.originalGoods !== undefined ? (r[col.originalGoods] || '').trim() : '',
      weightTon: weight,
    });
  }
  if (errors.length) throw new ImportError('ข้อมูลบางแถวไม่ถูกต้อง แก้ไขไฟล์แล้วนำเข้าใหม่', errors);

  const years = new Set(records.map((r) => r.yearAD));
  if (years.size < 2) {
    throw new ImportError('ต้องมีข้อมูลอย่างน้อย 2 ปี จึงจะคำนวณการเติบโต (G) และเสถียรภาพ (S) ได้');
  }
  return { mode: 'raw', records, scores: null };
}

function parseScored(rows, col) {
  if (col.province === undefined) throw new ImportError('ไฟล์แบบมีคะแนน V,G,D,B,S ต้องมีคอลัมน์ชื่อจังหวัด (ProvinceName_TH)');
  if (col.avgVolume === undefined) {
    throw new ImportError('ไฟล์แบบมีคะแนน V,G,D,B,S ต้องมีคอลัมน์ AvgVolumeTon (ปริมาณเฉลี่ย ตัน/ปี) เพราะกฎจัดชั้นข้อ 1/2 ใช้ค่านี้');
  }
  const scores = [];
  const errors = [];
  const seen = new Set();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const line = i + 1;
    const provinceTh = (r[col.province] || '').trim();
    const vals = {};
    const problems = [];
    if (!provinceTh) problems.push('ไม่มีชื่อจังหวัด');
    else if (seen.has(provinceTh)) problems.push(`จังหวัด "${provinceTh}" ซ้ำ`);
    for (const k of ['V', 'G', 'D', 'B', 'S']) {
      vals[k] = toNumber(r[col[k]]);
      if (!Number.isFinite(vals[k]) || vals[k] < 0 || vals[k] > 100) problems.push(`${k} ต้องเป็นตัวเลข 0–100`);
    }
    const avgVolumeTon = toNumber(r[col.avgVolume]);
    if (!Number.isFinite(avgVolumeTon) || avgVolumeTon < 0) problems.push('AvgVolumeTon ต้องเป็นตัวเลข ≥ 0');
    if (problems.length) {
      errors.push(`แถว ${line}: ${problems.join(', ')}`);
      if (errors.length >= MAX_ERRORS) break;
      continue;
    }
    seen.add(provinceTh);
    scores.push({
      provinceTh,
      provinceEn: col.provinceEn !== undefined ? (r[col.provinceEn] || '').trim() : '',
      yearAD: col.year !== undefined && toYears(r[col.year]) ? toYears(r[col.year]).yearAD : null,
      avgYearlyTotalTon: avgVolumeTon,
      ...vals,
    });
  }
  if (errors.length) throw new ImportError('ข้อมูลบางแถวไม่ถูกต้อง แก้ไขไฟล์แล้วนำเข้าใหม่', errors);
  return { mode: 'scored', records: [], scores };
}

class ImportError extends Error {
  constructor(message, details = []) {
    super(message);
    this.details = details;
  }
}

module.exports = { parseDataset, ImportError };
