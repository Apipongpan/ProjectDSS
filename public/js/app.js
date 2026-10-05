'use strict';
/**
 * DSS ท่าเรือ — Frontend (vanilla JS, ไม่มี framework/library ภายนอก)
 * ลำดับหน้าจอตาม Use Case / Swim lane สไลด์หน้า 14:
 *   1 นำเข้าข้อมูล → 2 ดูแนวโน้ม (FR1, FR2) → 3 กำหนดน้ำหนัก (FR3) → 4 จัดอันดับ (FR4, FR5) → 5 แสดงผล/ส่งออก (FR6)
 *
 * น้ำหนักที่ผู้ใช้ตั้งในหน้า What-if เป็น "สถานะกลาง" (state.weights) ทุกหน้าที่แสดงคะแนน/อันดับ
 * ใช้ผลการคำนวณชุดเดียวกัน (state.ranking) — ปรับน้ำหนักแล้วทุกหน้าเปลี่ยนตามทันที
 */

const KEYS = ['V', 'G', 'D', 'B', 'S'];

// ความหมายของชั้นตามตารางกฎการตัดสินใจ สไลด์หน้า 11
const TIER_LABEL = {
  1: 'ชั้น 1 · ขยายกำลังรองรับ',
  2: 'ชั้น 2 · พัฒนาเฉพาะทาง',
  3: 'ชั้น 3 · พัฒนาเฉพาะทาง',
  4: 'ชั้น 4 · ติดตาม',
};
const TIER_COLOR = { 1: '#dc2626', 2: '#ea580c', 3: '#2a78d6', 4: '#94a3b8' };

const IND_LABEL = {
  V: 'ปริมาณ (Volume)',
  G: 'การเติบโต (Growth)',
  D: 'ความหลากหลาย (Diversity)',
  B: 'ความสมดุล (Balance)',
  S: 'เสถียรภาพ (Stability)',
};

// โปรไฟล์น้ำหนักตัวอย่าง สไลด์หน้า 10
const PRESETS = {
  balanced: { label: 'สมดุล (ค่าเริ่มต้น)', weights: { V: 40, G: 25, D: 15, B: 10, S: 10 } },
  capacity: { label: 'เน้นขยายกำลังรองรับ', weights: { V: 50, G: 20, D: 10, B: 10, S: 10 } },
  stability: { label: 'เน้นความเสถียรภาพ', weights: { V: 20, G: 15, D: 10, B: 15, S: 40 } },
};

const state = {
  data: null,          // GET /api/dashboard-data
  weights: { ...PRESETS.balanced.weights }, // หน่วย % (จำนวนเต็ม)
  thresholdTon: 5000000,
  ranking: [],         // ผลการจัดอันดับตามน้ำหนักปัจจุบัน (ใช้ร่วมกันทุกหน้า)
  appliedWeights: { ...PRESETS.balanced.weights },
  appliedThresholdTon: 5000000,
  trendProvince: 'all',
  trendCategory: 'all',
};

// ---------------- Bootstrapping ----------------

async function fetchJSON(url, options) {
  const res = await fetch(url, options);
  let body;
  try { body = await res.json(); } catch (e) { body = null; }
  if (!res.ok) {
    const err = new Error((body && body.error) ? body.error : `HTTP ${res.status}`);
    err.details = body && body.details;
    throw err;
  }
  return body;
}

async function init() {
  setupTabs();
  try {
    await loadDashboard();
    document.getElementById('loading').style.display = 'none';
    state.thresholdTon = state.data.defaults.volumeThresholdTon;
    state.appliedThresholdTon = state.thresholdTon;
    renderImport();
    renderWhatIfControls();
    await applyWeights();
    if (!hasData()) goTab('import');
  } catch (err) {
    document.getElementById('loading').style.display = 'none';
    showError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้: ' + err.message + ' — ตรวจสอบว่ารัน "node server/index.js" อยู่หรือไม่');
    setConnStatus(false);
  }
}

function hasData() {
  return !!(state.data && state.data.provinces.length > 0);
}

// การ์ดแสดงแทนเนื้อหา เมื่อยังไม่ได้นำเข้าข้อมูล
function emptyState(title) {
  return `
    <div class="card empty-card">
      <p class="section-title">${title}</p>
      <p class="section-sub">ยังไม่มีข้อมูลในระบบ — เริ่มจากขั้นที่ 1 นำเข้าไฟล์ข้อมูลการค้า (CSV) ระบบจะคำนวณและแสดงผลหน้านี้ให้อัตโนมัติ</p>
      <a href="#" class="btn btn-primary btn-sm" data-goto="import">ไปหน้านำเข้าข้อมูล →</a>
    </div>`;
}

async function loadDashboard() {
  state.data = await fetchJSON('/api/dashboard-data');
  setConnStatus(true);
}

function setConnStatus(ok) {
  const el = document.getElementById('conn-status');
  if (ok && !hasData()) {
    el.textContent = 'เชื่อมต่อสำเร็จ · ยังไม่มีข้อมูล';
    el.className = 'conn-status ok';
    document.getElementById('brand-sub').textContent = 'DSS ท่าเรือ · ยังไม่มีข้อมูล';
    document.getElementById('footer-text').textContent = 'Decision Support System · Project 2 · ยังไม่ได้นำเข้าข้อมูล';
  } else if (ok) {
    const ds = state.data.dataset;
    el.textContent = `เชื่อมต่อสำเร็จ · ${ds.provinces} พื้นที่`;
    el.className = 'conn-status ok';
    const t = state.data.trends;
    const range = t ? ` · ข้อมูลปี ${t.yearsBE[0]}–${t.yearsBE[t.yearsBE.length - 1]}` : '';
    document.getElementById('brand-sub').textContent =
      `DSS ท่าเรือ · ${t ? `${t.yearsBE[0]}–${t.yearsBE[t.yearsBE.length - 1]}` : `${ds.provinces} พื้นที่`}`;
    document.getElementById('footer-text').textContent =
      `Decision Support System · Project 2 · ชุดข้อมูล: ${ds.fileName || '-'}${range}`;
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

// หัวข้อหน้า (eyebrow / ชื่อหน้า / คำอธิบาย) ของแต่ละขั้นตอน
const PAGE_META = {
  import: ['DATA IMPORT / 01', 'นำเข้าข้อมูล', 'อัปโหลดไฟล์ข้อมูลการค้า (CSV) ระบบจะคำนวณตัวชี้วัด คะแนน และอันดับใหม่ทั้งหมดอัตโนมัติ'],
  overview: ['DASHBOARD / 02', 'แนวโน้มปริมาณการค้า', 'สรุปปริมาณสินค้านำเข้า–ส่งออกและอัตราการเติบโตรายปีของพื้นที่ท่าเรือ (FR1, FR2)'],
  whatif: ['SCENARIO LAB / 03', 'ปรับน้ำหนัก What-if', 'ปรับน้ำหนัก 5 ตัวชี้วัดและเกณฑ์ปริมาณ เพื่อจำลองมุมมองการลงทุนที่ต่างกัน (FR3)'],
  ranking: ['PRIORITY RANKING / 04', 'จัดลำดับความสำคัญ', 'จัดอันดับพื้นที่ที่ควรพิจารณาลงทุนก่อน–หลัง พร้อมจัดชั้นตามตารางกฎการตัดสินใจ (FR4, FR5)'],
  detail: ['INDICATORS / 05', 'คะแนนตัวชี้วัดรายพื้นที่', 'คะแนน V/G/D/B/S (0–100) ของทุกพื้นที่ เทียบกับคะแนนรวมและชั้นความสำคัญ (FR6)'],
};

function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => goTab(btn.dataset.tab));
  });
  document.addEventListener('click', (e) => {
    const link = e.target.closest('[data-goto]');
    if (link) { e.preventDefault(); goTab(link.dataset.goto); }
  });
  document.getElementById('menu-btn').addEventListener('click', () => document.body.classList.add('menu-open'));
  document.getElementById('sidebar-backdrop').addEventListener('click', () => document.body.classList.remove('menu-open'));
  setPageMeta('overview');
}

