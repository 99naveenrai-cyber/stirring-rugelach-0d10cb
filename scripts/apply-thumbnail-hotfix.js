const fs = require('fs');

function replaceOnce(file, search, replacement) {
  const before = fs.readFileSync(file, 'utf8');
  if (!before.includes(search)) {
    if (before.includes(replacement.trim().split('\n')[0])) return false;
    throw new Error(`${file}: expected snippet not found`);
  }
  fs.writeFileSync(file, before.replace(search, replacement));
  return true;
}

const functionsFile = 'functions/index.js';
const indexFile = 'index.html';

function replaceAllSafe(source, search, replacement) {
  return source.split(search).join(replacement);
}

function replaceSnippet(source, search, replacement) {
  if (source.includes(replacement)) return source;
  if (!source.includes(search)) {
    console.warn(`Skipping already-diverged snippet:\n${search.slice(0, 160)}`);
    return source;
  }
  return source.replace(search, replacement);
}

let functionsSource = fs.readFileSync(functionsFile, 'utf8');

functionsSource = functionsSource.replace(
  '  if (!url) return "";\n  if (/^(blob:|data:|file:)/i.test(url)) return "";',
  '  if (!url) return "";\n  if (isMissingThumbnailValue(url)) return "";\n  if (/^(blob:|data:|file:)/i.test(url)) return "";'
);
functionsSource = functionsSource.replace(
  '    if (isDirectYoutubeThumbnailHost(parsed.hostname) || /youtube\\.com$|youtube-nocookie\\.com$|youtu\\.be$/i.test(parsed.hostname)) return "";',
  '    if (!isDirectYoutubeThumbnailHost(parsed.hostname) && /youtube\\.com$|youtube-nocookie\\.com$|youtu\\.be$/i.test(parsed.hostname)) return "";'
);
if (!functionsSource.includes('function isMissingThumbnailValue(value)')) {
  functionsSource = functionsSource.replace(
    '\nfunction isDirectYoutubeThumbnailHost(hostname = "") {',
    '\nfunction isMissingThumbnailValue(value) {\n  const text = String(value || "").trim().toLowerCase();\n  return !text || text === "-" || text === "pending-repair" || text === "pending" || text === "null" || text === "undefined";\n}\n\nfunction isDirectYoutubeThumbnailHost(hostname = "") {'
  );
}
if (!functionsSource.includes('function youtubeThumbnailUrl(videoId')) {
  functionsSource = functionsSource.replace(
    '\nfunction protectedVideoIdFromContent(data) {',
    '\nfunction youtubeThumbnailUrl(videoId, quality = "maxresdefault") {\n  const id = extractYouTubeVideoId(videoId);\n  return id ? `https://img.youtube.com/vi/${id}/${quality}.jpg` : "";\n}\n\nfunction protectedVideoIdFromContent(data) {'
  );
}
functionsSource = functionsSource.replace(
  '    const courseThumb = publicContentThumbnail(data, fullVideoId);\n    const lessonThumb = publicLessonThumbnail(data, fullVideoId) || courseThumb;',
  '    const generatedThumb = youtubeThumbnailUrl(fullVideoId);\n    const courseThumb = publicContentThumbnail(data, fullVideoId) || generatedThumb;\n    const lessonThumb = publicLessonThumbnail(data, fullVideoId) || generatedThumb || courseThumb;'
);
fs.writeFileSync(functionsFile, functionsSource);

