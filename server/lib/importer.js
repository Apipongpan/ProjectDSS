'use strict';
/**
 * แปลงไฟล์ CSV ที่ผู้ใช้อัปโหลด → ข้อมูลพร้อมบันทึกลงฐานข้อมูล (Use Case: นำเข้า/ปรับปรุงข้อมูลการค้า)
 *
 * V,G,D,B,S คือ "ค่าตัวชี้วัด" ที่คำนวณจากข้อมูล (เช่น อัตราการเติบโต, ดัชนีเสถียร) ไม่ใช่คะแนนสำเร็จรูป
 * ถ้าไฟล์มีคอลัมน์ตัวไหนมาแล้ว ระบบใช้ค่านั้นแทนการคำนวณเอง (แค่ไม่ต้องคำนวณซ้ำ) จากนั้นทุกตัวผ่านขั้นตอนเดียวกัน:
 * ปรับสเกล 0-100 (min-max) → ถ่วงน้ำหนัก → จัดอันดับ → จัดชั้น
 *
 *  1) "raw"        ข้อมูลดิบรายการค้า (ปี/จังหวัด/นำเข้า-ส่งออก/หมวดสินค้า/น้ำหนัก ตัน)
 *                  + คอลัมน์ V,G,D,B,S บางตัวหรือครบก็ได้ (ไม่บังคับ) → ตัวที่ไม่มี ระบบคำนวณเอง
 *  2) "indicators" ไม่มีข้อมูลดิบ มีแต่ค่าตัวชี้วัดรายจังหวัด 1 แถว = 1 จังหวัด → ต้องมีครบ 5 ตัว
 *                  และต้องมีปริมาณเฉลี่ยต่อปี (กฎจัดชั้นข้อ 1/2 ต้องใช้)
 */
const { parseCsv } = require('./csv');

