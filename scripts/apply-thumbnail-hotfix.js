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
fs.writeFileSync(indexFile, indexSource);

console.log('Thumbnail hotfix applied without Firebase Storage.');
