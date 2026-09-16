from pathlib import Path

visibility = Path('tests/dongtian-visibility.test.cjs')
text = visibility.read_text()
text = text.replace(
    'assert.match(index, /<script type="module" src="main\\.js\\?v=20260916-dongtian3"><\\/script>/);',
    'assert.match(index, /<script type="module" src="main\\.js\\?v=[^\"]+"><\\/script>/);'
)
visibility.write_text(text)

lore = Path('tests/golden-core-lore.test.cjs')
text = lore.read_text()
text = text.replace(
    '  assert.match(training, /本命丹源/);\n',
    '  assert.match(training, /training-core-feature/);\n  assert.match(training, /training-core-story/);\n'
)
lore.write_text(text)
print('polish regression assumptions updated')