function setPageMeta(name) {
  const [eyebrow, title, desc] = PAGE_META[name];
  document.getElementById('page-eyebrow').textContent = eyebrow;
  document.getElementById('page-title').textContent = title;
  document.getElementById('page-desc').textContent = desc;
  document.getElementById('crumb-page').textContent = title;
}

function goTab(name) {
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach((p) => (p.style.display = 'none'));
  document.getElementById('tab-' + name).style.display = 'flex';
  setPageMeta(name);
  document.body.classList.remove('menu-open');
  window.scrollTo({ top: 0 });
}

// ---------------- คำนวณตามน้ำหนักปัจจุบัน แล้ววาดทุกหน้าใหม่ ----------------

async function applyWeights() {
  const status = document.getElementById('whatif-status');
  const sum = KEYS.reduce((a, k) => a + state.weights[k], 0);
  if (sum !== 100) {
    if (status) status.textContent = 'ผลรวมน้ำหนักต้องเท่ากับ 100% ก่อนคำนวณ';
    return;
  }
  if (!hasData()) {
    state.ranking = [];
    state.appliedWeights = { ...state.weights };
    state.appliedThresholdTon = state.thresholdTon;
    renderOverview();
    renderWhatIfResult();
    renderRanking();
    renderDetail();
    if (status) status.textContent = 'ยังไม่มีข้อมูล — นำเข้าข้อมูลก่อนจึงจะเห็นผลการจัดอันดับ';
    return;
  }
  if (status) status.textContent = 'กำลังคำนวณ…';
  const weights = Object.fromEntries(KEYS.map((k) => [k, state.weights[k] / 100]));
  try {
    const result = await fetchJSON('/api/recalculate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ weights, volumeThresholdTon: state.thresholdTon }),
    });
    state.ranking = result.provinces;
    state.appliedWeights = { ...state.weights };
    state.appliedThresholdTon = state.thresholdTon;
    renderOverview();
    renderWhatIfResult();
    renderRanking();
    renderDetail();
    if (status) {
      status.innerHTML = `คำนวณแล้ว ${new Date().toLocaleTimeString('th-TH')} · ใช้กับหน้า
        <a href="#" data-goto="ranking">จัดลำดับความสำคัญ</a> และ
        <a href="#" data-goto="detail">คะแนนตัวชี้วัด</a> แล้ว`;
    }
  } catch (err) {
    if (status) status.textContent = 'คำนวณไม่สำเร็จ: ' + err.message;
  }
}

function currentPresetLabel(w) {
  const hit = Object.values(PRESETS).find((p) => KEYS.every((k) => p.weights[k] === w[k]));
  return hit ? hit.label : 'กำหนดเอง';
}

function weightBanner() {
  const w = state.appliedWeights;
  return `
    <div class="weight-banner no-print-link">
      <div>
        <strong>น้ำหนักที่ใช้อยู่:</strong>
        ${KEYS.map((k) => `<span class="w-chip">${k} ${w[k]}%</span>`).join('')}
        <span class="muted">· โปรไฟล์: ${currentPresetLabel(w)} · เกณฑ์ปริมาณชั้น 1: ${fmtTonShort(state.appliedThresholdTon)}/ปี</span>
      </div>
      <a href="#" class="btn btn-outline btn-sm no-print" data-goto="whatif">ปรับน้ำหนัก →</a>
    </div>`;
}

// ---------------- 1) นำเข้าข้อมูล ----------------

