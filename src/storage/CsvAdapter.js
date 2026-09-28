'use strict';
const fs = require('fs');
const path = require('path');
const StorageAdapter = require('./StorageAdapter');

/**
 * 极简 CSV 解析器：
 *  - 支持双引号包裹字段
 *  - 双引号内用两个双引号 "" 转义
 *  - 字段分隔符为逗号，记录分隔符为 \n（兼容 \r\n）
 * 足以覆盖 demo 场景；生产可换 papaparse / csv-parse。
 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c === '\r') { /* 忽略，统一由 \n 切分 */ }
      else field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

/**
 * CSV 存储适配器：每张表对应 data/<name>.csv 一个文件，
 * 文件第一行是列名（表头），其余行是数据。
 */
class CsvAdapter extends StorageAdapter {
  constructor({ dataDir = './data' } = {}) {
    super();
    this.dataDir = path.resolve(dataDir);
  }

  async listTables() {
    let files;
    try {
      files = await fs.promises.readdir(this.dataDir);
    } catch (e) {
      throw new Error(`数据目录不存在或无法读取: ${this.dataDir}`);
    }
    return files
      .filter(f => f.toLowerCase().endsWith('.csv'))
      .map(f => f.slice(0, -4));
  }

  async readTable(name) {
    const file = path.join(this.dataDir, `${name}.csv`);
    let text;
    try {
      text = await fs.promises.readFile(file, 'utf8');
    } catch (e) {
      throw new Error(`表 "${name}" 不存在（找不到 ${file}）`);
    }
    const matrix = parseCsv(text).filter(
      r => r.length > 1 || (r.length === 1 && r[0] !== '')
    );
    if (matrix.length === 0) return { columns: [], rows: [] };

    const columns = matrix[0].map(h => h.trim());
    const rows = matrix.slice(1).map(cells => {
      const obj = {};
      columns.forEach((col, idx) => {
        const raw = cells[idx] !== undefined ? cells[idx] : '';
        obj[col] = raw === '' ? null : raw;
      });
      return obj;
    });
    return { columns, rows };
  }
}

module.exports = CsvAdapter;
module.exports.parseCsv = parseCsv;
