from pathlib import Path
import re

p = Path('.github/scripts/apply-polish-bundle.py')
s = p.read_text()
pattern = re.compile(r"# Click handler supports manage and repair before play\.[\s\S]*?# Encounter asks first, and encounter record is consumed even if declined\.")
replacement = r'''# Click handler keeps existing suspended-repair flow and inserts owner manage before play.
if 'openOwnerQuestionManager(manageButton.dataset.dtManage)' not in dt:
    play_marker = "      const button = event.target.closest('[data-dt-play]');\n      if (!button) return;"
    manage_insert = "      const manageButton = event.target.closest('[data-dt-manage]');\n      if (manageButton) {\n        manageButton.disabled = true;\n        await openOwnerQuestionManager(manageButton.dataset.dtManage).catch((error) => toast(error.message || '無法開啟題目管理'));\n        manageButton.disabled = false;\n        return;\n      }\n"
    dt = replace_once(dt, play_marker, manage_insert + play_marker, 'dongtian library manage handling')

# Encounter asks first, and encounter record is consumed even if declined.'''
new, count = pattern.subn(lambda _match: replacement, s, count=1)
if count != 1:
    raise SystemExit('could not patch apply-polish listener section')
p.write_text(new)
print('apply-polish script marker adjusted')
