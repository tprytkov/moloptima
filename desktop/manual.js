const fs = require('node:fs');
const path = require('node:path');

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function manualHeadingId(value) {
  return String(value || '')
    .replace(/^\s*\d+(?:\.\d+)*[.)]?\s+/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'section';
}

function inlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

function splitTableRow(line) {
  return line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
}

function renderMarkdownBody(markdown) {
  const lines = String(markdown || '').replaceAll('\r\n', '\n').split('\n');
  const html = [];
  const headings = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (line.startsWith('```')) {
      const language = line.slice(3).trim();
      const code = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith('```')) {
        code.push(lines[index]);
        index += 1;
      }
      index += index < lines.length ? 1 : 0;
      html.push(`<pre><code${language ? ` data-language="${escapeHtml(language)}"` : ''}>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const label = heading[2].trim();
      const baseId = manualHeadingId(label);
      let id = baseId;
      let suffix = 2;
      while (headings.some((entry) => entry.id === id)) {
        id = `${baseId}-${suffix}`;
        suffix += 1;
      }
      headings.push({ id, label: label.replace(/^\d+(?:\.\d+)*[.)]?\s+/, ''), level });
      html.push(`<h${level} id="${id}" tabindex="-1">${inlineMarkdown(label)}</h${level}>`);
      index += 1;
      continue;
    }

    if (line.includes('|') && index + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[index + 1])) {
      const header = splitTableRow(line);
      index += 2;
      const rows = [];
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        rows.push(splitTableRow(lines[index]));
        index += 1;
      }
      html.push('<div class="table-scroll"><table><thead><tr>');
      header.forEach((cell) => html.push(`<th scope="col">${inlineMarkdown(cell)}</th>`));
      html.push('</tr></thead><tbody>');
      rows.forEach((row) => {
        html.push('<tr>');
        header.forEach((_, cellIndex) => html.push(`<td>${inlineMarkdown(row[cellIndex] || '')}</td>`));
        html.push('</tr>');
      });
      html.push('</tbody></table></div>');
      continue;
    }

    const unordered = /^\s*-\s+(.+)$/.exec(line);
    const ordered = /^\s*\d+[.)]\s+(.+)$/.exec(line);
    if (unordered || ordered) {
      const tag = unordered ? 'ul' : 'ol';
      const pattern = unordered ? /^\s*-\s+(.+)$/ : /^\s*\d+[.)]\s+(.+)$/;
      html.push(`<${tag}>`);
      while (index < lines.length) {
        const item = pattern.exec(lines[index]);
        if (!item) break;
        html.push(`<li>${inlineMarkdown(item[1])}</li>`);
        index += 1;
      }
      html.push(`</${tag}>`);
      continue;
    }

    const paragraph = [line.trim()];
    index += 1;
    while (index < lines.length && lines[index].trim()
      && !/^(#{1,6})\s+/.test(lines[index])
      && !lines[index].startsWith('```')
      && !/^\s*-\s+/.test(lines[index])
      && !/^\s*\d+[.)]\s+/.test(lines[index])
      && !(lines[index].includes('|') && index + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[index + 1]))) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    html.push(`<p>${inlineMarkdown(paragraph.join(' '))}</p>`);
  }

  return { body: html.join('\n'), headings };
}