let indexSource = fs.readFileSync(indexFile, 'utf8');
indexSource = indexSource.replace(
  "  if (!url) return '';\n  if (/^(blob:|data:|file:)/i.test(url)) return '';",
  "  if (!url) return '';\n  const lowered = url.toLowerCase();\n  if (['-', 'pending-repair', 'pending', 'null', 'undefined'].includes(lowered)) return '';\n  if (/^(blob:|data:|file:)/i.test(url)) return '';"
);
indexSource = indexSource.replace("  if (/youtube\\.com|youtu\\.be|ytimg\\.com/i.test(url)) return '';\n", '');
indexSource = indexSource.replace(
  "  const fallback = img.dataset.fallback || imageFallbackUrl();\n  if (!img.dataset.warned) {",
  "  const fallback = img.dataset.fallback || imageFallbackUrl();\n  const hq = current.replace('/maxresdefault.jpg', '/hqdefault.jpg');\n  if (!img.dataset.warned) {"
);
indexSource = indexSource.replace(
  "  if (current !== fallback) {\n    img.src = fallback;\n    return;\n  }",
  "  if (current.includes('/maxresdefault.jpg') && hq !== current) {\n    img.src = hq;\n    return;\n  }\n  if (current !== fallback) {\n    img.src = fallback;\n    return;\n  }"
);

indexSource = replaceSnippet(
  indexSource,
  ".full-playlist{display:flex;flex-direction:column;gap:.24rem;max-height:min(58vh,560px);overflow-y:auto;overscroll-behavior:contain;scroll-behavior:smooth;overflow-anchor:none;padding:0 3px calc(var(--bottom-nav-height) + env(safe-area-inset-bottom) + 24px) 0;background:#f7f8fb;border:1px solid #e4e8f0;border-radius:12px}",
  ".full-playlist{display:flex;flex-direction:column;gap:.45rem;max-height:min(66vh,720px);overflow-y:auto;overscroll-behavior:contain;scroll-behavior:smooth;overflow-anchor:none;padding:0 5px calc(var(--bottom-nav-height) + env(safe-area-inset-bottom) + 28px) 0;background:#f7f8fb;border:1px solid #e4e8f0;border-radius:12px}"
);
indexSource = replaceSnippet(
  indexSource,
  ".lesson-section{background:#fff;border:1px solid #e4e8f0;border-radius:10px;padding:.4rem;margin:.35rem .35rem .28rem;box-shadow:0 6px 16px rgba(15,23,42,.045)}",
  ".lesson-section{background:#fff;border:1px solid #e4e8f0;border-radius:12px;padding:.55rem;margin:.45rem .45rem .36rem;box-shadow:0 6px 16px rgba(15,23,42,.045)}"
);
indexSource = replaceSnippet(
  indexSource,
  ".pl-item{display:flex;align-items:center;gap:.4rem;width:100%;min-height:44px;padding:.34rem .42rem;background:#fafafa;border:1px solid #e5e7eb;border-radius:8px;cursor:pointer;transition:border-color .15s,background .15s,transform .15s,box-shadow .15s}",
  ".pl-item{position:relative;display:grid;grid-template-columns:minmax(118px,30%) minmax(0,1fr) auto;align-items:center;gap:.65rem;width:100%;min-height:96px;padding:.52rem .6rem;background:#fff;border:1px solid #e5e7eb;border-radius:12px;cursor:pointer;transition:border-color .15s,background .15s,transform .15s,box-shadow .15s;text-align:left}"
);
indexSource = replaceSnippet(
  indexSource,
  ".pl-num{width:20px;height:20px;border-radius:50%;background:#edf2f7;color:#475569;font-size:.6rem;font-weight:900;display:flex;align-items:center;justify-content:center;flex-shrink:0}",
  ".pl-num{position:absolute;left:.45rem;top:.45rem;width:24px;height:24px;border-radius:50%;background:rgba(15,23,42,.78);color:#fff;font-size:.66rem;font-weight:900;display:flex;align-items:center;justify-content:center;z-index:2}"
);
indexSource = replaceSnippet(
  indexSource,
  ".pl-title{font-size:.75rem;font-weight:800;color:#1f2937;line-height:1.15;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}",
  ".pl-title{font-size:.88rem;font-weight:900;color:#1f2937;line-height:1.24;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}"
);
indexSource = replaceSnippet(
  indexSource,
  ".pl-dur{font-size:.62rem;color:#64748b;margin-top:1px;line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
  ".pl-desc{font-size:.74rem;color:#64748b;margin-top:.24rem;line-height:1.32;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}\n.pl-dur{font-size:.68rem;color:#64748b;margin-top:.24rem;line-height:1.22;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:800}"
);
indexSource = replaceSnippet(
  indexSource,
  ".pl-play-icon{font-size:.8rem;flex-shrink:0;opacity:.72;color:#64748b}",
  ".pl-play-icon{font-size:.78rem;flex-shrink:0;opacity:1;color:#1d4ed8;border:1px solid #bfdbfe;background:#eff6ff;border-radius:999px;padding:.38rem .62rem;font-weight:900}"
);
indexSource = replaceSnippet(
  indexSource,
  "@media (max-width:640px){.course-viewer-header{grid-template-columns:1fr}.video-page{padding-left:.85rem;padding-right:.85rem}.pl-item{align-items:center}.lesson-mini-thumb{width:48px}.course-viewer-meta,.selected-lesson-meta{gap:.35rem}}",
  "@media (min-width:641px){.pl-item .lesson-mini-thumb{width:100%;min-width:118px}.pl-item .lesson-mini-thumb img{object-fit:cover}}\n@media (max-width:640px){.course-viewer-header{grid-template-columns:1fr}.video-page{padding-left:.85rem;padding-right:.85rem}.pl-item{grid-template-columns:1fr;gap:.48rem;min-height:0;padding:.58rem}.pl-item .lesson-mini-thumb{width:100%;height:clamp(160px,48vw,190px);aspect-ratio:16/9;border-radius:10px}.pl-info{width:100%}.pl-play-icon{justify-self:start}.course-viewer-meta,.selected-lesson-meta{gap:.35rem}}"
);

