'use strict';
/**
 * DSS ท่าเรือ — Calculation engine
 * คำนวณ V, G, D, B, S จากข้อมูลดิบ (ไม่ใช้คอลัมน์สำเร็จรูปจากชีต "อัตราการเติบโต")
 * อ้างอิงสูตรจากสไลด์ Project-1 หน้า 9 (Weighted Scoring) และหน้า 15-17 (Data Modeling / ER)
 * หน่วยน้ำหนักทั้งหมดเป็น "ตัน" (TotalWeight ในตาราง TRADE_RECORD)
 */

function mean(arr) {
  const v = arr.filter((x) => Number.isFinite(x));
  if (v.length === 0) return 0;
  return v.reduce((a, b) => a + b, 0) / v.length;
}

function stdev(arr) {
  const v = arr.filter((x) => Number.isFinite(x));
  if (v.length < 2) return 0;
  const m = mean(v);
  const variance = v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length;
  return Math.sqrt(variance);
}

function minMaxNormalize(values) {
  const finite = values.filter((v) => Number.isFinite(v));
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  if (max === min) return values.map(() => 50); // ทุกค่าเท่ากัน ให้กลาง ๆ ไว้ ไม่หารด้วยศูนย์
  return values.map((v) => ((v - min) / (max - min)) * 100);
}

/**
 * @param {Array} records - แถวจากตาราง TRADE_RECORD (join PROVINCE, GOODS_CATEGORY แล้ว)
 *   { provinceId, provinceTh, provinceEn, yearAD, direction: 'import'|'export', categoryTh, weightTon }
 */
function buildProvinceMetrics(records) {
  const years = [...new Set(records.map((r) => r.yearAD))].sort();
  const provincesTh = [...new Set(records.map((r) => r.provinceTh))].sort();
  const categories = [...new Set(records.map((r) => r.categoryTh))].sort();

  const perProvince = {};
  for (const p of provincesTh) {
    perProvince[p] = {
      id: records.find((r) => r.provinceTh === p).provinceId,
      nameTh: p,
      nameEn: records.find((r) => r.provinceTh === p).provinceEn,
      yearlyImport: {},
      yearlyExport: {},
      categoryTotal: {},
    };
    for (const y of years) {
      perProvince[p].yearlyImport[y] = 0;
      perProvince[p].yearlyExport[y] = 0;
    }
    for (const c of categories) perProvince[p].categoryTotal[c] = 0;
  }

  for (const r of records) {
    const bucket = perProvince[r.provinceTh];
    if (r.direction === 'import') bucket.yearlyImport[r.yearAD] += r.weightTon;
    else bucket.yearlyExport[r.yearAD] += r.weightTon;
    bucket.categoryTotal[r.categoryTh] += r.weightTon;
  }

  const rawList = provincesTh.map((p) => {
    const b = perProvince[p];
    const yearlyTotal = years.map((y) => b.yearlyImport[y] + b.yearlyExport[y]);
    const avgYearlyTotalTon = mean(yearlyTotal);

    // --- V: ปริมาณเฉลี่ยต่อปี, log-scale (ลดผลของพื้นที่ปริมาณสูงผิดปกติ 1-2 แห่ง) ---
    const V_raw = Math.log(avgYearlyTotalTon + 1);

    // --- G: อัตราการเติบโตเฉลี่ยต่อปี (YoY) จากปริมาณรวมรายปี ---
    const growthRates = [];
    for (let i = 1; i < yearlyTotal.length; i++) {
      const prev = yearlyTotal[i - 1];
      const curr = yearlyTotal[i];
      if (prev > 0) growthRates.push((curr - prev) / prev);
    }
    const G_raw = mean(growthRates);

    // --- D: 1 - HHI ของสัดส่วน 7 หมวดสินค้า (รวมทุกปี ทุกทิศทาง) ---
    const totalAllCats = Object.values(b.categoryTotal).reduce((a, c) => a + c, 0);
    let hhi = 0;
    if (totalAllCats > 0) {
      for (const c of categories) {
        const share = b.categoryTotal[c] / totalAllCats;
        hhi += share * share;
      }
    } else {
      hhi = 1; // ไม่มีข้อมูลเลย = กระจุกตัวสูงสุด (กันหารศูนย์)
    }
    const D_raw = 1 - hhi;

    // --- B: ความสมดุลนำเข้า-ส่งออก เฉลี่ยรายปี ---
    const balancePerYear = years.map((y, i) => {
      const imp = b.yearlyImport[y];
      const exp = b.yearlyExport[y];
      const total = imp + exp;
      if (total === 0) return null;
      return 1 - Math.abs(imp - exp) / total;
    }).filter((x) => x !== null);
    const B_raw = mean(balancePerYear);

    // --- S: เสถียรภาพ = 1/(1+CV) จากปริมาณรวมรายปี (CV ต่ำ = เสถียรสูง) ---
    const cv = mean(yearlyTotal) > 0 ? stdev(yearlyTotal) / mean(yearlyTotal) : 0;
    const S_raw = 1 / (1 + cv);

    return {
      id: b.id,
      nameTh: b.nameTh,
      nameEn: b.nameEn,
      avgYearlyTotalTon,
      V_raw, G_raw, D_raw, B_raw, S_raw,
    };
  });

  // ปรับทุกตัวชี้วัดเป็นช่วง 0-100 แบบ min-max ข้ามทุกจังหวัด (ตามสไลด์หน้า 9)
  const V = minMaxNormalize(rawList.map((r) => r.V_raw));
  const G = minMaxNormalize(rawList.map((r) => r.G_raw));
  const D = minMaxNormalize(rawList.map((r) => r.D_raw));
  const B = minMaxNormalize(rawList.map((r) => r.B_raw));
  const S = minMaxNormalize(rawList.map((r) => r.S_raw));

  const metrics = rawList.map((r, i) => ({
    id: r.id,
    nameTh: r.nameTh,
    nameEn: r.nameEn,
    avgYearlyTotalTon: r.avgYearlyTotalTon,
    V: Math.round(V[i] * 10) / 10,
    G: Math.round(G[i] * 10) / 10,
    D: Math.round(D[i] * 10) / 10,
    B: Math.round(B[i] * 10) / 10,
    S: Math.round(S[i] * 10) / 10,
  }));

  return { years, metrics };
}

