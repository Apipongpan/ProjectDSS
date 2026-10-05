'use strict';
/**
 * DSS ท่าเรือ — Backend server
 * ใช้ Node.js core ล้วน ๆ (http + node:sqlite) ไม่มี dependency ภายนอก ไม่ต้อง npm install
 * ต้องใช้ Node.js 22.13 ขึ้นไป (มี node:sqlite ในตัว)
 *
 * สถาปัตยกรรม 3 ชั้น:
 *   Data Management  → server/lib/db.js (SQLite 4 ตารางตาม ER) + server/lib/importer.js (นำเข้า CSV)
 *   Model/Analytics  → server/lib/calc.js (V,G,D,B,S + Weighted Scoring + ตารางกฎจัดชั้น)
 *   UI/Visualization → public/
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { buildProvinceMetrics, normalizeIndicators, rankProvinces, classifyTier } = require('./lib/calc');
const { parseDataset, ImportError } = require('./lib/importer');
const store = require('./lib/db');

const DEFAULT_WEIGHTS = { V: 0.40, G: 0.25, D: 0.15, B: 0.10, S: 0.10 };

// เกณฑ์ปริมาณแยกชั้น 1/2 ตามตารางกฎสไลด์หน้า 11 (ปรับได้จากหน้า What-if)
const DEFAULT_VOLUME_THRESHOLD_TON = 5000000;

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const SAMPLE_FILE = path.join(PUBLIC_DIR, 'samples', 'port-trade-2565-2568.csv');

// ---------------- Data ----------------

function importCsv(csvText, fileName) {
  const dataset = parseDataset(csvText);
  store.replaceDataset(dataset, fileName, {
    buildMetrics: (records, provided) => buildProvinceMetrics(records, provided).metrics,
    normalize: normalizeIndicators,
    rank: (metrics) => rankProvinces(metrics, DEFAULT_WEIGHTS, DEFAULT_VOLUME_THRESHOLD_TON),
  });
  return dataset;
}

function loadSampleData() {
  importCsv(fs.readFileSync(SAMPLE_FILE, 'utf8'), path.basename(SAMPLE_FILE));
}


function withTier(list, threshold) {
  return list.map((p) => ({ ...p, tier: classifyTier(p.finalScore, p.avgYearlyTotalTon, threshold) }));
}

const round1 = (x) => Math.round(x * 10) / 10;

// FR1, FR2: ปริมาณนำเข้า/ส่งออกรายปี แยกจังหวัดและหมวดสินค้า (ไม่มีถ้าชุดข้อมูลเป็นแบบ "มีคะแนนมาแล้ว")
function buildTrends(records) {
  if (records.length === 0) return null;
  const years = [...new Set(records.map((r) => r.yearAD))].sort();
  const categories = [...new Set(records.map((r) => r.categoryTh))].sort();
  const yi = new Map(years.map((y, i) => [y, i]));

  const blank = () => ({
    import: years.map(() => 0),
    export: years.map(() => 0),
    byCategory: Object.fromEntries(categories.map((c) => [c, years.map(() => 0)])),
  });
  const all = blank();
  const byProvince = new Map();

  for (const r of records) {
    if (!byProvince.has(r.provinceId)) {
      byProvince.set(r.provinceId, { id: r.provinceId, nameTh: r.provinceTh, nameEn: r.provinceEn, ...blank() });
    }
    const i = yi.get(r.yearAD);
    for (const t of [all, byProvince.get(r.provinceId)]) {
      t[r.direction][i] += r.weightTon;
      t.byCategory[r.categoryTh][i] += r.weightTon;
    }
  }

  const roundAll = (t) => {
    t.import = t.import.map(Math.round);
    t.export = t.export.map(Math.round);
    for (const c of categories) t.byCategory[c] = t.byCategory[c].map(Math.round);
    return t;
  };
  const provinces = [...byProvince.values()].map(roundAll).sort((a, b) => a.nameTh.localeCompare(b.nameTh, 'th'));

  return {
    years,
    yearsBE: years.map((y) => y + 543),
    categories,
    all: roundAll(all),
    provinces,
  };
}

function buildOverview(trends, scores) {
  if (!trends) return null;
  const totals = trends.years.map((_, i) => trends.all.import[i] + trends.all.export[i]);
  const first = totals[0];
  const latest = totals[totals.length - 1];

  // สัดส่วน 2 พื้นที่ที่ปริมาณสูงสุด คิดรวมทั้งช่วงปี (สไลด์หน้า 8: ชลบุรี+ระยอง 84.7%)
  const provTotals = trends.provinces
    .map((p) => ({ nameTh: p.nameTh, total: p.import.reduce((a, b) => a + b, 0) + p.export.reduce((a, b) => a + b, 0) }))
    .sort((a, b) => b.total - a.total);
  const grand = provTotals.reduce((a, p) => a + p.total, 0);
  const top2 = provTotals.slice(0, 2);

  return {
    totalLatestYearTon: latest,
    pctChangeVsFirstYear: first > 0 ? round1(((latest - first) / first) * 100) : 0,
    top2Provinces: top2.map((p) => p.nameTh),
    top2ShareOfTotal: grand > 0 ? round1((top2.reduce((a, p) => a + p.total, 0) / grand) * 100) : 0,
    provinceCount: scores.length,
  };
}

function buildDashboard() {
  const records = store.loadTradeRecords();
  const scores = store.loadScores();
  const trends = buildTrends(records);
  return {
    dataset: store.loadDatasetInfo(),
    defaults: { weights: DEFAULT_WEIGHTS, volumeThresholdTon: DEFAULT_VOLUME_THRESHOLD_TON },
    overview: buildOverview(trends, scores),
    trends,
    provinces: withTier(scores, DEFAULT_VOLUME_THRESHOLD_TON),
  };
}

// ---------------- Validation ----------------

function validateWeights(weights) {
  if (!weights || typeof weights !== 'object') return 'ไม่พบ weights';
  const keys = ['V', 'G', 'D', 'B', 'S'];
  for (const k of keys) {
    if (typeof weights[k] !== 'number' || Number.isNaN(weights[k]) || weights[k] < 0) {
      return `weights.${k} ต้องเป็นตัวเลข >= 0`;
    }
  }
  const sum = keys.reduce((a, k) => a + weights[k], 0);
  if (Math.abs(sum - 1) > 0.01) {
    return `น้ำหนักทั้ง 5 ตัวต้องรวมกันได้ 1.0 (ตอนนี้รวมได้ ${sum.toFixed(3)})`;
  }
  return null;
}

// ---------------- HTTP helpers ----------------

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readJsonBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error(`ไฟล์/ข้อมูลใหญ่เกิน ${Math.round(maxBytes / 1024 / 1024)} MB`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const data = Buffer.concat(chunks).toString('utf8');
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        reject(new Error('JSON ไม่ถูกต้อง'));
      }
    });
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res, pathname) {
  let rel;
  try {
    rel = pathname === '/' ? '/index.html' : decodeURIComponent(pathname);
  } catch (e) {
    // URL ที่ encode ผิดรูป (เช่น %E0%A) ไม่ให้เซิร์ฟเวอร์ล่ม
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('URL ไม่ถูกต้อง');
  }
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  // กันการหลุดออกนอก public/ (path traversal)
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('ไม่พบไฟล์: ' + rel);
    }
    const ext = path.extname(filePath).toLowerCase();
    // no-cache: เบราว์เซอร์ต้องถามเซิร์ฟเวอร์ทุกครั้ง กันเห็น CSS/JS เวอร์ชันเก่าบนเครื่องที่เคยเปิดมาก่อน
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' };
    if (ext === '.csv') headers['Content-Disposition'] = `attachment; filename="${path.basename(filePath)}"`;
    res.writeHead(200, headers);
    res.end(content);
  });
}

// ---------------- Routes ----------------

const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host}`);
  const pathname = urlObj.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  try {
    if (pathname === '/api/dashboard-data' && req.method === 'GET') {
      return sendJson(res, 200, buildDashboard());
    }

    // FR3 + FR4 + FR5: คำนวณคะแนนและจัดอันดับใหม่ตามน้ำหนักที่ผู้ใช้กำหนด
    if (pathname === '/api/recalculate' && req.method === 'POST') {
      const body = await readJsonBody(req, 1024 * 1024);
      const { weights } = body || {};
      const err = validateWeights(weights);
      if (err) return sendJson(res, 400, { error: err });

      let threshold = DEFAULT_VOLUME_THRESHOLD_TON;
      if (body.volumeThresholdTon !== undefined) {
        threshold = Number(body.volumeThresholdTon);
        if (!Number.isFinite(threshold) || threshold < 0) {
          return sendJson(res, 400, { error: 'เกณฑ์ปริมาณต้องเป็นตัวเลข ≥ 0' });
        }
      }

      const base = store.loadScores(); // คะแนนฐาน (น้ำหนักเริ่มต้น) จากตาราง PRIORITY_SCORE
      const baseRankById = Object.fromEntries(base.map((r) => [r.id, r.rank]));
      const ranked = rankProvinces(base, weights, threshold);
      return sendJson(res, 200, {
        weights,
        volumeThresholdTon: threshold,
        provinces: ranked.map((r) => ({
          id: r.id,
          nameTh: r.nameTh,
          nameEn: r.nameEn,
          V: r.V, G: r.G, D: r.D, B: r.B, S: r.S,
          avgYearlyTotalTon: r.avgYearlyTotalTon,
          finalScore: r.finalScore,
          rank: r.rank,
          baseRank: baseRankById[r.id],
          tier: r.tier,
        })),
      });
    }

    // Use Case: นำเข้า/ปรับปรุงข้อมูลการค้า — แทนที่ข้อมูลทั้งชุดแล้วคำนวณใหม่ทั้งหมด
    if (pathname === '/api/import' && req.method === 'POST') {
      const body = await readJsonBody(req, 30 * 1024 * 1024);
      if (typeof body.csv !== 'string' || !body.csv.trim()) {
        return sendJson(res, 400, { error: 'ไม่พบเนื้อหาไฟล์ CSV' });
      }
      try {
        const ds = importCsv(body.csv, String(body.fileName || 'uploaded.csv'));
        return sendJson(res, 200, {
          ok: true,
          mode: ds.mode,
          rowsImported: ds.mode === 'raw' ? ds.records.length : ds.indicators.length,
          providedIndicators: ds.providedKeys,
          dataset: store.loadDatasetInfo(),
        });
      } catch (e) {
        if (e instanceof ImportError) return sendJson(res, 400, { error: e.message, details: e.details });
        throw e;
      }
    }

    // ล้างข้อมูลทั้งหมด (ใช้เตรียมสาธิตขั้น "นำเข้าข้อมูล" ตั้งแต่ระบบว่าง)
    if (pathname === '/api/clear' && req.method === 'POST') {
      store.clearAll();
      return sendJson(res, 200, { ok: true, dataset: store.loadDatasetInfo() });
    }

    if (pathname === '/api/reset-sample' && req.method === 'POST') {
      loadSampleData();
      return sendJson(res, 200, { ok: true, dataset: store.loadDatasetInfo() });
    }

    // ข้อมูลการค้าทุกแถวในตาราง TRADE_RECORD (อ่านอย่างเดียว) ให้ผู้ใช้ตรวจสอบชุดข้อมูลที่นำเข้า
    if (pathname === '/api/records' && req.method === 'GET') {
      const records = store.loadTradeRecords()
        .map((r) => ({ yearBE: r.yearBE, provinceTh: r.provinceTh, direction: r.direction, categoryTh: r.categoryTh, weightTon: r.weightTon }))
        .sort((a, b) => a.yearBE - b.yearBE || a.provinceTh.localeCompare(b.provinceTh, 'th')
          || a.direction.localeCompare(b.direction) || a.categoryTh.localeCompare(b.categoryTh, 'th'));
      return sendJson(res, 200, { records });
    }

    if (pathname === '/api/health' && req.method === 'GET') {
      const info = store.loadDatasetInfo();
      return sendJson(res, 200, { ok: true, provinces: info.provinces, records: info.records, dataset: info.fileName });
    }

    if (pathname.startsWith('/api/')) {
      return sendJson(res, 404, { error: 'ไม่พบ endpoint นี้' });
    }
  } catch (e) {
    console.error(e);
    return sendJson(res, 500, { error: 'เกิดข้อผิดพลาดในเซิร์ฟเวอร์: ' + e.message });
  }

  // ไม่ใช่ /api/* → เสิร์ฟไฟล์ static จาก public/
  return serveStatic(req, res, pathname);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`DSS ท่าเรือ server running: http://localhost:${PORT}`);
  if (store.isEmpty()) console.log('ฐานข้อมูลยังว่าง → เปิดหน้า "นำเข้าข้อมูล" เพื่อนำเข้าไฟล์ CSV');
});