function renderImport() {
  const el = document.getElementById('tab-import');
  el.innerHTML = `
    <div class="card">
      <p class="section-title">ชุดข้อมูลที่ใช้อยู่ตอนนี้</p>
      <div id="dataset-info"></div>
    </div>

    ${indicatorGuide()}

    <div class="card">
      <p class="section-title">นำเข้า / ปรับปรุงข้อมูลการค้า</p>
      <p class="section-sub">อัปโหลดไฟล์ CSV (เช่น ข้อมูลจาก data.go.th) — ระบบจะ<strong>แทนที่ข้อมูลเดิมทั้งชุด</strong>แล้วคำนวณคะแนนและอันดับใหม่ทั้งหมดอัตโนมัติ
        ถ้าต้องการเก็บข้อมูลปีเก่าไว้ ให้รวมข้อมูลปีเก่าไว้ในไฟล์เดียวกันด้วย</p>

      <div class="format-grid">
        <div class="format-card">
          <p class="format-title">แบบที่ 1 · ข้อมูลดิบ <span class="muted">(ระบบคำนวณ V,G,D,B,S ให้)</span></p>
          <p class="format-sub">1 แถว = ปริมาณสินค้า 1 รายการ ต้องมีอย่างน้อย 2 ปี</p>
          <table class="mini-table">
            <tr><td><code>Year_BE</code></td><td>ปี พ.ศ. หรือ ค.ศ.</td></tr>
            <tr><td><code>ProvinceName_TH</code></td><td>จังหวัด/พื้นที่ท่าเรือ</td></tr>
            <tr><td><code>ProcessingIndicator</code></td><td>นำเข้า / ส่งออก</td></tr>
            <tr><td><code>CategoryName_TH</code></td><td>หมวดสินค้า</td></tr>
            <tr><td><code>TotalWeight</code></td><td>น้ำหนัก (ตัน)</td></tr>
          </table>
          <p class="format-sub">ไม่บังคับ: ProvinceName_EN, CategoryName_EN, OriginalGoodsMapping · หัวคอลัมน์ภาษาไทย (ปี, จังหวัด, นำเข้า/ส่งออก, หมวดสินค้า, น้ำหนัก) ก็ได้</p>
          <p class="format-sub"><strong>ถ้าไฟล์มีคอลัมน์ V, G, D, B หรือ S มาแล้ว</strong> (บางตัวหรือครบก็ได้) ระบบใช้ค่านั้นแทนการคำนวณตัวนั้นเอง ตัวที่ไม่มีคำนวณจากข้อมูลดิบ — ค่าต่อจังหวัดใส่แถวไหนก็ได้ แต่ต้องครบทุกจังหวัด</p>
          <a class="btn btn-outline btn-sm" href="/samples/port-trade-2565-2568.csv" download>ดาวน์โหลดไฟล์ตัวอย่าง (ข้อมูลจริง 2565–2568)</a>
        </div>
        <div class="format-card">
          <p class="format-title">แบบที่ 2 · มีแต่ค่าตัวชี้วัด <span class="muted">(ไม่มีข้อมูลดิบ)</span></p>
          <p class="format-sub">1 แถว = 1 พื้นที่ ค่าตัวชี้วัดที่คำนวณไว้แล้ว เช่น อัตราการเติบโต −0.04, ดัชนีเสถียร 0.95</p>
          <table class="mini-table">
            <tr><td><code>ProvinceName_TH</code></td><td>จังหวัด/พื้นที่ท่าเรือ</td></tr>
            <tr><td><code>V, G, D, B, S</code></td><td>ค่าตัวชี้วัด สเกลใดก็ได้ ต้องครบ 5 ตัว</td></tr>
            <tr><td><code>AvgVolumeTon</code></td><td>ปริมาณเฉลี่ย (ตัน/ปี) ใช้กับกฎจัดชั้น</td></tr>
          </table>
          <p class="format-sub">ไม่บังคับ: Year_BE, ProvinceName_EN · ไม่มีข้อมูลรายปี จึงไม่มีกราฟแนวโน้ม</p>
          <a class="btn btn-outline btn-sm" href="/samples/template-indicators.csv" download>ดาวน์โหลดไฟล์ตัวอย่าง (ค่าตัวชี้วัด)</a>
        </div>
      </div>
      <p class="section-sub">ไม่ว่าค่าตัวชี้วัดจะคำนวณเองหรือมากับไฟล์ ระบบปรับสเกลเป็นคะแนน 0–100 (min-max) → ถ่วงน้ำหนัก → จัดอันดับ → จัดชั้น ด้วยขั้นตอนเดียวกันเสมอ</p>

      <label class="drop-zone" id="drop-zone">
        <input type="file" id="file-input" accept=".csv,text/csv" hidden>
        <span id="drop-text"><strong>คลิกเพื่อเลือกไฟล์ CSV</strong> หรือลากไฟล์มาวางที่นี่</span>
      </label>
      <div id="import-preview"></div>
      <div class="import-actions">
        <button id="btn-import" class="btn btn-primary" disabled>นำเข้าและคำนวณใหม่</button>
        <button id="btn-reset-sample" class="btn btn-outline">โหลดชุดข้อมูลตัวอย่าง</button>
        <button id="btn-clear" class="btn btn-danger">ล้างข้อมูลทั้งหมด</button>
      </div>
      <div id="import-result"></div>
    </div>
  `;
  renderDatasetInfo();

  const input = document.getElementById('file-input');
  const drop = document.getElementById('drop-zone');
  input.addEventListener('change', () => input.files[0] && pickFile(input.files[0]));
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    if (e.dataTransfer.files[0]) pickFile(e.dataTransfer.files[0]);
  });
  document.getElementById('btn-import').addEventListener('click', doImport);
  document.getElementById('btn-reset-sample').addEventListener('click', doResetSample);
  document.getElementById('btn-clear').addEventListener('click', doClear);
}

function renderDatasetInfo() {
  const ds = state.data.dataset;
  document.getElementById('btn-clear').style.display = hasData() ? '' : 'none';
  if (!hasData()) {
    document.getElementById('dataset-info').innerHTML =
      '<div class="hint-box">ยังไม่มีข้อมูลในระบบ — เลือกไฟล์ CSV ด้านล่างเพื่อนำเข้า (หรือกด "โหลดชุดข้อมูลตัวอย่าง")</div>';
    return;
  }
  const modeText = describeSource(ds.mode, ds.providedIndicators ? ds.providedIndicators.split(',') : []);
  const t = state.data.trends;
  document.getElementById('dataset-info').innerHTML = `
    <div class="kpi-grid dataset-kpis">
      <div class="kpi-card"><p class="kpi-label">ไฟล์</p><p class="kpi-value small">${esc(ds.fileName || '-')}</p>
        <p class="kpi-delta">นำเข้าเมื่อ ${ds.importedAt ? new Date(ds.importedAt).toLocaleString('th-TH') : '-'}</p></div>
      <div class="kpi-card"><p class="kpi-label">รูปแบบ</p><p class="kpi-value small">${modeText}</p></div>
      <div class="kpi-card"><p class="kpi-label">ขนาดข้อมูล (ตาราง)</p>
        <p class="kpi-value small">${ds.provinces} พื้นที่ · ${fmtNum(ds.records)} รายการ</p>
        <p class="kpi-delta">${ds.categories} หมวดสินค้า${t ? ` · ปี ${t.yearsBE.join(', ')}` : ''}</p></div>
    </div>`;
}

// บอกว่าตัวชี้วัดตัวไหนมาจากไฟล์ ตัวไหนระบบคำนวณเอง
function describeSource(mode, providedKeys) {
  const fromFile = (providedKeys || []).filter(Boolean);
  const computed = KEYS.filter((k) => !fromFile.includes(k));
  if (mode === 'indicators') return 'ค่าตัวชี้วัดรายจังหวัด — ใช้ V,G,D,B,S จากไฟล์ แล้วปรับสเกล 0–100';
  if (fromFile.length === 0) return 'ข้อมูลดิบ — ระบบคำนวณ V,G,D,B,S เองทั้งหมด';
  if (computed.length === 0) return 'ข้อมูลดิบ + ค่าตัวชี้วัดครบ — ใช้ V,G,D,B,S จากไฟล์ ไม่ต้องคำนวณ';
  return `ข้อมูลดิบ — ใช้ ${fromFile.join(',')} จากไฟล์ · คำนวณ ${computed.join(',')} เอง`;
}

let pendingFile = null;

async function pickFile(file) {
  const preview = document.getElementById('import-preview');
  document.getElementById('import-result').innerHTML = '';
  if (!/\.csv$/i.test(file.name)) {
    pendingFile = null;
    document.getElementById('btn-import').disabled = true;
    preview.innerHTML = `<div class="msg msg-err">รองรับเฉพาะไฟล์ .csv — ถ้าเป็น Excel ให้เปิดแล้วกด File › Save As › "CSV UTF-8 (Comma delimited)"</div>`;
    return;
  }
  const text = await readFileText(file);
  pendingFile = { name: file.name, text };
  document.getElementById('drop-text').innerHTML = `<strong>${esc(file.name)}</strong> · ${fmtNum(Math.round(file.size / 1024))} KB · คลิกเพื่อเปลี่ยนไฟล์`;
  const rows = parseCsvPreview(text, 6);
  const dataRows = Math.max(0, text.split(/\r?\n/).filter((l) => l.trim()).length - 1);
  preview.innerHTML = `
    <p class="section-sub" style="margin:14px 0 6px">ตัวอย่าง 5 แถวแรก (ทั้งหมดประมาณ ${fmtNum(dataRows)} แถว)</p>
    <div class="table-wrap"><table class="data-table compact">
      <thead><tr>${rows[0].map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${rows.slice(1).map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>`;
  document.getElementById('btn-import').disabled = false;
}

// Excel บน Windows ภาษาไทย บันทึก CSV เป็น windows-874 ได้ ถ้าอ่านเป็น UTF-8 ไม่ผ่านให้ลอง windows-874
async function readFileText(file) {
  const buf = await file.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch (e) {
    return new TextDecoder('windows-874').decode(buf);
  }
}

