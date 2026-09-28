# CSV-SQL Demo

一个**以 CSV 文件为底层存储、支持标准 SQL 查询**的演示项目。本期支持：

- `SELECT` 全套：列选择、`*`、`WHERE`(AND/OR)、`ORDER BY`、`LIMIT`、聚合(`COUNT/SUM/AVG/MAX/MIN`)、`GROUP BY`、`DISTINCT`、`JOIN`（含子查询，由底层引擎原生支持）。
- `DESC <table>` / `DESCRIBE <table>`：查看表结构（列名 + 推断类型）。

设计目标是**存储层可替换**：查询逻辑完全不感知底层是 CSV 还是 JSON / SQLite，将来换存储只改一个适配器类。

---

## 快速开始

```bash
npm install            # 唯一运行时依赖：alasql
node server.js         # 启动服务
# 浏览器打开 http://localhost:3000
```

- 左侧列出 `data/` 下所有表，点击表名即执行 `DESC <表名>`。
- 右侧输入 SQL，按 `Ctrl+Enter` 或点"执行"，结果以表格展示；错误以红框提示。

---

## 目录结构

```
csv_db/
├── server.js                  # Node 原生 http 服务：托管前端 + 提供 API
├── package.json               # 唯一依赖 alasql（^4）
├── src/storage/
│   ├── StorageAdapter.js      # 存储抽象接口（可换存储的核心）
│   └── CsvAdapter.js          # CSV 实现 + 极简 CSV 解析器
├── src/engine/
│   ├── SqlEngine.js           # 查询分发：DESC 拦截 + 注册内存表交给 alasql
│   └── schema.js              # 类型推断 + 值转换 + AST 兜底列名
├── public/                    # 前端单页：index.html / app.js / style.css
└── data/                      # 示例数据：users.csv、orders.csv（每张表一个文件）
```

---

## 架构总览

```
┌─────────────────────────────────────┐
│  浏览器页面 (public/)                 │  输入 SQL → 渲染结果表格
└──────────────────┬──────────────────┘
                   │  POST /api/query { sql }
┌──────────────────▼──────────────────┐
│  server.js (Node 原生 http)           │
│                                       │
│   ┌─────────── 路由分发 ───────────┐   │
│   │ GET  /api/tables               │   │
│   │ POST /api/query  → SqlEngine   │   │
│   └────────────────────────────────┘   │
│                                       │
│  SqlEngine（src/engine/SqlEngine.js）   │
│   ├─ DESC/DESCRIBE ──► 走 schema 分支  │  ← 不进 SQL 引擎，自己造结果
│   └─ SELECT/其他 ──► 以下流程          │
│         │                             │
│   ┌─────▼────────────────────────┐     │
│   │ 存储层 StorageAdapter（可换）  │     │
│   │   CsvAdapter: data/<表>.csv   │     │
│   │   → 解析成 内存对象数组(已转型) │     │
│   └─────┬────────────────────────┘     │
│         │ rows[]                       │
│   ┌─────▼────────────────────────┐     │
│   │ 注册为 alasql 内存表           │     │
│   │   alasql.tables[name]={data}  │     │
│   └─────┬────────────────────────┘     │
│         │ 原始 SQL 字符串               │
│   ┌─────▼────────────────────────┐     │
│   │ alasql 解析 + 执行            │     │  ← SQL 真正在这里被执行
│   └─────┬────────────────────────┘     │
│         │ [{...}, {...}]               │
│   ┌─────▼────────────────────────┐     │
│   │ 结果整形：取列名、计数         │     │
│   └─────┬────────────────────────┘     │
└─────────┼─────────────────────────────┘
          │  { columns, rows, rowCount, isDesc }
          ▼
     前端动态渲染 <table>
```

---

## SQL 是怎么转换成执行的（核心）

这是本项目最关键的部分。分两条路径：**`DESC` 是我们自己处理**，**`SELECT` 等查询则交给 alasql 执行**——我们做的事是"把存储层的数据物化成 alasql 能识别的内存表"，而不是手写 SQL 翻译器。

