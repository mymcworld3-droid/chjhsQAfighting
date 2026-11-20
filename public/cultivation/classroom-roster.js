export const ROSTER_IMPORT_LIMIT = 100;

function cells(text) {
  const input = String(text || '').replace(/^\uFEFF/, '');
  if (input.length > 60000) throw Error('CSV 檔案過大，請只匯入本班最多 100 位學生。');
  const rows = [], row = [];
  let cell = '', inside = false, justEnded = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inside) {
      if (ch === '"') {
        if (input[i+1] === '"') { cell += '"'; i++; }
        else inside = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') {
      if (cell.trim() || justEnded) throw Error('CSV 引號格式錯誤。');
      inside = true; justEnded = true;
    } else if (ch === ',') {
      row.push(cell); cell = ''; justEnded = false;
    } else if (ch === '\r' || ch === '\n') {
      row.push(cell); cell = ''; justEnded = false;
      if (row.some(value => value.trim())) rows.push(row.slice());
      row.length = 0;
      if (ch === '\r' && input[i+1] === '\n') i++;
    } else {
      if (justEnded && ch !== ' ' && ch !== '\t') throw Error('CSV 引號後出現無效文字。');
      cell += ch;
    }
  }
  if (inside) throw Error('CSV 引號未正確結束。');
  row.push(cell);
  if (row.some(value => value.trim())) rows.push(row);
  return rows;
}
function cleanSpreadsheetValue(value) {
  const str = String(value ?? '').trim();
  return /^'[=+@-]/.test(str) ? str.slice(1) : str;
}
export function parseRosterCSV(csv, members) {
  const rows = cells(csv);
  if (!rows.length) throw Error('CSV 沒有資料。');
  const headers = rows[0].map(value => String(value).trim().toLowerCase());
  if (headers.length !== 3 || !['uid','name','seat'].every(key => headers.includes(key))) {
    throw Error('CSV 表頭必須為 uid,name,seat（順序可調整）。請先匯出本班名單作為範本。');
  }
  if (rows.length < 2 || rows.length > ROSTER_IMPORT_LIMIT + 1) {
    throw Error('CSV 必須有 1 至 100 筆資料。');
  }
  const ids = new Map((members || []).map(m => [m.uid,m]));
  const seen = new Set(), updates = [], errors = [];
  let unchanged = 0;
  const positions = Object.fromEntries(['uid','name','seat'].map(key => [key,headers.indexOf(key)]));
  rows.slice(1).forEach((cells, index) => {
    if (cells.length !== 3) { errors.push('第 ' + (index+2) + ' 列欄位數量不符'); return; }
    const uid = cleanSpreadsheetValue(cells[positions.uid]);
    const name = cleanSpreadsheetValue(cells[positions.name]);
    const seat = cleanSpreadsheetValue(cells[positions.seat]);
    if (seen.has(uid)) { errors.push('第 ' + (index+2) + ' 列學生識別碼重複'); return; }
    seen.add(uid);
    const current = ids.get(uid);
    if (!current) { errors.push('第 ' + (index+2) + ' 列識別碼不屬於目前班級'); return; }
    if (!name || name.length > 40 || seat.length > 12) {
      errors.push('第 ' + (index+2) + ' 列姓名或座號格式錯誤'); return;
    }
    if (current.name === name && (current.seat || '') === seat) unchanged++;
    else updates.push({ uid, name, seat });
  });
  return { updates, errors, unchanged, checked: rows.length - 1 };
}
function safeCsvCell(input) {
  let value = String(input ?? '');
  if (/^[\s\uFEFF]*[=+@-]/.test(value) || /^[\t\r\n]/.test(value)) value = "'" + value;
  return '"' + value.replace(/"/g, '""') + '"';
}
export function exportRosterCSV(members) {
  return '\uFEFF' + [['uid','name','seat'],...(members || []).map(m=>[m.uid,m.name,m.seat||''])]
    .map(row=>row.map(safeCsvCell).join(',')).join('\r\n') + '\r\n';
}
export function renderRosterPanel(state, helpers) {
  const { escape: e, button } = helpers, room = state.classroom;
  const active = room.status === 'active';
  const members = (room.members || []).slice();
  const sort = state.studentSort === 'name' ? 'name' : 'seat';
  members.sort((a,b) => sort === 'name'
    ? a.name.localeCompare(b.name,'zh-Hant') || (a.seat||'').localeCompare(b.seat||'','zh-Hant',{numeric:true})
    : (a.seat||'').localeCompare(b.seat||'','zh-Hant',{numeric:true}) || a.name.localeCompare(b.name,'zh-Hant'));
  const selected = new Set(state.rosterSelected || []);
  const attr = (key, value) => ' data-' + key + '="' + e(value) + '"';
  const rowHtml = members.map(m => {
    const editing = state.editStudentUid === m.uid;
    const select = '<label class="cc-roster-check"><input type="checkbox" data-roster-select="' + e(m.uid) + '" ' +
      (selected.has(m.uid) ? 'checked ' : '') + (active ? '' : 'disabled ') +
      'aria-label="選取學生 ' + e(m.name) + '"></label>';
    const info = '<span class="cc-seat">' + e(m.seat || '—') + '</span><div class="cc-roster-info"><strong>' +
      e(m.name) + '</strong><small>座號 ' + e(m.seat || '未填寫') + '</small></div>';
    const editor = '<form class="cc-form cc-roster-editor" data-form="student-edit">' +
      '<label>姓名<input name="name" required maxlength="40" value="' + e(m.name) + '"></label>' +
      '<label>座號<input name="seat" maxlength="12" value="' + e(m.seat || '') + '"></label>' +
      '<div class="cc-actions">' + button('roster-save', '儲存資料', attr('student-uid',m.uid) + ' class="cc-primary"') +
      button('roster-edit-cancel','取消') + '</div></form>';
    return '<article class="cc-card cc-student cc-roster-item" data-cc-item="student" data-cc-search="' +
      e((m.seat || '') + ' ' + m.name) + '">' +
      select + info + '<div class="cc-actions cc-roster-student-actions">' +
      button('roster-edit','編輯', attr('student-uid',m.uid) + (active ? '' : ' disabled')) +
      button('remove-student','移出',attr('id',m.uid)+attr('name',m.name) + (active ? ' class="cc-danger"' : ' disabled')) +
      '</div>' + (editing ? editor : '') + '</article>';
  }).join('');
  const preview = state.rosterPreview;
  const errors = preview?.errors || [];
  const previewHtml = preview ? '<div class="cc-roster-preview">' +
    '<p class="cc-muted">檢查 ' + preview.checked + ' 位：待修改 ' + preview.updates.length +
    ' 位、無變更 ' + preview.unchanged + ' 位、錯誤 ' + errors.length + ' 列。</p>' +
    errors.map(text => '<p role="alert" class="cc-roster-error">' + e(text) + '</p>').join('') +
    (preview.updates.length ? '<div class="cc-table-wrap"><table><thead><tr><th>原姓名</th><th>修改後</th><th>座號</th></tr></thead><tbody>' +
      preview.updates.slice(0,20).map(row => {
        const previous = members.find(m => m.uid === row.uid);
        return '<tr><td>' + e(previous?.name || '') + '</td><td>' + e(row.name) + '</td><td>' + e(row.seat || '—') + '</td></tr>';
      }).join('') + '</tbody></table></div>' : '') +
    button('roster-import-apply','確認更新 ' + preview.updates.length + ' 位學生',
      (errors.length || !preview.updates.length || !active ? 'disabled' : 'class="cc-primary"')) +
    '<p class="cc-muted">CSV 只會修改已有學生的姓名／座號；不會新增或合併帳號、修改作答或成績。</p></div>' : '';
  const imported = '<details class="cc-card cc-roster-import"' + (state.rosterPreview ? ' open' : '') +
    '><summary>CSV 匯入學生資料</summary>' +
    '<p class="cc-muted">先匯出名單，使用 uid、name、seat 三欄修改後再匯入；只以不可變動的 uid 比對，不會猜測相同姓名是否為同一人。</p>' +
    '<label>選取 CSV 檔案<input id="cc-roster-file" type="file" accept=".csv,text/csv" ' + (active?'':'disabled') + '></label>' +
    '<label>或貼上 CSV 內容<textarea id="cc-roster-csv" rows="5" placeholder="uid,name,seat" ' +
    (active?'':'disabled') + '>' + e(state.rosterCsvText || '') + '</textarea></label>' +
    '<div class="cc-actions">' + button('roster-import-preview', '預覽變更', active?'':'disabled') +
    button('roster-export', '匯出本班名單') + '</div>' + previewHtml + '</details>';
  return '<div class="cc-roster-section">' +
    '<div class="cc-section-title"><h3>學生名單</h3><div class="cc-actions">' +
    button('roster-export', '匯出 CSV') + button('roster-sort','依' + (sort === 'seat'?'姓名':'座號') + '排序') +
    '</div></div><p class="cc-muted">共 ' + members.length + ' 位學生。可單筆修改、批次整理或匯入 CSV；所有紀錄依原帳號保留。</p>' +
    '<div class="cc-list-tools"><label class="cc-search">尋找學生<input data-cc-search="student" type="search" ' +
    'placeholder="姓名或座號" value="' + e(state.studentSearch || '') + '"></label></div>' +
    '<div class="cc-roster-batchbar">' + button('roster-select-visible','選取目前顯示學生',active?'':'disabled') +
    '<span id="cc-roster-selected-count" class="cc-muted">已選取 ' + selected.size + ' 位</span>' +
    button('roster-batch-remove','批次移出所選學生',
      (!active || !selected.size || selected.size > 20 ? 'disabled' : 'class="cc-danger"')) + '</div>' +
    (selected.size > 20 ? '<p class="cc-muted">每次最多移出 20 位學生，請減少勾選數量。</p>' : '') +
    (room.status !== 'active' ? '<p class="cc-empty">班級已封存，恢復後才能編輯或移出學生。</p>' : '') +
    '<div class="cc-student-grid cc-roster-grid">' + rowHtml + '</div>' +
    (members.length ? '<p class="cc-empty" data-cc-empty="student" hidden>沒有符合條件的學生。</p>' :
      '<p class="cc-empty">尚無學生加入；請在班級設定分享加入碼。</p>') + imported + '</div>';
}
