"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

test("active video stage exposes a responsive fullscreen control", () => {
  assert.match(source, /id="player-fullscreen-btn"/);
  assert.match(source, /onclick="toggleLessonFullscreen\(\)"/);
  assert.match(source, /navigationUI: 'hide'/);
  assert.match(source, /\.lesson-player-stage\.has-active-video \.player-fullscreen-btn\{display:grid\}/);
  assert.match(source, /\.lesson-player-stage:fullscreen/);
  assert.match(source, /classList\.toggle\('has-active-video', !!\(embedSrc \|\| nativeVideoUrl\)\)/);
});

test("fullscreen implementation supports standard, WebKit, and exit paths", () => {
  assert.match(source, /stage\.requestFullscreen/);
  assert.match(source, /stage\.webkitRequestFullscreen/);
  assert.match(source, /nativeVideo\?\.webkitEnterFullscreen/);
  assert.match(source, /document\.exitFullscreen/);
  assert.match(source, /document\.webkitExitFullscreen/);
  assert.match(source, /document\.addEventListener\('fullscreenchange', syncLessonFullscreenControls\)/);
  assert.match(source, /document\.addEventListener\('webkitfullscreenchange', syncLessonFullscreenControls\)/);
  assert.match(source, /exitLessonFullscreen\(\);\s*stopAndUnloadActiveLessonVideo\(\)/);
});

test("landscape Separate Quiz can fullscreen the complete split workspace", () => {
  assert.match(source, /id="separate-quiz-fullscreen-btn"/);
  assert.match(source, /onclick="toggleSeparateQuizFullscreen\(\)"/);
  assert.match(source, /workspace\.requestFullscreen\(\{ navigationUI: 'hide' \}\)/);
  assert.match(source, /workspace\.webkitRequestFullscreen\(\)/);
  assert.match(source, /\.separate-quiz-workspace:fullscreen/);
  assert.match(source, /orientation:landscape[\s\S]*separate-quiz-fullscreen-btn\{display:inline-flex/);
  assert.match(source, /button\.textContent = active \? '✕ Exit full page' : '⛶ Full page'/);
});

test("fullscreen controls stay minimal and popup video keeps a compact exit", () => {
  assert.match(source, /\.lesson-player-stage:fullscreen \.player-fullscreen-btn[^}]*\{display:none!important\}/);
  assert.match(source, /\.lesson-player-stage\.has-timed-quiz:fullscreen \.player-fullscreen-btn[^}]*\{display:grid!important;[^}]*width:36px;height:36px;[^}]*border-radius:50%/);
  assert.match(source, /\.separate-quiz-workspace:fullscreen \.separate-quiz-fullscreen-btn[^}]*\{display:none!important\}/);
  assert.match(source, /\.separate-quiz-workspace:fullscreen \.player-fullscreen-btn[^}]*\{display:none!important\}/);
});

test("rewinding re-arms timed questions without resetting awarded score", () => {
  assert.match(source, /function rearmTimedPopupQuestionsAfterRewind\(quizState, currentTime, previousTime\)/);
  assert.match(source, /currentTime \+ 0\.35 >= previousTime/);
  assert.match(source, /quizState\.answeredThisSession\.delete\(String\(item\.questionId\)\)/);
  assert.doesNotMatch(source, /rearmTimedPopupQuestionsAfterRewind[\s\S]{0,600}correctThisSession\.delete/);
  assert.match(source, /rearmTimedPopupQuestionsAfterRewind\(activeLessonQuiz, time, previousTime\)/);

  const functionStart = source.indexOf("function rearmTimedPopupQuestionsAfterRewind");
  const functionEnd = source.indexOf("\n}\n\nfunction maybeShowTimedPopupQuiz", functionStart) + 2;
  const resolver = new Function(`${source.slice(functionStart, functionEnd)}; return rearmTimedPopupQuestionsAfterRewind;`)();
  const state = {
    quizData: { popupQuiz: { timestamps: [
      { questionId: "q1", timeSeconds: 20 },
      { questionId: "q2", timeSeconds: 40 }
    ] } },
    answeredThisSession: new Set(["q1", "q2"]),
    correctThisSession: new Set(["q1", "q2"])
  };
  assert.equal(resolver(state, 10, 55), true);
  assert.deepEqual([...state.answeredThisSession], []);
  assert.deepEqual([...state.correctThisSession], ["q1", "q2"]);
});

test("quiz confetti is mounted inside the active fullscreen tree", () => {
  assert.match(source, /const fullscreenHost = lessonFullscreenElement\(\)/);
  assert.match(source, /const layerHost = fullscreenHost\?\.appendChild \? fullscreenHost : document\.body/);
  assert.match(source, /layerHost\.appendChild\(layer\)/);
});

test("user Play taps fullscreen the correct quiz workspace before loading video", () => {
  assert.match(source, /function requestQuizPlaybackFullscreen\(lesson\)/);
  assert.match(source, /if \(!separateQuiz && !popupQuiz\) return/);
  assert.match(source, /const target = separateQuiz[\s\S]*separate-quiz-workspace[\s\S]*lesson-player-stage/);
  assert.match(source, /window\.playLessonInFullscreen = \(idx, options = \{\}\) => \{[\s\S]*requestQuizPlaybackFullscreen\(lesson\);[\s\S]*window\.playFromPlaylist/);
  assert.match(source, /onclick="playLessonInFullscreen\(\$\{idx\}\)">Play Video/);
  assert.match(source, /onclick="\$\{canPlayLesson \? `playLessonInFullscreen\(\$\{i\}\)`/);
});

test("timed popup quiz enters and exits with controlled slow transitions", () => {
  assert.match(source, /transition:opacity 820ms[\s\S]*transform 880ms[\s\S]*filter 760ms/);
  assert.match(source, /\.popup-quiz-layer\.closing/);
  assert.match(source, /if \(layer\.dataset\.dismissing === 'true'\) return/);
  assert.match(source, /requestAnimationFrame\(\(\) => requestAnimationFrame\(\(\) => layer\.classList\.add\('show'\)\)\)/);
  assert.match(source, /activeLessonQuiz\.active = false;[\s\S]*player\.playVideo\(\);[\s\S]*\}, 900\)/);
});