### 完整链路（以一条 `SELECT` 为例）

**① 前端提交**
`app.js` 把文本框里的 SQL 用 `fetch('/api/query', {method:'POST', body:{sql}})` 发到后端。

**② 服务端路由**（`server.js`）
`POST /api/query` 解析 JSON 拿到 `sql` 字符串，调用 `engine.query(sql)`。

**③ SqlEngine 分发**（`SqlEngine.js` → `query()`）
先判断语句类型：

```js
const DESC_RE = /^\s*(DESCRIBE|DESC)\s+([A-Za-z0-9_]+)\s*;?\s*$/i;
const m = DESC_RE.exec(sql);
if (m) { /* 走 DESC 分支，见下文 */ }
// 否则走 SELECT / 通用分支
```

**④ 存储层加载 + 类型转换**（`CsvAdapter.readTable` → `schema.inferAndCoerce`）
- `CsvAdapter` 读取 `data/<表名>.csv`，用自带解析器把文本变成 `矩阵`：第一行是列名，其余每行是一个对象 `{列名: 值}`（空单元格记为 `null`）。
- **关键一步——类型推断与转换**（`schema.js`）：CSV 里所有值本质上都是字符串，但直接拿字符串给 SQL 引擎做数值比较/求和会出错（比如 `"9" > "10"` 按字典序为真）。所以 `inferAndCoerce` 对每列采样前 50 行推断类型并就地转换：
  - 全部是非空数字 → `number`，值用 `Number()` 转成数字；
  - 匹配日期格式 `YYYY-MM-DD[ HH:MM[:SS]]` → `date`（保持字符串，仅标记类型）；
  - 只有 `true`/`false` → `boolean`；
  - 否则 → `string`。
- 最终得到 `{ columns, types, rows }`，其中 `rows` 已经是带正确 JS 类型的对象数组。

**⑤ 注册为 alasql 内存表**（`SqlEngine._register`）
把上一步的内存表"挂"到 alasql 的表注册表里：

```js
for (const [name, entry] of this.cache) {
  alasql.tables[name] = { data: entry.rows };
}
```

这一步就是本项目"存储可换"的核心：无论底层是 CSV / JSON / SQLite，只要能给出 `{columns, rows}`，就能注册成 alasql 表，**查询层与底层格式彻底解耦**。

**⑥ alasql 解析并真正执行**
`alasql(sql)` 接收**原始的 SQL 字符串**，由 alasql 自己的词法/语法解析器和执行器去处理 `WHERE`/`JOIN`/`GROUP BY`/聚合/`ORDER BY`/`LIMIT` 等，返回结果是 JS 对象数组 `[{列:值}, ...]`。

> 说明：本项目**没有**把 SQL 翻译成别的语言或自己实现执行器。SELECT 系列的执行完全委托给 alasql；我们只在"存储 → 内存表"这一层做物化与类型处理。这正是 demo 阶段最划算的做法——把精力放在存储抽象和前端交互上。

**⑦ 结果整形**（`SqlEngine.query` 返回前）
- 列名从结果第一行 `Object.keys(res[0])` 取；
- 若结果为 0 行，用 `alasql.parse(sql)` 拿 AST 里的 `columns` 兜底列名（`schema.columnsFromAst`），保证表头不空；
- 组装成 `{ columns, rows, rowCount, isDesc:false }` 返回。

**⑧ 前端渲染**（`app.js → renderResult`）
按 `columns` 生成 `<thead>`，逐行生成 `<tbody>`，`null` 显示为 `NULL` 斜体，对象类型 `JSON.stringify`。

---

### `DESC` 为什么要单独拦截

`DESC <表>` 不是标准 SELECT，alasql 也不会把它当"查看表结构"处理（它只会当成 `ORDER BY ... DESC` 的片段去解析，整句必然报错）。所以我们在 `SqlEngine` 里用正则把整句 `DESC/DESCRIBE <表名>` 拦下来，**不交给 alasql**，而是：

