"use strict";

const QUIZ_SCORE_MODES = Object.freeze(["live", "popup", "separate"]);

function indiaDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { year: Number(value.year), month: Number(value.month), day: Number(value.day) };
}

function isoWeekKey(parts) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - weekday);
  const weekYear = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(weekYear, 0, 1));
  const week = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${weekYear}-W${String(week).padStart(2, "0")}`;
}

function scorePeriodIds(date = new Date()) {
  const parts = indiaDateParts(date);
  const dateKey = `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
  const monthKey = `${parts.year}-${String(parts.month).padStart(2, "0")}`;
  return {
    day: `day_${dateKey}`,
    week: `week_${isoWeekKey(parts)}`,
    month: `month_${monthKey}`,
    overall: "overall"
  };
}

function scoreRatio(row, scope = "integrated") {
  const data = scope === "integrated" ? row?.integrated : row?.modes?.[scope];
  const attempted = Math.max(0, Number(data?.attempted || 0));
  const correct = Math.max(0, Number(data?.correct || 0));
  return attempted ? correct / attempted : 0;
}

function scoreAttemptDelta(previous, correct) {
  const alreadyAttempted = !!previous;
  const alreadyCorrect = previous?.correct === true;
  return {
    attemptedDelta: alreadyAttempted ? 0 : 1,
    correctDelta: correct && !alreadyCorrect ? 1 : 0,
    answerAttempts: Math.max(0, Number(previous?.attempts || 0)) + 1
  };
}

function rankRows(rows, uid, scope = "integrated") {
  const ranked = (rows || [])
    .map((row) => ({
      uid: String(row.uid || ""),
      correct: Math.max(0, Number((scope === "integrated" ? row.integrated : row.modes?.[scope])?.correct || 0)),
      attempted: Math.max(0, Number((scope === "integrated" ? row.integrated : row.modes?.[scope])?.attempted || 0)),
      ratio: scoreRatio(row, scope)
    }))
    .filter((row) => row.attempted > 0)
    .sort((a, b) => b.ratio - a.ratio || b.correct - a.correct || a.attempted - b.attempted || a.uid.localeCompare(b.uid));
  const index = ranked.findIndex((row) => row.uid === uid);
  const current = index >= 0 ? ranked[index] : { uid, correct: 0, attempted: 0, ratio: 0 };
  const ahead = index > 0 ? ranked[index - 1] : null;
  let target = "Complete a quiz to enter this ranking.";
  if (index === 0) {
    target = "Keep your lead with another accurate answer.";
  } else if (ahead?.ratio >= 1) {
    target = "Aim for consecutive correct answers to match the next rank's accuracy.";
  } else if (ahead) {
    const required = Math.max(1, Math.floor(((ahead.ratio * current.attempted) - current.correct) / (1 - ahead.ratio)) + 1);
    target = `Target ${required} consecutive correct answer${required === 1 ? "" : "s"} to challenge the next rank.`;
  }
  return {
    rank: index >= 0 ? index + 1 : null,
    participants: ranked.length,
    correct: current.correct,
    attempted: current.attempted,
    percentage: current.attempted ? Math.round(current.ratio * 100) : 0,
    target
  };
}

function normalizeScoreMode(mode) {
  const value = String(mode || "").toLowerCase();
  return QUIZ_SCORE_MODES.includes(value) ? value : "";
}

module.exports = {
  QUIZ_SCORE_MODES,
  indiaDateParts,
  normalizeScoreMode,
  rankRows,
  scoreAttemptDelta,
  scorePeriodIds,
  scoreRatio
};
