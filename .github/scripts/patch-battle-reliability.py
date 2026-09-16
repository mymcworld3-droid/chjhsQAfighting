from pathlib import Path

p = Path('public/cultivation/battle-mode-v2.js')
s = p.read_text()

if 'MATCH_SCAN_LIMIT = 80' not in s:
    s = s.replace(
        "  const MATCH_RECONCILE_MS = 1100;\n  const INTRO_DURATION_MS = 4800;",
        "  const MATCH_RECONCILE_MS = 1100;\n  const MATCH_SCAN_LIMIT = 80;\n  const INTRO_DURATION_MS = 4800;",
        1
    )

if 'function hasSubmittedAnswer' not in s:
    s = s.replace(
        "  function answerObject(player, round) {\n    if (!player || Number(player.answerRound) !== Number(round) || typeof player.answerCorrect !== 'boolean') return null;",
        "  function hasSubmittedAnswer(player, round) {\n    return !!player && Number(player.answerRound) === Number(round) && typeof player.answerCorrect === 'boolean';\n  }\n\n  function answerObject(player, round) {\n    if (!hasSubmittedAnswer(player, round)) return null;",
        1
    )

s = s.replace("where('status', '==', 'waiting'), limit(20)", "where('status', '==', 'waiting'), limit(MATCH_SCAN_LIMIT)")

if 'function scheduleReconcile' not in s:
    marker = "  async function reconcileOwnWaitingRoom() {"
    scheduler = """  function scheduleReconcile(delay = MATCH_RECONCILE_MS) {
    if (state.reconcile || state.role !== 'host' || !state.roomId) return;
    state.reconcile = setTimeout(async () => {
      state.reconcile = null;
      await reconcileOwnWaitingRoom();
      // 只要仍在自己的等待房，就持續尋找另一個同時建立的等待房。
      // 修正兩名玩家同時按配對、各自成為房主後永久互相等不到的情況。
      if (state.roomId && state.role === 'host' && state.room?.status === 'waiting') scheduleReconcile();
    }, delay);
  }

"""
    if marker not in s:
        raise SystemExit('reconcile marker not found')
    s = s.replace(marker, scheduler + marker, 1)

start = s.index("  async function submitAnswer(choice) {")
end = s.index("\n  async function timeoutMissingAnswer(room) {", start)
if 'const submitted = await runTransaction' not in s[start:end]:
    new_submit = """  async function submitAnswer(choice) {
    if (!state.roomId || !state.role || state.room?.status !== 'playing') return;
    const round = Number(state.room.round);
    const mine = playerForRole(state.room, state.role);
    if (hasSubmittedAnswer(mine, round) || state.pendingAnswer?.round === round) return;
    const questionId = state.room.currentQuestion?.id;
    if (!questionId) return;

    state.pendingAnswer = { round, choice };
    renderQuestion(state.room, mine);
    try {
      const submitted = await runTransaction(db(), async (tx) => {
        const ref = roomRef();
        const snap = await tx.get(ref);
        if (!snap.exists()) return false;
        const room = snap.data();
        if (room.status !== 'playing' || Number(room.round) !== round || room.currentQuestion?.id !== questionId) return false;
        const player = playerForRole(room, state.role);
        if (hasSubmittedAnswer(player, round)) return false;

        const other = playerForRole(room, otherRole(state.role));
        const otherAnswered = hasSubmittedAnswer(other, round);
        const patch = {
          [`${state.role}.answerChoice`]: choice,
          [`${state.role}.answerCorrect`]: Number(choice) === Number(room.currentQuestion.ans),
          [`${state.role}.answerAt`]: serverTimestamp(),
          [`${state.role}.answerClientAt`]: nowMs(),
          [`${state.role}.answerRound`]: round,
          [`${state.role}.timedOut`]: false,
          [`${state.role}.lastSeenAtMs`]: nowMs(),
          updatedAt: serverTimestamp()
        };
        // 關鍵規則：題目本身不倒數；第一位玩家提交答案後，才建立 25 秒應答窗。
        if (!otherAnswered && !room.answerWindowStartedAt && !room.answerWindowStartedAtMs) {
          patch.answerWindowStartedAt = serverTimestamp();
          patch.answerWindowStartedAtMs = nowMs();
          patch.firstAnswerUid = me().uid;
        }
        tx.update(ref, patch);
        return true;
      });

      // transaction 無動作時解除本機鎖定，避免答案按鈕永久卡住。
      if (!submitted) {
        state.pendingAnswer = null;
        if (state.room) renderQuestion(state.room, playerForRole(state.room, state.role));
      }
    } catch (error) {
      state.pendingAnswer = null;
      if (state.room) renderQuestion(state.room, playerForRole(state.room, state.role));
      console.error('[Battle v2] answer submit failed:', error);
      toast('答案送出失敗，請再點一次。');
    }
  }
"""
    s = s[:start] + new_submit + s[end:]

