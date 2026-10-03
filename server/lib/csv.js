'use strict';
/**
 * CSV parser/writer แบบเขียนเอง (ไม่ใช้ library ภายนอก)
 * รองรับ: BOM ของ Excel, ช่องที่มี "..." ครอบ, "" แทนเครื่องหมายคำพูด, ขึ้นบรรทัดใหม่ทั้ง \r\n และ \n
 */

function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // ตัด BOM ที่ Excel ใส่มา
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else field += ch;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }

  // ตัดบรรทัดว่างทิ้ง (เช่น บรรทัดท้ายไฟล์)
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

function toCsv(header, rows) {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  // ใส่ BOM ให้ Excel เปิดภาษาไทยได้ถูกต้อง
  return '﻿' + [header, ...rows].map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n';
}

module.exports = { parseCsv, toCsv };