function parseCsvPreview(text, maxRows) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length && rows.length < maxRows; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
    } else field += ch;
  }
  if (rows.length < maxRows && (field || row.length)) { row.push(field); rows.push(row); }
  if (rows[0] && rows[0][0]) rows[0][0] = rows[0][0].replace(/^﻿/, '');
  return rows.length ? rows : [['(ไฟล์ว่าง)']];
}

async function doImport() {
  if (!pendingFile) return;
  if (hasData() && !confirm(`นำเข้า "${pendingFile.name}"?\nข้อมูลเดิมในระบบจะถูกแทนที่ทั้งหมด แล้วคำนวณคะแนนใหม่`)) return;
  const btn = document.getElementById('btn-import');
  const out = document.getElementById('import-result');
  btn.disabled = true;
  out.innerHTML = '<div class="msg">กำลังนำเข้าและคำนวณ…</div>';
  try {
    const r = await fetchJSON('/api/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName: pendingFile.name, csv: pendingFile.text }),
    });
    await afterDatasetChanged();
    out.innerHTML = `<div class="msg msg-ok">นำเข้าสำเร็จ ${fmtNum(r.rowsImported)} แถว
      (${describeSource(r.mode, r.providedIndicators)}) ·
      ${r.dataset.provinces} พื้นที่ ·
      <a href="#" data-goto="overview">ดูแนวโน้ม →</a> <a href="#" data-goto="ranking">ดูอันดับ →</a></div>`;
    pendingFile = null;
  } catch (err) {
    const details = (err.details || []).map((d) => `<li>${esc(d)}</li>`).join('');
    out.innerHTML = `<div class="msg msg-err"><strong>นำเข้าไม่สำเร็จ:</strong> ${esc(err.message)}
      ${details ? `<ul>${details}</ul>` : ''}<p class="muted" style="margin:6px 0 0">ข้อมูลเดิมยังอยู่ครบ ไม่มีอะไรถูกเปลี่ยน</p></div>`;
    btn.disabled = false;
  }
}

async function doClear() {
  if (!confirm('ล้างข้อมูลทั้งหมดในระบบ? ทุกหน้าจะว่างจนกว่าจะนำเข้าข้อมูลใหม่')) return;
  const out = document.getElementById('import-result');
  try {
    await fetchJSON('/api/clear', { method: 'POST' });
    await afterDatasetChanged();
    out.innerHTML = '<div class="msg msg-ok">ล้างข้อมูลแล้ว ระบบพร้อมนำเข้าข้อมูลใหม่</div>';
  } catch (err) {
    out.innerHTML = `<div class="msg msg-err">ไม่สำเร็จ: ${esc(err.message)}</div>`;
  }
}

async function doResetSample() {
  if (hasData() && !confirm('โหลดชุดข้อมูลตัวอย่าง (23 พื้นที่ ปี 2565–2568)?\nข้อมูลที่มีอยู่จะถูกแทนที่')) return;
  const out = document.getElementById('import-result');
  try {
    await fetchJSON('/api/reset-sample', { method: 'POST' });
    await afterDatasetChanged();
    out.innerHTML = '<div class="msg msg-ok">โหลดชุดข้อมูลตัวอย่างแล้ว · <a href="#" data-goto="overview">ดูแนวโน้ม →</a></div>';
  } catch (err) {
    out.innerHTML = `<div class="msg msg-err">ไม่สำเร็จ: ${esc(err.message)}</div>`;
  }
}

async function afterDatasetChanged() {
  await loadDashboard();
  state.trendProvince = 'all';
  state.trendCategory = 'all';
  renderDatasetInfo();
  await applyWeights();
}

// ---------------- 2) แนวโน้มปริมาณการค้า (FR1, FR2) ----------------

function renderOverview() {
  const el = document.getElementById('tab-overview');
  if (!hasData()) { el.innerHTML = emptyState('แนวโน้มปริมาณการค้า (FR1, FR2)'); return; }
  const { overview: ov, trends } = state.data;
  const top = state.ranking[0];

  if (!trends) {
    el.innerHTML = `
      <div class="card">
        <p class="section-title">แนวโน้มปริมาณการค้า</p>
        <div class="hint-box">ชุดข้อมูลปัจจุบันมีแต่ค่าตัวชี้วัดรายจังหวัด ไม่มีข้อมูลการค้ารายปี จึงแสดงกราฟแนวโน้มไม่ได้ —
          นำเข้าไฟล์ข้อมูลดิบในหน้า <a href="#" data-goto="import">นำเข้าข้อมูล</a> เพื่อดูแนวโน้ม</div>
      </div>
      <div class="kpi-grid">
        <div class="kpi-card"><p class="kpi-label">พื้นที่ในระบบ</p><p class="kpi-value">${state.ranking.length}</p></div>
        <div class="kpi-card"><p class="kpi-label">พื้นที่อันดับ 1 (น้ำหนักปัจจุบัน)</p><p class="kpi-value small">${esc(top.nameTh)}</p>
          <p class="kpi-delta">Priority Score ${top.finalScore}</p></div>
      </div>`;
    return;
  }

  const yBE = trends.yearsBE;
  const changeClass = ov.pctChangeVsFirstYear > 0 ? 'up' : (ov.pctChangeVsFirstYear < 0 ? 'down' : '');
  const changeSign = ov.pctChangeVsFirstYear > 0 ? '+' : '';

  el.innerHTML = `
    <div class="kpi-grid">
      <div class="kpi-card">
        <p class="kpi-label">ปริมาณรวมปี ${yBE[yBE.length - 1]}</p>
        <p class="kpi-value">${fmtMillion(ov.totalLatestYearTon)} <span class="unit">ล้านตัน</span></p>
        <p class="kpi-delta ${changeClass}">${changeSign}${ov.pctChangeVsFirstYear}% เทียบปี ${yBE[0]}</p>
      </div>
      <div class="kpi-card">
        <p class="kpi-label">พื้นที่ในระบบ</p>
        <p class="kpi-value">${ov.provinceCount} <span class="unit">พื้นที่</span></p>
        <p class="kpi-delta">${trends.categories.length} หมวดสินค้า</p>
      </div>
      <div class="kpi-card">
        <p class="kpi-label">สัดส่วน 2 พื้นที่สูงสุด (${yBE[0]}–${yBE[yBE.length - 1]})</p>
        <p class="kpi-value">${ov.top2ShareOfTotal}%</p>
        <p class="kpi-delta">${ov.top2Provinces.map(esc).join(' · ')}</p>
      </div>
      <div class="kpi-card">
        <p class="kpi-label">พื้นที่อันดับ 1 (น้ำหนักปัจจุบัน)</p>
        <p class="kpi-value small">${esc(top.nameTh)}</p>
        <p class="kpi-delta">Priority Score ${top.finalScore} · <a href="#" data-goto="ranking">ดูอันดับ →</a></p>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <div>
          <p class="section-title">ปริมาณสินค้านำเข้า–ส่งออกรายปี (FR1)</p>
          <p class="section-sub" id="trend-sub"></p>
        </div>
        <div class="filters">
          <label>พื้นที่
            <select id="sel-province">
              <option value="all">ทุกพื้นที่ (${trends.provinces.length})</option>
              ${trends.provinces.map((p) => `<option value="${p.id}">${esc(p.nameTh)}</option>`).join('')}
            </select>
          </label>
          <label>หมวดสินค้า
            <select id="sel-category">
              <option value="all">ทุกหมวด</option>
              ${trends.categories.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}
            </select>
          </label>
        </div>
      </div>
      <div id="trend-chart"></div>
    </div>

    <div class="card">
      <p class="section-title">อัตราการเติบโตรายปี (YoY Growth Rate) (FR2)</p>
      <p class="section-sub">อัตราการเติบโต = (ปริมาณปีนี้ − ปีก่อน) ÷ ปีก่อน × 100 — ค่าเฉลี่ยของอัตรานี้คือค่าดิบที่ใช้คำนวณคะแนน G</p>
      <div id="trend-table" class="table-wrap"></div>
    </div>

    <div class="card">
      <p class="section-title">ปริมาณแยกตามหมวดสินค้า</p>
      <p class="section-sub" id="cat-sub"></p>
      <div id="cat-table" class="table-wrap"></div>
    </div>
  `;

  const selP = document.getElementById('sel-province');
  const selC = document.getElementById('sel-category');
  selP.value = state.trendProvince;
  selC.value = state.trendCategory;
  selP.addEventListener('change', () => { state.trendProvince = selP.value; renderTrendBody(); });
  selC.addEventListener('change', () => { state.trendCategory = selC.value; renderTrendBody(); });
  renderTrendBody();
}

