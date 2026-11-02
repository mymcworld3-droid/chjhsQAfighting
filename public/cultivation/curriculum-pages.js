// 同頁選範圍：年級、科目、章節；細考點與自訂輸入按需展開。
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  let ready = false;

  function openCustom(value) {
    const custom = $('cs-custom-range');
    if (!custom) return;
    custom.open = true;
    if (typeof value === 'string') $('cs-range-input').value = value;
    $('cs-range-input').focus();
  }

  function refresh() {
    if (!ready) return;
    const grade = $('cs-grade')?.value || '', subject = $('cs-subject')?.value || '';
    $('cs-current-course').textContent = [grade, subject].filter(Boolean).join(' · ');
    $('cs-range-context').textContent = '加入 ' + grade + '・' + subject + ' 的範圍';
    document.querySelectorAll('[data-cs-term]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.csTerm === (window.getCurriculumTermFilter?.() || 'all')));
    });
  }

  function mount() {
    if (ready) return true;
    const base = $('cs-scope'), native = base?.querySelector('.cs-fields');
    const search = base?.querySelector('.cs-search-field'), tools = base?.querySelector('.cs-tools');
    const chapter = $('cs-units'), message = $('cs-message');
    if (!base || !native || !search || !tools || !chapter || !message) return false;
    const root = document.createElement('section');
    root.id = 'cs-pages'; root.className = 'cs-simple-picker';
    root.innerHTML = `
      <div class="cs-simple-heading"><h4>想練習什麼？</h4><p>選好年級、科目，點選章節，再按下方儲存。</p></div>
      <section id="cs-stage-2" class="cs-stage" aria-label="選擇章節">
        <div class="cs-course-heading"><strong id="cs-current-course"></strong><span>可選多章</span></div>
        <div class="cs-term-filter" role="group" aria-label="顯示的學期">
          <button type="button" data-cs-term="all" aria-pressed="true">全學年</button>
          <button type="button" data-cs-term="第一學期" aria-pressed="false">上學期</button>
          <button type="button" data-cs-term="第二學期" aria-pressed="false">下學期</button>
        </div>
      </section>
      <details id="cs-custom-range" class="cs-range-panel">
        <summary>找不到章節？自行輸入範圍</summary>
        <div class="cs-range-body">
          <p id="cs-range-context"></p>
          <label for="cs-range-input" class="cs-range-label">想練習的章節或考點
            <textarea id="cs-range-input" rows="2" maxlength="2400" placeholder="例如：鉛直圓周運動、功與動能" aria-describedby="cs-range-help cs-range-message"></textarea>
          </label>
          <p id="cs-range-help">多個範圍可用頓號或換行分開，每項最多 90 字。</p>
          <button type="button" id="cs-range-add">加入範圍</button>
          <p id="cs-range-message" role="status" aria-live="polite"></p>
        </div>
      </details>`;
    base.prepend(root);
    root.insertBefore(native, $('cs-stage-2'));
    native.classList.add('cs-simple-fields');
    const stage = $('cs-stage-2');
    search.firstChild.textContent = '';
    $('cs-search').setAttribute('aria-label', '搜尋章名或考點');
    stage.insertBefore(search, stage.querySelector('.cs-term-filter'));
    const actions = tools.querySelector('.cs-tools-actions');
    const bulk = document.createElement('details'); bulk.className = 'cs-bulk-tools';
    const bulkTitle = document.createElement('summary'); bulkTitle.textContent = '批次選取';
    bulk.append(bulkTitle, actions); tools.append(bulk);
    const count = $('cs-draft-count'); tools.querySelector('.cs-tools-caption').replaceChildren('已勾選 ', count, ' 項');
    stage.append(tools, chapter, message);
    document.querySelectorAll('[data-cs-term]').forEach(button => button.addEventListener('click', () => {
      window.filterCurriculumTerm?.(button.dataset.csTerm); refresh();
    }));
    ['cs-grade', 'cs-subject'].forEach(id => $(id).addEventListener('change', refresh));
    const addRange = () => {
      const input = $('cs-range-input'), result = window.addCustomCurriculumRange?.(input.value);
      $('cs-range-message').textContent = result?.message || '範圍選擇器尚未準備好，請稍後再試。';
      if (result?.ok) input.value = '';
      input.focus({ preventScroll:true });
    };
    $('cs-range-add').addEventListener('click', addRange);
    $('cs-range-input').addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.isComposing) { e.preventDefault(); addRange(); }
    });
    ready = true; refresh(); return true;
  }

  window.openCustomCurriculumRange = value => { if (mount()) openCustom(value); };
  window.resetCurriculumPages = () => {
    if (!mount()) return;
    $('cs-custom-range').open = false;
    document.querySelector('.cs-bulk-tools').open = false;
    $('cs-range-message').textContent = '';
    $('cs-range-input').value = '';
    window.restoreCurriculumContext?.();
    refresh();
  };
  // 舊版教學仍可指定焦點，所有欄位維持在同一頁。
  window.openCurriculumPage = page => { if (mount()) $(page === 0 ? 'cs-grade' : page === 1 ? 'cs-subject' : 'cs-search')?.focus(); };
  window.addEventListener('curriculum:options-ready', () => { mount(); refresh(); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once:true });
  else mount();
})();
