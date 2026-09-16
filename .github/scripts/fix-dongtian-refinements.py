from pathlib import Path

p = Path('public/cultivation/dongtian.js')
s = p.read_text()

# Raw creator material is generation input only. Do not persist the original text.
s = s.replace(
    "      await saveGeneratedDongtian(payload.dongtian, text, state.files.length);",
    "      await saveGeneratedDongtian(payload.dongtian, state.files.length);",
    1
)
s = s.replace(
    "  async function saveGeneratedDongtian(generated, sourceText, sourceImageCount) {",
    "  async function saveGeneratedDongtian(generated, sourceImageCount) {",
    1
)
s = s.replace(
    "      sourceText: String(sourceText || '').slice(0, 16000),\n",
    "",
    1
)

# The creator must be able to list every Dongtian they created.
s = s.replace(
    "query(collection(db, INDEX_COLLECTION), where('ownerUid', '==', uid()), limit(80))",
    "query(collection(db, INDEX_COLLECTION), where('ownerUid', '==', uid()))",
    1
)

# Match school subject families as well as exact labels.
old = """  function subjectMatches(caveSubject, practiceSubjects) {
    if (!caveSubject || caveSubject === '綜合') return true;
    if (practiceSubjects.includes('綜合')) return true;
    return practiceSubjects.includes(caveSubject);
  }
"""
new = """  function subjectFamily(subject) {
    const value = String(subject || '').trim();
    if (['自然', '生物理化', '物理', '化學', '生物'].includes(value)) return '自然';
    if (['社會', '歷史地理公民', '歷史', '地理', '公民'].includes(value)) return '社會';
    return value;
  }

  function subjectMatches(caveSubject, practiceSubjects) {
    if (!caveSubject || caveSubject === '綜合') return true;
    if (practiceSubjects.includes('綜合')) return true;
    const caveFamily = subjectFamily(caveSubject);
    return practiceSubjects.some((subject) => subject === caveSubject || subjectFamily(subject) === caveFamily);
  }
"""
if old not in s and 'function subjectFamily(subject)' not in s:
    raise SystemExit('subjectMatches block not found')
if old in s:
    s = s.replace(old, new, 1)

# Guard the expected refinements before writing.
if 'sourceText:' in s[s.index('async function saveGeneratedDongtian'):s.index('async function loadOwnDongtians')]:
    raise SystemExit('raw sourceText persistence remains')
if "where('ownerUid', '==', uid()), limit(80)" in s:
    raise SystemExit('owner list still capped')
if 'function subjectFamily(subject)' not in s:
    raise SystemExit('subject family matcher missing')

p.write_text(s)