function renderTrendBody() {
  const trends = state.data.trends;
  const src = state.trendProvince === 'all'
    ? { ...trends.all, nameTh: 'ทุกพื้นที่' }
    : trends.provinces.find((p) => String(p.id) === String(state.trendProvince));
  const cat = state.trendCategory;
  const yBE = trends.yearsBE;

  // หมวดสินค้ารวมทั้งนำเข้าและส่งออก จึงแสดงเป็นแท่งเดียว
  let series;
  if (cat === 'all') {
    series = [
      { name: 'นำเข้า', color: '#2a78d6', values: src.import },
      { name: 'ส่งออก', color: '#eb6834', values: src.export },
    ];
  } else {
    series = [{ name: `${cat} (นำเข้า+ส่งออก)`, color: '#1c5cab', values: src.byCategory[cat] }];
  }
  const totals = yBE.map((_, i) => series.reduce((a, s) => a + s.values[i], 0));

  document.getElementById('trend-sub').textContent =
    `${src.nameTh} · ${cat === 'all' ? 'ทุกหมวดสินค้า' : cat} · หน่วย: ล้านตัน`;
  document.getElementById('trend-chart').innerHTML = buildBarChart(yBE, series);

  const yoy = totals.map((v, i) => (i === 0 || totals[i - 1] === 0 ? null : ((v - totals[i - 1]) / totals[i - 1]) * 100));
  const valid = yoy.filter((x) => x !== null);
  const avgYoy = valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
  const yoyCell = (v) => (v === null ? '<td class="muted">—</td>'
    : `<td class="${v >= 0 ? 'change-up' : 'change-down'}">${v >= 0 ? '+' : ''}${v.toFixed(1)}%</td>`);

  document.getElementById('trend-table').innerHTML = `
    <table class="data-table">
      <thead><tr><th>${esc(src.nameTh)}</th>${yBE.map((y) => `<th class="num">${y}</th>`).join('')}<th class="num">เฉลี่ย</th></tr></thead>
      <tbody>
        ${series.map((s) => `<tr><td>${esc(s.name)} (ตัน)</td>${s.values.map((v) => `<td class="num">${fmtNum(v)}</td>`).join('')}<td></td></tr>`).join('')}
        ${series.length > 1 ? `<tr><td><strong>รวม (ตัน)</strong></td>${totals.map((v) => `<td class="num"><strong>${fmtNum(v)}</strong></td>`).join('')}<td></td></tr>` : ''}
        <tr class="yoy-row"><td><strong>อัตราการเติบโต YoY</strong></td>${yoy.map(yoyCell).join('')}${yoyCell(avgYoy)}</tr>
      </tbody>
    </table>`;

  const catTotals = trends.categories.map((c) => ({ c, v: src.byCategory[c], sum: src.byCategory[c].reduce((a, b) => a + b, 0) }))
    .sort((a, b) => b.sum - a.sum);
  const grand = catTotals.reduce((a, x) => a + x.sum, 0);
  document.getElementById('cat-sub').textContent =
    `${src.nameTh} · รวมนำเข้า+ส่งออก หน่วยตัน · สัดส่วนนี้คือข้อมูลที่ใช้คำนวณความหลากหลาย (D)`;
  document.getElementById('cat-table').innerHTML = `
    <table class="data-table">
      <thead><tr><th>หมวดสินค้า</th>${yBE.map((y) => `<th class="num">${y}</th>`).join('')}<th class="num">สัดส่วน</th></tr></thead>
      <tbody>${catTotals.map((x) => `
        <tr class="${x.c === cat ? 'row-hl' : ''}"><td>${esc(x.c)}</td>${x.v.map((v) => `<td class="num">${fmtNum(v)}</td>`).join('')}
          <td class="num">${pctBar(grand ? (x.sum / grand) * 100 : 0)}</td></tr>`).join('')}
      </tbody>
    </table>`;
}

function buildBarChart(labels, series) {
  const W = 960, H = 300, padL = 54, padB = 34, padT = 22, padR = 10;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const maxVal = Math.max(1, ...series.flatMap((s) => s.values)) * 1.12;
  const groupW = plotW / labels.length;
  const barW = Math.min(46, (groupW * 0.7) / series.length);

  let grid = '';
  for (let s = 0; s <= 4; s++) {
    const yy = padT + plotH - (s / 4) * plotH;
    grid += `<line x1="${padL}" y1="${yy}" x2="${W - padR}" y2="${yy}" stroke="#eef2f6"></line>
      <text x="${padL - 8}" y="${yy + 4}" text-anchor="end" font-size="11" fill="#94a3b8">${fmtMillion((s / 4) * maxVal)}</text>`;
  }
  let bars = '';
  labels.forEach((lab, i) => {
    const gx = padL + i * groupW + groupW / 2;
    const startX = gx - (barW * series.length + 4 * (series.length - 1)) / 2;
    series.forEach((s, j) => {
      const v = s.values[i];
      const h = (v / maxVal) * plotH;
      const x = startX + j * (barW + 4);
      bars += `<rect x="${x}" y="${padT + plotH - h}" width="${barW}" height="${h}" fill="${s.color}" rx="3"><title>${s.name} ${lab}: ${fmtNum(v)} ตัน</title></rect>
        <text x="${x + barW / 2}" y="${padT + plotH - h - 6}" text-anchor="middle" font-size="11" fill="#334155">${fmtMillion(v)}</text>`;
    });
    bars += `<text x="${gx}" y="${H - 10}" text-anchor="middle" font-size="12" fill="#64748b">${lab}</text>`;
  });
  return `
    <div class="chart-legend">${series.map((s) => `<span><span class="legend-dot" style="background:${s.color}"></span>${esc(s.name)}</span>`).join('')}</div>
    <svg viewBox="0 0 ${W} ${H}" class="chart-svg" style="max-width:${W}px">${grid}${bars}</svg>`;
}

