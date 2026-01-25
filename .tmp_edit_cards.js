const fs = require(" fs\);
const path = \apps/server/index.js\;
const text = fs.readFileSync(path, \utf8\);
const eol = text.includes(\\\r\\n\) ? \\\r\\n\ : \\\n\;
const lines = text.split(/\\r?\\n/);
const out = [];
let inside = false;
let insideNext = false;
let skipBvidBlock = false;
let skipNextBvidDecl = false;
for (let i = 0; i < lines.length; i += 1) {
 const line = lines[i];
 if (line.includes('app.post(/api/cards')) {
 inside = true;
 }
 if (inside && line.includes('const next = {')) {
 insideNext = true;
 }
 if (insideNext && line.trim() === '};') {
 insideNext = false;
 }
 if (skipNextBvidDecl) {
 skipNextBvidDecl = false;
 if (line.trim().startsWith('const bvid = String(req.body?.bvid')) {
 continue;
 }
 }
 if (skipBvidBlock) {
 if (line.trim() === '}') {
 skipBvidBlock = false;
 }
 continue;
 }
 if (inside && line.trim().startsWith('const title = String(req.body?.title')) {
 out.push(line);
 out.push(' const source = String(req.body?.source || ).trim() || bilibili;');
    out.push('  const bvid = String(req.body?.bvid || ).trim();');
 out.push(' const localPath = String(req.body?.localPath || ).trim();');
    skipNextBvidDecl = true;
    continue;
  }
  if (inside && line.trim().startsWith('if (!bvid) {')) {
    const messageLine = lines[i + 1] || '    res.status(400).json({ ok: false, message: Please select a video source. });';
    out.push('  if (source === bilibili && !bvid) {');
    out.push(messageLine);
    out.push('    return;');
    out.push('  }');
    out.push('  if (source === local && !localPath) {');
    out.push('    res.status(400).json({ ok: false, message: Please select a local video. });');
    out.push('    return;');
    out.push('  }');
    skipBvidBlock = true;
    continue;
  }
  if (insideNext && line.trim() === 'title,') {
    out.push(line);
    out.push('    source,');
    out.push('    bvid: source === bilibili ? bvid : ,');
 out.push(' localPath: source === local ? localPath : ,');
    const nextLine = lines[i + 1] || '';
    if (nextLine.trim() === 'bvid,') {
      i += 1;
    }
    continue;
  }
  if (insideNext && line.trim().startsWith('visibility: req.body?.visibility')) {
    out.push(line);
    out.push('    localDuration: Number(req.body?.localDuration) || 0,');
    out.push('    localFileSize: Number(req.body?.localFileSize) || 0,');
    out.push('    localWidth: Number(req.body?.localWidth) || 0,');
    out.push('    localHeight: Number(req.body?.localHeight) || 0,');
    continue;
  }
  if (inside && line.trim() === '});') {
    inside = false;
  }
  out.push(line);
}
fs.writeFileSync(path, out.join(eol), \utf8\);
