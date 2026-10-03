'use strict';
/**
 * DSS ท่าเรือ — Frontend (vanilla JS, ไม่มี framework/library ภายนอก)
 * ออกแบบใหม่ทั้งหมดตาม FR1-FR6 (ไม่ได้อิงจาก mockup หน้า 18-21 ของสไลด์เดิม)
 */

const TIER_LABEL = {
  1: 'ชั้น 1 · ขยายกำลังรองรับ',
  2: 'ชั้น 2 · พัฒนาเฉพาะทาง',
  3: 'ชั้น 3 · พัฒนาเฉพาะทาง',
  4: 'ชั้น 4 · ติดตาม',
};

const IND_LABEL = {
  V: 'ปริมาณ (Volume)',
  G: 'การเติบโต (Growth)',
  D: 'ความหลากหลาย (Diversity)',
  B: 'ความสมดุล (Balance)',
  S: 'เสถียรภาพ (Stability)',
};

const PRESETS = {
  balanced: { key: 'balanced', label: 'ค่าเริ่มต้น (สมดุล)', weights: { V: 40, G: 25, D: 15, B: 10, S: 10 } },
  capacity: { key: 'capacity', label: 'เน้นขยายกำลังรองรับ', weights: { V: 50, G: 20, D: 10, B: 10, S: 10 } },
  stability: { key: 'stability', label: 'เน้นความเสถียรภาพ', weights: { V: 20, G: 15, D: 10, B: 15, S: 40 } },
};

let dashboardData = null;      // ผลลัพธ์จาก GET /api/dashboard-data (น้ำหนักเริ่มต้น)
let whatifWeights = { V: 40, G: 25, D: 15, B: 10, S: 10 }; // หน่วย % (int)
let whatifResult = null;       // ผลลัพธ์ล่าสุดจาก POST /api/recalculate

// ---------------- Bootstrapping ----------------

async function fetchJSON(url, options) {
  const res = await fetch(url, options);
  let body;
  try { body = await res.json(); } catch (e) { body = null; }
  if (!res.ok) {
    const msg = (body && body.error) ? body.error : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return body;
}

async function init() {
  setupTabs();
  try {
    dashboardData = await fetchJSON('/api/dashboard-data');
    document.getElementById('loading').style.display = 'none';
    setConnStatus(true);
    renderOverview(dashboardData);
    renderRanking(dashboardData.provinces);
    renderDetail(dashboardData.provinces);
    initWhatIf();
  } catch (err) {
    document.getElementById('loading').style.display = 'none';
    showError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้: ' + err.message + ' — ตรวจสอบว่ารัน "npm start" (หรือ node server/index.js) อยู่หรือไม่');
    setConnStatus(false);
  }
}

function setConnStatus(ok) {
  const el = document.getElementById('conn-status');
  if (ok) {
    el.textContent = `เชื่อมต่อสำเร็จ · ${dashboardData.provinces.length} พื้นที่ · ปี ${dashboardData.years[0]}–${dashboardData.years[dashboardData.years.length - 1]}`;
    el.className = 'conn-status ok';
  } else {
    el.textContent = 'เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ';
    el.className = 'conn-status err';
  }
}

function showError(msg) {
  const box = document.getElementById('error-box');
  box.style.display = 'block';
  box.textContent = msg;
}

function setupTabs() {
  const buttons = document.querySelectorAll('.tab-btn');
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      buttons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.tab-panel').forEach((p) => (p.style.display = 'none'));
      document.getElementById('tab-' + btn.dataset.tab).style.display = 'flex';
    });
  });
}

// ---------------- Tab 1: ภาพรวม (FR1, FR2) ----------------

