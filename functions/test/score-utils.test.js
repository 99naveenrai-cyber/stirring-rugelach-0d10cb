"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { rankRows, scoreAttemptDelta, scorePeriodIds } = require("../score-utils");

test("wrong retries count one attempted question and a later correct answer scores once", () => {
  assert.deepEqual(scoreAttemptDelta(null, false), { attemptedDelta: 1, correctDelta: 0, answerAttempts: 1 });
  assert.deepEqual(scoreAttemptDelta({ correct: false, attempts: 1 }, false), { attemptedDelta: 0, correctDelta: 0, answerAttempts: 2 });
  assert.deepEqual(scoreAttemptDelta({ correct: false, attempts: 2 }, true), { attemptedDelta: 0, correctDelta: 1, answerAttempts: 3 });
  assert.deepEqual(scoreAttemptDelta({ correct: true, attempts: 3 }, true), { attemptedDelta: 0, correctDelta: 0, answerAttempts: 4 });
});

test("score periods use the India calendar for day, week, month and overall", () => {
  const periods = scorePeriodIds(new Date("2026-08-09T18:45:00.000Z"));
  assert.deepEqual(periods, {
    day: "day_2026-08-10",
    week: "week_2026-W33",
    month: "month_2026-08",
    overall: "overall"
  });
});

test("integrated and individual quiz modes rank independently", () => {
  const rows = [
    { uid: "a", integrated: { correct: 8, attempted: 10 }, modes: { live: { correct: 2, attempted: 2 }, popup: { correct: 2, attempted: 4 }, separate: { correct: 4, attempted: 4 } } },
    { uid: "b", integrated: { correct: 6, attempted: 10 }, modes: { live: { correct: 3, attempted: 5 }, popup: { correct: 3, attempted: 5 } } }
  ];
  assert.equal(rankRows(rows, "a", "integrated").rank, 1);
  assert.equal(rankRows(rows, "a", "popup").rank, 2);
  assert.equal(rankRows(rows, "a", "separate").percentage, 100);
});

test("ranking target is based on consecutive correct answers needed to improve accuracy", () => {
  const rows = [
    { uid: "leader", integrated: { correct: 8, attempted: 10 } },
    { uid: "student", integrated: { correct: 6, attempted: 10 } }
  ];
  const student = rankRows(rows, "student", "integrated");
  assert.equal(student.rank, 2);
  assert.equal(student.participants, 2);
  assert.match(student.target, /11 consecutive correct answers/);
});

test("students without attempts receive an entry target without exposing peers", () => {
  const rank = rankRows([{ uid: "other", integrated: { correct: 1, attempted: 1 } }], "new-student", "integrated");
  assert.equal(rank.rank, null);
  assert.equal(rank.correct, 0);
  assert.equal(rank.target, "Complete a quiz to enter this ranking.");
});