s = s.replace(
    "    const hostAnswered = !!answerObject(room.host, round); const guestAnswered = !!answerObject(room.guest, round);",
    "    const hostAnswered = hasSubmittedAnswer(room.host, round); const guestAnswered = hasSubmittedAnswer(room.guest, round);",
    1
)
s = s.replace(
    "        const h = !!answerObject(fresh.host, round); const g = !!answerObject(fresh.guest, round); if (h === g) return;",
    "        const h = hasSubmittedAnswer(fresh.host, round); const g = hasSubmittedAnswer(fresh.guest, round); if (h === g) return;",
    1
)

old_tick = """      const hostAnswer = answerObject(room.host, room.round); const guestAnswer = answerObject(room.guest, room.round);
      if (hostAnswer && guestAnswer) settleRound(room);
      else if (hostAnswer || guestAnswer) {"""
new_tick = """      const hostSubmitted = hasSubmittedAnswer(room.host, room.round);
      const guestSubmitted = hasSubmittedAnswer(room.guest, room.round);
      const hostAnswer = answerObject(room.host, room.round);
      const guestAnswer = answerObject(room.guest, room.round);
      if (hostSubmitted && guestSubmitted) {
        // 等 Firestore serverTimestamp 落地後再用伺服器時間判定速度。
        if (hostAnswer && guestAnswer) settleRound(room);
      } else if (hostSubmitted || guestSubmitted) {"""
if old_tick not in s:
    raise SystemExit('tick answer block not found')
s = s.replace(old_tick, new_tick, 1)

s = s.replace(
    "    if (room.status === 'waiting') renderLobby(room); else if (room.status === 'intro') renderIntro(room);",
    "    if (room.status === 'waiting') { renderLobby(room); if (state.role === 'host') scheduleReconcile(); } else if (room.status === 'intro') renderIntro(room);",
    1
)
s = s.replace(
    "state.role = 'host'; subscribeRoom(created); state.reconcile = setTimeout(reconcileOwnWaitingRoom, MATCH_RECONCILE_MS);",
    "state.role = 'host'; subscribeRoom(created); scheduleReconcile();",
    1
)

p.write_text(s)

t = Path('tests/battle-v2.test.cjs')
ts = t.read_text()
if 'keeps reconciling simultaneous waiting rooms' not in ts:
    ts += """

test('Battle v2 keeps reconciling simultaneous waiting rooms and scans a wider waiting-room window', () => {
  assert.match(battleSource, /MATCH_SCAN_LIMIT = 80/);
  assert.match(battleSource, /function scheduleReconcile/);
  assert.match(battleSource, /limit\\(MATCH_SCAN_LIMIT\\)/);
  assert.match(battleSource, /同時按配對/);
});

test('Battle v2 never leaves answer buttons locked after a no-op transaction', () => {
  assert.match(battleSource, /function hasSubmittedAnswer/);
  assert.match(battleSource, /const submitted = await runTransaction/);
  assert.match(battleSource, /if \\(!submitted\\)/);
  assert.match(battleSource, /state\\.pendingAnswer = null/);
  assert.match(battleSource, /serverTimestamp 落地後/);
});
"""
t.write_text(ts)
