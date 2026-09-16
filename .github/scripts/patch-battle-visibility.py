from pathlib import Path

css_path = Path('public/styles/battle-mode-v2.css')
css = css_path.read_text()
rule = '\n/* Only one Battle v2 phase may be visible at a time. */\n.battle-v2-page .hidden{display:none!important}\n'
if '.battle-v2-page .hidden{display:none!important}' not in css:
    css = css.rstrip() + rule
    css_path.write_text(css)

test_path = Path('tests/battle-v2.test.cjs')
test = test_path.read_text()
if "Battle v2 hidden phases cannot be overridden by phase display styles" not in test:
    test += '''\n\ntest('Battle v2 hidden phases cannot be overridden by phase display styles', () => {\n  assert.match(cssSource, /\\.battle-v2-page \\.hidden\\{display:none!important\\}/);\n  assert.match(battleSource, /classList\\.toggle\\('hidden', key !== name\\)/);\n});\n'''
    test_path.write_text(test)
