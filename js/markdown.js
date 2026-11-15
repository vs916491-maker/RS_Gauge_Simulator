/*
 * Small Markdown renderer for METHOD.md (headings, paragraphs, lists, tables, code blocks,
 * block quotes, rules, **bold**, *italic*, `code`). Builds DOM nodes with textContent only,
 * so it never injects HTML. parseBlocks() is DOM-free (testable in Node).
 * Attaches to RSGAUGE.markdown.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  else { root.RSGAUGE = root.RSGAUGE || {}; root.RSGAUGE.markdown = api; }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function slug(t) { return t.toLowerCase().replace(/`/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
  function isTableSep(l) { return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l) && l.indexOf('|') >= 0; }
  function splitRow(l) { return l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(function (c) { return c.trim(); }); }
  var LIST_RE = /^(\s*)([*-]|\d+\.)\s+(.*)$/;

  function parseBlocks(text) {
    var lines = text.replace(/\r\n?/g, '\n').split('\n'), i = 0, out = [], m, used = {};
    function startsBlock(l) { return /^(#{1,6})\s/.test(l) || /^```/.test(l) || /^\s*---+\s*$/.test(l) || /^>\s?/.test(l) || LIST_RE.test(l); }
    while (i < lines.length) {
      var l = lines[i];
      if (/^\s*$/.test(l)) { i++; continue; }
      if (/^```/.test(l)) {
        var code = []; i++;
        while (i < lines.length && !/^```/.test(lines[i])) { code.push(lines[i]); i++; }
        i++; out.push({ type: 'code', text: code.join('\n') }); continue;
      }
      if ((m = /^(#{1,6})\s+(.*)$/.exec(l))) { var hid = slug(m[2]) || 'section'; if (used[hid]) { used[hid]++; hid = hid + '-' + used[hid]; } else { used[hid] = 1; }
        out.push({ type: 'heading', level: m[1].length, text: m[2].trim(), id: hid }); i++; continue; }
      if (/^\s*---+\s*$/.test(l)) { out.push({ type: 'hr' }); i++; continue; }
      if (/^>/.test(l)) {
        var q = [];
        while (i < lines.length && /^>/.test(lines[i])) { q.push(lines[i].replace(/^>\s?/, '')); i++; }
        out.push({ type: 'quote', text: q.join(' ').replace(/\s+/g, ' ').trim() }); continue;
      }
      if (l.indexOf('|') >= 0 && i + 1 < lines.length && isTableSep(lines[i + 1])) {
        var head = splitRow(l), rows = []; i += 2;
        while (i < lines.length && lines[i].indexOf('|') >= 0 && !/^\s*$/.test(lines[i])) { rows.push(splitRow(lines[i])); i++; }
        out.push({ type: 'table', head: head, rows: rows }); continue;
      }
      if ((m = LIST_RE.exec(l))) {
        var ordered = /\d/.test(m[2]), items = [];
        while (i < lines.length && (m = LIST_RE.exec(lines[i])) && (/\d/.test(m[2]) === ordered)) {
          var item = [m[3]]; i++;
          while (i < lines.length && !/^\s*$/.test(lines[i]) && !LIST_RE.exec(lines[i]) && !/^(#{1,6})\s/.test(lines[i]) && !/^```/.test(lines[i])) { item.push(lines[i].trim()); i++; }
          items.push(item.join(' '));
          if (i < lines.length && /^\s*$/.test(lines[i]) && i + 1 < lines.length && LIST_RE.exec(lines[i + 1]) && /\d/.test(LIST_RE.exec(lines[i + 1])[2]) === ordered) { i++; }
        }
        out.push({ type: 'list', ordered: ordered, items: items }); continue;
      }
      var para = [];
      while (i < lines.length && !/^\s*$/.test(lines[i]) && !startsBlock(lines[i]) &&
        !(lines[i].indexOf('|') >= 0 && i + 1 < lines.length && isTableSep(lines[i + 1]))) { para.push(lines[i].trim()); i++; }
      if (!para.length) { para.push(l.trim()); i++; }
      out.push({ type: 'p', text: para.join(' ') });
    }
    return out;
  }

  function headings(blocks) {
    return blocks.filter(function (b) { return b.type === 'heading'; });
  }

  // inline: `code`, **bold**, *italic*
  function inline(text, doc) {
    var frag = doc.createDocumentFragment(), parts = text.split(/(`[^`]+`)/), k;
    for (k = 0; k < parts.length; k++) {
      var p = parts[k];
      if (!p) { continue; }
      if (p.charAt(0) === '`' && p.length > 2 && p.charAt(p.length - 1) === '`') {
        var c = doc.createElement('code'); c.textContent = p.slice(1, -1); frag.appendChild(c); continue;
      }
      var segs = p.split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*[^*\s]\*|\*[^*\s]\*)/), j;
      for (j = 0; j < segs.length; j++) {
        var sg = segs[j];
        if (!sg) { continue; }
        if (/^\*\*[^*]+\*\*$/.test(sg)) { var b = doc.createElement('strong'); b.textContent = sg.slice(2, -2); frag.appendChild(b); }
        else if (/^\*[^*]+\*$/.test(sg)) { var e = doc.createElement('em'); e.textContent = sg.slice(1, -1); frag.appendChild(e); }
        else { frag.appendChild(doc.createTextNode(sg)); }
      }
    }
    return frag;
  }

  function render(blocks, doc) {
    doc = doc || document;
    var root = doc.createElement('div');
    blocks.forEach(function (b) {
      var n;
      if (b.type === 'heading') { n = doc.createElement('h' + Math.min(6, b.level + 1)); /* page has its own h1 */ n.id = 'm-' + b.id; n.appendChild(inline(b.text, doc)); }
      else if (b.type === 'p') { n = doc.createElement('p'); n.appendChild(inline(b.text, doc)); }
      else if (b.type === 'code') { n = doc.createElement('pre'); var cc = doc.createElement('code'); cc.textContent = b.text; n.appendChild(cc); n.tabIndex = 0; }
      else if (b.type === 'hr') { n = doc.createElement('hr'); }
      else if (b.type === 'quote') { n = doc.createElement('blockquote'); n.appendChild(inline(b.text, doc)); }
      else if (b.type === 'list') {
        n = doc.createElement(b.ordered ? 'ol' : 'ul');
        b.items.forEach(function (t) { var li = doc.createElement('li'); li.appendChild(inline(t, doc)); n.appendChild(li); });
      } else if (b.type === 'table') {
        n = doc.createElement('div'); n.className = 'tablewrap';
        var t = doc.createElement('table'), th = doc.createElement('thead'), tb = doc.createElement('tbody'), hr = doc.createElement('tr');
        b.head.forEach(function (h) { var c = doc.createElement('th'); c.className = 'l'; c.appendChild(inline(h, doc)); hr.appendChild(c); });
        th.appendChild(hr);
        b.rows.forEach(function (r) {
          var tr = doc.createElement('tr');
          r.forEach(function (x) { var c = doc.createElement('td'); c.className = 'l'; c.style.whiteSpace = 'normal'; c.appendChild(inline(x, doc)); tr.appendChild(c); });
          tb.appendChild(tr);
        });
        t.appendChild(th); t.appendChild(tb); n.appendChild(t);
      }
      if (n) { root.appendChild(n); }
    });
    return root;
  }

  return { parseBlocks: parseBlocks, headings: headings, render: render, slug: slug };
}));