function renderOverview(data) {
  const el = document.getElementById('tab-overview');
  const ov = data.overview;
  const changeClass = ov.pctChangeVsFirstYear > 0 ? 'up' : (ov.pctChangeVsFirstYear < 0 ? 'down' : '');
  const changeSign = ov.pctChangeVsFirstYear > 0 ? '+' : '';

  el.innerHTML = `
    <div class="kpi-grid">
      <div class="kpi-card">
        <p class="kpi-label">ปริมาณรวมปีล่าสุด (${ov.years[ov.years.length - 1]})</p>
        <p class="kpi-value">${fmtNum(ov.totalLatestYearTon)} <span style="font-size:14px;font-weight:600;color:var(--muted)">ตัน</span></p>
        <p class="kpi-delta ${changeClass}">${changeSign}${ov.pctChangeVsFirstYear}% เทียบปี ${ov.years[0]}</p>
      </div>
      <div class="kpi-card">
        <p class="kpi-label">พื้นที่ในระบบ (ครบตามข้อมูลจริง)</p>
        <p class="kpi-value">${data.provinces.length} <span style="font-size:14px;font-weight:600;color:var(--muted)">พื้นที่</span></p>
      </div>
      <div class="kpi-card">
        <p class="kpi-label">สัดส่วน 2 พื้นที่สูงสุด</p>
        <p class="kpi-value">${ov.top2ShareOfTotal}%</p>
        <p class="kpi-delta">${ov.top2Provinces.join(' · ')}</p>
      </div>
      <div class="kpi-card">
        <p class="kpi-label">พื้นที่อันดับ 1 (คะแนนรวม)</p>
        <p class="kpi-value small">${data.provinces[0].nameTh}</p>
        <p class="kpi-delta">Priority Score ${data.provinces[0].finalScore}</p>
      </div>
    </div>

    <div class="card">
      <p class="section-title">ปริมาณนำเข้า–ส่งออกรายปี (FR1)</p>
      <p class="section-sub">หน่วย: ตัน · รวมทั้ง 23 พื้นที่</p>
      ${buildImportExportChart(ov)}
    </div>

    <div class="card">
      <p class="section-title">อัตราการเติบโต (FR2)</p>
      <p class="section-sub">คำนวณจากอัตราการเปลี่ยนแปลงปริมาณรวมรายปี (YoY) เฉลี่ยของแต่ละพื้นที่ แล้วปรับเป็นคะแนน 0–100 (คอลัมน์ G) — ดูค่าเต็มได้ในแท็บ "คะแนนตัวชี้วัดรายพื้นที่"</p>
      <div class="hint-box">พื้นที่ที่มีคะแนน G สูงสุด ณ ขณะนี้คือ <strong>${topByMetric(data.provinces, 'G').nameTh}</strong> (G = ${topByMetric(data.provinces, 'G').G})</div>
    </div>
  `;
}

function buildImportExportChart(ov) {
  const W = 720, H = 260, padL = 50, padB = 34, padT = 14, padR = 10;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const maxVal = Math.max(...ov.importByYear, ...ov.exportByYear) * 1.15 || 1;
  const n = ov.years.length;
  const groupW = plotW / n;
  const barW = Math.min(34, groupW * 0.32);

  let bars = '';
  ov.years.forEach((y, i) => {
    const gx = padL + i * groupW + groupW / 2;
    const impH = (ov.importByYear[i] / maxVal) * plotH;
    const expH = (ov.exportByYear[i] / maxVal) * plotH;
    const impX = gx - barW - 3;
    const expX = gx + 3;
    bars += `
      <rect x="${impX}" y="${padT + plotH - impH}" width="${barW}" height="${impH}" fill="#16787f" rx="3"></rect>
      <rect x="${expX}" y="${padT + plotH - expH}" width="${barW}" height="${expH}" fill="#e8a33d" rx="3"></rect>
      <text x="${gx}" y="${H - 10}" text-anchor="middle" font-size="12" fill="#5f7674">${y}</text>
      <text x="${impX + barW / 2}" y="${padT + plotH - impH - 6}" text-anchor="middle" font-size="10.5" fill="#0b3d3f">${fmtNum(ov.importByYear[i])}</text>
      <text x="${expX + barW / 2}" y="${padT + plotH - expH - 6}" text-anchor="middle" font-size="10.5" fill="#0b3d3f">${fmtNum(ov.exportByYear[i])}</text>
    `;
  });

  // gridlines
  let grid = '';
  const steps = 4;
  for (let s = 0; s <= steps; s++) {
    const yy = padT + plotH - (s / steps) * plotH;
    grid += `<line x1="${padL}" y1="${yy}" x2="${W - padR}" y2="${yy}" stroke="#e3ecea" stroke-width="1"></line>
      <text x="${padL - 8}" y="${yy + 4}" text-anchor="end" font-size="10.5" fill="#8aa19f">${fmtNum(Math.round((s / steps) * maxVal))}</text>`;
  }

  return `
    <div class="chart-legend">
      <span><span class="legend-dot" style="background:#16787f"></span>นำเข้า</span>
      <span><span class="legend-dot" style="background:#e8a33d"></span>ส่งออก</span>
    </div>
    <svg viewBox="0 0 ${W} ${H}" style="width:100%; height:auto; max-width:${W}px">${grid}${bars}</svg>
  `;
}