// ---------------- 3) ปรับน้ำหนัก What-if (FR3) ----------------

let recalcTimer = null;

function renderWhatIfControls() {
  const el = document.getElementById('tab-whatif');
  el.innerHTML = `
    ${indicatorGuide()}
    <div class="card">
      <p class="section-title">กำหนดน้ำหนักเกณฑ์การให้คะแนน (FR3)</p>
      <p class="section-sub">ลากปรับสัดส่วนความสำคัญของ 5 ตัวชี้วัด (รวมต้องได้ 100%) ระบบคำนวณใหม่ทันที
        และ<strong>ทุกหน้า</strong> (จัดลำดับ, คะแนนตัวชี้วัด, พื้นที่อันดับ 1) จะใช้น้ำหนักนี้ ·
        <a href="#" data-goto="detail">ดูความหมายและสูตรของแต่ละตัวชี้วัด →</a></p>
      <div class="preset-row">
        <span class="muted" style="align-self:center">โปรไฟล์ตัวอย่าง:</span>
        ${Object.entries(PRESETS).map(([key, p]) => `<button class="btn btn-outline" data-preset="${key}">${p.label}</button>`).join('')}
      </div>
      <div id="weight-grid" class="weight-grid"></div>
      <div class="weight-sum-row">
        <span id="weight-sum-badge" class="weight-sum-badge">รวม 100%</span>
        <span id="weight-formula" class="muted"></span>
      </div>
      <div class="threshold-row">
        <label for="threshold-input"><strong>เกณฑ์ปริมาณแยกชั้น 1/2</strong> (ค่านโยบายตามตารางกฎหน้า 11 ไม่ได้คำนวณจากข้อมูล · ตั้งต้น 5 ล้านตัน/ปี ปรับได้)</label>
        <span><input type="number" id="threshold-input" min="0" step="0.1" value="${state.thresholdTon / 1e6}"> ล้านตัน/ปี</span>
      </div>
      <p id="whatif-status" class="whatif-status"></p>
    </div>
    <div class="card">
      <p class="section-title">ตารางกฎการตัดสินใจจัดชั้นความสำคัญ</p>
      <p class="section-sub">อัปเดตตามเกณฑ์ปริมาณแยกชั้น 1/2 ที่ตั้งด้านบนทันที</p>
      <div id="whatif-rules">${tierRulesTable(state.thresholdTon)}</div>
    </div>
    <div class="card">
      <p class="section-title">ผลกระทบต่ออันดับ</p>
      <p class="section-sub">เทียบกับอันดับฐาน (น้ำหนักสมดุล V40 G25 D15 B10 S10 ที่บันทึกในตาราง PRIORITY_SCORE)</p>
      <div id="whatif-table" class="table-wrap"></div>
    </div>
  `;

  renderWeightGrid();
  el.querySelectorAll('[data-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.weights = { ...PRESETS[btn.dataset.preset].weights };
      renderWeightGrid();
      applyWeights();
    });
  });
  document.getElementById('threshold-input').addEventListener('input', (e) => {
    const v = parseFloat(e.target.value);
    if (!Number.isFinite(v) || v < 0) return;
    state.thresholdTon = Math.round(v * 1e6);
    document.getElementById('whatif-rules').innerHTML = tierRulesTable(state.thresholdTon);
    scheduleRecalc();
  });
}

function renderWeightGrid() {
  const grid = document.getElementById('weight-grid');
  grid.innerHTML = KEYS.map((k) => `
    <div class="weight-item">
      <label for="w-input-${k}">
        <span><span class="w-letter">${k}</span>${IND_LABEL[k]}</span>
        <span id="w-val-${k}">${state.weights[k]}%</span>
      </label>
      <p class="weight-help">${IND_INFO[k][0]}</p>
      <input type="range" min="0" max="100" step="5" value="${state.weights[k]}" id="w-input-${k}">
    </div>
  `).join('');
  KEYS.forEach((k) => {
    document.getElementById(`w-input-${k}`).addEventListener('input', (e) => {
      state.weights[k] = parseInt(e.target.value, 10);
      document.getElementById(`w-val-${k}`).textContent = state.weights[k] + '%';
      updateSumBadge();
      scheduleRecalc();
    });
  });
  updateSumBadge();
}

function scheduleRecalc() {
  clearTimeout(recalcTimer);
  recalcTimer = setTimeout(applyWeights, 250);
}

function updateSumBadge() {
  const sum = KEYS.reduce((a, k) => a + state.weights[k], 0);
  const badge = document.getElementById('weight-sum-badge');
  badge.textContent = sum === 100 ? 'รวม 100% ✓' : `รวม ${sum}% — ต้องเท่ากับ 100% (${sum > 100 ? 'เกิน' : 'ขาด'} ${Math.abs(100 - sum)}%)`;
  badge.classList.toggle('bad', sum !== 100);
  document.getElementById('weight-formula').textContent =
    'คะแนนรวม = ' + KEYS.map((k) => `${(state.weights[k] / 100).toFixed(2)}·${k}`).join(' + ');
}

function rankChangeHtml(p) {
  const diff = p.baseRank - p.rank;
  if (diff > 0) return `<span class="change-up">▲ ${diff}</span>`;
  if (diff < 0) return `<span class="change-down">▼ ${Math.abs(diff)}</span>`;
  return '<span class="change-flat">—</span>';
}

function renderWhatIfResult() {
  const box = document.getElementById('whatif-table');
  if (!box) return;
  if (!hasData()) {
    box.innerHTML = '<p class="muted" style="margin:0">ยังไม่มีข้อมูล — <a href="#" data-goto="import">นำเข้าข้อมูล</a> ก่อน แล้วผลการจัดอันดับจะแสดงที่นี่</p>';
    return;
  }
  const moved = state.ranking.filter((p) => p.rank !== p.baseRank).length;
  box.innerHTML = `
    <p class="muted" style="margin:0 0 10px">${moved === 0 ? 'อันดับเหมือนอันดับฐานทุกพื้นที่' : `อันดับเปลี่ยน ${moved} พื้นที่`}</p>
    <table class="data-table">
      <thead><tr><th>พื้นที่</th><th class="num">อันดับฐาน</th><th class="num">อันดับใหม่</th><th>เปลี่ยน</th><th class="num">คะแนนใหม่</th><th>ชั้น</th></tr></thead>
      <tbody>${state.ranking.map((p) => `
        <tr><td>${esc(p.nameTh)}</td><td class="num">#${p.baseRank}</td><td class="num"><strong>#${p.rank}</strong></td>
          <td>${rankChangeHtml(p)}</td><td class="num">${p.finalScore}</td>
          <td><span class="tier-badge tier-${p.tier}">ชั้น ${p.tier}</span></td></tr>`).join('')}
      </tbody>
    </table>`;
}

// ---------------- 4) จัดลำดับความสำคัญ (FR4, FR5) + ส่งออกรายงาน ----------------

