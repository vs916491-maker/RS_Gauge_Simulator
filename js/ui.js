/*
 * Builds the whole page: tabs, input forms and tables, previews, import/export buttons, messages.
 * The only file touching the DOM. Contains no physics (the engine arrives in Phase 2). Exposes RSGAUGE.app.
 */
(function (root) {
  'use strict';
  var R = root.RSGAUGE, S = R.schema, M = R.model, IO = R.io, P = R.plot, MD = R.markdown;
  var doc = root.document, STORE = 'rsgauge.last.v1';
  var INPUT_TABS = { train: 'Train Configuration', bogie: 'Car body & Bogie', ke: 'Customer KE & SOD', rs: 'RS Profile', track: 'Track Data' };

  var state = {
    p: null, dirty: false, tab: 'train', restored: false, charts: {},
    sel: { ke: 0, sod: 0, rs: 0 }, mode: { ke: 'replace', rs: 'replace' },
    pv: { ke: { ke: true, sod: true, rs: false, items: true }, rs: { ke: true, sod: false, rs: true, items: false } },
    validation: null, timer: null
  };

  // ---------------------------------------------------------------- DOM helpers
  function $(id) { return doc.getElementById(id); }
  function el(tag, a, kids) {
    var e = doc.createElement(tag), k;
    a = a || {};
    for (k in a) {
      if (!Object.prototype.hasOwnProperty.call(a, k) || a[k] === undefined || a[k] === null) { continue; }
      if (k === 'text') { e.textContent = a[k]; }
      else if (k === 'on') { Object.keys(a.on).forEach(function (ev) { e.addEventListener(ev, a.on[ev]); }); }
      else if (k === 'class') { e.className = a[k]; }
      else if (k === 'value') { e.value = a[k]; }
      else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'hidden') { e[k] = !!a[k]; }
      else { e.setAttribute(k, a[k]); }
    }
    (kids || []).forEach(function (c) { if (c !== null && c !== undefined) { e.appendChild(typeof c === 'string' ? doc.createTextNode(c) : c); } });
    return e;
  }
  function clear(n) { while (n.firstChild) { n.removeChild(n.firstChild); } return n; }
  function fmt(v, d) { return v === null || v === undefined || !isFinite(v) ? '—' : Number(v).toFixed(d === undefined ? 0 : d); }
  function uniqueName(base, list, key) {
    var names = {}, i = 1;
    list.forEach(function (x) { names[x[key || 'name']] = true; });
    while (names[base + (i === 1 ? '' : ' ' + i)]) { i++; }
    return base + (i === 1 ? '' : ' ' + i);
  }

  // ---------------------------------------------------------------- change handling
  function changed(structural) {
    state.dirty = true; $('dirty').hidden = false;
    if (structural) { renderTab(state.tab); }
    clearTimeout(state.timer);
    state.timer = setTimeout(function () { refresh(); persist(); }, 180);
  }
  function persist() { try { root.localStorage.setItem(STORE, JSON.stringify(state.p)); } catch (e) { /* storage may be blocked on file:// */ } }

  // ---------------------------------------------------------------- controls
  function control(fd, obj, onChange, refs) {
    var v = obj[fd.k], c;
    var opts = refs && refs[fd.k] ? refs[fd.k]().map(function (n) { return [n, n]; }) : fd.o;
    if (opts) {
      c = el('select', { 'aria-label': fd.l });
      var has = false;
      opts.forEach(function (o) { var s = String(o[0]) === String(v); has = has || s; c.appendChild(el('option', { value: o[0], text: o[1], selected: s })); });
      if (!has && v !== '' && v !== null && v !== undefined) { c.appendChild(el('option', { value: v, text: v + ' (not defined)', selected: true })); }
      if (!has && (v === '' || v === null || v === undefined) && refs && refs[fd.k]) { c.insertBefore(el('option', { value: '', text: '—', selected: true }), c.firstChild); }
      c.addEventListener('change', function () { var old = obj[fd.k]; obj[fd.k] = c.value; onChange(fd.k, old); });
    } else if (fd.t === 'num' || fd.t === 'int') {
      c = el('input', { type: 'number', step: fd.t === 'int' ? '1' : 'any', value: v === null || v === undefined ? '' : v, 'aria-label': fd.l });
      if (fd.min !== undefined) { c.min = fd.min; }
      if (fd.max !== undefined) { c.max = fd.max; }
      c.addEventListener('input', function () {
        var old = obj[fd.k], n = c.value === '' ? null : Number(c.value);
        obj[fd.k] = (n === null || isFinite(n)) ? (fd.t === 'int' && n !== null ? Math.round(n) : n) : old;
        onChange(fd.k, old);
      });
    } else {
      c = el('input', { type: 'text', value: v === null || v === undefined ? '' : v, 'aria-label': fd.l });
      c.addEventListener('input', function () { var old = obj[fd.k]; obj[fd.k] = c.value; onChange(fd.k, old); });
    }
    return c;
  }
  function form(container, fields, obj, onChange, refs) {
    clear(container);
    fields.forEach(function (fd) {
      container.appendChild(el('div', { class: 'field' }, [
        el('label', {}, [fd.l, fd.u ? el('span', { class: 'unit', text: ' [' + fd.u + ']' }) : null]),
        el('div', { class: 'ctl' }, [control(fd, obj, onChange || function () { changed(false); }, refs)]),
        fd.h ? el('small', { text: fd.h }) : null
      ]));
    });
  }
  // Multi-cell paste from Excel (tab/newline separated) into a table: cb(rowOffset, colOffset, value)
  function pasteHandler(r0, c0, apply) {
    return function (ev) {
      var t = (ev.clipboardData || root.clipboardData).getData('text');
      if (!/[\t\n]/.test(t.replace(/\n$/, ''))) { return; }
      ev.preventDefault();
      var rows = t.replace(/\r/g, '').replace(/\n+$/, '').split('\n').map(function (r) { return r.split('\t'); });
      rows.forEach(function (r, i) { r.forEach(function (v, j) { apply(r0 + i, c0 + j, v.trim()); }); });
      changed(true);
    };
  }
  function setValue(obj, fd, v) {
    if (fd.t === 'num' || fd.t === 'int') { var n = M.num(v); obj[fd.k] = n === null ? null : (fd.t === 'int' ? Math.round(n) : n); }
    else if (fd.o) { if (fd.o.some(function (o) { return o[0] === v; })) { obj[fd.k] = v; } }
    else { obj[fd.k] = v; }
  }

  // Parameters as rows, one column per item (car types, bogie types, car bodies).
  function grid(container, items, fields, o) {
    clear(container);
    var tbl = el('table', { class: 'grid freeze-first' }), hr = el('tr', {}, [el('th', { class: 'l', text: 'Parameter' }), el('th', { class: 'l', text: 'Unit' })]);
    items.forEach(function (it, j) {
      hr.appendChild(el('th', { class: 'item' }, [
        el('span', { text: it[fields[0].k] || ('#' + (j + 1)) }),
        o.canDelete === false ? null : el('button', { type: 'button', class: 'small ghost del', title: 'Delete this column', text: '×', on: { click: function () {
          items.splice(j, 1); if (o.onDelete) { o.onDelete(it); } changed(true);
        } } })
      ]));
    });
    tbl.appendChild(el('thead', {}, [hr]));
    var tb = el('tbody');
    fields.forEach(function (fd, i) {
      var tr = el('tr', {}, [el('td', { class: 'l', title: fd.h || '' }, [fd.l, fd.h ? el('span', { class: 'qm', text: ' ?' }) : null]), el('td', { class: 'l unit', text: fd.u })]);
      items.forEach(function (it, j) {
        var c = control(fd, it, function (k, old) {
          if (o.onChange) { o.onChange(it, k, old); }
          changed(k === fields[0].k);
        }, o.refs);
        c.addEventListener('paste', pasteHandler(i, j, function (ri, cj, v) { if (fields[ri] && items[cj]) { setValue(items[cj], fields[ri], v); } }));
        tr.appendChild(el('td', {}, [c]));
      });
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    container.appendChild(tbl);
    if (o.addLabel) {
      container.appendChild(el('p', { class: 'tools' }, [el('button', { type: 'button', class: 'ghost', text: o.addLabel, on: { click: function () {
        var it = o.newItem(); items.push(it); if (o.onAdd) { o.onAdd(it); } changed(true);
      } } })]));
    }
  }

  // One row per record (points, track segments, SOD items).
  function table(container, rows, fields, o) {
    clear(container);
    o = o || {};
    var tbl = el('table', { class: 'rows' }), hr = el('tr', {}, [el('th', { text: '#' })]);
    fields.forEach(function (fd) { hr.appendChild(el('th', { class: 'l', title: fd.h || '' }, [fd.l, fd.u ? el('span', { class: 'unit', text: ' [' + fd.u + ']' }) : null])); });
    hr.appendChild(el('th', { text: '' }));
    tbl.appendChild(el('thead', {}, [hr]));
    var tb = el('tbody');
    function blank() { var r = o.newRow ? o.newRow() : S.defaults(fields); fields.forEach(function (fd) { if (r[fd.k] === undefined) { r[fd.k] = fd.t === 'num' ? null : ''; } }); return r; }
    rows.forEach(function (r, i) {
      var tr = el('tr', {}, [el('td', { class: 'idx', text: String(i + 1) })]);
      fields.forEach(function (fd, j) {
        var c = control(fd, r, function () { changed(false); }, o.refs);
        c.addEventListener('paste', pasteHandler(i, j, function (ri, cj, v) {
          while (rows.length <= ri) { rows.push(blank()); }
          if (fields[cj]) { setValue(rows[ri], fields[cj], v); }
        }));
        tr.appendChild(el('td', {}, [c]));
      });
      tr.appendChild(el('td', { class: 'acts' }, [
        el('button', { type: 'button', class: 'small ghost', title: 'Insert a row below', text: '+', on: { click: function () { rows.splice(i + 1, 0, blank()); changed(true); } } }),
        el('button', { type: 'button', class: 'small ghost', title: 'Delete this row', text: '×', on: { click: function () { rows.splice(i, 1); changed(true); } } })
      ]));
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    container.appendChild(tbl);
    container.appendChild(el('p', { class: 'tools' }, [
      el('button', { type: 'button', class: 'ghost', text: o.addLabel || 'Add row', on: { click: function () { rows.push(blank()); changed(true); } } }),
      rows.length ? el('button', { type: 'button', class: 'ghost', text: 'Clear all rows', on: { click: function () {
        if (root.confirm('Delete all ' + rows.length + ' rows?')) { rows.length = 0; changed(true); }
      } } }) : null,
      el('span', { class: 'muted', text: rows.length + ' row' + (rows.length === 1 ? '' : 's') + (o.pasteHint === false ? '' : ' · paste from Excel into any cell') })
    ]));
  }

  // A set of named profiles (KE, SOD, RS): selector, profile fields, points table.
  function profileSet(container, group, list, prFields, o) {
    clear(container);
    if (state.sel[group] >= list.length) { state.sel[group] = Math.max(0, list.length - 1); }
    var cur = list[state.sel[group]];
    var sel = el('select', { 'aria-label': 'Profile', on: { change: function () { state.sel[group] = Number(sel.value); renderTab(state.tab); } } });
    list.forEach(function (pr, i) { sel.appendChild(el('option', { value: i, text: pr.name + ' (' + pr.points.length + ' pts)', selected: i === state.sel[group] })); });
    function add(copy) {
      var base = copy ? JSON.parse(JSON.stringify(copy)) : S.defaults(prFields);
      base.name = uniqueName(copy ? copy.name + ' copy' : (o.newName || 'Profile'), list);
      base.points = base.points || [];
      list.push(M.record(base, prFields)); list[list.length - 1].points = base.points;
      state.sel[group] = list.length - 1; changed(true);
    }
    container.appendChild(el('div', { class: 'toolbar' }, [
      list.length ? sel : el('span', { class: 'muted', text: 'No profile yet.' }),
      el('button', { type: 'button', class: 'ghost small', text: 'Add', on: { click: function () { add(null); } } }),
      cur ? el('button', { type: 'button', class: 'ghost small', text: 'Duplicate', on: { click: function () { add(cur); } } }) : null,
      cur ? el('button', { type: 'button', class: 'ghost small', text: 'Delete', on: { click: function () {
        if (root.confirm('Delete profile "' + cur.name + '"?')) { list.splice(state.sel[group], 1); changed(true); }
      } } }) : null
    ]));
    if (!cur) { return; }
    var f = el('div', { class: 'fields' });
    form(f, prFields, cur, function (k, old) {
      if (k === 'name' && o.onRename) { o.onRename(old, cur.name); }
      sel.options[state.sel[group]].text = cur.name + ' (' + cur.points.length + ' pts)';
      changed(false);
    }, o.refs);
    container.appendChild(f);
    var t = el('div', { class: 'tablewrap points' });
    container.appendChild(t);
    table(t, cur.points, S.point, { addLabel: 'Add point', newRow: function () { return { pt: String.fromCharCode(65 + (cur.points.length % 26)), y: null, z: null }; } });
  }

  // ---------------------------------------------------------------- import / export toolbars
  function sampleProject() { return M.normalizeProject(R.presets.sample); }
  function ioToolbar(bar) {
    var tab = bar.getAttribute('data-io'), fileId = 'file-' + tab;
    clear(bar);
    var msg = el('div', { class: 'messages importmsg', 'aria-live': 'polite' });
    var input = el('input', { type: 'file', id: fileId, accept: '.xlsx,.xls,.csv,.txt', hidden: true });
    input.addEventListener('change', function () {
      var file = input.files[0]; input.value = '';
      if (!file) { return; }
      IO.readFile(file, function (err, wb) {
        if (err) { showMsgs(msg, [{ level: 'err', text: err.message }]); return; }
        var res = IO.importWorkbook(wb, state.p, { tab: tab, mode: state.mode[tab] || 'replace' });
        if (res.imported.length) { state.p = res.project; changed(true); }
        showMsgs(msg, [{ level: 'ok', text: file.name + ':' }].concat(res.messages));
      });
    });
    bar.appendChild(el('button', { type: 'button', text: 'Download template (Excel)', title: 'Empty layout with the fictional example rows, to fill in and import', on: { click: function () {
      IO.downloadWorkbook(IO.tabWorkbook(tab, sampleProject(), 'Template — ' + INPUT_TABS[tab] + ' (rows below are the FICTIONAL example: overwrite them)'), 'gauge-' + tab + '-template.xlsx');
    } } }));
    bar.appendChild(el('button', { type: 'button', class: 'ghost', text: 'Download current data (Excel)', title: 'This project\'s inputs of this tab, ready to edit and import again', on: { click: function () {
      IO.downloadWorkbook(IO.tabWorkbook(tab, state.p), IO.fileSlug(state.p.name) + '-' + tab + '-inputs.xlsx');
    } } }));
    bar.appendChild(el('label', { class: 'btn', for: fileId, text: 'Import Excel / CSV…' }));
    bar.appendChild(input);
    if (tab === 'ke' || tab === 'rs') {
      var s = el('select', { 'aria-label': 'Import mode', on: { change: function () { state.mode[tab] = s.value; } } }, [
        el('option', { value: 'replace', text: 'Import replaces all profiles' }), el('option', { value: 'merge', text: 'Import adds / replaces by name' })]);
      s.value = state.mode[tab];
      bar.appendChild(s);
    }
    bar.parentNode.insertBefore(msg, bar.nextSibling);
  }
  function showMsgs(box, list) {
    clear(box);
    ['err', 'warn', 'ok'].forEach(function (lv) {
      var items = list.filter(function (m) { return m.level === lv; });
      if (items.length) { box.appendChild(el('ul', { class: lv }, items.map(function (m) { return el('li', { text: m.text }); }))); }
    });
  }

  // ---------------------------------------------------------------- tabs
  function renderTrain() {
    var t = state.p.train;
    form($('f-train-desc'), S.trainDescription, t);
    form($('f-train-config'), S.trainConfig, t, function () { changed(false); });
    form($('f-train-load'), S.trainLoad, t);
    grid($('g-cartypes'), t.carTypes, S.carType, {
      refs: { bogie1: bogieNames, bogie2: bogieNames },
      addLabel: 'Add car type',
      newItem: function () { var c = M.record(S.defaults(S.carType), S.carType); c.name = uniqueName('CAR', t.carTypes); return c; },
      onAdd: function () { M.syncBodies(state.p); },
      onChange: function (it, k, old) {
        if (k === 'name') { state.p.bodies.forEach(function (b) { if (b.car === old) { b.car = it.name; } }); state.p.rs.profiles.forEach(function (pr) { if (pr.car === old) { pr.car = it.name; } }); }
      }
    });
    drawTrain();
  }
  function bogieNames() { return state.p.bogies.map(function (b) { return b.name; }); }
  function carNames() { return state.p.train.carTypes.map(function (c) { return c.name; }); }

  function drawTrain() {
    var box = $('train-drawing'), t = state.p.train, ns = 'http://www.w3.org/2000/svg';
    clear(box);
    var tok = M.formationTokens(t.formation), types = {};
    t.carTypes.forEach(function (c) { types[c.name] = c; });
    if (!tok.length) { box.appendChild(el('p', { class: 'muted', text: 'Enter the train formation to see the drawing.' })); return; }
    var lens = tok.map(function (n) { return types[n] && types[n].length_m ? types[n].length_m : 20; }), total = lens.reduce(function (a, b) { return a + b; }, 0);
    var gap = 0.6, W = Math.max(640, Math.min(1300, (total + gap * tok.length) * 9)), k = (W - 20) / (total + gap * tok.length);
    var svg = doc.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' 96'); svg.setAttribute('width', W); svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Train formation ' + tok.join(' - '));
    function s(tag, a, txt) { var e = doc.createElementNS(ns, tag), q; for (q in a) { e.setAttribute(q, a[q]); } if (txt) { e.textContent = txt; } svg.appendChild(e); return e; }
    var x = 10;
    tok.forEach(function (n, i) {
      var c = types[n], L = lens[i], w = L * k, flip = (i === tok.length - 1);   // the last car is drawn turned round (cab at the right)
      s('rect', { x: x, y: 18, width: w, height: 34, rx: (i === 0 || flip) ? 8 : 3, class: c ? 'car-body' : 'car-body missing' });
      s('text', { x: x + w / 2, y: 40, 'text-anchor': 'middle', class: 'car-name' }, n + (c ? '' : ' ?'));
      s('text', { x: x + w / 2, y: 13, 'text-anchor': 'middle', class: 'car-no' }, 'Car ' + (i + 1) + ' · ' + fmt(L, 1) + ' m');
      if (c) {
        var e1 = flip ? c.na2_m : c.na1_m, e2 = flip ? c.na1_m : c.na2_m, b1 = flip ? c.bogie2 : c.bogie1, b2 = flip ? c.bogie1 : c.bogie2;
        [[e1, b1], [L - e2, b2]].forEach(function (bp) {
          var bx = x + bp[0] * k, isM = bp[1] === 'M' || /^M/i.test(bp[1] || '');
          s('rect', { x: bx - 14, y: 54, width: 28, height: 9, rx: 3, class: isM ? 'bg-m' : 'bg-t' });
          s('circle', { cx: bx - 8, cy: 68, r: 5, class: 'wheel' }); s('circle', { cx: bx + 8, cy: 68, r: 5, class: 'wheel' });
          s('text', { x: bx, y: 88, 'text-anchor': 'middle', class: 'car-no' }, bp[1] || '?');
        });
      }
      x += w + gap * k;
    });
    s('line', { x1: 6, y1: 73, x2: W - 6, y2: 73, class: 'rail' });
    box.appendChild(svg);
    box.appendChild(el('p', { class: 'muted', text: tok.length + ' cars · train length over bodies ' + fmt(total, 2) + ' m · ' +
      (t.bogie_arrangement === 'shared' ? 'shared (Jacobs) bogies' : 'non-shared bogies') + ' · filled bogie = motor (name starting with M)' }));
  }

  function renderBogie() {
    M.syncBodies(state.p);
    grid($('g-bogies'), state.p.bogies, S.bogie, {
      addLabel: 'Add bogie type',
      newItem: function () { var b = M.record(S.defaults(S.bogie), S.bogie); b.name = uniqueName('B', state.p.bogies); return b; },
      onChange: function (it, k, old) {
        if (k === 'name') { state.p.train.carTypes.forEach(function (c) { if (c.bogie1 === old) { c.bogie1 = it.name; } if (c.bogie2 === old) { c.bogie2 = it.name; } }); }
      }
    });
    grid($('g-bodies'), state.p.bodies, S.body, { refs: { car: carNames } });
  }

  function previewSel(boxId, key, chartId) {
    var box = $(boxId), pv = state.pv[key];
    clear(box);
    [['ke', 'KE'], ['sod', 'SOD'], ['rs', 'RS profiles'], ['items', 'SOD items']].forEach(function (o) {
      var c = el('input', { type: 'checkbox', checked: pv[o[0]], on: { change: function () { pv[o[0]] = c.checked; profileChart(chartId, key); } } });
      box.appendChild(el('label', { class: 'check' }, [c, o[1]]));
    });
  }
  function renameRefs(field) {
    return function (old, nu) { state.p.track.segments.forEach(function (s) { if (s[field] === old) { s[field] = nu; } }); };
  }
  function renderKE() {
    profileSet($('ps-ke'), 'ke', state.p.ke.profiles, S.keProfile, { newName: 'KE', onRename: renameRefs('ke') });
    profileSet($('ps-sod'), 'sod', state.p.sod.profiles, S.sodProfile, { newName: 'SOD', onRename: renameRefs('sod') });
    table($('t-sod-items'), state.p.sod.items, S.sodItem, { addLabel: 'Add item' });
    form($('f-sod'), S.sodSettings, state.p.sod);
    form($('f-en'), S.enParams, state.p.ke.en);
    previewSel('pv-ke-sel', 'ke', 'chart-ke');
    profileChart('chart-ke', 'ke');
  }
  function renderRS() {
    profileSet($('ps-rs'), 'rs', state.p.rs.profiles, S.rsProfile, { newName: 'RS profile', refs: { car: function () { return ['ALL'].concat(carNames()); } } });
    previewSel('pv-rs-sel', 'rs', 'chart-rs');
    profileChart('chart-rs', 'rs');
  }
  function renderTrack() {
    form($('f-track'), S.trackParams, state.p.track.params);
    table($('t-track'), state.p.track.segments, S.segment, {
      addLabel: 'Add segment',
      refs: { sod: function () { return state.p.sod.profiles.map(function (x) { return x.name; }); }, ke: function () { return state.p.ke.profiles.map(function (x) { return x.name; }); } },
      newRow: function () {
        var seg = state.p.track.segments, last = seg[seg.length - 1], r = S.defaults(S.segment);
        r.from_m = last ? last.to_m : 0; r.to_m = r.from_m !== null ? r.from_m + 100 : null;
        if (last) { r.sod = last.sod; r.ke = last.ke; r.section = last.section; r.form = last.form; r.speed_kmh = last.speed_kmh; }
        return r;
      }
    });
    trackChart();
  }
  function renderSummary() {
    var v = state.validation, box = $('summary-inputs');
    clear(box);
    var tbl = el('table', { class: 'summary' }, [el('thead', {}, [el('tr', {}, ['Input tab', 'Errors', 'Warnings', 'Status'].map(function (h, i) { return el('th', { class: i === 0 || i === 3 ? 'l' : '', text: h }); }))])]);
    var tb = el('tbody');
    Object.keys(INPUT_TABS).forEach(function (tab) {
      var ms = v.messages.filter(function (m) { return m.tab === tab; }), e = ms.filter(function (m) { return m.level === 'err'; }).length;
      tb.appendChild(el('tr', { class: e ? 'worse' : '' }, [
        el('td', { class: 'l' }, [el('button', { type: 'button', class: 'linkish', text: INPUT_TABS[tab], on: { click: function () { activate(tab); } } })]),
        el('td', { text: String(e) }), el('td', { text: String(ms.length - e) }),
        el('td', { class: 'l', text: e ? 'Fix before running' : (ms.length ? 'Ready (check warnings)' : 'Ready') })
      ]));
    });
    tbl.appendChild(tb); box.appendChild(tbl);
  }
  function readiness(box) {
    clear(box);
    var v = state.validation;
    box.appendChild(el('p', { class: v.ok ? 'pill ok' : 'pill err', text: v.ok ? 'Inputs complete: ' + v.warnings + ' warning(s). The Run button arrives with the engine.' : v.errors + ' input error(s) to fix first — see Overall Summary.' }));
  }
  var methodDone = false;
  function renderMethod() {
    if (methodDone) { return; }
    var body = $('method-body'), toc = $('method-toc');
    if (!R.methodMd || !MD) { body.textContent = 'The method text (js/method.js) did not load.'; return; }
    var blocks = MD.parseBlocks(R.methodMd);
    body.appendChild(MD.render(blocks, doc));
    MD.headings(blocks).forEach(function (h) {
      if (h.level > 3) { return; }
      toc.appendChild(el('button', { type: 'button', class: h.level === 3 ? 'sub' : '', text: h.text.replace(/`/g, ''), on: { click: function () {
        var t = $('m-' + h.id); if (t) { t.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      } } }));
    });
    methodDone = true;
  }
  var RENDER = { train: renderTrain, bogie: renderBogie, ke: renderKE, rs: renderRS, track: renderTrack, summary: renderSummary, method: renderMethod,
    ssim: function () { readiness($('ready-ssim')); }, dsim: function () { readiness($('ready-dsim')); }, sres: function () {}, dres: function () {} };
  function renderTab(tab) {
    if (!state.validation) { state.validation = M.validate(state.p); }
    RENDER[tab]();
  }
  function renderAll() {
    $('project-name').value = state.p.name; $('project-notes').value = state.p.notes || '';
    state.validation = M.validate(state.p);
    renderTab(state.tab); refresh();
  }

  // ---------------------------------------------------------------- charts
  function cssVar(n, d) { try { return root.getComputedStyle(doc.documentElement).getPropertyValue(n).trim() || d; } catch (e) { return d; } }
  function themeCharts() {
    if (!root.Chart) { return; }
    root.Chart.defaults.color = cssVar('--muted', '#59636e');
    root.Chart.defaults.borderColor = cssVar('--grid', 'rgba(110,118,129,.25)');
    root.Chart.defaults.font.family = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  }
  function profileChart(id, key) {
    if (!root.Chart) { return; }
    var canvas = $(id), pv = state.pv[key], hl = null;
    if (state.tab === 'ke') { hl = { group: 'ke', name: (state.p.ke.profiles[state.sel.ke] || {}).name }; }
    if (state.tab === 'rs') { hl = { group: 'rs', name: (state.p.rs.profiles[state.sel.rs] || {}).name }; }
    var ds = P.profileDatasets(state.p, { ke: pv.ke, sod: pv.sod, rs: pv.rs, items: pv.items, highlight: hl }), ax = P.profileAxes(ds);
    if (state.charts[id]) { state.charts[id].destroy(); }
    state.charts[id] = new root.Chart(canvas.getContext('2d'), {
      type: 'scatter', data: { datasets: ds },
      options: {
        animation: false, responsive: true, maintainAspectRatio: true, aspectRatio: Math.max(0.55, Math.min(1.8, ax.aspect * 0.92)),
        scales: {
          x: { type: 'linear', min: ax.xmin, max: ax.xmax, title: { display: true, text: 'Y lateral from track centre [mm]' }, ticks: { stepSize: 500 } },
          y: { min: ax.ymin, max: ax.ymax, title: { display: true, text: 'Z above top of rail [mm]' }, ticks: { stepSize: 500 } }
        },
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 18 } },
          tooltip: { callbacks: { label: function (c) { return c.dataset.label + (c.raw.label ? ' — ' + c.raw.label : '') + ': Y ' + fmt(c.raw.x) + ', Z ' + fmt(c.raw.y) + ' mm'; } } }
        }
      }
    });
  }
  function trackChart() {
    if (!root.Chart) { return; }
    var s = P.trackSeries(state.p.track.segments), id = 'chart-track';
    if (state.charts[id]) { state.charts[id].destroy(); }
    function line(label, data, axis, color, dash) { return { label: label, data: data, yAxisID: axis, borderColor: color, backgroundColor: color, borderWidth: 1.8, borderDash: dash || [], pointRadius: 0, spanGaps: false, tension: 0 }; }
    state.charts[id] = new root.Chart($(id).getContext('2d'), {
      type: 'line',
      data: { datasets: [
        line('Curvature 1000/R [1/km] (left +, right −)', s.curvature, 'yk', cssVar('--c1', '#2563eb')),
        line('Vertical curvature 10000/Rv [1/10 km] (crest +)', s.vcurvature, 'yk', cssVar('--c5', '#7c3aed'), [5, 4]),
        line('Cant [mm]', s.cant, 'yc', cssVar('--c2', '#d97706')),
        line('Speed limit [km/h]', s.speed, 'yc', cssVar('--c3', '#059669'), [2, 2])
      ] },
      options: {
        animation: false, responsive: true, maintainAspectRatio: false, interaction: { mode: 'nearest', axis: 'x', intersect: false },
        scales: {
          x: { type: 'linear', title: { display: true, text: 'Chainage [m]' } },
          yk: { position: 'left', title: { display: true, text: 'Curvature' } },
          yc: { position: 'right', min: 0, title: { display: true, text: 'Cant [mm] / speed [km/h]' }, grid: { drawOnChartArea: false } }
        },
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 18 } } }
      }
    });
    var seg = state.p.track.segments, curves = seg.filter(function (x) { return x.R_m > 0; });
    var rmin = curves.reduce(function (a, x) { return Math.min(a, x.R_m); }, Infinity);
    $('track-stats').textContent = seg.length + ' segments · ' + fmt(M.trackLength(seg)) + ' m · ' + curves.length + ' curves' + (curves.length ? ' · min R ' + fmt(rmin) + ' m' : '');
  }

  // ---------------------------------------------------------------- refresh (messages, badges, previews)
  function refresh() {
    var v = state.validation = M.validate(state.p);
    doc.querySelectorAll('[data-msgs]').forEach(function (box) {
      var tab = box.getAttribute('data-msgs'), list = tab === 'all' ? v.messages.map(function (m) { return { level: m.level, text: INPUT_TABS[m.tab] + ': ' + m.text }; }) : v.messages.filter(function (m) { return m.tab === tab; });
      showMsgs(box, list.length ? list : [{ level: 'ok', text: tab === 'all' ? 'No problems found in the inputs.' : 'No problems found in this tab.' }]);
    });
    Object.keys(INPUT_TABS).forEach(function (tab) {
      var b = $('tabbtn-' + tab), e = v.messages.filter(function (m) { return m.tab === tab && m.level === 'err'; }).length, badge = b.querySelector('.badge');
      if (!badge) { badge = el('span', { class: 'badge' }); b.appendChild(badge); }
      badge.textContent = e ? String(e) : ''; badge.hidden = !e; badge.title = e ? e + ' error(s)' : '';
    });
    var ban = [];
    if (state.p.fictional) { ban.push('Fictional example data loaded — replace it with project data before use.'); }
    if (state.restored) { ban.push('Your last session was restored from this browser.'); }
    $('data-banner').textContent = ban.join(' ');
    if (state.tab === 'train') { drawTrain(); }
    if (state.tab === 'ke') { profileChart('chart-ke', 'ke'); }
    if (state.tab === 'rs') { profileChart('chart-rs', 'rs'); }
    if (state.tab === 'track') { trackChart(); }
    if (state.tab === 'summary') { renderSummary(); }
    if (state.tab === 'ssim' || state.tab === 'dsim') { RENDER[state.tab](); }
  }

  // ---------------------------------------------------------------- tab switching
  var TABS = ['train', 'bogie', 'ke', 'rs', 'track', 'ssim', 'sres', 'dsim', 'dres', 'summary', 'method'];
  function activate(tab) {
    state.tab = tab;
    TABS.forEach(function (t) {
      var b = $('tabbtn-' + t), on = t === tab;
      b.setAttribute('aria-selected', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1;
      $('tab-' + t).hidden = !on;
    });
    renderTab(tab);
    try { root.localStorage.setItem(STORE + '.tab', tab); } catch (e) { /* ignore */ }
  }
  function wireTabs() {
    TABS.forEach(function (t, i) {
      var b = $('tabbtn-' + t);
      b.addEventListener('click', function () { activate(t); });
      b.addEventListener('keydown', function (ev) {
        var j = ev.key === 'ArrowRight' ? i + 1 : ev.key === 'ArrowLeft' ? i - 1 : -1;
        if (j < 0 && ev.key !== 'ArrowLeft') { return; }
        j = (j + TABS.length) % TABS.length; activate(TABS[j]); $('tabbtn-' + TABS[j]).focus(); ev.preventDefault();
      });
    });
  }

  // ---------------------------------------------------------------- header actions
  function load(p, opts) {
    state.p = p; state.dirty = !!(opts && opts.dirty); state.restored = !!(opts && opts.restored);
    state.sel = { ke: 0, sod: 0, rs: 0 };
    $('dirty').hidden = !state.dirty;
    renderAll(); persist();
  }
  function okToReplace() { return !state.dirty || root.confirm('Replace the current data? Unsaved changes will be lost (save the project first to keep them).'); }
  function wireHeader() {
    $('project-name').addEventListener('input', function () { state.p.name = this.value; changed(false); });
    $('project-notes').addEventListener('input', function () { state.p.notes = this.value; changed(false); });
    $('btn-save').addEventListener('click', function () {
      IO.downloadText(IO.projectJson(state.p), IO.fileSlug(state.p.name) + '.rsgauge.json', 'application/json');
      state.dirty = false; $('dirty').hidden = true;
    });
    $('file-project').addEventListener('change', function () {
      var f = this.files[0]; this.value = '';
      if (!f || !okToReplace()) { return; }
      IO.readFile(f, function (err, text) {
        if (err) { root.alert(err.message); return; }
        try { load(IO.parseProject(text)); } catch (e) { root.alert(e.message); }
      });
    });
    $('btn-export-all').addEventListener('click', function () { IO.downloadWorkbook(IO.allInputsWorkbook(state.p), IO.fileSlug(state.p.name) + '-all-inputs.xlsx'); });
    $('file-import-all').addEventListener('change', function () {
      var f = this.files[0]; this.value = '';
      if (!f) { return; }
      IO.readFile(f, function (err, wb) {
        var box = $('top-msgs');
        if (err) { showMsgs(box, [{ level: 'err', text: err.message }]); return; }
        var res = IO.importWorkbook(wb, state.p, { tab: 'all' });
        if (res.imported.length) { state.p = res.project; state.p.fictional = false; changed(true); renderAll(); }
        showMsgs(box, [{ level: 'ok', text: f.name + ':' }].concat(res.messages));
      });
    });
    $('btn-example').addEventListener('click', function () { if (okToReplace()) { load(sampleProject()); } });
    $('btn-new').addEventListener('click', function () {
      if (!okToReplace()) { return; }
      var p = M.emptyProject();
      p.train.carTypes.push(M.record({ name: 'CAR', count: p.train.n_cars }, S.carType));
      p.train.formation = new Array(p.train.n_cars + 1).join('CAR-').replace(/-$/, '');
      p.bogies.push(M.record({ name: 'T' }, S.bogie));
      M.syncBodies(p);
      load(p);
    });
  }

  function start() {
    themeCharts();
    var banner = $('data-banner');
    banner.parentNode.insertBefore(el('div', { id: 'top-msgs', class: 'messages top-msgs', 'aria-live': 'polite' }), banner.nextSibling);
    doc.querySelectorAll('[data-io]').forEach(ioToolbar);
    wireTabs(); wireHeader();
    $('method-dl').addEventListener('click', function () { IO.downloadText(R.methodMd || '', 'METHOD.md', 'text/markdown'); });
    var saved = null, tab = 'train';
    try { saved = root.localStorage.getItem(STORE); tab = root.localStorage.getItem(STORE + '.tab') || 'train'; } catch (e) { saved = null; }
    if (saved) { try { state.p = M.normalizeProject(JSON.parse(saved)); state.restored = true; } catch (e) { saved = null; } }
    if (!saved) { state.p = sampleProject(); }
    state.tab = TABS.indexOf(tab) >= 0 ? tab : 'train';
    $('project-name').value = state.p.name; $('project-notes').value = state.p.notes || '';
    state.validation = M.validate(state.p);
    activate(state.tab); refresh();
  }

  R.app = { state: state, activate: activate, load: load, refresh: refresh };
  if (doc.readyState === 'loading') { doc.addEventListener('DOMContentLoaded', start); } else { start(); }
}(typeof globalThis !== 'undefined' ? globalThis : this));