function topByMetric(provinces, key) {
  return provinces.reduce((best, p) => (p[key] > best[key] ? p : best), provinces[0]);
}

// ---------------- Tab 2: จัดลำดับความสำคัญ (FR4, FR5) ----------------

function renderRanking(provinces) {
  const el = document.getElementById('tab-ranking');
  el.innerHTML = `
    <div class="card">
      <p class="section-title">จัดลำดับความสำคัญพื้นที่ (น้ำหนักเริ่มต้น: สมดุล V40 G25 D15 B10 S10)</p>
      <p class="section-sub">คำนวณจาก Priority Score = 0.40·V + 0.25·G + 0.15·D + 0.10·B + 0.10·S แล้วจัดชั้นตามกฎ 4 ข้อ (ดู "หมายเหตุการคำนวณ" ในเอกสารโครงการสำหรับเกณฑ์ปริมาณที่ใช้แยกชั้น 1/2)</p>
      <div class="table-wrap">${buildRankingTable(provinces)}</div>
    </div>
    <div class="card">
      <p class="section-title">ความหมายของแต่ละชั้น</p>
      <div class="table-wrap">
        <table class="data-table">
          <tr><th>ชั้น</th><th>เกณฑ์</th><th>ความหมาย</th></tr>
          <tr><td><span class="tier-badge tier-1">ชั้น 1</span></td><td>คะแนน ≥ 65 และปริมาณเฉลี่ย ≥ เกณฑ์ที่กำหนด</td><td>ขยายกำลังรองรับ — ควรลงทุนขยายท่าเรือ</td></tr>
          <tr><td><span class="tier-badge tier-2">ชั้น 2</span></td><td>คะแนน ≥ 65 แต่ปริมาณเฉลี่ย &lt; เกณฑ์ที่กำหนด</td><td>พัฒนาเฉพาะทาง — พัฒนาแบบเจาะจงจุดแข็ง</td></tr>
          <tr><td><span class="tier-badge tier-3">ชั้น 3</span></td><td>คะแนน 50–64.9</td><td>พัฒนาเฉพาะทาง — พัฒนาตามศักยภาพ</td></tr>
          <tr><td><span class="tier-badge tier-4">ชั้น 4</span></td><td>คะแนน &lt; 50</td><td>ติดตาม — เฝ้าระวัง ยังไม่จัดลำดับความสำคัญลงทุน</td></tr>
        </table>
      </div>
    </div>
  `;
}