/**
 * ตารางกฎการตัดสินใจจัดชั้นความสำคัญ (สไลด์ Project-1 หน้า 11)
 * กฎ1: คะแนน≥65 และ ปริมาณเฉลี่ย≥volumeThresholdTon  -> ชั้น 1
 * กฎ2: คะแนน≥65 และ ปริมาณเฉลี่ย<volumeThresholdTon  -> ชั้น 2
 * กฎ3: คะแนน<65 แต่ ≥50                                -> ชั้น 3
 * กฎ4: คะแนน<50                                          -> ชั้น 4
 */
function classifyTier(finalScore, avgYearlyTotalTon, volumeThresholdTon) {
  if (finalScore >= 65 && avgYearlyTotalTon >= volumeThresholdTon) return 1;
  if (finalScore >= 65 && avgYearlyTotalTon < volumeThresholdTon) return 2;
  if (finalScore >= 50) return 3;
  return 4;
}

function weightedScore(m, weights) {
  return (
    m.V * weights.V + m.G * weights.G + m.D * weights.D + m.B * weights.B + m.S * weights.S
  );
}

function rankProvinces(metrics, weights, volumeThresholdTon) {
  const scored = metrics.map((m) => ({
    ...m,
    finalScore: Math.round(weightedScore(m, weights) * 10) / 10,
  }));
  scored.sort((a, b) => b.finalScore - a.finalScore || a.id - b.id);
  scored.forEach((s, i) => {
    s.rank = i + 1;
    s.tier = classifyTier(s.finalScore, s.avgYearlyTotalTon, volumeThresholdTon);
  });
  return scored;
}

module.exports = { buildProvinceMetrics, rankProvinces, classifyTier, weightedScore, mean, stdev, minMaxNormalize };
