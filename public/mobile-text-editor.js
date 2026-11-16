// The game iframe has a fixed logical size. Put the editor in the outer page
// so its position follows the device viewport without moving the game.
(() => {
  'use strict';
  let host = window;
  try {
    if (window.frameElement?.id === 'game-frame' && window.parent.document.body) host = window.parent;
  } catch (_) { /* Use the current page if embedding prevents access. */ }

  const hostDocument = host.document;
  const viewport = host.visualViewport;
  const scopes = '#scope-studio, #quiz-helper-panel, .quiz-helper-panel, #dongtian-overlay, .dt-modal, #page-teacher-dongtian, #dt-source-text, #dt-shared-code';
  const fields = 'textarea, input:not([type]), input[type="text"], input[type="search"], input[type="url"], input[type="email"], input[type="tel"]';
  let touchField, active, frame, unlockTimer;

  function getField(event) {
    const field = event.target.closest?.(fields);
    return field?.closest(scopes) && !field.disabled && !field.readOnly ? field : null;
  }

  function finish(session) {
    if (active !== session) return;
    active = null;
    session.sync();
    if (session.dock.hidePopover && session.dock.matches(':popover-open')) session.dock.hidePopover();
    session.dock.remove();
    host.cancelAnimationFrame(frame);
    frame = 0;
    unlockTimer = window.setTimeout(() => host.QAGameStage?.setKeyboardEditing(false), 350);
  }

  function position() {
    frame = 0;
    if (!active) return;
    const { dock, field, baseline } = active;
    if (!field.isConnected || !field.getClientRects().length) {
      finish(active);
      return;
    }
    const height = viewport?.height ?? host.innerHeight;
    const bottom = (viewport?.offsetTop ?? 0) + height;
    const left = viewport?.offsetLeft ?? 0;
    const width = viewport?.width ?? host.innerWidth;
    if (baseline - height > 100) active.keyboardSeen = true;
    if (active.keyboardSeen && baseline - height < 40) {
      finish(active);
      return;
    }
    Object.assign(dock.style, {
      top: Math.round(bottom) + 'px',
      left: Math.round(left + width / 2) + 'px',
      width: Math.max(0, Math.min(680, width - 20)) + 'px'
    });
  }

  function schedule() {
    if (active && !frame) frame = host.requestAnimationFrame(position);
  }

  function open(field) {
    if (active?.field === field) {
      active.editor.focus({ preventScroll: true });
      return;
    }
    if (active) finish(active);
    clearTimeout(unlockTimer);
    host.QAGameStage?.setKeyboardEditing(true);
    const dock = hostDocument.createElement('div');
    dock.id = 'qa-mobile-text-editor';
    dock.setAttribute('popover', 'manual');
    dock.style.cssText = 'position:fixed;inset:auto;margin:0;transform:translate(-50%,-100%);z-index:2147483647;box-sizing:border-box;display:flex;align-items:end;gap:8px;padding:8px;margin-top:-8px;border:1px solid #86cfc4;border-radius:12px;background:#142321;color:#fff;box-shadow:0 4px 24px #0009';
    const editor = hostDocument.createElement(field.tagName === 'TEXTAREA' ? 'textarea' : 'input');
    editor.style.cssText = 'box-sizing:border-box;flex:1;min-width:0;min-height:44px;max-height:88px;resize:none;padding:8px;background:#091315;color:#fff;border:1px solid #86cfc4;border-radius:8px;font:16px/1.35 system-ui';
    if (editor.tagName === 'TEXTAREA') editor.rows = 2;
    if (field.maxLength >= 0) editor.maxLength = field.maxLength;
    editor.inputMode = field.inputMode || ({ email: 'email', url: 'url', tel: 'tel', search: 'search' })[field.type] || 'text';
    editor.placeholder = field.placeholder;
    editor.value = field.value;
    editor.setAttribute('aria-label', field.getAttribute('aria-label') || field.labels?.[0]?.textContent.trim() || field.placeholder || '輸入文字');
    const done = hostDocument.createElement('button');
    done.type = 'button';
    done.textContent = '完成';
    done.style.cssText = 'flex:none;min-height:44px;padding:0 14px;color:#10221c;background:#a6d9c5;border:0;border-radius:8px;font:16px system-ui';
    dock.append(editor, done);
    const mount = host === window ? field.closest('dialog[open]') || hostDocument.body : hostDocument.body;
    mount.append(dock);
    const sync = () => {
      if (!field.isConnected || field.value === editor.value) return;
      field.value = editor.value;
      field.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const session = { dock, field, editor, sync, baseline: viewport?.height ?? host.innerHeight };
    active = session;
    position();
    dock.showPopover?.();
    editor.addEventListener('input', event => { if (!event.isComposing) sync(); });
    editor.addEventListener('compositionend', sync);
    done.addEventListener('click', () => finish(session));
    dock.addEventListener('focusout', () => {
      window.setTimeout(() => {
        if (!dock.contains(hostDocument.activeElement)) finish(session);
      }, 0);
    });
    editor.addEventListener('keydown', event => {
      if ((event.key === 'Enter' && editor.tagName === 'INPUT' || event.key === 'Escape') && !event.isComposing && event.keyCode !== 229) {
        event.preventDefault();
        event.stopPropagation();
        finish(session);
      }
    });
    editor.focus({ preventScroll: true });
    editor.setSelectionRange(editor.value.length, editor.value.length);
  }

  document.addEventListener('pointerdown', event => {
    touchField = event.pointerType === 'touch' || event.pointerType === 'pen' ? getField(event) : null;
    if (touchField) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);
  document.addEventListener('click', event => {
    const field = getField(event);
    const touch = event.pointerType === 'touch' || event.pointerType === 'pen' || field && field === touchField;
    touchField = null;
    if (!field || !touch) return;
    event.preventDefault();
    open(field);
  }, true);
  viewport?.addEventListener('resize', schedule, { passive: true });
  viewport?.addEventListener('scroll', schedule, { passive: true });
  host.addEventListener('resize', schedule, { passive: true });
  window.addEventListener('pagehide', () => { if (active) finish(active); });
})();
