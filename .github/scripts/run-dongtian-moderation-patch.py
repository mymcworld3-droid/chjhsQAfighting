from pathlib import Path

api = Path('dongtian-api.js').read_text()
ui = Path('public/cultivation/dongtian.js').read_text()

if "/api/review-dongtian-question" in api and "dt-report-question" in ui:
    print('Dongtian moderation patch already applied; nothing to do.')
    raise SystemExit(0)

code = Path('.github/scripts/add-dongtian-moderation.py').read_text()
exec(compile(code, '.github/scripts/add-dongtian-moderation.py', 'exec'), {'__name__': '__main__'})
