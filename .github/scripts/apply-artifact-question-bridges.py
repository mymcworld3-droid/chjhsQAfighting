from pathlib import Path


def insert_once(path, marker, block, sentinel):
    text = path.read_text()
    if sentinel in text:
        return False
    if marker not in text:
        raise SystemExit(f'missing marker in {path}: {marker}')
    path.write_text(text.replace(marker, block + marker, 1))
    return True

battle = Path('public/cultivation/battle-mode-v2.js')
insert_once(
    battle,
    '  window.startBattleMatchmaking = startMatchmaking;\n',
    '''  // 法寶通用引擎只需要這個唯讀橋接，不必知道 Battle v2 的內部 state 結構。\n  window.getBattleArtifactQuestionContext = function () {\n    const room = state.room;\n    const question = room?.currentQuestion;\n    if (!room || !question || !state.roomId || !state.role) return null;\n    const mine = playerForRole(room, state.role);\n    const round = Number(room.round);\n    const answered = hasSubmittedAnswer(mine, round) || state.pendingAnswer?.round === round || room.status !== 'playing';\n    return {\n      context: 'battle',\n      key: `battle:${state.roomId}:${round}:${question.id}`,\n      correctIndex: Number(question.ans),\n      answered,\n      buttonsSelector: '#bv2-options .bv2-option',\n      containerSelector: '#bv2-options'\n    };\n  };\n\n''',
    'window.getBattleArtifactQuestionContext'
)

dongtian = Path('public/cultivation/dongtian.js')
insert_once(
    dongtian,
    '  window.renderDongtianHistoryLog = function (log, time) {\n',
    '''  // 法寶通用引擎只取得當前題目的安全索引，不接觸洞天其他流程。\n  window.getDongtianArtifactQuestionContext = function () {\n    const s = state.session;\n    const question = s?.dongtian?.questions?.[s.index];\n    if (!s || !question || !Array.isArray(s.currentOptions)) return null;\n    const correctIndex = s.currentOptions.findIndex((item) => item?.correct);\n    if (correctIndex < 0) return null;\n    return {\n      context: 'dongtian',\n      key: `dongtian:${s.runId}:${s.index}:${question.id}`,\n      correctIndex,\n      answered: !!s.answered,\n      buttonsSelector: '#dongtian-overlay [data-dt-answer]',\n      containerSelector: '#dt-options'\n    };\n  };\n\n''',
    'window.getDongtianArtifactQuestionContext'
)