indexSource = indexSource.replace(
  "  return ['maxresdefault', 'hqdefault'].map(quality => youtubeThumbnailUrl(id, quality));",
  "  return ['maxresdefault', 'hqdefault', 'mqdefault'].map(quality => youtubeThumbnailUrl(id, quality));"
);

indexSource = indexSource.replace(
  "    lesson.thumbnailVideoId || lesson.vid || lesson.videoId || lesson.youtubeVideoId || lesson.firstVideoId ||\n    lesson.videoUrl || lesson.youtubeUrl || lesson.url || ''",
  "    lesson.thumbnailVideoId || lesson.vid || lesson.videoId || lesson.youtubeVideoId || lesson.firstVideoId ||\n    lesson.contentId || lesson.lessonId || lesson.videoUrl || lesson.youtubeUrl || lesson.url || ''"
);
indexSource = indexSource.replace(
  "    lesson.vid || lesson.videoId || lesson.youtubeVideoId || lesson.firstVideoId ||\n    lesson.videoUrl || lesson.youtubeUrl || lesson.url || ''",
  "    lesson.vid || lesson.videoId || lesson.youtubeVideoId || lesson.firstVideoId ||\n    lesson.contentId || lesson.lessonId || lesson.videoUrl || lesson.youtubeUrl || lesson.url || ''"
);
indexSource = indexSource.replace(
  /lesson\.vid \|\| lesson\.videoId \|\| lesson\.youtubeVideoId \|\| lesson\.firstVideoId \|\|\r?\n\s*lesson\.videoUrl \|\| lesson\.youtubeUrl \|\| lesson\.url \|\| ''/,
  "lesson.vid || lesson.videoId || lesson.youtubeVideoId || lesson.firstVideoId ||\n    lesson.contentId || lesson.lessonId || lesson.videoUrl || lesson.youtubeUrl || lesson.url || ''"
);
indexSource = indexSource.replace(
  "  if (!accessRule?.locked && !lesson.vid && !lesson.playlistId) badges.push('<span class=\"lesson-badge locked\">Unavailable</span>');",
  "  if (!accessRule?.locked && !(lesson?.contentId || lesson?.lessonId || lesson?.vid || lesson?.playlistId)) badges.push('<span class=\"lesson-badge locked\">Unavailable</span>');"
);
indexSource = indexSource.replace(
  "            const visibleLesson = safePlaylistLessonForViewer(lesson, accessRule);\n          return `\n            <button type=\"button\" class=\"pl-item locked\" onclick=\"showLockedLessonPrompt('${course.id}')\">\n              ${renderThumbFrame({ src: getLessonThumbnail(visibleLesson) || getCourseThumbnail(course), alt: `${visibleLesson.title || 'Lesson'} thumbnail`, mini: true, fallback: 'Ã¢â€“Â¶', courseId: course.id })}",
  "            const visibleLesson = safePlaylistLessonForViewer(lesson, accessRule);\n          const thumbSrc = getLessonThumbnail(lesson) || getLessonThumbnail(visibleLesson) || getCourseThumbnail(course);\n          return `\n            <button type=\"button\" class=\"pl-item locked\" onclick=\"showLockedLessonPrompt('${course.id}')\">\n              ${renderThumbFrame({ src: thumbSrc, alt: `${visibleLesson.title || 'Lesson'} thumbnail`, mini: true, fallback: 'Ã¢â€“Â¶', courseId: course.id })}"
);
indexSource = indexSource.replace(
  "                <div class=\"pl-title\">${escapeHtml(visibleLesson.title || 'Untitled lesson')}</div>\n                <div class=\"pl-dur\">Ã¢ÂÂ± ${escapeHtml(lessonDuration(visibleLesson) || 'Duration not set')}</div>",
  "                <div class=\"pl-title\">${escapeHtml(visibleLesson.title || 'Untitled lesson')}</div>\n                ${visibleLesson.desc ? `<div class=\"pl-desc\">${escapeHtml(visibleLesson.desc)}</div>` : ''}\n                <div class=\"pl-dur\">Ã¢ÂÂ± ${escapeHtml(lessonDuration(visibleLesson) || 'Duration not set')}</div>"
);

