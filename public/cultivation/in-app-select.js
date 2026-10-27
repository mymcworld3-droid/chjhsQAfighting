// Keep native select values, form submission and existing change handlers.
// Only replace the picker, including for controls created after startup.
(() => {
  'use strict';
  let current = null, sequence = 0;
  const controls = new WeakMap(), sources = new WeakMap();
  const enabled = select => select.isConnected && !select.matches(':disabled') && select.getClientRects().length;
  const dropdown = select => !select.multiple && select.size <= 1;
  function syncControl(select) {
    let state = controls.get(select);
    if (state && select.parentElement !== state.wrapper) {
      state.wrapper.remove(); select.inert = state.inert;
      controls.delete(select); sources.delete(state.trigger); state = null;
    }
    if (!select.isConnected) return;
    if (!dropdown(select)) {
      if (current?.select === select) close(false);
      if (state) {
        state.wrapper.replaceWith(select); select.inert = state.inert;
        controls.delete(select); sources.delete(state.trigger);
      }
      return;
    }
    if (!state) {
      if (!select.isConnected || select.inert) return;
      const wrapper = document.createElement('span'), trigger = document.createElement('button');
      wrapper.className = 'app-select-control'; trigger.className = 'app-select-trigger'; trigger.type = 'button';
      state = {wrapper, trigger, inert:select.inert};
      controls.set(select, state); sources.set(trigger, select);
      // The original control still renders its value and participates in forms.
      // An inert select cannot activate a second, platform-owned picker.
      select.before(wrapper); wrapper.append(select, trigger); select.inert = true;
      trigger.setAttribute('aria-haspopup', 'dialog'); trigger.setAttribute('aria-expanded', 'false');
      trigger.addEventListener('focus', () => syncControl(select));
    }
    const {wrapper, trigger} = state;
    const hidden = select.hidden || select.classList.contains('hidden') || getComputedStyle(select).display === 'none';
    if (wrapper.hidden !== hidden) wrapper.hidden = hidden;
    const disabled = select.matches(':disabled');
    if (trigger.disabled !== disabled) trigger.disabled = disabled;
    const name = nameOf(select), value = select.selectedOptions[0]?.label || '';
    const label = value ? name + '：' + value : name;
    if (trigger.getAttribute('aria-label') !== label) trigger.setAttribute('aria-label', label);
  }
  function scan(root) {
    if (root.matches?.('select')) syncControl(root);
    root.querySelectorAll?.('select').forEach(syncControl);
  }
  function nameOf(select) {
    const explicit = select.getAttribute('aria-label');
    if (explicit) return explicit;
    const ids = select.getAttribute('aria-labelledby')?.split(/\s+/);
    if (ids?.length) return ids.map(id => document.getElementById(id)?.textContent || '').join(' ').trim() || '選擇選項';
    const label = select.labels?.[0]?.cloneNode(true);
    label?.querySelectorAll('select,input,textarea,button').forEach(node => node.remove());
    return label?.textContent.trim() || select.title || '選擇選項';
  }
  function close(restoreFocus = true) {
    const state = current;
    if (!state) return;
    current = null;
    state.optionsObserver.disconnect(); state.pageObserver.disconnect();
    window.removeEventListener('resize', position);
    window.removeEventListener('scroll', position, true);
    window.visualViewport?.removeEventListener('resize', position);
    window.visualViewport?.removeEventListener('scroll', position);
    for (const [name, value] of state.attributes) {
      const control = state.control || state.select;
      if (value === null) control.removeAttribute(name); else control.setAttribute(name, value);
    }
    if (state.dialog.open) state.dialog.close();
    state.dialog.remove();
    if (restoreFocus && enabled(state.select)) (state.control || state.select).focus({ preventScroll:true });
  }
  function position() {
    if (!current) return;
    const { select, dialog } = current;
    if (!enabled(select)) { close(false); return; }
    const view = window.visualViewport;
    const width = view?.width || innerWidth, height = view?.height || innerHeight;
    const left = view?.offsetLeft || 0, top = view?.offsetTop || 0;
    const rect = select.getBoundingClientRect(), gap = 8;
    const menuWidth = Math.max(0, Math.min(Math.max(rect.width, 260), 420, width - 24));
    dialog.style.width = menuWidth + 'px';
    dialog.style.maxHeight = Math.max(0, Math.min(420, height - 24)) + 'px';
    const menuHeight = dialog.getBoundingClientRect().height;
    const below = rect.bottom + gap;
    const y = below + menuHeight <= top + height - 12 ? below : rect.top - menuHeight - gap;
    dialog.style.left = Math.max(left + 12, Math.min(rect.left, left + width - menuWidth - 12)) + 'px';
    dialog.style.top = Math.max(top + 12, Math.min(y, top + height - menuHeight - 12)) + 'px';
  }
  function choose(index) {
    const state = current;
    if (!state || !enabled(state.select)) { close(false); return; }
    const option = state.select.options[index];
    if (!option || option.hidden || option.disabled || option.parentElement?.disabled || option.parentElement?.hidden) return;
    const changed = state.select.selectedIndex !== index;
    state.select.selectedIndex = index;
    if (controls.has(state.select)) syncControl(state.select);
    close();
    if (changed) {
      state.select.dispatchEvent(new Event('input', { bubbles:true }));
      state.select.dispatchEvent(new Event('change', { bubbles:true }));
    }
  }
  function renderOptions() {
    if (!current) return;
    const { select, list, search } = current;
    const query = search.value.trim().toLocaleLowerCase();
    const fragment = document.createDocumentFragment();
    let group = null, count = 0;
    for (const option of select.options) {
      const parent = option.parentElement;
      const label = option.label || option.textContent;
      if (option.hidden || parent?.hidden || query && !label.toLocaleLowerCase().includes(query)) continue;
      if (parent?.tagName === 'OPTGROUP' && parent !== group) {
        const heading = document.createElement('div'); heading.className = 'app-select-group';
        heading.textContent = parent.label; fragment.append(heading); group = parent;
      }
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'app-select-option';
      button.tabIndex = -1;
      button.setAttribute('role', 'option'); button.setAttribute('aria-selected', String(option.selected));
      button.setAttribute('aria-label', label);
      button.disabled = option.disabled || !!parent?.disabled;
      button.dataset.optionIndex = String(option.index); button.textContent = label;
      button.addEventListener('click', () => choose(option.index)); fragment.append(button); count++;
    }
    if (!count) {
      const empty = document.createElement('p'); empty.className = 'app-select-empty';
      empty.setAttribute('role', 'status'); empty.textContent = '沒有符合的選項'; fragment.append(empty);
    }
    const focusedIndex = document.activeElement?.dataset?.optionIndex;
    list.replaceChildren(fragment);
    const first = list.querySelector('[aria-selected="true"]:not(:disabled)') || list.querySelector('button:not(:disabled)');
    if (first) first.tabIndex = 0;
    if (focusedIndex !== undefined) {
      const next = list.querySelector(`[data-option-index="${focusedIndex}"]:not(:disabled)`) || first;
      if (next) { if (first) first.tabIndex = -1; next.tabIndex = 0; next.focus({preventScroll:true}); }
    }
    position();
  }
  function moveFocus(event) {
    if (!current) return;
    const { list, search } = current;
    const buttons = [...list.querySelectorAll('button:not(:disabled)')];
    const index = buttons.indexOf(document.activeElement);
    if (event.target === search && !['ArrowDown','ArrowUp','Enter'].includes(event.key)) return;
    let next;
    if (event.key === 'ArrowDown') next = Math.min(index + 1, buttons.length - 1);
    else if (event.key === 'ArrowUp') next = index < 0 ? buttons.length - 1 : Math.max(0, index - 1);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = buttons.length - 1;
    else if (event.key === 'Enter' && event.target === search) {
      event.preventDefault(); if (buttons[0]) choose(Number(buttons[0].dataset.optionIndex)); return;
    }
    if (next !== undefined) {
      event.preventDefault();
      buttons.forEach(button => { button.tabIndex = -1; });
      if (buttons[next]) { buttons[next].tabIndex = 0; buttons[next].focus(); }
    }
  }
  function open(select) {
    if (!enabled(select)) return;
    if (current?.select === select) return;
    close(false);
    const dialog = document.createElement('dialog');
    dialog.id = 'app-select-' + (++sequence); dialog.className = 'app-select-menu';
    dialog.setAttribute('aria-label', nameOf(select));
    const header = document.createElement('header'), title = document.createElement('strong'), dismiss = document.createElement('button');
    title.textContent = nameOf(select); dismiss.type = 'button'; dismiss.textContent = '×';
    dismiss.setAttribute('aria-label','取消選擇'); dismiss.addEventListener('click', () => close());
    header.append(title, dismiss);
    const search = document.createElement('input'); search.type = 'search'; search.placeholder = '搜尋選項';
    search.className = 'app-select-search'; search.setAttribute('aria-label','搜尋選項'); search.autocomplete = 'off';
    const list = document.createElement('div'); list.className = 'app-select-list'; list.setAttribute('role','listbox');
    list.setAttribute('aria-label', nameOf(select));
    dialog.append(header, search, list);
    const control = controls.get(select)?.trigger || select;
    const attributes = ['aria-haspopup','aria-expanded','aria-controls'].map(name => [name, control.getAttribute(name)]);
    const optionsObserver = new MutationObserver(renderOptions);
    const pageObserver = new MutationObserver(() => { if (current && !enabled(select)) close(false); });
    current = { select, control, dialog, search, list, attributes, optionsObserver, pageObserver };
    control.setAttribute('aria-haspopup','dialog'); control.setAttribute('aria-expanded','true'); control.setAttribute('aria-controls',dialog.id);
    document.body.append(dialog);
    dialog.showModal();
    renderOptions();
    const first = list.querySelector('[aria-selected="true"]:not(:disabled)') || list.querySelector('button:not(:disabled)');
    (first || dismiss).focus({ preventScroll:true }); first?.scrollIntoView({ block:'nearest' });
    search.addEventListener('input', renderOptions); dialog.addEventListener('keydown', moveFocus);
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    dialog.addEventListener('close', () => { if (current?.dialog === dialog) close(); });
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
    });
    optionsObserver.observe(select, { childList:true, subtree:true, attributes:true, characterData:true });
    pageObserver.observe(document.body, { childList:true, subtree:true, attributes:true, attributeFilter:['class','hidden','disabled','open'] });
    window.addEventListener('resize', position); window.addEventListener('scroll', position, true);
    window.visualViewport?.addEventListener('resize', position); window.visualViewport?.addEventListener('scroll', position);
  }
  const targetSelect = event => {
    const target = event.target;
    const trigger = target.closest?.('.app-select-trigger');
    const select = sources.get(trigger) || target.closest?.('select');
    if (select) return dropdown(select) ? select : null;
    // A label's default activation must not focus the original native control.
    if (target.closest?.('button,input,textarea,a')) return null;
    const labelled = target.closest?.('label')?.control;
    return labelled?.tagName === 'SELECT' && dropdown(labelled) ? labelled : null;
  };
  // Cover controls inserted in the same task, before the observer has run.
  for (const type of ['pointerdown','mousedown','touchstart']) document.addEventListener(type, event => {
    const select = event.target.closest?.('select');
    if (select && dropdown(select)) { event.preventDefault(); syncControl(select); }
  }, { capture:true, passive:false });
  // A tap produces one button click. Opening on touchend as well can reopen it.
  document.addEventListener('click', event => {
    const select = targetSelect(event); if (!select) return;
    event.preventDefault(); open(select);
  }, { capture:true, passive:false });
  document.addEventListener('keydown', event => {
    const select = targetSelect(event); if (!select || event.key === 'Tab' || event.ctrlKey || event.metaKey) return;
    if (['ArrowDown','ArrowUp','Enter',' ','F4','Home','End'].includes(event.key)) { event.preventDefault(); open(select); }
  }, true);
  for (const type of ['input','change']) document.addEventListener(type, event => {
    if (event.target.tagName === 'SELECT') syncControl(event.target);
  }, true);
  document.addEventListener('reset', event => setTimeout(() => scan(event.target), 0), true);
  new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'childList') { record.addedNodes.forEach(scan); record.removedNodes.forEach(scan); }
      const select = record.target.closest?.('select') || record.target.parentElement?.closest('select');
      if (select) syncControl(select);
      else if (record.type === 'attributes' && record.target.tagName === 'FIELDSET') scan(record.target);
    }
  }).observe(document.documentElement, {childList:true, subtree:true, characterData:true, attributes:true,
    attributeFilter:['disabled','hidden','class','style','multiple','size','label','selected','aria-label','aria-labelledby','title']});
  scan(document);
})();
