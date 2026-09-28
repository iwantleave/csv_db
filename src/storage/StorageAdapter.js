'use strict';

/**
 * 存储适配器接口（抽象基类）。
 *
 * 查询层（SqlEngine）只依赖这个接口，完全不感知底层是 CSV / JSON / SQLite。
 * 未来要换存储，只需新增一个实现本接口的类（如 JsonAdapter、SqliteAdapter），
 * 在 server.js 里替换实例即可，查询 / 前端逻辑一律不动。
 */
class StorageAdapter {
  /** 列出所有表名 @returns {Promise<string[]>} */
  async listTables() {
    throw new Error('listTables() 未实现');
  }

  /**
   * 读取一张表的数据
   * @param {string} name 表名
   * @returns {Promise<{columns: string[], rows: Object[]}>}
   */
  async readTable(name) {
    throw new Error('readTable() 未实现');
  }

  /**
   * （未来扩展）写入一张表 —— 当前 demo 仅查询，留接口占位
   * @param {string} name
   * @param {Object[]} rows
   */
  async writeTable(name, rows) {
    throw new Error('writeTable() 未实现');
  }
}

module.exports = StorageAdapter;