if (!indexSource.includes('function ensureYouTubeIframeApi()')) {
  indexSource = indexSource.replace(
    '\nasync function openVideoPlayer(course, startIdx, meta = {}) {',
    '\nlet youtubeIframeApiPromise = null;\n\nfunction ensureYouTubeIframeApi() {\n  if (window.YT?.Player) return Promise.resolve(window.YT);\n  if (youtubeIframeApiPromise) return youtubeIframeApiPromise;\n  youtubeIframeApiPromise = new Promise((resolve, reject) => {\n    const previousReady = window.onYouTubeIframeAPIReady;\n    window.onYouTubeIframeAPIReady = () => {\n      if (typeof previousReady === "function") previousReady();\n      resolve(window.YT);\n    };\n    const script = document.createElement("script");\n    script.src = "https://www.youtube.com/iframe_api";\n    script.async = true;\n    script.onerror = () => reject(new Error("youtube_iframe_api_failed"));\n    document.head.appendChild(script);\n  });\n  return youtubeIframeApiPromise;\n}\n\nfunction destroyActiveLessonPlayer() {\n  try {\n    window._activeLessonPlayer?.destroy?.();\n  } catch (error) {\n    console.warn("[IdeaKDC player] previous player cleanup skipped", error?.message || error);\n  }\n  window._activeLessonPlayer = null;\n}\n\nasync function openVideoPlayer(course, startIdx, meta = {}) {'
  );
}
if (!indexSource.includes('const startNextLessonAfterEnd = (currentIdx) =>')) {
  indexSource = indexSource.replace(
    "  const allowed = getLessonAccessRule(course, startIdx, access).canPlay === true;",
    "  const nextPlayableLessonIndex = (currentIdx) => {\n    for (let i = currentIdx + 1; i < videos.length; i++) {\n      const nextLesson = videos[i];\n      const nextRule = getLessonAccessRule(course, i, access);\n      if ((nextLesson?.contentId || nextLesson?.lessonId) && nextRule.canPlay) return i;\n    }\n    return -1;\n  };\n  const startNextLessonAfterEnd = (currentIdx) => {\n    const nextIdx = nextPlayableLessonIndex(currentIdx);\n    if (nextIdx < 0) return;\n    showToast('Next lesson starting...', 'success');\n    window.clearTimeout(window._nextLessonTimer);\n    window._nextLessonTimer = window.setTimeout(() => {\n      window.playFromPlaylist(nextIdx, { autoplay: true });\n    }, 3000);\n  };\n  const allowed = getLessonAccessRule(course, startIdx, access).canPlay === true;"
  );
}
indexSource = indexSource.replace(
  "            const visibleLesson = safePlaylistLessonForViewer(v, accessRule);\n            return `\n              <button type=\"button\" class=\"pl-item ${i===activeIdx?'playing':''} ${canPlayLesson?'':'locked'}\"\n                onclick=\"${canPlayLesson ? `playFromPlaylist(${i})` : `showLockedLessonPrompt('${course.id}')`}\" ${v.contentId || v.lessonId ? '' : 'disabled'}>\n                ${renderThumbFrame({ src: getLessonThumbnail(visibleLesson) || getCourseThumbnail(course), alt: `${visibleLesson.title || 'Lesson'} thumbnail`, mini: true, fallback: 'Ã¢â€“Â¶', courseId: course.id })}",
  "            const visibleLesson = safePlaylistLessonForViewer(v, accessRule);\n            const thumbSrc = getLessonThumbnail(v) || getLessonThumbnail(visibleLesson) || getCourseThumbnail(course);\n            return `\n              <button type=\"button\" class=\"pl-item ${i===activeIdx?'playing':''} ${canPlayLesson?'':'locked'}\"\n                onclick=\"${canPlayLesson ? `playFromPlaylist(${i})` : `showLockedLessonPrompt('${course.id}')`}\" ${v.contentId || v.lessonId ? '' : 'disabled'}>\n                ${renderThumbFrame({ src: thumbSrc, alt: `${visibleLesson.title || 'Lesson'} thumbnail`, mini: true, fallback: 'Ã¢â€“Â¶', courseId: course.id })}"
);
indexSource = indexSource.replace(
  "                  ${visibleLesson.desc ? `<div class=\"pl-dur\">${escapeHtml(visibleLesson.desc)}</div>` : ''}",
  "                  ${visibleLesson.desc ? `<div class=\"pl-desc\">${escapeHtml(visibleLesson.desc)}</div>` : ''}"
);
indexSource = indexSource.replace(
  "  window.playFromPlaylist = async (idx) => {",
  "  window.playFromPlaylist = async (idx, options = {}) => {"
);
indexSource = indexSource.replace(
  "? `https://www.youtube.com/embed/${selectedVideoId}?rel=0&playsinline=1&enablejsapi=1&origin=${origin}`",
  "? `https://www.youtube.com/embed/${selectedVideoId}?rel=0&playsinline=1&enablejsapi=1&origin=${origin}&autoplay=1`"
);
indexSource = indexSource.replace(
  "          allow=\"accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture\"",
  "          allow=\"accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture\""
);
if (!indexSource.includes('new YT.Player(iframeId')) {
  indexSource = indexSource.replace(
    "    document.getElementById('video-wrap').innerHTML = embedSrc",
    "    destroyActiveLessonPlayer();\n    window.clearTimeout(window._nextLessonTimer);\n    document.getElementById('video-wrap').innerHTML = embedSrc"
  );
  indexSource = indexSource.replace(
    "    document.getElementById('video-title').textContent = '';",
    "    if (embedSrc) {\n      ensureYouTubeIframeApi()\n        .then((YT) => {\n          window._activeLessonPlayer = new YT.Player(iframeId, {\n            events: {\n              onStateChange: (event) => {\n                if (event.data === YT.PlayerState.ENDED) startNextLessonAfterEnd(idx);\n              },\n              onReady: (event) => {\n                try { event.target.playVideo(); } catch (_) {}\n              }\n            }\n          });\n        })\n        .catch((error) => console.warn('[IdeaKDC player] YouTube ended hook unavailable', error?.message || error));\n    }\n    document.getElementById('video-title').textContent = '';"
  );
}

fs.writeFileSync(indexFile, indexSource);

console.log('Thumbnail hotfix applied without Firebase Storage.');
