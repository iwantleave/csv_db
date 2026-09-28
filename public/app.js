'use strict';

const sqlInput = document.getElementById('sqlInput');
const runBtn = document.getElementById('runBtn');
const clearBtn = document.getElementById('clearBtn');
const statusEl = document.getElementById('status');
const errorEl = document.getElementById('error');
const resultTable = document.getElementById('resultTable');
const resultMeta = document.getElementById('resultMeta');
const tableList = document.getElementById('tableList');

async function loadTables() {
  try {
    const res = await fetch('/api/tables');
    const data = await res.json();
    tableList.innerHTML = '';
    (data.tables || []).forEach(t => {
      const li = document.createElement('li');
      li.textContent = t;
      li.title = '点击执行 DESC ' + t;
      li.onclick = () => runSql('DESC ' + t);
      tableList.appendChild(li);
    });
  } catch (e) {
    tableList.innerHTML = '<li style="color:#c0392b">加载表失败: ' + e.message + '</li>';
  }
}

function renderResult(result) {
  resultTable.innerHTML = '';
  const cols = result.columns || [];

  const thead = document.createElement('thead');
  const htr = document.createElement('tr');
  cols.forEach(c => {
    const th = document.createElement('th');
    th.textContent = c;
    htr.appendChild(th);
  });
  thead.appendChild(htr);
  resultTable.appendChild(thead);

  const tbody = document.createElement('tbody');
  (result.rows || []).forEach(row => {
    const tr = document.createElement('tr');
    cols.forEach(c => {
      const td = document.createElement('td');
      const v = row[c];
      if (v === null || v === undefined) {
        td.textContent = 'NULL';
        td.className = 'null';
      } else if (typeof v === 'object') {
        td.textContent = JSON.stringify(v);
      } else {
        td.textContent = String(v);
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  resultTable.appendChild(tbody);

  resultMeta.textContent = '返回 ' + result.rowCount + ' 行 · ' + cols.length + ' 列'
    + (result.isDesc ? ' · DESC' : '');
}

async function runSql(sql) {
  const query = (sql != null) ? sql : sqlInput.value;
  if (sql != null) sqlInput.value = sql;

  errorEl.hidden = true;
  statusEl.textContent = '执行中…';
  try {
    const res = await fetch('/api/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql: query })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '查询失败');
    renderResult(data);
    statusEl.textContent = '完成';
  } catch (e) {
    errorEl.hidden = false;
    errorEl.textContent = e.message;
    statusEl.textContent = '';
  }
}

runBtn.onclick = () => runSql();
clearBtn.onclick = () => { sqlInput.value = ''; sqlInput.focus(); };
sqlInput.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    runSql();
  }
});

loadTables();