// ชื่อหัวคอลัมน์ที่ยอมรับได้ (เทียบแบบไม่สนตัวพิมพ์/ช่องว่าง/ขีดล่าง)
const ALIASES = {
  year: ['year', 'year_be', 'year_ad', 'ปี', 'ปีพ.ศ.', 'พ.ศ.', 'ปีพศ'],
  province: ['provincename_th', 'province', 'จังหวัด', 'พื้นที่', 'ท่าเรือ', 'จังหวัด/ท่าเรือ'],
  provinceEn: ['provincename_en', 'province_en', 'area_en', 'area(en)'],
  direction: ['processingindicator', 'direction', 'ทิศทาง', 'ประเภท', 'นำเข้า/ส่งออก', 'ขาเข้า/ขาออก'],
  category: ['categoryname_th', 'goodscategory', 'category', 'หมวดสินค้า', 'หมวด', 'หมวดหมู่ใหม่', 'หมวดหมู่สินค้า', 'หมวดหมู่'],
  categoryEn: ['categoryname_en', 'category_en', 'category(en)', 'newcategory(en)'],
  originalGoods: ['originalgoodsmapping', 'originalgoods', 'สินค้าเดิม', 'ชื่อสินค้าเดิม', 'สินค้า'],
  weight: ['totalweight', 'weight', 'weightton', 'น้ำหนัก', 'ปริมาณ', 'ปริมาณ(ตัน)', 'น้ำหนัก(ตัน)',
    'น้ำหนักรวม', 'น้ำหนักรวม(ตัน)', 'น้ำหนักรวม(กก.)'],
  V: ['v', 'volume', 'volumescore', 'ปริมาณสินค้า'],
  G: ['g', 'growth', 'growthrate', 'growthscore', 'อัตราการเติบโต', 'การเติบโต'],
  D: ['d', 'diversity', 'diversityscore', 'ความหลากหลาย'],
  B: ['b', 'balance', 'balancescore', 'ความสมดุล'],
  S: ['s', 'stability', 'stabilityscore', 'ดัชนีความเสถียร', 'เสถียรภาพ', 'ความเสถียร'],
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

const cellText = (r, i) => (i === undefined ? '' : String(r[i] ?? '').trim());

const MAX_ERRORS = 15;
const KEYS = ['V', 'G', 'D', 'B', 'S'];
const RAW_FIELDS = ['year', 'province', 'direction', 'category', 'weight'];

function parseDataset(csvText) {
  const rows = parseCsv(csvText);
  if (rows.length < 2) throw new ImportError('ไฟล์ว่าง หรือมีแต่หัวคอลัมน์ ไม่มีข้อมูล');

  const header = rows[0];
  const col = mapHeader(header);
  const indicatorKeys = KEYS.filter((k) => col[k] !== undefined);
  const hasRaw = RAW_FIELDS.every((k) => col[k] !== undefined);

  if (hasRaw) return parseRaw(rows, col, indicatorKeys);
  if (indicatorKeys.length === KEYS.length && col.province !== undefined) return parseIndicatorsOnly(rows, col);

  if (indicatorKeys.length > 0) {
    const missing = KEYS.filter((k) => !indicatorKeys.includes(k));
    throw new ImportError(
      'ไฟล์ไม่มีข้อมูลดิบให้คำนวณตัวชี้วัดที่ขาด — ต้องมีข้อมูลดิบ หรือมีคอลัมน์ V,G,D,B,S ครบทั้ง 5 ตัว',
      [`ตัวชี้วัดที่ขาด: ${missing.join(', ')}`, `หัวคอลัมน์ที่พบ: ${header.join(', ')}`]
    );
  }
  const missingRaw = RAW_FIELDS.filter((k) => col[k] === undefined);
  throw new ImportError(
    'ไม่รู้จักรูปแบบไฟล์ — ต้องมีข้อมูลดิบ (ปี, จังหวัด, นำเข้า/ส่งออก, หมวดสินค้า, น้ำหนัก) ' +
    'หรือค่าตัวชี้วัด V,G,D,B,S ครบรายจังหวัด (ดาวน์โหลดไฟล์ตัวอย่างในหน้านี้ได้)',
    [`หัวคอลัมน์ที่พบ: ${header.join(', ')}`, `คอลัมน์ข้อมูลดิบที่ขาด: ${missingRaw.join(', ')}`]
  );
}

function parseRaw(rows, col, indicatorKeys) {
  const records = [];
  const errors = [];
  const provided = {}; // { จังหวัด: { G: ..., S: ... } } ค่าตัวชี้วัดที่มากับไฟล์

  for (let i = 1; i < rows.length && errors.length < MAX_ERRORS; i++) {
    const r = rows[i];
    const years = toYears(r[col.year]);
    const provinceTh = cellText(r, col.province);
    const direction = toDirection(r[col.direction]);
    const categoryTh = cellText(r, col.category);
    const weight = toNumber(r[col.weight]);

    const problems = [];
    if (!years) problems.push(`ปี "${cellText(r, col.year)}" ไม่ถูกต้อง`);
    if (!provinceTh) problems.push('ไม่มีชื่อจังหวัด');
    if (!direction) problems.push(`นำเข้า/ส่งออก "${cellText(r, col.direction)}" ไม่รู้จัก`);
    if (!categoryTh) problems.push('ไม่มีหมวดสินค้า');
    if (!Number.isFinite(weight) || weight < 0) problems.push(`น้ำหนัก "${cellText(r, col.weight)}" ไม่ใช่ตัวเลข ≥ 0`);

    // ค่าตัวชี้วัดเป็นค่าระดับจังหวัด: เว้นว่างบางแถวได้ แต่ถ้าใส่ ต้องเป็นตัวเลขและตรงกันทุกแถวของจังหวัดเดียวกัน
    for (const k of indicatorKeys) {
      const cell = cellText(r, col[k]);
      if (cell === '' || !provinceTh) continue;
      const v = toNumber(cell);
      if (!Number.isFinite(v)) { problems.push(`${k} "${cell}" ไม่ใช่ตัวเลข`); continue; }
      provided[provinceTh] = provided[provinceTh] || {};
      const prev = provided[provinceTh][k];
      if (prev !== undefined && Math.abs(prev - v) > 1e-9) {
        problems.push(`ค่า ${k} ของ "${provinceTh}" ไม่ตรงกับแถวก่อนหน้า (${prev} กับ ${v})`);
      } else provided[provinceTh][k] = v;
    }

    if (problems.length) { errors.push(`แถว ${i + 1}: ${problems.join(', ')}`); continue; }
    records.push({
      ...years,
      provinceTh,
      provinceEn: cellText(r, col.provinceEn),
      direction,
      categoryTh,
      categoryEn: cellText(r, col.categoryEn),
      originalGoods: cellText(r, col.originalGoods),
      weightTon: weight,
    });
  }
  if (errors.length) throw new ImportError('ข้อมูลบางแถวไม่ถูกต้อง แก้ไขไฟล์แล้วนำเข้าใหม่', errors);

  // คอลัมน์ตัวชี้วัดไหนที่มี ต้องมีค่าครบทุกจังหวัด ไม่งั้นค่าจากไฟล์กับค่าที่คำนวณเองจะปนกันในคอลัมน์เดียว
  const provinces = [...new Set(records.map((r) => r.provinceTh))];
  for (const k of indicatorKeys) {
    const missing = provinces.filter((p) => !provided[p] || provided[p][k] === undefined);
    if (missing.length) {
      const more = missing.length > 8 ? ` และอีก ${missing.length - 8} จังหวัด` : '';
      errors.push(`คอลัมน์ ${k} ไม่มีค่าของ: ${missing.slice(0, 8).join(', ')}${more}`);
    }
  }
  if (errors.length) {
    throw new ImportError('ค่าตัวชี้วัดในไฟล์ไม่ครบทุกจังหวัด — ใส่ให้ครบ หรือลบคอลัมน์นั้นออกให้ระบบคำนวณเอง', errors);
  }

  const computedKeys = KEYS.filter((k) => !indicatorKeys.includes(k));
  const yearCount = new Set(records.map((r) => r.yearAD)).size;
  if (yearCount < 2 && (computedKeys.includes('G') || computedKeys.includes('S'))) {
    throw new ImportError('ต้องมีข้อมูลอย่างน้อย 2 ปี จึงจะคำนวณการเติบโต (G) และเสถียรภาพ (S) ได้ (หรือใส่คอลัมน์ G, S มาในไฟล์)');
  }
  return { mode: 'raw', records, indicators: null, provided, providedKeys: indicatorKeys };
}

function parseIndicatorsOnly(rows, col) {
  if (col.avgVolume === undefined) {
    throw new ImportError('ไฟล์ที่มีแต่ค่าตัวชี้วัด (ไม่มีข้อมูลดิบ) ต้องมีคอลัมน์ AvgVolumeTon (ปริมาณเฉลี่ย ตัน/ปี) เพราะกฎจัดชั้นข้อ 1/2 ใช้ค่านี้');
  }
  const indicators = [];
  const errors = [];
  const seen = new Set();
  for (let i = 1; i < rows.length && errors.length < MAX_ERRORS; i++) {
    const r = rows[i];
    const provinceTh = cellText(r, col.province);
    const raw = {};
    const problems = [];
    if (!provinceTh) problems.push('ไม่มีชื่อจังหวัด');
    else if (seen.has(provinceTh)) problems.push(`จังหวัด "${provinceTh}" ซ้ำ (ไฟล์แบบนี้ 1 แถว = 1 จังหวัด)`);
    for (const k of KEYS) {
      raw[k] = toNumber(r[col[k]]);
      if (!Number.isFinite(raw[k])) problems.push(`${k} "${cellText(r, col[k])}" ไม่ใช่ตัวเลข`);
    }
    const avgVolumeTon = toNumber(r[col.avgVolume]);
    if (!Number.isFinite(avgVolumeTon) || avgVolumeTon < 0) problems.push('AvgVolumeTon ต้องเป็นตัวเลข ≥ 0');
    if (problems.length) { errors.push(`แถว ${i + 1}: ${problems.join(', ')}`); continue; }
    seen.add(provinceTh);
    const years = col.year !== undefined ? toYears(r[col.year]) : null;
    indicators.push({
      provinceTh,
      provinceEn: cellText(r, col.provinceEn),
      yearAD: years ? years.yearAD : null,
      avgYearlyTotalTon: avgVolumeTon,
      raw,
    });
  }
  if (errors.length) throw new ImportError('ข้อมูลบางแถวไม่ถูกต้อง แก้ไขไฟล์แล้วนำเข้าใหม่', errors);
  if (indicators.length < 2) throw new ImportError('ต้องมีอย่างน้อย 2 จังหวัด จึงจะปรับสเกลและจัดอันดับได้');
  return { mode: 'indicators', records: [], indicators, provided: {}, providedKeys: [...KEYS] };
}

class ImportError extends Error {
  constructor(message, details = []) {
    super(message);
    this.details = details;
  }
}

module.exports = { parseDataset, ImportError };
