'use strict';
const alasql = require('alasql');
const StorageAdapter = require('../storage/StorageAdapter');
const { inferAndCoerce, columnsFromAst } = require('./schema');

// 匹配整句 DESC / DESCRIBE <table>（不进入 SQL 引擎，单独处理）
const DESC_RE = /^\s*(DESCRIBE|DESC)\s+([A-Za-z0-9_]+)\s*;?\s*$/i;

/**
 * SQL 引擎：
 *  - DESC / DESCRIBE 表结构查看 —— 单独拦截，返回列名 + 推断类型
 *  - SELECT 等标准查询 —— 把存储层读出的内存行注册进 alasql 执行
 * 查询层与底层存储格式解耦：只要 StorageAdapter 提供表数据即可。
 */
class SqlEngine {
  constructor(storage) {
    if (!(storage instanceof StorageAdapter)) {
      throw new Error('SqlEngine 需要传入 StorageAdapter 实例');
    }
    this.storage = storage;
    this.cache = new Map(); // 表名 -> { columns, types, rows }
  }

  async _loadTable(name) {
    if (this.cache.has(name)) return this.cache.get(name);
    const { columns, rows } = await this.storage.readTable(name);
    const { types, rows: coerced } = inferAndCoerce(columns, rows);
    const entry = { columns, types, rows: coerced };
    this.cache.set(name, entry);
    return entry;
  }

  async _loadAll() {
    const tables = await this.storage.listTables();
    for (const t of tables) {
      if (!this.cache.has(t)) await this._loadTable(t);
    }
  }

  _register() {
    // 把缓存的表注册成 alasql 内存表，供 SELECT / JOIN 使用
    for (const [name, entry] of this.cache) {
      alasql.tables[name] = { data: entry.rows };
    }
  }

  /**
   * 执行一条 SQL（本期：SELECT 系列 + DESC/DESCRIBE）
   * @param {string} sql
   * @returns {Promise<{columns:string[], rows:Object[], rowCount:number, isDesc:boolean}>}
   */
  async query(sql) {
    if (!sql || !sql.trim()) {
      throw new Error('SQL 语句为空');
    }

    const m = DESC_RE.exec(sql);
    if (m) {
      const name = m[2];
      const entry = await this._loadTable(name);
      const rows = entry.columns.map(col => ({
        column: col,
        type: entry.types[col] || 'string'
      }));
      return { columns: ['column', 'type'], rows, rowCount: rows.length, isDesc: true };
    }

    // SELECT / 其他交给 alasql
    await this._loadAll();
    this._register();

    let res;
    try {
      res = alasql(sql);
    } catch (e) {
      throw new Error('SQL 执行错误: ' + e.message);
    }

    let columns = [];
    if (Array.isArray(res) && res.length > 0) {
      columns = Object.keys(res[0]);
    } else if (Array.isArray(res)) {
      columns = columnsFromAst(alasql, sql); // 0 行结果兜底列名
    }
    return {
      columns,
      rows: res || [],
      rowCount: Array.isArray(res) ? res.length : 0,
      isDesc: false
    };
  }

  /** 数据文件变化后清空表缓存 */
  clearCache() {
    this.cache.clear();
  }
}

module.exports = SqlEngine;