function renderRanking() {
  const el = document.getElementById('tab-ranking');
  if (!hasData()) { el.innerHTML = emptyState('จัดลำดับความสำคัญ (FR4, FR5)'); return; }
  const byTier = { 1: [], 2: [], 3: [], 4: [] };
  state.ranking.forEach((p) => byTier[p.tier].push(p.nameTh));

  el.innerHTML = `
    <div class="print-only print-head">
      <h2>รายงานผลการจัดลำดับความสำคัญการลงทุนท่าเรือ</h2>
      <p>พิมพ์เมื่อ ${new Date().toLocaleString('th-TH')} · ชุดข้อมูล ${esc(state.data.dataset.fileName || '-')}</p>
    </div>
    ${weightBanner()}
    <div class="card">
      <p class="section-title">ตารางกฎการตัดสินใจจัดชั้นความสำคัญ</p>
      ${tierRulesTable(state.appliedThresholdTon)}
    </div>
    <div class="card">
      <div class="card-head">
        <div>
          <p class="section-title">จัดอันดับพื้นที่ที่ควรพิจารณาลงทุนก่อน–หลัง (FR5)</p>
          <p class="section-sub">Priority Score 0–100 = ${KEYS.map((k) => `${(state.appliedWeights[k] / 100).toFixed(2)}·${k}`).join(' + ')} (FR4)</p>
        </div>
        <div class="export-row no-print">
          <button class="btn btn-outline btn-sm" id="btn-csv">ส่งออก CSV (Excel)</button>
          <button class="btn btn-primary btn-sm" id="btn-pdf">พิมพ์ / บันทึก PDF</button>
        </div>
      </div>
      <div class="rank-layout">
        <div>${buildRankChart(state.ranking)}</div>
        <div class="tier-cards">
          ${[1, 2, 3, 4].map((t) => `
            <div class="tier-card">
              <p class="tier-card-title"><span class="legend-dot" style="background:${TIER_COLOR[t]}"></span>${TIER_LABEL[t]}
                <span class="muted">(${byTier[t].length})</span></p>
              <p class="tier-card-body">${byTier[t].length ? byTier[t].map(esc).join(' · ') : '<span class="muted">—</span>'}</p>
            </div>`).join('')}
        </div>
      </div>
    </div>

    <div class="card">
      <p class="section-title">ตารางอันดับทั้งหมด</p>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th class="num">อันดับ</th><th>พื้นที่</th><th>Area (EN)</th><th class="num">Priority Score</th>
            <th class="num">ปริมาณเฉลี่ย (ล้านตัน/ปี)</th><th>ชั้นความสำคัญ</th><th>เทียบอันดับฐาน</th></tr></thead>
          <tbody>${state.ranking.map((p) => `
            <tr>
              <td class="rank-cell num">${p.rank}</td>
              <td>${esc(p.nameTh)}</td>
              <td class="muted">${esc(p.nameEn || '')}</td>
              <td class="num"><strong>${p.finalScore}</strong></td>
              <td class="num">${fmtMillion(p.avgYearlyTotalTon, 2)}</td>
              <td><span class="tier-badge tier-${p.tier}">${TIER_LABEL[p.tier]}</span></td>
              <td>${rankChangeHtml(p)}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>

  `;
  document.getElementById('btn-csv').addEventListener('click', exportCsv);
  document.getElementById('btn-pdf').addEventListener('click', () => window.print());
}

function buildRankChart(list) {
  const rowH = 22, padL = 120, padR = 44, W = 560;
  const H = list.length * rowH + 10;
  const plotW = W - padL - padR;
  const bars = list.map((p, i) => {
    const y = 5 + i * rowH;
    const w = Math.max(1, (p.finalScore / 100) * plotW);
    return `<text x="${padL - 8}" y="${y + 15}" text-anchor="end" font-size="12" fill="#334155">${esc(p.nameTh)}</text>
      <rect x="${padL}" y="${y + 3}" width="${w}" height="${rowH - 7}" rx="3" fill="${TIER_COLOR[p.tier]}"><title>${esc(p.nameTh)}: ${p.finalScore} (ชั้น ${p.tier})</title></rect>
      <text x="${padL + w + 6}" y="${y + 15}" font-size="11.5" font-weight="600" fill="#0f172a">${p.finalScore}</text>`;
  }).join('');
  const guides = [50, 65].map((v) => {
    const x = padL + (v / 100) * plotW;
    return `<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="#94a3b8" stroke-dasharray="3 3" opacity="0.8"></line>
      <text x="${x + 3}" y="${H - 2}" font-size="10" fill="#64748b">${v}</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="chart-svg" style="max-width:${W}px">${guides}${bars}</svg>`;
}

function exportCsv() {
  const w = state.appliedWeights;
  const header = ['Rank', 'ProvinceName_TH', 'ProvinceName_EN', 'VolumeScore', 'GrowthScore', 'DiversityScore',
    'BalanceScore', 'StabilityScore', 'FinalPriorityScore', 'Tier', 'TierMeaning', 'AvgVolumeTon', 'BaseRank'];
  const rows = state.ranking.map((p) => [p.rank, p.nameTh, p.nameEn || '', p.V, p.G, p.D, p.B, p.S, p.finalScore,
    p.tier, TIER_LABEL[p.tier].split('· ')[1], Math.round(p.avgYearlyTotalTon), p.baseRank]);
  const escCsv = (v) => (/[",\r\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const meta = `# weights V=${w.V}% G=${w.G}% D=${w.D}% B=${w.B}% S=${w.S}%; volume threshold ${state.appliedThresholdTon} ton/yr`;
  const csv = '﻿' + [[meta], header, ...rows].map((r) => r.map(escCsv).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `port-priority-ranking-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---------------- 5) คะแนนตัวชี้วัดรายพื้นที่ (FR6) ----------------

function renderDetail() {
  const el = document.getElementById('tab-detail');
  if (!hasData()) { el.innerHTML = emptyState('คะแนนตัวชี้วัดรายพื้นที่ (FR6)'); return; }
  el.innerHTML = `
    ${weightBanner()}
    ${indicatorGuide()}
    <div class="card">
      <p class="section-title">คะแนนรายตัวชี้วัด (0–100) ต่อพื้นที่ (FR6)</p>
      <p class="section-sub">ช่องยิ่งเข้ม = คะแนนสูง · V ปริมาณ, G การเติบโต, D ความหลากหลายสินค้า, B ความสมดุลนำเข้า–ส่งออก, S เสถียรภาพ ·
        คะแนนแต่ละตัวมาจากข้อมูล ไม่ขึ้นกับน้ำหนัก แต่คะแนนรวม อันดับ และชั้น เปลี่ยนตามน้ำหนัก</p>
      <div class="table-wrap">
        <table class="data-table heat-table">
          <thead><tr><th class="num">อันดับ</th><th>พื้นที่</th>
            ${KEYS.map((k) => `<th class="num" title="${IND_LABEL[k]}: ${IND_INFO[k][0]}">${k}<span class="w-sub">×${state.appliedWeights[k]}%</span></th>`).join('')}
            <th class="num">รวม</th><th>ชั้น</th><th>เทียบฐาน</th></tr></thead>
          <tbody>${state.ranking.map((p) => `
            <tr>
              <td class="rank-cell num">${p.rank}</td>
              <td><strong>${esc(p.nameTh)}</strong></td>
              ${KEYS.map((k) => heatCell(p[k])).join('')}
              <td class="num"><strong>${p.finalScore}</strong></td>
              <td><span class="tier-badge tier-${p.tier}">ชั้น ${p.tier}</span></td>
              <td>${rankChangeHtml(p)}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// คำอธิบายตัวชี้วัด 5 ตัว — สูตรตรงกับ server/lib/calc.js (buildProvinceMetrics)
const IND_INFO = {
  V: ['ขนาดการขนส่งของพื้นที่', 'log(ปริมาณนำเข้า+ส่งออกเฉลี่ยต่อปี + 1)', 'ใช้ log-scale เพื่อไม่ให้พื้นที่ที่ใหญ่มาก (เช่น ชลบุรี) ข่มพื้นที่อื่นจนคะแนนแยกกันไม่ออก', 'ปริมาณสินค้ามาก'],
  G: ['แนวโน้มการขยายตัวของปริมาณสินค้า', 'ค่าเฉลี่ยของอัตราการเติบโตรายปี (YoY) = (ปีนี้ − ปีก่อน) ÷ ปีก่อน', 'ค่าเฉลี่ยทางสถิติ', 'ปริมาณเพิ่มขึ้นต่อเนื่อง'],
  D: ['การกระจายตัวของหมวดสินค้า', '1 − HHI โดย HHI = ผลรวมของ (สัดส่วนแต่ละหมวดสินค้า)²', 'HHI (Herfindahl-Hirschman Index) คือดัชนีวัดการกระจุกตัวทางเศรษฐศาสตร์', 'ไม่พึ่งสินค้าหมวดเดียว'],
  B: ['ความสมดุลระหว่างนำเข้าและส่งออก', 'ค่าเฉลี่ยรายปีของ 1 − |นำเข้า − ส่งออก| ÷ (นำเข้า + ส่งออก)', 'อัตราส่วน 0–1 (1 = นำเข้าเท่ากับส่งออก)', 'ใช้ท่าเรือได้คุ้มทั้งขาเข้าและขาออก'],
  S: ['ความสม่ำเสมอของปริมาณในแต่ละปี', '1 ÷ (1 + CV) โดย CV = ส่วนเบี่ยงเบนมาตรฐาน ÷ ค่าเฉลี่ย ของปริมาณรายปี', 'CV (Coefficient of Variation) คือสัมประสิทธิ์การแปรผันทางสถิติ', 'ปริมาณไม่ผันผวน คาดการณ์ได้'],
};

// การ์ดพับเก็บได้ (เปิดไว้ตั้งต้น) ใช้ในหน้านำเข้าข้อมูล, What-if และคะแนนตัวชี้วัด
function indicatorGuide() {
  return `
    <details class="card guide-details" open>
      <summary class="section-title">ตัวชี้วัด V / G / D / B / S คืออะไร <span class="summary-hint">(คลิกเพื่อย่อ/ขยาย)</span></summary>
      <p class="section-sub">ค่าดิบของแต่ละตัวคำนวณจากข้อมูลการค้ารายปีของพื้นที่ จากนั้นปรับเป็นคะแนน 0–100 ด้วย
        <strong>min-max</strong> = (ค่า − ค่าต่ำสุด) ÷ (ค่าสูงสุด − ค่าต่ำสุด) × 100 เทียบกับทุกพื้นที่ แล้วถ่วงน้ำหนักรวมเป็น Priority Score</p>
      <div class="guide-grid">${KEYS.map((k) => `
        <div class="guide-card">
          <p class="guide-head"><span class="w-chip">${k}</span>${IND_LABEL[k]}</p>
          <p class="guide-what">${IND_INFO[k][0]}</p>
          <p class="guide-formula">${esc(IND_INFO[k][1])}</p>
          <p class="guide-note">${IND_INFO[k][2]}</p>
          <p class="guide-high">คะแนนสูง = ${IND_INFO[k][3]}</p>
        </div>`).join('')}
      </div>
    </details>`;
}

// ตารางกฎจัดชั้นตามสไลด์หน้า 11 — เส้นคะแนน 65/50 คงที่ ปรับได้เฉพาะเกณฑ์ปริมาณแยกชั้น 1/2
function tierRulesTable(thresholdTon) {
  const t = fmtTonShort(thresholdTon);
  return `
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>ชั้น</th><th>เงื่อนไข</th><th>ความหมาย</th></tr></thead>
        <tbody>
          <tr><td><span class="tier-badge tier-1">กฎ 1 → ชั้น 1</span></td><td>คะแนน ≥ 65 และปริมาณเฉลี่ย ≥ <strong>${t}/ปี</strong></td><td>ขยายกำลังรองรับ</td></tr>
          <tr><td><span class="tier-badge tier-2">กฎ 2 → ชั้น 2</span></td><td>คะแนน ≥ 65 แต่ปริมาณเฉลี่ย &lt; <strong>${t}/ปี</strong></td><td>พัฒนาเฉพาะทาง</td></tr>
          <tr><td><span class="tier-badge tier-3">กฎ 3 → ชั้น 3</span></td><td>50 ≤ คะแนน &lt; 65</td><td>พัฒนาเฉพาะทาง</td></tr>
          <tr><td><span class="tier-badge tier-4">กฎ 4 → ชั้น 4</span></td><td>คะแนน &lt; 50</td><td>ติดตาม</td></tr>
        </tbody>
      </table>
    </div>
    <p class="rules-note">เส้นคะแนน 65 และ 50 เป็นค่าคงที่ตามตารางกฎ (สไลด์หน้า 11) ·
      <strong>เกณฑ์ปริมาณแยกชั้น 1/2</strong> ไม่ได้คำนวณจากข้อมูล แต่เป็นค่านโยบาย (ตั้งต้น 5 ล้านตัน/ปี) ใช้แบ่งพื้นที่ที่คะแนน ≥ 65
      ว่าใหญ่พอจะ "ขยายกำลังรองรับ" (ชั้น 1) หรือควร "พัฒนาเฉพาะทาง" ก่อน (ชั้น 2) — เทียบกับปริมาณนำเข้า+ส่งออกเฉลี่ยต่อปีของพื้นที่</p>`;
}

function heatCell(v) {
  const a = 0.08 + (Math.max(0, Math.min(100, v)) / 100) * 0.8;
  const dark = a > 0.5;
  return `<td class="num heat" style="background:rgba(42,120,214,${a.toFixed(2)});color:${dark ? '#fff' : '#0f172a'}">${Math.round(v)}</td>`;
}

// ---------------- Utils ----------------

function fmtNum(n) {
  return new Intl.NumberFormat('th-TH').format(Math.round(n));
}

function fmtMillion(n, digits = 1) {
  return (n / 1e6).toLocaleString('th-TH', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function fmtTonShort(n) {
  return n >= 1e6 ? `${fmtMillion(n, n % 1e6 === 0 ? 0 : 1)} ล้านตัน` : `${fmtNum(n)} ตัน`;
}

function pctBar(pct) {
  return `<span class="pct-bar"><span style="width:${Math.min(100, pct)}%"></span></span> ${pct.toFixed(1)}%`;
}

function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

init();