1. 调存储层 `readTable` 拿到列名和推断类型（`entry.types`）；
2. 自己拼一个合成结果集：

```js
const rows = entry.columns.map(col => ({
  column: col,
  type: entry.types[col] || 'string'
}));
return { columns: ['column', 'type'], rows, rowCount: rows.length, isDesc: true };
```

前端拿到 `isDesc:true` 后只是正常渲染表格，于是 `DESC users` 就显示出 `id:number / name:string / age:number / city:string / active:boolean` 这样的结构信息。

---

## 类型推断规则（`src/engine/schema.js`）

| 条件（采样前 50 行非空值）        | 推断类型 | 存储值处理        |
| -------------------------------- | -------- | ----------------- |
| 全部可解析为数字                 | `number` | `Number(v)` 转换  |
| 匹配 `YYYY-MM-DD[ HH:MM[:SS]]`   | `date`   | 保持字符串        |
| 仅 `true` / `false`              | `boolean`| 转成布尔          |
| 其它                             | `string` | 保持原字符串      |

空单元格统一记为 `null`（既参与类型判断时"跳过"，也作为缺失值返回）。

---

## API 说明

| 方法 | 路径           | 入参              | 返回                                        |
| ---- | -------------- | ----------------- | ------------------------------------------- |
| GET  | `/api/tables`  | —                 | `{ tables: string[] }`                       |
| POST | `/api/query`   | `{ sql: string }` | `{ columns, rows, rowCount, isDesc }` 或 `{ error }` |
| GET  | `/`（及静态资源）| —                | 前端页面                                     |

错误示例（表不存在 / 语法错误 / 空语句）一律返回 `{ error: "..." }`，HTTP 状态 400，前端红框展示。

---

## 已支持的 SQL 能力（示例）

```sql
-- 基础查询 + 过滤
SELECT * FROM users WHERE age > 30;

-- 聚合 + 分组
SELECT city, COUNT(*) AS n FROM users GROUP BY city;

-- 多表连接
SELECT u.name, o.product, o.amount
FROM users u JOIN orders o ON u.id = o.user_id
WHERE o.amount > 100;

-- 排序 + 限量
SELECT name, age FROM users ORDER BY age DESC LIMIT 3;

-- 查看表结构
DESC users;
```

---

## 已知限制

- **alasql 保留字别名**：聚合别名若用了 alasql 的保留字会报语法错，例如 `COUNT(*) AS total` 要写成 `COUNT(*) AS [total]` 或反引号 `` COUNT(*) AS `total` ``。普通列名不受影响。
- 本期只读：`INSERT/UPDATE/DELETE` 未实现（`StorageAdapter.writeTable` 接口已预留）。
- CSV 解析器为演示用的极简实现（支持引号、双引号转义、逗号与换行），生产建议换 `papaparse` / `csv-parse`。

---

## 如何扩展

### 1. 换存储（核心卖点）
实现一个新的 `StorageAdapter` 子类，只改 `server.js` 一行：

```js
// 原来是：
const storage = new CsvAdapter({ dataDir: DATA_DIR });
// 换成（示例）：
const storage = new JsonAdapter({ dataDir: DATA_DIR });
```

只要 `listTables()` / `readTable()` 返回 `{ columns, rows }`，查询层和前端**一行都不用改**。

### 2. 加写能力
在 `StorageAdapter` 里实现 `writeTable(name, rows)`，并在 `SqlEngine` 增加 `INSERT/UPDATE/DELETE` 分支（同样可在交给 alasql 执行后回写存储）。

### 3. 消除保留字别名坑
在 `SqlEngine` 提交 alasql 前，对 `AS <词>` 中命中 alasql 保留词的别名自动加 `[...]` 包裹（轻量正则即可，无需完整 SQL 解析）。
