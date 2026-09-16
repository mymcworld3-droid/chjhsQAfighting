from pathlib import Path

p = Path('public/cultivation/five-immortals.js')
s = p.read_text()

css_marker = '.podium-container{display:flex;justify-content:center;align-items:flex-end;gap:6px;margin-top:48px;min-height:220px}'
help_css = '.five-immortals-head{position:relative;display:flex;align-items:center;justify-content:center;min-height:38px;padding:0 44px}.five-immortals-head h3{margin:0}.five-immortals-help{position:absolute;right:2px;top:50%;transform:translateY(-50%);width:32px;height:32px;padding:0;display:grid;place-items:center;border-radius:50%;border:1px solid rgba(216,177,93,.5);background:rgba(216,177,93,.08);color:#e8c66f;font-size:17px;font-weight:900;line-height:1;cursor:pointer;box-shadow:0 0 0 1px rgba(216,177,93,.05),0 8px 24px rgba(0,0,0,.28);transition:.18s ease}.five-immortals-help:hover,.five-immortals-help[aria-expanded="true"]{background:rgba(216,177,93,.18);border-color:rgba(232,198,111,.82);color:#fff0bd;box-shadow:0 0 18px rgba(216,177,93,.16)}.five-immortal-guide{margin:10px auto 0;max-width:720px;padding:12px;border:1px solid rgba(216,177,93,.16);border-radius:16px;background:rgba(216,177,93,.035)}.five-immortal-guide[hidden]{display:none}.five-immortal-guide>p{margin:0;color:#9b8c70;font-size:9px;text-align:center;line-height:1.75}.five-immortal-guide .five-immortal-rule{margin-top:10px}.five-immortal-guide .five-immortal-extra{margin-top:10px;color:#81755f;font-size:8px}' + css_marker
if '.five-immortals-help{' not in s:
    if css_marker not in s:
        raise SystemExit('CSS marker not found')
    s = s.replace(css_marker, help_css, 1)

old_html = 'box.innerHTML = `<h3>九州五大仙</h3><p>渡劫以上方可問鼎 · 國中程度連答 · 一錯即止 · 超越紀錄者登仙</p><div class="five-immortal-rule"><div><span>境界門檻</span><b>渡劫 · 3600 修為</b></div><div><span>問鼎方式</span><b>連續答對直到答錯</b></div><div><span>挑戰限制</span><b>無限次嘗試</b></div></div><div id="five-immortal-list" class="podium-container"></div><div id="five-immortal-lock" class="five-locked"></div>`;'
new_html = 'box.innerHTML = `<div class="five-immortals-head"><h3>九州五大仙</h3><button id="five-immortals-help" class="five-immortals-help" type="button" aria-label="查看五大仙遊戲方式" aria-expanded="false" title="遊戲方式">!</button></div><div id="five-immortals-guide" class="five-immortal-guide" hidden><p>渡劫以上方可問鼎 · 國中程度連答 · 一錯即止 · 超越紀錄者登仙</p><div class="five-immortal-rule"><div><span>境界門檻</span><b>渡劫 · 3600 修為</b></div><div><span>問鼎方式</span><b>連續答對直到答錯</b></div><div><span>挑戰限制</span><b>無限次嘗試</b></div></div><p class="five-immortal-extra">每一仙位對應固定科目；挑戰沒有總題數，也沒有次數限制。一路答到第一次答錯為止，只有嚴格超過目前紀錄才能奪位，同分不換榜；每名修士同時只能據有一席仙位。</p></div><div id="five-immortal-list" class="podium-container"></div><div id="five-immortal-lock" class="five-locked"></div>`;'
if old_html in s:
    s = s.replace(old_html, new_html, 1)
elif 'id="five-immortals-help"' not in s:
    raise SystemExit('mount HTML marker not found')

listener_marker = '      if (anchor) anchor.before(box); else rank.prepend(box);\n    }\n    render();'
listener_replacement = '''      if (anchor) anchor.before(box); else rank.prepend(box);
    }
    const helpButton = box.querySelector('#five-immortals-help');
    const guide = box.querySelector('#five-immortals-guide');
    if (helpButton && guide && helpButton.dataset.bound !== '1') {
      helpButton.dataset.bound = '1';
      helpButton.addEventListener('click', () => {
        guide.hidden = !guide.hidden;
        helpButton.setAttribute('aria-expanded', String(!guide.hidden));
      });
    }
    render();'''
if 'helpButton.dataset.bound' not in s:
    if listener_marker not in s:
        raise SystemExit('listener marker not found')
    s = s.replace(listener_marker, listener_replacement, 1)

p.write_text(s)

t = Path('tests/five-immortals-challenge.test.cjs')
ts = t.read_text()
if "hides game instructions behind a circular info button" not in ts:
    ts += '''\n\ntest('Five Immortals hides game instructions behind a circular info button', () => {\n  assert.match(source, /id=\\"five-immortals-help\\"/);\n  assert.match(source, /class=\\"five-immortals-help\\"/);\n  assert.match(source, /id=\\"five-immortals-guide\\"[\\s\\S]*hidden/);\n  assert.match(source, /guide\\.hidden = !guide\\.hidden/);\n  assert.match(source, /aria-expanded/);\n  assert.match(source, /同分不換榜/);\n  assert.match(source, /每名修士同時只能據有一席仙位/);\n});\n'''
    t.write_text(ts)
