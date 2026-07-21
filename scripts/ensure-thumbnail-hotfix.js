const fs = require('fs');

const indexFile = 'index.html';
let source = fs.readFileSync(indexFile, 'utf8');

const replacements = [
  [
    '.pl-item{position:relative;display:grid;grid-template-columns:minmax(132px,34%) minmax(0,1fr) auto;align-items:center;gap:.78rem;width:100%;min-height:112px;padding:.64rem .7rem;background:#fff;border:1px solid #e5e7eb;border-radius:12px;cursor:pointer;transition:border-color .15s,background .15s,transform .15s,box-shadow .15s;text-align:left}',
    '.pl-item{position:relative;display:grid;grid-template-columns:minmax(118px,30%) minmax(0,1fr) auto;align-items:center;gap:.65rem;width:100%;min-height:96px;padding:.52rem .6rem;background:#fff;border:1px solid #e5e7eb;border-radius:12px;cursor:pointer;transition:border-color .15s,background .15s,transform .15s,box-shadow .15s;text-align:left}'
  ],
  [
    '.pl-title{font-size:.94rem;font-weight:900;color:#1f2937;line-height:1.28;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
    '.pl-title{font-size:.88rem;font-weight:900;color:#1f2937;line-height:1.24;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}'
  ],
  [
    '.pl-desc{font-size:.78rem;color:#64748b;margin-top:.28rem;line-height:1.38;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}\n.pl-dur{font-size:.72rem;color:#64748b;margin-top:.28rem;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:800}',
    '.pl-desc{font-size:.74rem;color:#64748b;margin-top:.24rem;line-height:1.32;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}\n.pl-dur{font-size:.68rem;color:#64748b;margin-top:.24rem;line-height:1.22;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:800}'
  ],
  [
    '@media (min-width:641px){.pl-item .lesson-mini-thumb{width:100%;min-width:132px}.pl-item .lesson-mini-thumb img{object-fit:cover}}\n@media (max-width:640px){.course-viewer-header{grid-template-columns:1fr}.video-page{padding-left:.85rem;padding-right:.85rem}.pl-item{grid-template-columns:1fr;gap:.55rem;min-height:0;padding:.65rem}.pl-item .lesson-mini-thumb{width:100%;border-radius:10px}.pl-info{width:100%}.pl-play-icon{justify-self:start}.course-viewer-meta,.selected-lesson-meta{gap:.35rem}}',
    '@media (min-width:641px){.pl-item .lesson-mini-thumb{width:100%;min-width:118px}.pl-item .lesson-mini-thumb img{object-fit:cover}}\n@media (max-width:640px){.course-viewer-header{grid-template-columns:1fr}.video-page{padding-left:.85rem;padding-right:.85rem}.pl-item{grid-template-columns:1fr;gap:.48rem;min-height:0;padding:.58rem}.pl-item .lesson-mini-thumb{width:100%;height:clamp(160px,48vw,190px);aspect-ratio:16/9;border-radius:10px}.pl-info{width:100%}.pl-play-icon{justify-self:start}.course-viewer-meta,.selected-lesson-meta{gap:.35rem}}'
  ],
  [
    "return ['maxresdefault', 'hqdefault'].map(quality => youtubeThumbnailUrl(id, quality));",
    "return ['maxresdefault', 'hqdefault', 'mqdefault'].map(quality => youtubeThumbnailUrl(id, quality));"
  ]
];

let changed = false;
for (const [from, to] of replacements) {
  if (!source.includes(to) && source.includes(from)) {
    source = source.replace(from, to);
    changed = true;
  }
}

fs.writeFileSync(indexFile, source);
console.log(changed ? 'Thumbnail hotfix normalized intermediate CSS.' : 'Thumbnail hotfix already normalized.');
