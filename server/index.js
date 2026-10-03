'use strict';
/**
 * DSS ท่าเรือ — Backend server
 * ใช้ Node.js core (`http`) ล้วน ๆ ไม่มี dependency ภายนอก (ไม่ต้องพึ่ง express/cors)
 * เหตุผล: สภาพแวดล้อมที่พัฒนาไม่สามารถเข้าถึง npm registry ได้ (นโยบายเครือข่าย)
 * และการไม่มี dependency ภายนอกเลยยังช่วยให้วันสาธิตสด รันได้ทันทีด้วย `node server/index.js`
 * โดยไม่ต้องมีอินเทอร์เน็ตหรือรอ `npm install` เลย — เชื่อถือได้กว่าเวลาขึ้นสาธิตจริง
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { buildProvinceMetrics, rankProvinces } = require('./lib/calc');

const DEFAULT_WEIGHTS = { V: 0.40, G: 0.25, D: 0.15, B: 0.10, S: 0.10 };

// เกณฑ์ปริมาณสำหรับแยกชั้น 1/2 (ดู README_CALC_NOTES.md ว่าทำไมเลขนี้ไม่ใช่ 5 ล้านตันตามสไลด์เดิม)
const VOLUME_THRESHOLD_TON = 20000;

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const records = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'trade-records.json'), 'utf8'));
const slugMap = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'province-slug-map.json'), 'utf8'));

// คำนวณ V/G/D/B/S ครั้งเดียวตอน start server (ไม่เปลี่ยนตามน้ำหนัก ขึ้นกับข้อมูลดิบเท่านั้น)
const { years, metrics } = buildProvinceMetrics(records, slugMap);

function buildOverview() {
  const totals = years.map((y) => {
    let imp = 0;
    let exp = 0;
    for (const r of records) {
      if (r.yearAD !== y) continue;
      if (r.direction === 'import') imp += r.weightKg;
      else exp += r.weightKg;
    }
    return { year: y, importTon: imp / 1000, exportTon: exp / 1000 };
  });
  const latest = totals[totals.length - 1];
  const first = totals[0];
  const totalLatestTon = latest.importTon + latest.exportTon;
  const totalFirstTon = first.importTon + first.exportTon;
  const pctChange = totalFirstTon > 0 ? ((totalLatestTon - totalFirstTon) / totalFirstTon) * 100 : 0;

  const byProvinceLatestYear = {};
  for (const r of records) {
    if (r.yearAD !== latest.year) continue;
    byProvinceLatestYear[r.provinceTh] = (byProvinceLatestYear[r.provinceTh] || 0) + r.weightKg;
  }
  const sortedProv = Object.entries(byProvinceLatestYear).sort((a, b) => b[1] - a[1]);
  const top2Total = sortedProv.slice(0, 2).reduce((a, [, v]) => a + v, 0);
  const grandTotal = sortedProv.reduce((a, [, v]) => a + v, 0);
  const top2Share = grandTotal > 0 ? (top2Total / grandTotal) * 100 : 0;

  return {
    years,
    importByYear: totals.map((t) => Math.round(t.importTon)),
    exportByYear: totals.map((t) => Math.round(t.exportTon)),
    totalLatestYearTon: Math.round(totalLatestTon),
    pctChangeVsFirstYear: Math.round(pctChange * 10) / 10,
    top2ShareOfTotal: Math.round(top2Share * 10) / 10,
    top2Provinces: sortedProv.slice(0, 2).map(([name]) => name),
  };
}

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

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    const MAX = 1024 * 1024; // 1MB พอสำหรับ body นี้แล้ว
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX) {
        reject(new Error('body ใหญ่เกินไป'));
        req.destroy();
        return;
      }
      data += chunk;
    });
    req.on('end', () => {
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
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  rel = rel.split('?')[0];
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
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(content);
  });
}

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

  if (pathname === '/api/dashboard-data' && req.method === 'GET') {
    const ranked = rankProvinces(metrics, DEFAULT_WEIGHTS, VOLUME_THRESHOLD_TON);
    return sendJson(res, 200, {
      years,
      weights: DEFAULT_WEIGHTS,
      overview: buildOverview(),
      provinces: ranked.map((r) => ({
        id: r.id,
        nameTh: r.nameTh,
        nameEn: r.nameEn,
        V: r.V, G: r.G, D: r.D, B: r.B, S: r.S,
        finalScore: r.finalScore,
        rank: r.rank,
        tier: r.tier,
      })),
    });
  }

  if (pathname === '/api/recalculate' && req.method === 'POST') {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
    const { weights } = body || {};
    const err = validateWeights(weights);
    if (err) {
      return sendJson(res, 400, { error: err });
    }

    const baseRanked = rankProvinces(metrics, DEFAULT_WEIGHTS, VOLUME_THRESHOLD_TON);
    const baseRankById = Object.fromEntries(baseRanked.map((r) => [r.id, r.rank]));

    const ranked = rankProvinces(metrics, weights, VOLUME_THRESHOLD_TON);
    return sendJson(res, 200, {
      weights,
      provinces: ranked.map((r) => ({
        id: r.id,
        nameTh: r.nameTh,
        nameEn: r.nameEn,
        V: r.V, G: r.G, D: r.D, B: r.B, S: r.S,
        finalScore: r.finalScore,
        rank: r.rank,
        baseRank: baseRankById[r.id],
        tier: r.tier,
      })),
    });
  }

  if (pathname === '/api/health' && req.method === 'GET') {
    return sendJson(res, 200, { ok: true, provinces: metrics.length, years });
  }

  if (pathname.startsWith('/api/')) {
    return sendJson(res, 404, { error: 'ไม่พบ endpoint นี้' });
  }

  // ไม่ใช่ /api/* → เสิร์ฟไฟล์ static จาก public/
  return serveStatic(req, res, pathname);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`DSS ท่าเรือ server running: http://localhost:${PORT}`);
});
