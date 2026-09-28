'use strict';

const DATE_RE = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$/;

function looksLikeNumber(v) {
  if (v === null || v === '') return true; // 空值视为可兼容
  if (typeof v === 'number') return true;
  return v.trim() !== '' && !isNaN(Number(v));
}
function looksLikeBool(v) {
  return v === 'true' || v === 'false';
}
function looksLikeDate(v) {
  return typeof v === 'string' && DATE_RE.test(v);
}

/**
 * 根据采样行推断每列类型，并把字符串值转换成对应的 JS 类型。
 * 这样 DESC 能给出有意义的结果，且数值比较 / 聚合在 SQL 中不会因字符串而失真。
 *
 * @param {string[]} columns 列名
 * @param {Object[]} rows 原始行（值为字符串或 null）
 * @returns {{ types: Object<string,string>, rows: Object[] }}
 */
function inferAndCoerce(columns, rows) {
  const sample = rows.slice(0, 50);
  const types = {};
  for (const col of columns) {
    let num = true, bool = true, date = true, hasVal = false;
    for (const r of sample) {
      const v = r[col];
      if (v === null || v === '') continue;
      hasVal = true;
      if (!looksLikeNumber(v)) num = false;
      if (!looksLikeBool(v)) bool = false;
      if (!looksLikeDate(v)) date = false;
    }
    let t = 'string';
    if (hasVal) {
      if (num) t = 'number';
      else if (date) t = 'date';
      else if (bool) t = 'boolean';
    }
    types[col] = t;
  }

  const out = rows.map(r => {
    const o = {};
    for (const col of columns) {
      const v = r[col];
      if (v === null || v === '') { o[col] = null; continue; }
      switch (types[col]) {
        case 'number': o[col] = Number(v); break;
        case 'boolean': o[col] = v === 'true'; break;
        default: o[col] = v; // string / date 保持字符串
      }
    }
    return o;
  });

  return { types, rows: out };
}

/**
 * 当查询返回 0 行时，用 alasql 的 AST 兜底推导列名，保证表头不为空。
 * 仅为展示用，解析失败则返回空数组。
 */
function columnsFromAst(alasql, sql) {
  try {
    const ast = alasql.parse(sql);
    if (ast && Array.isArray(ast.columns)) {
      return ast.columns.map(c => {
        if (c.alias) return c.alias;
        if (c.columnid) return c.columnid;
        if (c.value !== undefined) return String(c.value);
        return '?';
      });
    }
  } catch (e) { /* 忽略解析失败 */ }
  return [];
}

module.exports = { inferAndCoerce, columnsFromAst };