function buildManualHtml(markdown, initialSection = 'introduction') {
  const { body, headings } = renderMarkdownBody(markdown);
  const safeSection = manualHeadingId(initialSection);
  const toc = headings
    .filter(({ level }) => level === 2)
    .map(({ id, label }) => `<li><a href="#${id}">${escapeHtml(label)}</a></li>`)
    .join('');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
  <title>MolOptima User Manual</title>
  <style>
    :root { color-scheme: light; font-family: Arial, Helvetica, sans-serif; color: #15233b; background: #f4f7f9; }
    * { box-sizing: border-box; }
    body { margin: 0; line-height: 1.55; }
    .toolbar { position: sticky; top: 0; z-index: 10; display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 12px 20px; color: #fff; background: #145f74; }
    .toolbar strong { font-size: 15px; }
    .toolbar button { border: 1px solid #fff; border-radius: 5px; padding: 7px 14px; color: #fff; background: transparent; cursor: pointer; font-weight: 700; }
    .layout { display: grid; grid-template-columns: minmax(210px, 280px) minmax(0, 900px); justify-content: center; gap: 28px; padding: 24px; }
    nav { position: sticky; top: 76px; max-height: calc(100vh - 100px); overflow: auto; padding: 16px; border: 1px solid #ccd8df; border-radius: 8px; background: #fff; }
    nav h2 { margin-top: 0; font-size: 15px; }
    nav ol { margin: 0; padding-left: 22px; }
    nav li { margin: 5px 0; }
    nav a { color: #145f74; text-decoration: none; }
    main { min-width: 0; padding: 30px 42px; border: 1px solid #ccd8df; border-radius: 8px; background: #fff; box-shadow: 0 4px 16px rgba(21, 35, 59, 0.06); }
    h1 { margin-top: 0; font-size: 30px; }
    h2 { margin-top: 2.2em; padding-bottom: 6px; border-bottom: 2px solid #d8e4e9; font-size: 23px; }
    h3 { margin-top: 1.6em; font-size: 18px; }
    h1:focus, h2:focus, h3:focus { outline: 3px solid #e19a00; outline-offset: 4px; }
    p, li { max-width: 82ch; }
    code { padding: 1px 4px; border-radius: 3px; background: #eef3f5; font-family: Consolas, monospace; }
    pre { overflow: auto; padding: 14px; border-radius: 6px; color: #13202d; background: #eef3f5; }
    .table-scroll { max-width: 100%; overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 14px; }
    th, td { padding: 8px 10px; border: 1px solid #aebfc8; text-align: left; vertical-align: top; }
    th { background: #edf4f6; }
    @media (max-width: 800px) { .layout { grid-template-columns: 1fr; padding: 12px; } nav { position: static; max-height: none; } main { padding: 22px 18px; } }
    @media print {
      :root, body { color: #000; background: #fff; }
      .toolbar, nav { display: none !important; }
      .layout { display: block; padding: 0; }
      main { max-width: none; padding: 0; border: 0; box-shadow: none; }
      h1, h2, h3 { break-after: avoid; color: #000; }
      table, pre { break-inside: avoid; }
      .table-scroll { overflow: visible; }
      a { color: #000; text-decoration: none; }
    }
  </style>
</head>
<body>
  <div class="toolbar"><strong>MolOptima User Manual · Offline</strong><button type="button" onclick="window.print()">Print manual</button></div>
  <div class="layout">
    <nav aria-label="Manual sections"><h2>Contents</h2><ol>${toc}</ol></nav>
    <main>${body}</main>
  </div>
  <script>
    const target = document.getElementById(${JSON.stringify(safeSection)}) || document.querySelector('main h1, main h2');
    if (target) { target.scrollIntoView(); target.focus({ preventScroll: true }); }
  </script>
</body>
</html>`;
}

function resolveManualPath({ isPackaged, resourcesPath, projectRoot }) {
  return isPackaged
    ? path.join(resourcesPath, 'manual', 'MolOptima_User_Manual.md')
    : path.join(projectRoot, 'docs', 'MolOptima_User_Manual.md');
}

function readManual(manualPath) {
  if (!fs.existsSync(manualPath)) {
    return { ok: false, code: 'manual_missing', message: 'The offline user manual resource is unavailable.' };
  }
  try {
    return { ok: true, markdown: fs.readFileSync(manualPath, 'utf8') };
  } catch (error) {
    return { ok: false, code: 'manual_unreadable', message: `The offline user manual could not be read: ${error.message}` };
  }
}

module.exports = {
  buildManualHtml,
  escapeHtml,
  manualHeadingId,
  readManual,
  renderMarkdownBody,
  resolveManualPath,
};
