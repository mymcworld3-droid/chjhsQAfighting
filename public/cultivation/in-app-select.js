// Keep native select values, form submission and existing change handlers.
// Only replace the picker, including for controls created after startup.
(() => {
  'use strict';
  if (window.__qaInAppSelectInstalled) return;
  window.__qaInAppSelectInstalled = true;
  let current = null, sequence = 0;
  const fields = new Map(), triggers = new WeakMap();
  const dropdown = select => select?.tagName === 'SELECT' && !select.multiple && select.size <= 1;
  const enabled = select => select.isConnected && !select.matches(':disabled') &&
    (fields.get(select)?.button || select).getClientRects().length;
  const setAttribute = (node, name, value) => {
    if (value === null) { if (node.hasAttribute(name)) node.removeAttribute(name); }
    else if (node.getAttribute(name) !== String(value)) node.setAttribute(name, String(value));
  };
  const appearance = ['color','background-color','border-top','border-right','border-bottom','border-left',
    'border-radius','padding-top','padding-right','padding-bottom','padding-left',
    'font-family','font-size','font-weight','line-height','letter-spacing','min-height'];
  function syncField(select) {
    const state = fields.get(select); if (!state) return;
    const { button } = state;
    if (select.nextElementSibling !== button) select.after(button);
    const classes = [...select.classList].filter(name => name !== 'app-select-native').join(' ');
    const desiredClass = (classes + ' app-select-trigger').trim();
    if (button.className !== desiredClass) button.className = desiredClass;
    if (!select.classList.contains('app-select-native')) select.classList.add('app-select-native');
    setAttribute(select, 'tabindex', '-1'); setAttribute(select, 'aria-hidden', 'true');
    setAttribute(select, 'inert', '');
    const style = getComputedStyle(select), hidden = select.hidden || style.display === 'none';
    if (button.hidden !== hidden) button.hidden = hidden;
    const disabled = select.matches(':disabled');
    if (button.disabled !== disabled) button.disabled = disabled;
    const selected = select.options[select.selectedIndex];
    const text = selected?.label || selected?.textContent || '請選擇';
    if (state.label.textContent !== text) state.label.textContent = text;
    setAttribute(button, 'aria-label', nameOf(select) + '：' + text);
    setAttribute(button, 'aria-describedby', select.getAttribute('aria-describedby'));
    setAttribute(button, 'aria-invalid', select.getAttribute('aria-invalid'));
    setAttribute(button, 'aria-required', select.required ? 'true' : null);
    // Copy inline sizing and the select's appearance, without copying its events or ID.
    for (const name of state.inlineKeys) {
      if (!select.style.getPropertyValue(name)) button.style.removeProperty(name);
    }
    state.inlineKeys = Array.from(select.style);
    for (const name of state.inlineKeys) {
      const value = select.style.getPropertyValue(name), priority = select.style.getPropertyPriority(name);
      if (button.style.getPropertyValue(name) !== value || button.style.getPropertyPriority(name) !== priority)
        button.style.setProperty(name, value, priority);
    }
    for (const name of appearance) {
      const value = style.getPropertyValue(name);
      if (button.style.getPropertyValue(name) !== value || button.style.getPropertyPriority(name) !== 'important')
        button.style.setProperty(name, value, 'important');
    }
  }
  function releaseField(select) {
    const state = fields.get(select); if (!state) return;
    if (current?.select === select) close(false);
    fields.delete(select); triggers.delete(state.button); state.button.remove();
    select.classList.remove('app-select-native');
    for (const [name, value] of state.attributes) setAttribute(select, name, value);
    for (const name of state.properties) delete select[name];
  }
  function enhance(select) {
    if (!dropdown(select) || !select.isConnected) { releaseField(select); return; }
    if (!fields.has(select)) {
      const button = document.createElement('button'), label = document.createElement('span');
      button.type = 'button'; label.className = 'app-select-value'; button.append(label);
      button.setAttribute('aria-haspopup', 'dialog'); button.setAttribute('aria-expanded', 'false');
      const attributes = ['tabindex','aria-hidden','inert'].map(name => [name, select.getAttribute(name)]);
      const properties = [], state = {button,label,attributes,properties,inlineKeys:[]};
      const tabIndex = select.getAttribute('tabindex'); if (tabIndex !== null) button.setAttribute('tabindex', tabIndex);
      fields.set(select, state); triggers.set(button, select);
      // Existing modules often assign .value without dispatching a change event.
      if (typeof HTMLSelectElement !== 'undefined') for (const name of ['value','selectedIndex']) {
        const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, name);
        if (!descriptor?.get || !descriptor.set || Object.hasOwn(select, name)) continue;
        Object.defineProperty(select, name, { configurable:true, enumerable:descriptor.enumerable,
          get(){return descriptor.get.call(this);},
          set(value){descriptor.set.call(this,value);syncField(this);}
        });
        properties.push(name);
      }
    }
    syncField(select); return fields.get(select)?.button;
  }
  function boot() {
    document.querySelectorAll('select').forEach(enhance);
    const pending = new Set(); let queued = false;
    const collect = node => {
      if (node?.nodeType !== 1) return;
      if (node.matches('.app-select-trigger,.app-select-menu') || node.closest('.app-select-menu')) return;
      if (node.tagName === 'SELECT') pending.add(node);
      const source = node.closest('select'); if (source) pending.add(source);
      node.querySelectorAll('select').forEach(select => pending.add(select));
    };
    const observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.type === 'childList') {
          for (const node of record.addedNodes) collect(node);
          const source = record.target.closest?.('select'); if (source) pending.add(source);
        } else collect(record.target.nodeType === 1 ? record.target : record.target.parentElement);
      }
      if (queued) return; queued = true;
      queueMicrotask(() => {
        queued = false;
        for (const select of fields.keys()) if (!select.isConnected || !dropdown(select)) releaseField(select);
        const list = [...pending]; pending.clear(); list.forEach(enhance);
      });
    });
    observer.observe(document.body, {subtree:true,childList:true,characterData:true,attributes:true,
      attributeFilter:['class','style','hidden','disabled','multiple','size','label','selected','value','required','aria-label','aria-labelledby','aria-describedby','aria-invalid','inert']});
    document.addEventListener('reset', () => queueMicrotask(() => fields.forEach((_, select) => syncField(select))), true);
    window.addEventListener('resize', () => fields.forEach((_, select) => syncField(select)), {passive:true});
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
    const target = state.trigger || state.select;
    for (const [name, value] of state.attributes) {
      if (value === null) target.removeAttribute(name); else target.setAttribute(name, value);
    }
    if (state.dialog.open) state.dialog.close();
    state.dialog.remove();
    if (restoreFocus && enabled(state.select)) target.focus({ preventScroll:true });
  }
  function position() {
    if (!current) return;
    const { select, dialog } = current;
    if (!enabled(select)) { close(false); return; }
    const view = window.visualViewport;
    const width = view?.width || innerWidth, height = view?.height || innerHeight;
    const left = view?.offsetLeft || 0, top = view?.offsetTop || 0;
    const rect = (current.trigger || select).getBoundingClientRect(), gap = 8;
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
    syncField(state.select);
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
    const trigger = enhance(select);
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
    const attributes = ['aria-haspopup','aria-expanded','aria-controls'].map(name => [name, trigger.getAttribute(name)]);
    const optionsObserver = new MutationObserver(renderOptions);
    const pageObserver = new MutationObserver(() => { if (current && !enabled(select)) close(false); });
    current = { select, trigger, dialog, search, list, attributes, optionsObserver, pageObserver };
    trigger.setAttribute('aria-expanded','true'); trigger.setAttribute('aria-controls',dialog.id);
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
    pageObserver.observe(document.body, { childList:true, subtree:true, attributes:true, attributeFilter:['class','hidden','disabled','open','inert'] });
    window.addEventListener('resize', position); window.addEventListener('scroll', position, true);
    window.visualViewport?.addEventListener('resize', position); window.visualViewport?.addEventListener('scroll', position);
  }
  const targetSelect = event => {
    const trigger = event.target.closest?.('.app-select-trigger');
    const select = triggers.get(trigger) || event.target.closest?.('select') || event.target.closest?.('label')?.control;
    return dropdown(select) ? select : null;
  };
  // Native controls are inert; visible buttons use a single click activation path.
  // Keep this guard for a select inserted and tapped before the observer runs.
  for (const type of ['pointerdown','mousedown','touchstart']) document.addEventListener(type, event => {
    if (dropdown(event.target.closest?.('select'))) event.preventDefault();
  }, { capture:true, passive:false });
  document.addEventListener('click', event => {
    const select = targetSelect(event); if (!select) return;
    event.preventDefault(); open(select);
  }, { capture:true, passive:false });
  document.addEventListener('keydown', event => {
    const select = targetSelect(event); if (!select || event.key === 'Tab' || event.ctrlKey || event.metaKey) return;
    if (['ArrowDown','ArrowUp','Enter',' ','F4','Home','End'].includes(event.key)) { event.preventDefault(); open(select); }
  }, true);
  document.addEventListener('input', event => { if (fields.has(event.target)) syncField(event.target); }, true);
  document.addEventListener('change', event => { if (fields.has(event.target)) syncField(event.target); }, true);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, {once:true});
  else boot();
})();