function buildRankingTable(provinces) {
  const rows = provinces.map((p) => `
    <tr>
      <td class="rank-cell">${p.rank}</td>
      <td>${p.nameTh}</td>
      <td>${p.nameEn}</td>
      <td><strong>${p.finalScore}</strong></td>
      <td><span class="tier-badge tier-${p.tier}">${TIER_LABEL[p.tier]}</span></td>
    </tr>
  `).join('');
  return `
    <table class="data-table">
      <thead><tr><th>อันดับ</th><th>พื้นที่</th><th>Area (EN)</th><th>Priority Score</th><th>ชั้นความสำคัญ</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

// ---------------- Tab 3: What-if (FR3) ----------------

function initWhatIf() {
  const el = document.getElementById('tab-whatif');
  el.innerHTML = `
    <div class="card">
      <p class="section-title">ปรับน้ำหนักตัวชี้วัด (FR3)</p>
      <p class="section-sub">ปรับสัดส่วนความสำคัญของแต่ละตัวชี้วัด แล้วกด "คำนวณใหม่" เพื่อดูอันดับที่เปลี่ยนไป — ผลรวมของน้ำหนักทั้ง 5 ตัวต้องเท่ากับ 100%</p>
      <div id="weight-grid" class="weight-grid"></div>
      <div class="weight-sum-row">
        <span id="weight-sum-badge" class="weight-sum-badge">รวม 100%</span>
        <button id="btn-recalc" class="btn btn-primary">คำนวณใหม่</button>
      </div>
      <div class="preset-row">
        <button class="btn btn-outline" data-preset="balanced">ค่าเริ่มต้น (สมดุล)</button>
        <button class="btn btn-outline" data-preset="capacity">เน้นขยายกำลังรองรับ</button>
        <button class="btn btn-outline" data-preset="stability">เน้นความเสถียรภาพ</button>
      </div>
      <p id="whatif-status" class="whatif-status"></p>
    </div>
    <div class="card">
      <p class="section-title">ผลลัพธ์การจัดอันดับใหม่</p>
      <p class="section-sub">คอลัมน์ "เปลี่ยนแปลง" เทียบกับอันดับตอนใช้น้ำหนักเริ่มต้น (สมดุล)</p>
      <div id="whatif-table" class="table-wrap">
        <p style="color:var(--muted); font-size:13.5px">ยังไม่ได้คำนวณ — ปรับน้ำหนักด้านบนแล้วกด "คำนวณใหม่"</p>
      </div>
    </div>
  `;

  renderWeightGrid();
  document.getElementById('btn-recalc').addEventListener('click', doRecalculate);
  document.querySelectorAll('[data-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const preset = PRESETS[btn.dataset.preset];
      whatifWeights = { ...preset.weights };
      renderWeightGrid();
      doRecalculate();
    });
  });

  // เริ่มต้นด้วยโปรไฟล์สมดุล คำนวณให้เห็นผลทันที
  doRecalculate();
}

function renderWeightGrid() {
  const grid = document.getElementById('weight-grid');
  const keys = ['V', 'G', 'D', 'B', 'S'];
  grid.innerHTML = keys.map((k) => `
    <div class="weight-item">
      <label>
        <span><span class="w-letter">${k}</span>${IND_LABEL[k]}</span>
        <span id="w-val-${k}">${whatifWeights[k]}%</span>
      </label>
      <input type="range" min="0" max="100" step="1" value="${whatifWeights[k]}" id="w-input-${k}" data-key="${k}">
    </div>
  `).join('');

  keys.forEach((k) => {
    document.getElementById(`w-input-${k}`).addEventListener('input', (e) => {
      whatifWeights[k] = parseInt(e.target.value, 10);
      document.getElementById(`w-val-${k}`).textContent = whatifWeights[k] + '%';
      updateSumBadge();
    });
  });
  updateSumBadge();
}

function updateSumBadge() {
  const sum = ['V', 'G', 'D', 'B', 'S'].reduce((a, k) => a + whatifWeights[k], 0);
  const badge = document.getElementById('weight-sum-badge');
  const btn = document.getElementById('btn-recalc');
  badge.textContent = `รวม ${sum}%`;
  if (sum === 100) {
    badge.classList.remove('bad');
    btn.disabled = false;
  } else {
    badge.classList.add('bad');
    btn.disabled = true;
  }
}

async function doRecalculate() {
  const status = document.getElementById('whatif-status');
  const sum = ['V', 'G', 'D', 'B', 'S'].reduce((a, k) => a + whatifWeights[k], 0);
  if (sum !== 100) {
    status.textContent = 'ผลรวมน้ำหนักต้องเท่ากับ 100% ก่อนคำนวณ';
    return;
  }
  status.textContent = 'กำลังคำนวณ…';
  const weightsFraction = {
    V: whatifWeights.V / 100, G: whatifWeights.G / 100, D: whatifWeights.D / 100,
    B: whatifWeights.B / 100, S: whatifWeights.S / 100,
  };
  try {
    whatifResult = await fetchJSON('/api/recalculate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ weights: weightsFraction }),
    });
    renderWhatIfTable(whatifResult.provinces);
    status.textContent = `คำนวณสำเร็จ · ${new Date().toLocaleTimeString('th-TH')}`;
  } catch (err) {
    status.textContent = 'คำนวณไม่สำเร็จ: ' + err.message;
  }
}

function renderWhatIfTable(provinces) {
  const box = document.getElementById('whatif-table');
  const rows = provinces.map((p) => {
    const diff = p.baseRank - p.rank; // ค่าบวก = อันดับดีขึ้น (เลขอันดับลดลง)
    let changeHtml;
    if (diff > 0) changeHtml = `<span class="change-up">▲ ขึ้น ${diff}</span>`;
    else if (diff < 0) changeHtml = `<span class="change-down">▼ ลง ${Math.abs(diff)}</span>`;
    else changeHtml = `<span class="change-flat">— คงที่</span>`;
    return `
      <tr>
        <td class="rank-cell">${p.rank}</td>
        <td>${p.nameTh}</td>
        <td>${p.finalScore}</td>
        <td>อันดับเดิม ${p.baseRank}</td>
        <td>${changeHtml}</td>
        <td><span class="tier-badge tier-${p.tier}">${TIER_LABEL[p.tier]}</span></td>
      </tr>
    `;
  }).join('');
  box.innerHTML = `
    <table class="data-table">
      <thead><tr><th>อันดับใหม่</th><th>พื้นที่</th><th>Priority Score</th><th>เทียบฐาน</th><th>เปลี่ยนแปลง</th><th>ชั้น</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

// ---------------- Tab 4: คะแนนตัวชี้วัดรายพื้นที่ (FR6) ----------------

function renderDetail(provinces) {
  const el = document.getElementById('tab-detail');
  const rows = provinces.map((p) => `
    <tr>
      <td class="rank-cell">${p.rank}</td>
      <td>${p.nameTh}</td>
      ${miniBarCell(p.V)}
      ${miniBarCell(p.G)}
      ${miniBarCell(p.D)}
      ${miniBarCell(p.B)}
      ${miniBarCell(p.S)}
      <td><strong>${p.finalScore}</strong></td>
      <td><span class="tier-badge tier-${p.tier}">ชั้น ${p.tier}</span></td>
    </tr>
  `).join('');

  el.innerHTML = `
    <div class="card">
      <p class="section-title">คะแนนรายตัวชี้วัด (0–100) ต่อพื้นที่ (FR6)</p>
      <p class="section-sub">V = ปริมาณ, G = การเติบโต, D = ความหลากหลายสินค้า, B = ความสมดุลนำเข้า-ส่งออก, S = เสถียรภาพ — ทุกค่าปรับสเกล 0–100 ด้วยวิธี min-max ข้ามทั้ง 23 พื้นที่</p>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr><th>อันดับ</th><th>พื้นที่</th><th>V</th><th>G</th><th>D</th><th>B</th><th>S</th><th>Priority Score</th><th>ชั้น</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  `;
}

function miniBarCell(value) {
  const pct = Math.max(0, Math.min(100, value));
  return `<td><div class="mini-bar-cell">
      <span class="mini-bar-track"><span class="mini-bar-fill" style="width:${pct}%"></span></span>
      <span class="mini-bar-num">${value}</span>
    </div></td>`;
}

// ---------------- Utils ----------------

function fmtNum(n) {
  return new Intl.NumberFormat('th-TH').format(n);
}

init();
