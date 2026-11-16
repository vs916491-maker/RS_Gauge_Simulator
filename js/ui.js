/*
 * Builds the whole page: tabs, input forms and tables, previews, import/export, the static run and its results.
 * The only file touching the DOM. Contains no physics: every calculated value comes from js/engine.js.
 * Exposes RSGAUGE.app.
 */
(function (root) {
  'use strict';
  var R = root.RSGAUGE, S = R.schema, M = R.model, IO = R.io, P = R.plot, E = R.engine, MD = R.markdown;
  var doc = root.document, STORE = 'rsgauge.last.v2';
  var INPUT_TABS = { train: 'Train Configuration', bogie: 'Car body & Bogie', ke: 'Customer KE & SOD', rs: 'RS Profile', track: 'Track Data', ssim: 'Static Simulation', dsim: 'Dynamic Simulation', tests: 'Tests', endyn: 'EN Dynamic Method' };

  var state = {
    p: null, dirty: false, tab: 'train', restored: false, charts: {},
    sel: { ke: 0, sod: 0, rs: 0 }, mode: { ke: 'replace', rs: 'replace' },
    pv: { ke: { ke: true, sod: true, rs: false, items: true }, rs: { ke: true, sod: false, rs: true, items: false } },
    validation: null, timer: null,
    run: null, runKey: null, resCar: null, resCase: 'end_t',
    drun: null, drunKey: null, dCar: null, dCh: null
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
  function inputsKey(p) { var q = JSON.parse(JSON.stringify(p)); delete q.name; delete q.notes; if (q.settings) { delete q.settings.report; } delete q.tests; return JSON.stringify(q); }   // report fields and test readings do not make results stale
  function staticOpts() { return state.p.settings['static']; }
  function dynOpts() { return state.p.settings.dynamic; }

  // ---------------------------------------------------------------- change handling
  function changed(structural) {
    state.dirty = true; $('dirty').hidden = false;
    if (structural) { renderTab(state.tab); }
    clearTimeout(state.timer);
    state.timer = setTimeout(function () { refresh(); persist(); }, 200);
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
      c = el('input', { type: 'number', step: fd.t === 'int' ? '1' : 'any', value: v === null || v === undefined ? '' : v, 'aria-label': fd.l, placeholder: fd.opt ? 'auto' : null });
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
    else if (fd.o) { var m = fd.o.filter(function (o) { return o[0] === v || o[1].toLowerCase() === String(v).toLowerCase(); })[0]; if (m) { obj[fd.k] = m[0]; } }
    else { obj[fd.k] = v; }
  }

  // Parameters as rows, one column per item. o.groups: { key: 'title of the group starting at this key' }
  function grid(container, items, fields, o) {
    clear(container);
    var tbl = el('table', { class: 'grid freeze-first' }), hr = el('tr', {}, [el('th', { class: 'l', text: 'Parameter' }), el('th', { class: 'l', text: 'Unit' })]);
    items.forEach(function (it, j) {
      hr.appendChild(el('th', { class: 'item' }, [
        el('span', { text: it[fields[0].k] || ('#' + (j + 1)) }),
        o.canDelete === false ? null : el('button', { type: 'button', class: 'small ghost del', title: 'Delete this column', text: '×', on: { click: function () {
          if (!root.confirm('Delete "' + (it[fields[0].k] || '#' + (j + 1)) + '"?')) { return; }
          items.splice(j, 1); if (o.onDelete) { o.onDelete(it); } changed(true);
        } } })
      ]));
    });
    tbl.appendChild(el('thead', {}, [hr]));
    var tb = el('tbody');
    fields.forEach(function (fd, i) {
      if (o.groups && o.groups[fd.k]) { tb.appendChild(el('tr', { class: 'grp' }, [el('td', { class: 'l', colspan: String(items.length + 2), text: o.groups[fd.k] })])); }
      var tr = el('tr', { class: i === 0 ? 'namerow' : '' }, [el('td', { class: 'l', title: fd.h || '' }, [fd.l, fd.h ? el('span', { class: 'qm', text: ' ?' }) : null]), el('td', { class: 'l unit', text: fd.u })]);
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
        var c = control(fd, r, function (k, old) { if (o.onChange) { o.onChange(r, k, old); } changed(!!(o.structural && o.structural[k])); }, o.refs);
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
      el('span', { class: 'muted', text: rows.length + ' row' + (rows.length === 1 ? '' : 's') + ' · paste from Excel into any cell' })
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
      var pts = base.points || [];
      var rec = M.record(base, prFields); rec.points = pts;
      list.push(rec);
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
    });
    container.appendChild(f);
    var t = el('div', { class: 'tablewrap points' });
    container.appendChild(t);
    table(t, cur.points, S.point, { addLabel: 'Add point', newRow: function () { return { pt: String(cur.points.length + 1), y: null, z: null }; } });
  }

  // Read-only table: head = [labels], rows = [[cells]]; a cell may be {v, cls}.
  function roTable(container, head, rows, cls) {
    clear(container);
    var t = el('table', { class: 'ro ' + (cls || '') });
    t.appendChild(el('thead', {}, [el('tr', {}, head.map(function (h, i) { return el('th', { class: i === 0 ? 'l' : '', text: h }); }))]));
    var tb = el('tbody');
    rows.forEach(function (r) {
      tb.appendChild(el('tr', { class: r.cls || '' }, (r.cells || r).map(function (c, i) {
        var o = (c && typeof c === 'object') ? c : { v: c };
        return el('td', { class: (i === 0 ? 'l ' : '') + (o.cls || ''), text: o.v === null || o.v === undefined ? '' : String(o.v), title: o.title || null });
      })));
    });
    t.appendChild(tb);
    container.appendChild(t);
    return t;
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
    bar.appendChild(el('button', { type: 'button', text: 'Download template (Excel)', title: 'Layout with the fictional example rows, to overwrite and import', on: { click: function () {
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

  // ---------------------------------------------------------------- name lists for drop-downs
  function bogieNames() { return state.p.bogies.map(function (b) { return b.name; }); }
  function carNames() { return state.p.train.carTypes.map(function (c) { return c.name; }); }
  function rsNames() { return state.p.rs.profiles.map(function (x) { return x.name; }); }
  function keNames() { return state.p.ke.profiles.map(function (x) { return x.name; }); }
  function renameRefs(list, keys, old, nu) { list.forEach(function (r) { keys.forEach(function (k) { if (r[k] === old) { r[k] = nu; } }); }); }

  // ---------------------------------------------------------------- Train Configuration
  function renderTrain() {
    var t = state.p.train;
    form($('f-train-desc'), S.trainDescription, t);
    form($('f-train-config'), S.trainConfig, t, function (k) {
      if (k === 'study') { changed(true); return; }
      if (k === 'framework' || (k === 'ebo_use' && t.framework === 'ebo')) { applyFramework(); changed(true); return; }
      changed(false);
    });
    M.syncLoads(state.p, true);
    loadTables();
    endsTable();
    grid($('g-cartypes'), t.carTypes, S.carType.filter(function (fd) { return !END_KEYS[fd.k]; }), {
      refs: { prof_int: rsNames, prof_ext: rsNames, prof_end: rsNames },
      groups: { name: 'Identification', length_m: 'Body geometry and pivots (bogie ends and masses: Load definition above)', ni_m: 'Sections checked', width_mm: 'Body and door sill', prof_int: 'Section profiles' },
      addLabel: 'Add car type',
      newItem: function () {
        var c = M.record(S.defaults(S.carType), S.carType);
        c.name = uniqueName('CAR', t.carTypes);
        if (state.p.bogies[0]) { c.bogie1 = c.bogie2 = state.p.bogies[0].name; }
        return c;
      },
      onAdd: function () { M.syncBodies(state.p); M.fillRefs(state.p); M.syncLoads(state.p, true); },
      onChange: function (it, k, old) {
        if (k === 'name') { renameRefs(state.p.sections, ['car'], old, it.name); renameRefs(state.p.loads.cars, ['car'], old, it.name); renameRefs(state.p.bodies, ['car'], old, it.name); renameRefs(state.p.lowerParts, ['car'], old, it.name); renameRefs(state.p.doorSteps, ['car'], old, it.name); renameRefs(state.p.pantographs, ['car'], old, it.name); renameRefs(state.p.tests.sway, ['car'], old, it.name); }
      }
    });
    sectionsTable(); drawTrain(); calcGeometry(); carDrawings();
  }
  // Load cases and masses (Load definition card, METHOD §4.1a)
  function loadNames() { return state.p.loads.cases.map(function (c) { return c.name; }); }
  function loadTables() {
    var L = state.p.loads;
    table($('t-loadcases'), L.cases, S.loadCase, {
      addLabel: 'Add load case', structural: { role: true },
      newRow: function () { var r = S.defaults(S.loadCase); r.name = uniqueName('AW', L.cases); r.role = 'other'; return r; },
      onChange: function (r, k, old) { if (k === 'name') { renameRefs(L.cars, ['load'], old, r.name); if (state.p.settings.dynamic.load === old) { state.p.settings.dynamic.load = r.name; } carLoadTable(); } }
    });
    carLoadTable();
  }
  function carLoadTable() {
    table($('t-carloads'), state.p.loads.cars, S.carLoad, { addLabel: 'Add row', refs: { car: carNames, load: loadNames }, structural: { car: true, load: true }, onChange: function () { loadValues(); } });
    loadValues();
  }
  function loadValues() {
    var rows = [], opt = state.p.settings['static'];
    state.p.train.carTypes.forEach(function (c) {
      if (!c.name) { return; }
      var d; try { d = E.deriveCar(state.p, c, opt); } catch (e) { return; }
      d.loads.forEach(function (x) {
        rows.push([c.name, x.name, x.role, fmt(x.m / 1000, 2), fmt(x.hG * 1000, 0), fmt(x.dz, 1), fmt(x.s, 3), fmt(x.hc * 1000, 0), fmt(x.Dw, 1)]);
      });
    });
    roTable($('calc-loads'), ['Car type', 'Load case', 'Role', 'm (t)', 'hG (mm)', 'Δz (mm)', 's used', 'hc used (mm)', 'Wind cant Dw (mm)'], rows);
    var box = $('calc-loads');
    box.appendChild(el('p', { class: 'muted', text: 's and hc follow the Static Simulation options (' + (opt.flex === 'theoretical' ? 'theoretical' : 'specified') + ', lateral state ' + (opt.lat_state || 'inflated') + '); wind at ' + fmt(state.p.track.params.wind_open_kmh, 0) + ' km/h.' }));
  }

  // Bogie ends of every car type (Load definition card): one row per car type, the ends and their bogie types.
  var END_KEYS = { end1: true, bogie1: true, end2: true, bogie2: true };
  function endsTable() {
    var box = $('t-ends'), t = state.p.train, tok = M.formationTokens(t.formation);
    clear(box);
    if (!t.carTypes.length) { box.appendChild(el('p', { class: 'muted', text: 'Add a car type below first.' })); return; }
    var fd = {}; S.carType.forEach(function (f) { fd[f.k] = f; });
    var head = ['Car type', 'In formation', 'End 1', 'Bogie type at end 1', 'End 2', 'Bogie type at end 2', 'Arrangement', 'Overhang n1 (m)', 'Overhang n2 (m)', 'Pivot distance a (m)'];
    var tbl = el('table', { class: 'rows ends' });
    tbl.appendChild(el('thead', {}, [el('tr', {}, head.map(function (h, i) { return el('th', { class: i < 7 ? 'l' : '', text: h }); }))]));
    var tb = el('tbody');
    t.carTypes.forEach(function (c) {
      var g = E.carGeometry(c), k = tok.filter(function (n) { return n === c.name; }).length;
      var ns = (c.end1 === 'shared' ? 1 : 0) + (c.end2 === 'shared' ? 1 : 0);
      var kind = ns === 0 ? 'Two own bogies (non-articulated)' : ns === 1 ? 'One shared end (semi-articulated)' : 'Two shared ends (articulated)';
      function ctl(key, refs) { return el('td', {}, [control(fd[key], c, function () { changed(true); }, refs)]); }
      tb.appendChild(el('tr', {}, [
        el('td', { class: 'l', text: c.name || '—' }), el('td', { class: 'l', text: k ? k + ' ×' : 'not used' }),
        ctl('end1'), ctl('bogie1', { bogie1: bogieNames }), ctl('end2'), ctl('bogie2', { bogie2: bogieNames }),
        el('td', { class: 'l', text: kind }),
        el('td', { text: fmt(g.n1, 3) }), el('td', { text: fmt(g.n2, 3) }), el('td', { class: g.a > 0 ? '' : 'badcell', text: fmt(g.a, 3) })
      ]));
    });
    tbl.appendChild(tb);
    box.appendChild(tbl);
  }
  // Additional sections per car type (METHOD §6.1a)
  function sectionsTable() {
    table($('t-sections'), state.p.sections, S.extraSection, {
      addLabel: 'Add section', refs: { car: carNames, profile: rsNames }, structural: { car: true, ref_end: true },
      onChange: function () { carDrawings(); },
      newRow: function () {
        var t = state.p.sections, last = t[t.length - 1], c = state.p.train.carTypes[0] || {}, r = S.defaults(S.extraSection);
        r.car = last ? last.car : (c.name || ''); r.profile = last ? last.profile : (c.prof_int || ''); r.name = 'Section ' + (t.length + 1); r.dist_m = null;
        return r;
      }
    });
  }
  // Side view of every car type with the sections checked (to scale, no physics: positions from E.carGeometry / E.carSections).
  function carDrawings() {
    var box = $('car-drawings'), ns = 'http://www.w3.org/2000/svg';
    clear(box);
    state.p.train.carTypes.forEach(function (c) {
      if (!c.name) { return; }
      var g = E.carGeometry(c), Lb = g.Lb;
      if (!(Lb > 0)) { return; }
      var W = 820, x0 = 40, k = (W - 2 * x0) / Lb, svg = doc.createElementNS(ns, 'svg');
      svg.setAttribute('viewBox', '0 0 ' + W + ' 186'); svg.setAttribute('width', W); svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', 'Car type ' + c.name + ' with the sections checked');
      var title = doc.createElementNS(ns, 'text'); title.setAttribute('x', 4); title.setAttribute('y', 13); title.setAttribute('class', 'car-name'); title.textContent = c.name;
      svg.appendChild(title);
      var grp = doc.createElementNS(ns, 'g'); grp.setAttribute('transform', 'translate(0,18)'); svg.appendChild(grp);
      function s(tag, a, txt) { var e = doc.createElementNS(ns, tag), q; for (q in a) { e.setAttribute(q, a[q]); } if (txt !== undefined) { e.textContent = txt; } grp.appendChild(e); return e; }
      function X(m) { return x0 + m * k; }
      s('rect', { x: X(0), y: 40, width: Lb * k, height: 46, rx: 6, class: 'car-body' });
      s('text', { x: X(0) + 4, y: 82, class: 'end-tag' }, 'end 1'); s('text', { x: X(Lb) - 4, y: 82, 'text-anchor': 'end', class: 'end-tag' }, 'end 2');
      var piv = [g.n1, Lb - g.n2], bog = [c.bogie1, c.bogie2], pw = 2.3;
      (state.p.bogies || []).forEach(function (b) { if (b.name === c.bogie1 && b.p_m) { pw = b.p_m; } });
      piv.forEach(function (px, i) {
        s('line', { x1: X(px), y1: 34, x2: X(px), y2: 104, class: 'pivot' });
        s('rect', { x: X(px - pw / 2) - 6, y: 88, width: pw * k + 12, height: 8, rx: 3, class: /^M/i.test(bog[i] || '') ? 'bg-m' : 'bg-t' });
        s('circle', { cx: X(px - pw / 2), cy: 100, r: 6, class: 'wheel' }); s('circle', { cx: X(px + pw / 2), cy: 100, r: 6, class: 'wheel' });
      });
      s('line', { x1: X(0) - 20, y1: 106, x2: X(Lb) + 20, y2: 106, class: 'rail' });
      // dimensions n1 – a – n2 and Lb
      function dim(a, b, y, label) {
        s('line', { x1: X(a), y1: y, x2: X(b), y2: y, class: 'dim' });
        s('line', { x1: X(a), y1: y - 4, x2: X(a), y2: y + 4, class: 'dim' }); s('line', { x1: X(b), y1: y - 4, x2: X(b), y2: y + 4, class: 'dim' });
        s('text', { x: (X(a) + X(b)) / 2, y: y - 3, 'text-anchor': 'middle', class: 'car-no' }, label);
      }
      dim(0, g.n1, 124, 'n1 ' + fmt(g.n1, 3)); dim(g.n1, Lb - g.n2, 124, 'a ' + fmt(g.a, 3)); dim(Lb - g.n2, Lb, 124, 'n2 ' + fmt(g.n2, 3));
      dim(0, Lb, 146, 'Lb ' + fmt(Lb, 3) + ' m');
      // sections: standard (red) and additional (purple); label rows alternate to avoid overlap
      var lines = [{ x: g.n1 + g.ni, t: 'Int', cls: 'sec-std', title: 'Interior: ni ' + fmt(g.ni, 3) + ' m from pivot 1 = ' + fmt(g.int_e1, 3) + ' m from body end 1 (' + fmt(g.int_e2, 3) + ' m from end 2)' }];
      [[g.n1 - g.na, g.n1, g.ext_e1, 1], [Lb - g.n2 + g.na, g.n2, g.ext_e2, 2]].forEach(function (e) { if (g.na <= e[1] + 1e-9) { lines.push({ x: e[0], t: 'Ext', cls: 'sec-std', title: 'Exterior: na ' + fmt(g.na, 3) + ' m beyond pivot ' + e[3] + ' = ' + fmt(e[2], 3) + ' m from body end ' + e[3] }); } });
      if (Math.abs(g.n1 - g.n_end) < 1e-9) { lines.push({ x: 0.04, t: 'End', cls: 'sec-std' }); }
      if (Math.abs(g.n2 - g.n_end) < 1e-9) { lines.push({ x: Lb - 0.04, t: 'End', cls: 'sec-std' }); }
      E.carSections(state.p, c, g).forEach(function (xs) { lines.push({ x: xs.x, t: xs.name, cls: 'sec-x', title: xs.name + ': ' + fmt(xs.dist, 3) + ' m from body ' + (xs.ref_end === 'end2' ? 'end 2' : 'end 1') + ', ' + xs.pos + ' the pivots, n ' + fmt(xs.n, 3) + ' m, A ' + fmt(xs.A, 4) }); });
      lines.sort(function (a, b) { return a.x - b.x; });
      lines.forEach(function (l, i) {
        var ln = s('line', { x1: X(l.x), y1: 30, x2: X(l.x), y2: 92, class: l.cls });
        if (l.title) { ln.appendChild(doc.createElementNS(ns, 'title')).textContent = l.title; }
        s('text', { x: X(l.x), y: i % 2 ? 26 : 16, 'text-anchor': 'middle', class: l.cls === 'sec-x' ? 'sec-x-label' : 'sec-label' }, l.t);
      });
      box.appendChild(svg);
    });
    if (!box.firstChild) { box.appendChild(el('p', { class: 'muted', text: 'Add a car type with a body length to see the drawing.' })); }
  }
  function calcGeometry() {
    var rows = state.p.train.carTypes.map(function (c) {
      var g = E.carGeometry(c);
      return [c.name, fmt(g.Lb, 3), fmt(g.n1, 3), fmt(g.n2, 3), { v: fmt(g.a, 3), cls: g.a > 0 ? '' : 'badcell' }, fmt(g.n_end, 3), fmt(g.ni, 3), fmt(g.int_e1, 3) + ' / ' + fmt(g.int_e2, 3),
        fmt(g.na, 3), (g.ext_e1 === null ? '–' : fmt(g.ext_e1, 3)) + ' / ' + (g.ext_e2 === null ? '–' : fmt(g.ext_e2, 3)), fmt(g.A_ext, 4), fmt(g.A_end, 4),
        { v: g.na_ok ? 'OK' : 'na > overhang – check', cls: g.na_ok ? 'okcell' : 'badcell' }];
    });
    roTable($('calc-geometry'), ['Car type', 'Lb (m)', 'n1 (m)', 'n2 (m)', 'Pivot distance a (m)', 'Largest overhang nE (m)', 'Interior ni from pivot 1 (m)', 'Interior from body end 1 / end 2 (m)', 'Exterior na beyond each pivot (m)', 'Exterior from body end 1 / end 2 (m)', 'Yaw factor A exterior', 'Yaw factor A car end', 'Exterior within overhang'], rows);
  }
  function drawTrain() {
    var box = $('train-drawing'), t = state.p.train, ns = 'http://www.w3.org/2000/svg';
    clear(box);
    var lay = M.formationLayout(t), cars = lay.cars;
    if (!cars.length) { box.appendChild(el('p', { class: 'muted', text: 'Enter the train formation to see the drawing.' })); return; }
    var lens = cars.map(function (k) { return k.car && k.car.length_m ? k.car.length_m : 20; }), total = lens.reduce(function (a, b) { return a + b; }, 0);
    var gap = 0.6, W = Math.max(640, Math.min(1300, (total + gap * cars.length) * 9)), k = (W - 20) / (total + gap * cars.length);
    var svg = doc.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' 104'); svg.setAttribute('width', W); svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Train formation ' + cars.map(function (q) { return q.name; }).join(' - '));
    function s(tag, a, txt) { var e = doc.createElementNS(ns, tag), q; for (q in a) { e.setAttribute(q, a[q]); } if (txt) { e.textContent = txt; } svg.appendChild(e); return e; }
    function bogie(bx, name, title) {
      var isM = /^M/i.test(name || ''), g = s('rect', { x: bx - 14, y: 54, width: 28, height: 9, rx: 3, class: isM ? 'bg-m' : 'bg-t' });
      if (title) { g.appendChild(doc.createElementNS(ns, 'title')).textContent = title; }
      s('circle', { cx: bx - 8, cy: 68, r: 5, class: 'wheel' }); s('circle', { cx: bx + 8, cy: 68, r: 5, class: 'wheel' });
      s('text', { x: bx, y: 88, 'text-anchor': 'middle', class: 'car-no' }, name || '?');
    }
    var x = 10, starts = [];
    cars.forEach(function (q, i) {
      var c = q.car, L = lens[i], w = L * k;
      starts.push(x);
      s('rect', { x: x, y: 18, width: w, height: 34, rx: (i === 0 || i === cars.length - 1) ? 8 : 3, class: c ? 'car-body' : 'car-body missing' });
      s('text', { x: x + w / 2, y: 40, 'text-anchor': 'middle', class: 'car-name' }, q.name + (c ? '' : ' ?'));
      s('text', { x: x + w / 2, y: 13, 'text-anchor': 'middle', class: 'car-no' }, 'Car ' + q.pos + ' · ' + fmt(L, 1) + ' m' + (q.rev ? ' · reversed' : ''));
      if (c) {
        s('text', { x: x + 3, y: 49, class: 'end-tag' }, q.rev ? '2' : '1');
        s('text', { x: x + w - 3, y: 49, 'text-anchor': 'end', class: 'end-tag' }, q.rev ? '1' : '2');
        var g = E.carGeometry(c), eL = q.rev ? g.n2 : g.n1, eR = q.rev ? g.n1 : g.n2;
        var jl = lay.joints[i - 1], jr = lay.joints[i];
        // a shared joint is drawn once, under the joint (by the joint itself, below)
        if (!(q.left === 'shared' && jl && jl.shared)) { bogie(x + eL * k, q.bogieLeft, q.left === 'shared' ? 'Shared end without a matching neighbour' : 'Own bogie'); }
        if (!(q.right === 'shared' && jr && jr.shared)) { bogie(x + (L - eR) * k, q.bogieRight, q.right === 'shared' ? 'Shared end without a matching neighbour' : 'Own bogie'); }
      }
      x += w + gap * k;
    });
    lay.joints.forEach(function (j, i) {
      var jx = starts[i + 1] - gap * k / 2;
      if (j.shared) {
        s('rect', { x: jx - 18, y: 15, width: 36, height: 78, rx: 6, class: 'joint-shared' });
        bogie(jx, cars[i].bogieRight || cars[i + 1].bogieLeft, 'Shared bogie (articulated joint)');
        s('text', { x: jx, y: 101, 'text-anchor': 'middle', class: 'car-no' }, 'shared');
      }
      if (!j.ok || !j.bogieOk) {
        var m = s('circle', { cx: jx, cy: 35, r: 8, class: 'joint-bad' });
        m.appendChild(doc.createElementNS(ns, 'title')).textContent = j.text;
        s('text', { x: jx, y: 39, 'text-anchor': 'middle', class: 'joint-bad-text' }, '!');
      }
    });
    s('line', { x1: 6, y1: 73, x2: W - 6, y2: 73, class: 'rail' });
    box.appendChild(svg);
    var nsh = lay.joints.filter(function (j) { return j.shared; }).length;
    box.appendChild(el('p', { class: 'muted', text: cars.length + ' cars · train length over bodies ' + fmt(total, 2) + ' m · ' + nsh + ' shared bogie' + (nsh === 1 ? '' : 's') +
      ' · small numbers 1 / 2 = car ends · filled bogie = motor (name starting with M)' }));
    if (lay.issues.length) { box.appendChild(el('ul', { class: 'err' }, lay.issues.map(function (x) { return el('li', { text: x }); }))); }
  }

  // ---------------------------------------------------------------- Car body & Bogie
  function renderBogie() {
    M.syncBodies(state.p);
    grid($('g-bodies'), state.p.bodies, S.body, {
      refs: { car: carNames }, canDelete: false,
      groups: { car: 'Car type', wind_len_m: 'Wind (equivalent cant method)', uf_h_mm: 'Lower parts', s_tare: 'Flexibility coefficient and roll centre – SPECIFIED (sway test or bogie supplier)', eta0_deg: 'EN 15273-2 (static option)' }
    });
    table($('t-lower'), state.p.lowerParts, S.lowerPart, {
      addLabel: 'Add lower part',
      refs: { car: function () { return state.p.train.carTypes.map(function (c) { return c.name; }); } },
      newRow: function () { var t = state.p.lowerParts, last = t[t.length - 1], r = S.defaults(S.lowerPart); r.car = last ? last.car : ((state.p.train.carTypes[0] || {}).name || ''); return r; }
    });
    form($('f-wind'), S.trainWind, state.p.train);
    grid($('g-bogies'), state.p.bogies, S.bogie, {
      groups: { name: 'Bogie type', p_m: '1. Geometry and lateral plays', wheel_new_mm: '2. Vertical travels', mass_t: 'Mass and axles',
        kz_prim: '3. Suspension stiffness (theoretical s and hc)', en_s_frame: 'EN 15273-2 bogie parts (A.3.11)', bb_mm: '4. Play calculator inputs (information)' },
      addLabel: 'Add bogie type',
      newItem: function () { var b = M.record(S.defaults(S.bogie), S.bogie); b.name = uniqueName('B', state.p.bogies); return b; },
      onChange: function (it, k, old) { if (k === 'name') { renameRefs(state.p.train.carTypes, ['bogie1', 'bogie2'], old, it.name); renameRefs(state.p.bogieParts, ['bogie'], old, it.name); renameRefs(state.p.ccds, ['bogie'], old, it.name); } }
    });
    table($('t-bogie-parts'), state.p.bogieParts, S.bogiePart, {
      addLabel: 'Add bogie part',
      refs: { bogie: function () { return state.p.bogies.map(function (b) { return b.name; }); } },
      newRow: function () { var t = state.p.bogieParts, last = t[t.length - 1], r = S.defaults(S.bogiePart); r.bogie = last ? last.bogie : ((state.p.bogies[0] || {}).name || ''); return r; }
    });
    var ccdNames = function () { return state.p.ccds.map(function (c) { return c.name; }); };
    table($('t-ccd'), state.p.ccds, S.ccd, {
      addLabel: 'Add CCD',
      refs: { bogie: function () { return state.p.bogies.map(function (b) { return b.name; }); } },
      newRow: function () { var r = S.defaults(S.ccd); r.name = uniqueName('CCD-', state.p.ccds); r.bogie = (state.p.bogies[0] || {}).name || ''; return r; },
      onChange: function (it, k, old) { if (k === 'name') { renameRefs(state.p.ccdPoints, ['ccd'], old, it.name); } }
    });
    table($('t-ccd-pts'), state.p.ccdPoints, S.ccdPoint, {
      addLabel: 'Add point', refs: { ccd: ccdNames },
      newRow: function () { var t = state.p.ccdPoints, last = t[t.length - 1], r = S.defaults(S.ccdPoint); if (last) { r.ccd = last.ccd; r.state = last.state; r.part = last.part; } else { r.ccd = ccdNames()[0] || ''; } return r; }
    });
    calcBody(); calcPlay();
  }
  function calcBody() {
    var o = staticOpts(), cars = state.p.train.carTypes, ds = cars.map(function (c) { return E.deriveCar(state.p, c, o); });
    function row(label, unit, fn, d) { return [label, unit].concat(ds.map(function (x) { var v = fn(x); return typeof v === 'object' && v !== null ? v : fmt(v, d); })); }
    function chk(v) { return { v: v, cls: v === 'OK' ? 'okcell' : 'badcell' }; }
    roTable($('cm-body'), ['Quantity', 'Unit'].concat(cars.map(function (c) { return c.name; })), [
      row('Wind-exposed area Aw', 'm²', function (d) { return d.wind.Aw; }, 2),
      row('Wind coefficient tare Cw0 (D = Cw·V²)', 'mm/(km/h)²', function (d) { return d.wind.Cw_t; }, 6),
      row('Wind coefficient crush Cw4', 'mm/(km/h)²', function (d) { return d.wind.Cw_c; }, 6),
      row('Wind force at open-line wind speed F', 'N', function (d) { return d.wind.F; }, 0),
      row('Wind equivalent cant tare Dw0', 'mm', function (d) { return d.wind.Dw_t; }, 2),
      row('Wind equivalent cant crush Dw4', 'mm', function (d) { return d.wind.Dw_c; }, 2),
      row('Radial wheel wear used Δw', 'mm', function (d) { return d.bogie.dn_wheel; }, 1),
      row('Total downward movement Σd (' + (o.vert_state === 'inflated' ? 'inflated' : 'deflated') + ')', 'mm', function (d) { return d.dn_total; }, 1),
      row('Total upward movement Σu', 'mm', function (d) { return d.up_total; }, 1),
      row('Camber / sag / pitch / unevenness / rail wear (§5.3c): up / down at mid-car', 'mm', function (d) { var v = d.vert(d.geo.a / 2, true); return { v: fmt(v.up, 1) + ' / ' + fmt(v.dn, 1) }; }),
      row('… up / down at the car end', 'mm', function (d) { var v = d.vert(d.geo.n_end, false); return { v: fmt(v.up, 1) + ' / ' + fmt(v.dn, 1) }; }),
      row('Secondary lateral play used w*', 'mm', function (d) { return d.w_use; }, 1),
      row('w_i(R) / w_a(R) at 250 m (inside / outside)', 'mm', function (d) { return { v: fmt(d.wi(250), 1) + ' / ' + fmt(d.wa(250), 1) }; }),
      row('w_i(R) / w_a(R) at 150 m (inside / outside)', 'mm', function (d) { return { v: fmt(d.wi(150), 1) + ' / ' + fmt(d.wa(150), 1) }; }),
      row('w_i(R) / w_a(R) at the static radius Rs', 'mm', function (d) { var R = n0(state.p.track.params.R_static_m); return { v: R > 0 ? fmt(d.wi(R), 1) + ' / ' + fmt(d.wa(R), 1) : 'tangent: ' + fmt(d.w_use, 1) }; }),
      row('Roll-stiffness share ψ', '–', function (d) { return d.theoretical.roll_share; }, 2),
      row('Theoretical hc – tare / crush / deflated', 'm', function (d) { var t = d.theoretical; return { v: fmt(t.tare.hc, 3) + ' / ' + fmt(t.crush.hc, 3) + ' / ' + fmt(t.defl.hc, 3) }; }),
      row('Theoretical s – tare / crush / deflated', '–', function (d) { var t = d.theoretical; return { v: fmt(t.tare.s, 3) + ' / ' + fmt(t.crush.s, 3) + ' / ' + fmt(t.defl.s, 3) }; }),
      row('Plausibility of theoretical s', '', function (d) { var t = d.theoretical, w = [t.tare.check, t.crush.check, t.defl.check].filter(function (x) { return x !== 'OK'; }); return chk(w.length ? w[0] : 'OK'); }),
      row('s used – tare / crush (' + (o.flex === 'theoretical' ? 'theoretical' : 'specified') + ')', '–', function (d) { return { v: fmt(d.s_t, 3) + ' / ' + fmt(d.s_c, 3) }; }),
      row('hc used – tare / crush', 'm', function (d) { return { v: fmt(d.hc_t, 3) + ' / ' + fmt(d.hc_c, 3) }; }),
      row('Bogie load end 1 / end 2 (crush)', 't', function (d) { return { v: fmt(d.shared.Q1 / 1000, 2) + ' / ' + fmt(d.shared.Q2 / 1000, 2) }; }),
      row('Maximum axle load P', 't', function (d) { return d.shared.axle_t; }, 2),
      row('Axle-load check', '', function (d) { return chk(d.shared.axle_ok ? 'OK' : 'EXCEEDS LIMIT'); }),
      row('Mid-throw / end-throw at Rmin – this arrangement', 'mm', function (d) { return { v: fmt(d.shared.mt, 1) + ' / ' + fmt(d.shared.et, 1) }; }),
      row('Mid-throw / end-throw at Rmin – non-shared reference', 'mm', function (d) { return { v: fmt(d.shared.mt_ref, 1) + ' / ' + fmt(d.shared.et_ref, 1) }; }),
      row('Body width lost vs non-shared (both sides)', 'mm', function (d) { return d.shared.width_loss; }, 1),
      row('Largest pivot distance for the non-shared mid-throw', 'm', function (d) { return d.shared.a_max; }, 3)
    ]);
  }
  function calcPlay() {
    var rows = state.p.bogies.map(function (b) {
      var r = E.playCalc(state.p, b), d = r.half_worn - b.play_ld_mm;
      return [b.name, fmt(r.l, 1), fmt(r.d_new, 1), fmt(r.d_worn, 1), fmt(r.half_new, 2), fmt(r.half_worn, 2), fmt(b.play_ld_mm, 2), { v: fmt(d, 2), cls: d > 0.01 ? 'warncell' : '' }];
    });
    roTable($('calc-play'), ['Bogie', 'Track gauge l = nominal + tolerance (mm)', 'd new (mm)', 'd worn (mm)', 'Half play new (mm)', 'Half play worn (mm)', 'Play used (mm)', 'Worn − used (mm)'], rows);
  }

  // ---------------------------------------------------------------- KE & SOD, RS
  function previewSel(boxId, key, chartId) {
    var box = $(boxId), pv = state.pv[key];
    clear(box);
    [['ke', 'KE'], ['sod', 'SOD'], ['rs', 'RS profiles'], ['items', 'SOD items']].forEach(function (o) {
      var c = el('input', { type: 'checkbox', checked: pv[o[0]], on: { change: function () { pv[o[0]] = c.checked; profileChart(chartId, key); } } });
      box.appendChild(el('label', { class: 'check' }, [c, o[1]]));
    });
  }
  function renderKE() {
    profileSet($('ps-ke'), 'ke', state.p.ke.profiles, S.keProfile, { newName: 'KE', onRename: function (old, nu) {
      renameRefs(state.p.track.segments, ['ke'], old, nu); if (staticOpts().ke === old) { staticOpts().ke = nu; }
    } });
    profileSet($('ps-sod'), 'sod', state.p.sod.profiles, S.sodProfile, { newName: 'SOD', onRename: function (old, nu) { renameRefs(state.p.track.segments, ['sod'], old, nu); } });
    form($('f-limits'), S.customerLimits, state.p.ke.limits);
    table($('t-sod-items'), state.p.sod.items, S.sodItem, { addLabel: 'Add item' });
    form($('f-sod'), S.sodSettings, state.p.sod);
    form($('f-en'), S.enParams, state.p.ke.en, function (k) {
      if (k === 'en_gauge') {
        var v = S.enGaugeValues(state.p.ke.en.en_gauge);
        if (v) { Object.keys(v).forEach(function (x) { state.p.ke.en[x] = v[x]; }); changed(true); return; }
      }
      changed(false);
    });
    form($('f-third'), S.thirdRail, state.p.thirdRail, null, { tr_ke: function () { return [''].concat(keNames()); } });
    table($('t-tr-parts'), state.p.thirdRail.parts, S.trPart, { addLabel: 'Add part' });
    previewSel('pv-ke-sel', 'ke', 'chart-ke');
    profileChart('chart-ke', 'ke');
  }
  function renderRS() {
    $('rs-study-note').hidden = state.p.train.study !== 'backward';
    profileSet($('ps-rs'), 'rs', state.p.rs.profiles, S.rsProfile, { newName: 'RS profile', onRename: function (old, nu) {
      renameRefs(state.p.train.carTypes, ['prof_int', 'prof_ext', 'prof_end'], old, nu);
      renameRefs(state.p.sections, ['profile'], old, nu);
    } });
    previewSel('pv-rs-sel', 'rs', 'chart-rs');
    profileChart('chart-rs', 'rs');
    table($('t-doors'), state.p.doorSteps, S.doorStep, {
      addLabel: 'Add door / step',
      refs: { car: function () { return state.p.train.carTypes.map(function (c) { return c.name; }); } },
      newRow: function () { var t = state.p.doorSteps, last = t[t.length - 1], r = S.defaults(S.doorStep); r.car = last ? last.car : ((state.p.train.carTypes[0] || {}).name || ''); return r; }
    });
    table($('t-panto'), state.p.pantographs, S.pantograph, {
      addLabel: 'Add pantograph',
      refs: { car: function () { return state.p.train.carTypes.map(function (c) { return c.name; }); } },
      newRow: function () { var t = state.p.pantographs, last = t[t.length - 1], r = S.defaults(S.pantograph); r.car = last ? last.car : ((state.p.train.carTypes[0] || {}).name || ''); return r; }
    });
  }

  // Applies the default checks (and EN rules) of the chosen framework (METHOD §16).
  function applyFramework() {
    var t = state.p.train, fw = S.frameworkDefaults[t.framework] || {}, so = state.p.settings['static'];
    Object.keys(fw['static'] || {}).forEach(function (k) { so[k] = fw['static'][k]; });
    var g = S.frameworkGauge(t), v = g ? S.enGaugeValues(g) : null;
    if (v) { Object.keys(v).forEach(function (k) { state.p.ke.en[k] = v[k]; }); state.p.ke.en.en_gauge = g; }
  }
  function renderFramework() {
    var t = state.p.train, fw = S.frameworkDefaults[t.framework] || {}, so = staticOpts(), name = (S.FRAMEWORKS.filter(function (x) { return x[0] === t.framework; })[0] || [])[1] || t.framework;
    function yn(v) { return v === 'yes' ? 'Yes' : 'No'; }
    function rowFor(label, key, note) { var def = (fw['static'] || {})[key]; return [label, def === undefined ? '–' : yn(def), { v: yn(so[key]) + (def !== undefined && def !== so[key] ? ' (changed)' : ''), cls: def !== undefined && def !== so[key] ? 'warncell' : '' }, note || '']; }
    var g = S.frameworkGauge(t), rows = [
      ['Framework', name, '', t.framework === 'ebo' ? 'EBO Anlage 9 specifics pending the documents' : (t.framework === 'bostrab' ? 'BOStrab-Lichtraum-Richtlinien pending the documents' : '')],
      ['Customer KE: Method B (3 sections × load cases) and Method A', 'Yes', 'Yes', 'Always'],
      rowFor('EN 15273-2 kinematic check', 'en_check', g ? 'Rules of gauge ' + g + (state.p.ke.en.en_gauge !== g ? ' (now ' + state.p.ke.en.en_gauge + ')' : '') : ''),
      rowFor('EN 15273-2 static gauge method', 'en_static', ''),
      rowFor('BOStrab §34 vehicle dimensions', 'bst_check', t.bostrab_street === 'yes' ? 'Street-running vehicle' : 'Applies to street-running vehicles only'),
      ['Third-rail CCD', 'when given', (state.p.ccds || []).length ? 'Yes (' + state.p.ccds.length + ' CCD)' : 'No CCD given', 'METHOD §14'],
      ['EN dynamic method (Annex O)', 'when given', (state.p.sim.transient || []).length ? 'Yes' : 'No simulation results', 'EN Dynamic Method tab']
    ];
    roTable($('ssim-fw'), ['Check', 'Framework default', 'Current', 'Note'], rows);
  }

  // ---------------------------------------------------------------- Track
  function renderTrack() {
    var tp = state.p.track.params;
    form($('f-track-op'), S.trackOperating, tp); form($('f-track-tol'), S.trackTolerances, tp);
    form($('f-track-st'), S.trackStatic, tp); form($('f-track-sw'), S.trackSweep, tp);
    table($('t-track'), state.p.track.segments, S.segment, {
      addLabel: 'Add element',
      refs: { ke: keNames, sod: function () { return [''].concat(state.p.sod.profiles.map(function (x) { return x.name; })); } },
      newRow: function () {
        var seg = state.p.track.segments, last = seg[seg.length - 1], r = S.defaults(S.segment);
        r.from_m = last ? last.to_m : 0; r.to_m = r.from_m !== null ? r.from_m + 100 : null;
        r.ke = last ? last.ke : (keNames()[0] || ''); if (last) { r.speed_kmh = last.speed_kmh; r.location = last.location === 'platform' ? 'open' : last.location; }
        return r;
      }
    });
    trackChart();
  }

  // ---------------------------------------------------------------- Static Simulation
  var STUDY_TXT = { both: 'Study direction: Both – the maximum construction gauge is derived from the customer KE (backward) and the RS profiles are checked (forward).',
    backward: 'Study direction: Backward – the maximum construction gauge is derived from the customer KE and used as the section profiles; no RS profile is needed.',
    forward: 'Study direction: Forward – the RS profiles are checked against the customer KE (no gauge outline is derived).' };
  function renderSsim() {
    var o = staticOpts();
    $('ssim-study').textContent = STUDY_TXT[state.p.train.study] || STUDY_TXT.both;
    form($('f-static'), S.staticOptions, o, function () { changed(false); renderFramework(); }, { ke: keNames, en_static_ref: function () { return [''].concat(keNames()); } });
    renderFramework();
    carPicker($('ssim-cars'), o);
    readiness($('ready-ssim'), 'static');
  }
  function carPicker(box, o) {
    clear(box);
    var want = (o.cars && o.cars !== 'all') ? String(o.cars).split(',') : null;
    var all = el('input', { type: 'checkbox', checked: !want });
    all.addEventListener('change', function () { o.cars = all.checked ? 'all' : carNames().join(','); changed(true); });
    box.appendChild(el('label', { class: 'check' }, [all, el('strong', { text: 'All car types' })]));
    carNames().forEach(function (n) {
      var c = el('input', { type: 'checkbox', checked: !want || want.indexOf(n) >= 0, disabled: !want });
      c.addEventListener('change', function () {
        var cur = (o.cars && o.cars !== 'all') ? String(o.cars).split(',') : carNames();
        cur = c.checked ? cur.concat([n]) : cur.filter(function (x) { return x !== n; });
        o.cars = cur.filter(function (x, i) { return cur.indexOf(x) === i; }).join(','); changed(false);
      });
      box.appendChild(el('label', { class: 'check' }, [c, n]));
    });
  }
  function readiness(box, run) {
    clear(box);
    var v = state.validation, rd = M.readiness(v, run || 'static');
    box.appendChild(el('p', { class: rd.ok ? 'pill ok' : 'pill err', text: rd.ok ? 'Inputs complete' + (v.warnings ? ' (' + v.warnings + ' warning' + (v.warnings > 1 ? 's' : '') + ')' : '') + ' – ready to run.' : rd.errors + ' input error(s) to fix first – see Overall Summary.' }));
    if (!rd.ok) { box.appendChild(el('ul', { class: 'errlist' }, rd.messages.slice(0, 4).map(function (m) { return el('li', { text: INPUT_TABS[m.tab] + ': ' + m.text }); }))); }
    $(run === 'dynamic' ? 'btn-run-dynamic' : 'btn-run-static').disabled = !rd.ok;
  }
  function runStatic() {
    var v = M.validate(state.p);
    if (!M.readiness(v, 'static').ok) { $('ssim-status').textContent = 'Fix the input errors first.'; return; }
    var t0 = Date.now();
    try {
      state.run = E.staticRun(state.p, staticOpts());
      state.runKey = inputsKey(state.p);
      if (!state.resCar || !state.run.cars.some(function (c) { return c.car === state.resCar; })) { state.resCar = state.run.governing ? state.run.governing.car : (state.run.cars[0] && state.run.cars[0].car); }
      if (state.run.governing) { state.resCase = state.run.governing.id; }
      $('ssim-status').textContent = 'Done in ' + (Date.now() - t0) + ' ms: ' + (state.run.ok ? 'all checks OK' : 'CHECK – see Static Results') + '.';
      activate('sres'); refresh();
    } catch (e) { $('ssim-status').textContent = 'Run failed: ' + e.message; }
  }

  // ---------------------------------------------------------------- Static Results
  function stale() { return state.run && state.runKey !== inputsKey(state.p); }
  function cCell(v) { return { v: fmt(v, 1), cls: v >= 0 ? 'okcell' : 'badcell' }; }
  function renderSres() {
    var r = state.run;
    $('sres-empty').hidden = !!r; $('sres-body').hidden = !r;
    if (!r) { return; }
    $('sres-stale').textContent = stale() ? 'Inputs or options changed since this run – press Run static simulation again.' : '';
    var selCar = $('sres-car'); clear(selCar);
    r.cars.forEach(function (c) { selCar.appendChild(el('option', { value: c.car, text: c.car + (c.ok ? '' : ' (CHECK)'), selected: c.car === state.resCar })); });
    var c = r.cars.filter(function (x) { return x.car === state.resCar; })[0] || r.cars[0];
    if (!c) { return; }
    state.resCar = c.car;
    // cards
    var cards = clear($('sres-cards')), g = r.governing;
    function stat(k, v, u, key) { cards.appendChild(el('div', { class: 'stat' + (key ? ' key' : '') }, [el('div', { class: 'v' }, [v, u ? el('span', { class: 'u', text: ' ' + u }) : null]), el('div', { class: 'k', text: k })])); }
    var bw = r.study === 'backward';
    $('sres-table-h').firstChild.textContent = bw ? 'Closure of the derived gauge with the customer KE by car type and case ' : 'Minimum clearance to the customer KE by car type and case ';
    if (c.mcg && c.mcg.car.ok) { stat('Max construction gauge – ' + c.car + ' whole car', fmt(c.mcg.car.maxWidth, 1) + ' / ' + fmt(c.mcg.car.top, 0), 'mm half-width / top', bw); }
    stat(bw ? 'Closure (gauge vs KE, ≈ 0 by construction)' : 'Governing clearance', g ? fmt(g.c, 1) : '—', 'mm', !bw);
    stat('Governing car and case', g ? g.car + ' · ' + g.label : '—');
    stat('Status', r.ok ? 'ALL OK' : 'CHECK');
    stat('Customer KE', r.ke.name);
    var lowV = null; r.cars.forEach(function (x) { x.vertical.forEach(function (v) { if (!v.info && (!lowV || v.margin < lowV.margin)) { lowV = { car: x.car, label: v.label, margin: v.margin }; } }); });
    stat('Smallest vertical margin', lowV ? fmt(lowV.margin, 1) : '—', 'mm');
    // table car x case
    function std(x) { return x.cases.filter(function (k) { return !k.extra; }); }
    var anyX = r.cars.some(function (x) { return x.cases.some(function (k) { return k.extra; }); });
    var head = ['Car type'].concat((r.cars[0] ? std(r.cars[0]) : E.CASES).map(function (k) { return k.label; }), anyX ? ['Additional sections (worst)'] : [], ['Governing', 'Vertical checks', 'Axle load (t)']);
    roTable($('sres-table'), head, r.cars.map(function (x) {
      var vOk = x.vertical.every(function (v) { return v.info || v.ok; });
      var wx = null; x.cases.forEach(function (k) { if (k.extra && k.min && (!wx || k.min.c < wx.min.c)) { wx = k; } });
      var xcell = !anyX ? [] : [wx ? { v: fmt(wx.min.c, 1) + ' (' + wx.label + ')', cls: wx.ok ? 'okcell' : 'badcell' } : '–'];
      return { cls: x.car === c.car ? 'selrow' : '', cells: [x.car].concat(std(x).map(function (k) { return { v: fmt(k.min.c, 1) + ' @ ' + k.min.pt, cls: k.ok ? 'okcell' : 'badcell', title: k.profile }; }), xcell,
        [x.governing ? x.governing.label : '', { v: vOk ? 'OK' : 'CHECK', cls: vOk ? 'okcell' : 'badcell' }, { v: fmt(x.derived.shared.axle_t, 2), cls: x.derived.shared.axle_ok ? '' : 'badcell' }]) };
    }), 'results');
    renderSresMcg(r, c);
    // section charts
    ['int', 'ext', 'end'].forEach(function (sec) { sectionChart('chart-sec-' + sec, r, c.car, sec); });
    // build-up
    var keys = [['n', 'Section position from pivot', 'm', 3], ['A', 'Yaw factor A', '–', 4], ['dg', 'Geometric overthrow at Rs', 'mm', 1], ['play', 'Wheel–rail half play × A', 'mm', 2], ['q', 'Primary lateral play × A', 'mm', 2],
      ['wi', 'w_i(Rs) – clearance towards the inside of the curve', 'mm', 2], ['wa', 'w_a(Rs) – clearance towards the outside of the curve', 'mm', 2],
      ['w', 'Secondary lateral play: w∞·A, on a curve w_i (between) or w_i·n/a + w_a·(n + a)/a (beyond)', 'mm', 2], ['fw', 'Rail gauge-face wear × A', 'mm', 2], ['widen', 'Gauge widening/2 × A', 'mm', 2], ['T', 'Quasi-static translation T', 'mm', 2, true],
      ['rnd_gauge', 'Random: track gauge tolerance', 'mm', 2], ['rnd_align', 'Random: alignment tolerance', 'mm', 2], ['cant', 'Cant excess (interior) / deficiency (exterior, end)', 'mm', 1], ['wind', 'Wind equivalent cant', 'mm', 2],
      ['cl', 'Cross-level error', 'mm', 1], ['s', 'Flexibility coefficient s', '–', 3], ['hc', 'Roll-centre height hc', 'm', 3], ['thq', 'Roll angle – quasi-static θq = s·(cant + wind)/G', 'rad', 5, true], ['thr', 'Roll angle – cross-level θr (random)', 'rad', 5],
      ['tht', 'Rigid tilt – cross-level θt', 'rad', 5], ['thtot', 'Total angle for vertical shift', 'rad', 5], ['drop', 'Body lowering Δz from tare', 'mm', 1], ['up', 'Upward movement combined with roll', 'mm', 1]];
    roTable($('sres-buildup'), ['Quantity', 'Unit'].concat(c.cases.map(function (k) { return k.label; })), keys.map(function (k) {
      return { cls: k[4] ? 'b' : '', cells: [k[1], k[2]].concat(c.cases.map(function (cs) { return fmt(cs.params[k[0]], k[3]); })) };
    }).concat([{ cls: 'total', cells: ['Minimum clearance', 'mm'].concat(c.cases.map(function (cs) { return cCell(cs.min.c); })) },
      { cells: ['At profile point (profile)', ''].concat(c.cases.map(function (cs) { return cs.min.pt + ' (' + cs.profile + ')'; })) }]));
    // points of a case
    var sc = $('sres-case'); clear(sc);
    c.cases.forEach(function (k) { sc.appendChild(el('option', { value: k.id, text: k.label, selected: k.id === state.resCase })); });
    var cs = c.cases.filter(function (k) { return k.id === state.resCase; })[0] || c.cases[0];
    roTable($('sres-points'), ['Pt', 'x0 static', 'h0 static', 'Lateral E', 'x displaced', 'h displaced', 'KE width at h', 'ΔX horizontal', 'KE height at x', 'ΔH vertical', 'Clearance', 'Status'],
      cs.points.map(function (q) { return { cls: q === cs.min ? 'selrow' : '', cells: [q.pt, fmt(q.x0, 1), fmt(q.h0, 1), fmt(q.E, 2), fmt(q.x, 1), fmt(q.h, 1), fmt(q.W, 1), fmt(q.dX, 1), fmt(q.H, 1), fmt(q.dH, 1), cCell(q.c), q.ok ? 'OK' : 'INFRINGES'] }; }));
    // Method A
    methodAChart(r, c.car);
    function mcell(v) { return v === null ? '' : { v: fmt(v, 1), cls: v >= 0 ? '' : 'badcell' }; }
    var xsA = c.extraSections || [];
    roTable($('sres-methodA'), ['h', 'KE width', 'Max static Int', 'Max static Ext', 'Max static End', 'Margin Int', 'Margin Ext', 'Margin End'].concat(
      xsA.map(function (q) { return 'Max static ' + q.name; }), xsA.map(function (q) { return 'Margin ' + q.name; })),
      c.methodA.map(function (x) {
        return [fmt(x.h, 0), fmt(x.W, 1), fmt(x.max_int, 1), fmt(x.max_ext, 1), fmt(x.max_end, 1), mcell(x.margin_int), mcell(x.margin_ext), mcell(x.margin_end)].concat(
          xsA.map(function (q) { return fmt(x['max_' + q.key], 1); }), xsA.map(function (q) { return mcell(x['margin_' + q.key]); }));
      }));
    renderSresEn(r, c);
    renderSresCcd(r);
    var bst = c.bostrab;
    $('sres-bst').hidden = !bst;
    if (bst) {
      roTable($('sres-bst-table'), ['Check', 'Value', 'Limit', 'Margin', 'Status'], bst.rows.map(function (x) {
        return [x.label, fmt(x.value, 0) + ' ' + x.unit, fmt(x.limit, 0) + ' ' + x.unit, x.applies ? cCell(x.margin) : '–', x.applies ? (x.ok ? 'OK' : 'EXCEEDS') : x.note];
      }));
    }
    renderSresEnStatic(r, c);
    renderSresXs(r, c);
    renderSresRs(r);
    $('sres-susp').hidden = !(c.susp && c.susp.length);
    if (c.susp && c.susp.length) {
      roTable($('sres-susp-table'), ['End / bogie', 'Load', 'Largest roll (case)', 'Secondary share', 'Roll at the air spring θ₂·b2', 'Δz', 'Low side: travel / margin', 'High side: travel / margin', 'Status'], c.susp.map(function (x) {
        return [x.end + ' / ' + x.bogie, x.load, fmt(x.theta * 1000, 1) + ' mrad (' + x.case + ')', fmt(x.share, 2), fmt(x.roll, 1), fmt(x.dz, 1),
          x.mDn === null ? '–' : { v: fmt(x.bumpDn, 0) + ' / ' + fmt(x.mDn, 1), cls: x.mDn >= 0 ? '' : 'badcell' }, x.mUp === null ? '–' : { v: fmt(x.bumpUp, 0) + ' / ' + fmt(x.mUp, 1), cls: x.mUp >= 0 ? '' : 'badcell' },
          { v: x.ok ? 'OK' : 'ON THE STOP', cls: x.ok ? 'okcell' : 'badcell' }];
      }));
    }
    $('sres-el').hidden = !(c.elStatic && c.elStatic.length);
    if (c.elStatic && c.elStatic.length) {
      roTable($('sres-el-table'), ['Live part', 'Y / Z (mm)', 'Section', 'Profile', 'Distance (mm)', 'Required (mm)', 'Margin (mm)', 'Status'], c.elStatic.map(function (x) {
        return [x.item, fmt(x.y) + ' / ' + fmt(x.z), x.label, x.profile, fmt(x.dist, 1), fmt(x.req), cCell(x.margin), { v: x.ok ? 'OK' : 'TOO CLOSE', cls: x.ok ? 'okcell' : 'badcell' }];
      }));
    }
    // vertical
    roTable($('sres-vertical'), ['Check', 'Value (mm)', 'Limit / reference (mm)', 'Margin (mm)', 'Status'], c.vertical.map(function (v) {
      return v.info ? [v.label, fmt(v.value, 1), '', '', ''] : [v.label, fmt(v.value, 1), fmt(v.limit, 1), cCell(v.margin), { v: v.ok ? 'OK' : (v.id.indexOf('uf') === 0 ? 'BELOW MIN' : 'INFRINGES'), cls: v.ok ? 'okcell' : 'badcell' }];
    }));
  }

  // Rotation stops of every car type (METHOD §5.3b)
  function rsR(v) { return v === Infinity ? 'any (also straight)' : (v === 0 ? '–' : fmt(v, 0)); }
  function renderSresRs(r) {
    var rows = [];
    r.cars.forEach(function (c) { (c.rotStops || []).forEach(function (x) { rows.push([c, x]); }); });
    $('sres-rs').hidden = !rows.length;
    if (!rows.length) { return; }
    roTable($('sres-rs-table'), ['Car type', 'End / bogie', 'x (m)', 'Gap + travel (mm)', 'R min (m)', 'ψ (mrad)', 'Closure ψ·x (mm)', 'Margin to contact (mm)', 'Free rotation',
      'Drift at I + wind (mm)', 'Contact below R – rotation only / in service (m)', 'Line length with contact', 'Comfort', 'w limit ∞ / 250 / 150 (mm)', 'Used in w(R)'], rows.map(function (q) {
      var c = q[0], x = q[1];
      return [c.car, x.end + ' / ' + x.bogie, fmt(x.x, 2), fmt(x.gap, 0) + ' + ' + fmt(x.travel, 0), fmt(x.Rmin, 0), fmt(x.psi * 1000, 2), fmt(x.closure, 1), cCell(x.margin),
        { v: x.ok ? 'OK' : 'BLOCKED (diagonal contact)', cls: x.ok ? 'okcell' : 'badcell' }, fmt(x.yq, 1), rsR(x.Rrot) + ' / ' + rsR(x.Rrun),
        x.lineTotal > 0 ? fmt(x.lineLen, 0) + ' m (' + fmt(x.lineShare, 1) + ' %)' : 'no track data',
        x.comfOk === null ? 'info' : { v: x.comfOk ? 'OK (no contact ≥ ' + fmt(x.Rcomf, 0) + ' m)' : 'CONTACT above ' + fmt(x.Rcomf, 0) + ' m', cls: x.comfOk ? 'okcell' : 'badcell' },
        { v: fmt(x.w_lim.inf, 1) + ' / ' + fmt(x.w_lim.r250, 1) + ' / ' + fmt(x.w_lim.r150, 1), cls: x.wOver && !x.limits ? 'warncell' : '', title: x.wOver && !x.limits ? 'The entered w is larger than the stops allow' : '' },
        x.limits ? 'Yes' : 'No'];
    }));
  }
  // Maximum construction gauge of the selected car type (METHOD §7.3): chart, one row per section, points of the chosen outline
  var MCG_SEC = { car: 'Whole car', int: 'Interior', ext: 'Exterior', end: 'Car end' };
  function mcgKeys(c) { return ['car', 'int', 'ext', 'end'].concat((c.extraSections || []).map(function (q) { return q.key; })); }
  function mcgLabel(c, k) { if (MCG_SEC[k]) { return MCG_SEC[k]; } var q = (c.extraSections || []).filter(function (x) { return x.key === k; })[0]; return q ? q.name : k; }
  function renderSresMcg(r, c) {
    var m = c.mcg, box = $('sres-mcg');
    box.hidden = !m;
    if (!m) { return; }
    var sel = $('sres-mcg-sel'); clear(sel);
    var opts = [['all', 'Whole car + sections']].concat(mcgKeys(c).map(function (k) { return [k, mcgLabel(c, k)]; }));
    if (!opts.some(function (o) { return o[0] === state.mcgSel; })) { state.mcgSel = 'all'; }
    opts.forEach(function (o) { sel.appendChild(el('option', { value: o[0], text: o[1], selected: o[0] === state.mcgSel })); });
    $('sres-mcg-hint').textContent = 'At every height: the largest half-width whose point stays inside the KE in every load case of the section (Method B movements). Top = KE top − Σu ' +
      (m.upRoll ? '(Σu combined with roll)' : '(' + fmt(m.up, 1) + ' mm, centre line)') + ' = ' + fmt(m.top, 1) + ' mm; bottom on the centre line = cb ' + fmt(m.cb, 0) + ' + Σd ' + fmt(m.dn, 1) +
      ' + vertical curve ' + fmt(m.vc, 1) + ' (+ sag / unevenness / rail wear, §5.3c) = ' + fmt(m.bottom, 1) + ' mm (whole car), rising with the crush roll angle ' + fmt(m.th * 1000, 2) + ' mrad towards the side. Height step ' + fmt(m.step, 0) + ' mm, refined where needed.';
    var both = r.study === 'both';
    roTable($('sres-mcg-info'), ['Section', 'Top', 'Bottom', 'Largest half-width', 'Points'].concat(both ? ['RS profile', 'RS margin side / top'] : [], ['Status']), mcgKeys(c).map(function (k) {
      var q = m[k];
      if (!q.ok) { return [mcgLabel(c, k), '–', '–', '–', '–'].concat(both ? ['', ''] : [], [{ v: 'NO GAUGE', cls: 'badcell', title: q.warn.join(' ') }]); }
      var rs = q.rs, rsOk = !rs || rs.ok;
      return { cls: k === state.mcgSel ? 'selrow' : '', cells: [mcgLabel(c, k), fmt(q.top, 1), fmt(q.bottom, 1), fmt(q.maxWidth, 1), String(q.points.length)].concat(both ? [rs ? rs.profile : '–',
        rs ? { v: (rs.min ? fmt(rs.min.margin, 1) + ' (' + rs.min.pt + ')' : '–') + ' / ' + fmt(rs.topMargin, 1), cls: rsOk ? 'okcell' : 'badcell' } : '–'] : [],
        [{ v: q.warn.length ? 'OK (see warnings)' : 'OK', cls: 'okcell', title: q.warn.join(' ') }]) };
    }));
    var cols = { ke: cssVar('--c1', '#2563eb'), car: cssVar('--c4', '#dc2626'), int: cssVar('--c3', '#059669'), ext: cssVar('--c5', '#7c3aed'), end: cssVar('--c2', '#d97706'), rs: '#6b7280' };
    var ds = P.mcgDatasets(r, c.car, state.mcgSel, cols);
    scatterChart('chart-mcg', ds, P.profileAxes(ds), null, null, null, 'bottom');
    var shown = m[state.mcgSel === 'all' ? 'car' : state.mcgSel];
    roTable($('sres-mcg-points'), ['Pt', 'Y', 'Z'], shown && shown.ok ? shown.points.map(function (q) { return [q.pt, fmt(q.y, 1), fmt(q.z, 1)]; }) : []);
  }
  // Copy the outlines of the selected car type to the RS Profile tab (replacing profiles of the same name)
  function copyMcg() {
    var r = state.run, c = r && r.cars.filter(function (x) { return x.car === state.resCar; })[0];
    if (!c || !c.mcg) { return; }
    var n = 0;
    mcgKeys(c).forEach(function (k) {
      var m = c.mcg[k]; if (!m.ok) { return; }
      var pr = { name: m.name, note: 'Maximum construction gauge derived from the customer KE ' + r.ke.name + ' (' + mcgLabel(c, k) + ')', points: m.points.map(function (q) { return { pt: q.pt, y: q.y, z: q.z }; }) };
      var list = state.p.rs.profiles, i = -1;
      list.forEach(function (x, j) { if (x.name === m.name) { i = j; } });
      if (i >= 0) { list[i] = M.record(pr, S.rsProfile); list[i].points = pr.points; } else { var nr = M.record(pr, S.rsProfile); nr.points = pr.points; list.push(nr); }
      n++;
    });
    changed(true);
    $('sres-stale').textContent = n + ' outline(s) of ' + c.car + ' copied to the RS Profile tab.';
  }

  // Additional sections of the selected car type: one row per section (cases per load), chart of the chosen one
  function renderSresXs(r, c) {
    var xs = c.extraSections || [], box = $('sres-xs');
    box.hidden = !xs.length;
    if (!xs.length) { return; }
    var loads = c.derived.loads.map(function (L) { return L.name; });
    roTable($('sres-xs-table'), ['Section', 'Position', 'Between / beyond the pivots', 'n (m)', 'Yaw factor A', 'Profile'].concat(loads.map(function (n) { return 'Min clearance ' + n + ' (mm)'; }), ['Status']),
      xs.map(function (q) {
        var ks = c.cases.filter(function (k) { return k.section === q.key; }), ok = ks.every(function (k) { return k.ok; });
        return [q.name, fmt(q.dist, 3) + ' m from body ' + (q.ref_end === 'end2' ? 'end 2' : 'end 1'), q.pos === 'beyond' ? 'beyond (' + (q.side === 'end1' ? 'end 1' : 'end 2') + ' side)' : 'between', fmt(q.n, 3), fmt(q.A, 4), q.profile]
          .concat(ks.map(function (k) { return { v: fmt(k.min.c, 1) + ' @ ' + k.min.pt, cls: k.ok ? 'okcell' : 'badcell' }; }), [{ v: ok ? 'OK' : 'INFRINGES', cls: ok ? 'okcell' : 'badcell' }]);
      }));
    var sel = $('sres-xs-sel'); clear(sel);
    if (!xs.some(function (q) { return q.key === state.resXs; })) { state.resXs = xs[0].key; }
    xs.forEach(function (q) { sel.appendChild(el('option', { value: q.key, text: q.name, selected: q.key === state.resXs })); });
    sectionChart('chart-sec-xs', r, c.car, state.resXs);
  }

  var SEC_NAMES = { int: 'Interior', ext: 'Exterior', end: 'Car end' };
  function renderSresEn(r, c) {
    var box = $('sres-en'), en = c.en;
    box.hidden = !en;
    if (!en) { return; }
    var R = en.rules;
    roTable($('sres-en-info'), ['Item', 'Interior', 'Exterior', 'Car end'], [].concat([
      ['Reference gauge / formula set', en.gauge + ' / ' + ({ traction: 'Traction unit', coach: 'Coach', motor: 'Motor coach' })[en.set] + ' – ' + en.clause, '', ''],
      en.varW || en.nonlin ? ['Secondary play w per bogie: ∞ / 250 m / 150 m' + (en.nonlin ? ' / variable stops' : '') + ' (mm)', en.bogies.map(function (b) {
        return b.name + ': ' + fmt(b.winf * 1000, 1) + ' / ' + fmt(b.w250 * 1000, 1) + ' / ' + fmt(b.w150 * 1000, 1) + (b.Rv ? ' / ' + fmt(b.wv * 1000, 1) + ' from R ' + fmt(b.Rv, 0) + ' m' : '');
      }).join('; '), '', ''] : null,
      ['Position n from the bogie centre (m)'].concat(['int', 'ext', 'end'].map(function (k) { return fmt(en.sections[k].n, 3); })),
      ['Δ = a·n ∓ n² ± p²/4 (m²)'].concat(['int', 'ext', 'end'].map(function (k) { return fmt(en.sections[k].delta, 3); })),
      ['Formula branch – upper / lower parts'].concat(['int', 'ext', 'end'].map(function (k) { return en.sections[k].branch_up + ' / ' + en.sections[k].branch_low; })),
      ['x-term at R2 – upper (mm)'].concat(['int', 'ext', 'end'].map(function (k) { return fmt(en.sections[k].x_up, 2); })),
      ['(l_max − d)/2 with d worn = ' + fmt(en.d, 1) + ' mm', fmt(en.P, 2) + ' mm', '', ''],
      ['q / w used (mm)', fmt(en.q, 1) + ' / ' + fmt(en.w, 1), '', ''],
      ['Rules', 'l_max ' + fmt(R.lmax * 1000, 0) + ' mm, R1 ' + fmt(R.R1, 0) + ' m, R2 ' + fmt(R.R2, 0) + ' m, Ck ' + fmt(R.Ck_low, 2) + ' / ' + fmt(R.Ck_up, 2) + ' m², s0 ' + fmt(R.s0, 2) + ', hc0 ' + fmt(R.hc0 * 1000, 0) + ' mm', '', ''],
      { cls: 'total', cells: ['Minimum margin to the EN maximum construction gauge (mm)'].concat(['int', 'ext', 'end'].map(function (k) { var m = en.checks[k].min; return m ? cCell(m.margin) : ''; })) },
      ['At height (mm) / profile'].concat(['int', 'ext', 'end'].map(function (k) { var m = en.checks[k].min; return m ? fmt(m.h, 0) + ' / ' + en.checks[k].profile : ''; }))
    ]).filter(function (x) { return x; }));
    methodAChart(r, c.car, true);
    function mcell(v) { return v === null ? '' : { v: fmt(v, 1), cls: v >= 0 ? '' : 'badcell' }; }
    roTable($('sres-en-table'), ['h', 'KE width', 'Ei Int', 'Ea Ext', 'Ea End', 'EN max Int', 'Method A Int', 'EN max End', 'Method A End', 'Margin Int', 'Margin Ext', 'Margin End'],
      en.rows.map(function (x) { return [fmt(x.h, 0), fmt(x.W, 1), fmt(x.E_int, 1), fmt(x.E_ext, 1), fmt(x.E_end, 1), fmt(x.max_int, 1), fmt(x.ma_int, 1), fmt(x.max_end, 1), fmt(x.ma_end, 1), mcell(x.margin_int), mcell(x.margin_ext), mcell(x.margin_end)]; }));
    var sec = $('sres-en-sec').value || 'int', ck = en.checks[sec];
    roTable($('sres-en-check'), ['h', 'Profile half-width', 'KE half-width', 'E', 'z_kin', 'Branch', 'Load', 'EN max', 'Margin', 'Status'],
      ck.points.map(function (q) { return { cls: q === ck.min ? 'selrow' : '', cells: [fmt(q.h, 0), fmt(q.x, 1), fmt(q.W, 1), fmt(q.E, 2), fmt(q.z, 2), q.branch, q.load, fmt(q.max, 1), cCell(q.margin), q.ok ? 'OK' : 'EXCEEDS'] }; }));
    renderSresEnVertical(en.vertical);
    var ds = en.doors ? en.doors.rows : [], drows = [];
    $('sres-en-doors').hidden = !ds.length;
    ds.forEach(function (q) {
      var m = q.min;
      drows.push({ cls: '', cells: [q.name, q.kind === 'door' ? 'Door open' : 'Step deployed', q.pos === 'beyond' ? 'Beyond' : 'Between', fmt(q.n, 2), fmt(q.lo, 0) + ' – ' + fmt(q.hi, 0),
        m ? fmt(m.h, 0) : '', m ? fmt(m.max, 1) : '', m ? m.rule : '', m ? fmt(m.extra, 1) : '', m ? fmt(m.allowed, 1) : '', fmt(q.y, 0), m ? cCell(m.margin) : '', q.ok ? 'OK' : 'CHECK'] });
      q.gap.forEach(function (gp) {
        drows.push(['  step position, ' + gp.side + ' of curve', 'b_q0 ' + fmt(gp.bq0, 0), gp.toward ? 'towards platform' : 'away from platform', '', '', '', 'dg ' + fmt(gp.dg, 1) + ' / dg_max ' + fmt(gp.dgmax, 1), 'gap straight / R',
          fmt(gp.gap0, 1) + ' / ' + fmt(gp.gapR, 1), 'limit ' + fmt(gp.bgap, 0), '', cCell(gp.bgap - gp.gapMax), gp.ok ? 'OK' : 'GAP TOO LARGE']);
      });
    });
    roTable($('sres-en-doors-table'), ['Door / step', 'Kind', 'Position', 'n (m)', 'Heights lowered', 'Governing h', 'Max construction', 'Rule', 'Allowance', 'Allowed', 'Half-width', 'Margin', 'Status'], drows);
    var pg = en.pantographs ? en.pantographs.rows : [], prow = [];
    $('sres-en-panto').hidden = !pg.length;
    pg.forEach(function (q) {
      [['Upper collecting point 6,5 m – Po', q.worstO, 'Po', 'zo'], ['Lower collecting point 5,0 m – Pu', q.worstU, 'Pu', 'zu']].forEach(function (w, i) {
        var x = w[1];
        prow.push([i ? '' : q.name, i ? '' : (q.pos === 'beyond' ? 'Beyond' : 'Between') + ', n ' + fmt(q.n, 2) + ' m', w[0], x.R === null ? 'straight' : fmt(x.R, 0) + ' m', x.load + ', ' + x.far + '/' + x.near,
          fmt(x.geo, 1), fmt(x.play, 1), fmt(x.j, 1), fmt(x[w[3]], 1), { v: fmt(x[w[2]], 1), cls: x[w[2]] <= 1e-9 ? 'okcell' : 'badcell' }, x[w[2]] <= 1e-9 ? 'OK' : 'EXCEEDS']);
      });
      if (q.lowered) { var lw = q.lowered; prow.push(['', 'Lowered, top ' + fmt(lw.h, 0), 'Lowered pantograph (A.3.12.7)', '', 'b_w + insulating ' + fmt(lw.bw + lw.ins, 0), 'EN max ' + fmt(lw.max, 1), '', '', 'KE top ' + fmt(lw.top, 0), cCell(Math.min(lw.marginW, lw.marginH)), lw.ok ? 'OK' : 'EXCEEDS']); }
    });
    roTable($('sres-en-panto-table'), ['Pantograph', 'Position', 'Check', 'Worst R', 'Load, bogies', 'Geometric', 'Play', "j'", "z' / z\"", 'P (≤ 0)', 'Status'], prow);
    var bp = r.en && r.en.bogieParts ? r.en.bogieParts.rows : [];
    $('sres-en-bogie').hidden = !bp.length;
    roTable($('sres-en-bogie-table'), ['Bogie', 'Part', 'Mounted', 'Position', 'n (m)', 'Height range', 'Half-width', 'z_kin', 'Branch', 'E', 'KE half-width', 'EN max', 'Margin', 'Status'],
      bp.map(function (q) { return [q.bogie, q.name, q.mount === 'axle' ? 'Axle' : 'Frame', q.pos === 'beyond' ? 'Beyond' : 'Between', fmt(q.n, 2), fmt(q.h_lo, 0) + ' – ' + fmt(q.h_hi, 0), fmt(q.y, 0),
        fmt(q.z, 2), q.branch, fmt(q.E, 2), fmt(q.W, 1), fmt(q.max, 1), cCell(q.margin), q.ok ? 'OK' : 'EXCEEDS']; }));
  }
  function renderSresCcd(r) {
    var cc = r.ccd;
    $('sres-ccd').hidden = !cc;
    if (!cc) { return; }
    var rows = [];
    cc.ccds.forEach(function (c) {
      c.cases.forEach(function (k, i) {
        rows.push([i ? '' : c.name + ' (' + c.bogie + ', x ' + fmt(c.x, 2) + ' m)', k.situation, k.ke ? cCell(k.ke.margin) : 'n/a', k.ke ? k.ke.pt + ' (' + k.ke.state + ')' : '',
          fmt(k.contact.relLo, 1) + ' – ' + fmt(k.contact.relHi, 1), fmt(k.contact.cmin, 0) + ' – ' + fmt(k.contact.cmax, 0), cCell(k.contact.reach), cCell(k.contact.mOv),
          k.clear ? cCell(k.clear.margin) : 'n/a', k.clear ? k.clear.pt + ' – ' + k.clear.part : '', k.ok ? 'OK' : 'CHECK']);
      });
    });
    roTable($('sres-ccd-table'), ['CCD', 'Situation', 'Envelope', 'At', 'Rail relative to shoe', 'Working range', 'Reach', 'Overlap', 'Clearance', 'To', 'Status'], rows);
    var ds = P.ccdDatasets(state.p, cc.ke, { ke: cssVar('--muted', '#6b7280'), work: cssVar('--c1', '#2563eb'), ret: cssVar('--c5', '#7c3aed'), rail: cssVar('--c4', '#dc2626'), part: cssVar('--c2', '#d97706') });
    var xs = [], ys = [];
    ds.forEach(function (d) { d.data.forEach(function (q) { if (q.x !== null && q.y !== null && q.x > 900) { xs.push(q.x); ys.push(q.y); } }); });
    if (xs.length) {
      var x0 = Math.floor((Math.min.apply(null, xs) - 100) / 100) * 100, x1 = Math.ceil((Math.max.apply(null, xs) + 100) / 100) * 100, y0 = Math.min(0, Math.floor((Math.min.apply(null, ys) - 50) / 100) * 100), y1 = Math.ceil((Math.max.apply(null, ys) + 50) / 100) * 100;
      scatterChart('chart-ccd', ds, { xmin: x0, xmax: x1, ymin: y0, ymax: y1, step: 100, stepY: 50, aspect: (x1 - x0) / Math.max(1, y1 - y0) });
    }
  }
  function renderSresEnStatic(r, c) {
    var st = c.enStatic, SEC = { int: 'Interior', ext: 'Exterior', end: 'Car end' }, ks = ['int', 'ext', 'end'];
    $('sres-enst').hidden = !st;
    if (!st) { return; }
    roTable($('sres-enst-info'), ['Item', 'Interior', 'Exterior', 'Car end'], [
      ['Reference gauge rules / reference profile', st.gauge + ' / ' + st.ref, '', ''],
      { cls: '', cells: ['Flexibility coefficient s used / s_max (A.2.3.1)', { v: fmt(st.s, 3) + ' / ' + fmt(st.smax, 2) + (st.sOk ? ' – static gauge allowed' : ' – NOT ALLOWED: use the kinematic or dynamic method'), cls: st.sOk ? 'okcell' : 'badcell' }, '', ''] },
      ['(l_max − d)/2 with d worn = ' + fmt(st.d, 1) + ' mm / q / w (mm)', fmt(st.P, 2) + ' / ' + fmt(st.q, 1) + ' / ' + fmt(st.w, 1), '', ''],
      ['Position n (m)'].concat(ks.map(function (k) { return fmt(st.sections[k].n, 3); })),
      ['Δ used (m²) – not below the minimum'].concat(ks.map(function (k) { return fmt(st.sections[k].delta, 3); })),
      ['x-term (mm)'].concat(ks.map(function (k) { return fmt(st.sections[k].x, 2); })),
      ['Reduction E (mm)'].concat(ks.map(function (k) { return fmt(st.sections[k].E, 2); })),
      ['Profile top / reference top (mm)'].concat(ks.map(function (k) { var q = st.checks[k]; return { v: fmt(q.top, 0) + ' / ' + fmt(q.refTop, 0), cls: q.topOk ? '' : 'badcell' }; })),
      { cls: 'total', cells: ['Minimum margin (mm)'].concat(ks.map(function (k) { var m = st.checks[k].min; return m ? cCell(m.margin) : ''; })) }
    ]);
    var rows = [];
    ks.forEach(function (k) { var q = st.checks[k]; q.points.forEach(function (x) { rows.push({ cls: x === q.min ? 'selrow' : '', cells: [SEC[k], q.profile, fmt(x.h, 0), fmt(x.x, 1), fmt(x.W, 1), fmt(x.E, 2), fmt(x.max, 1), cCell(x.margin), x.ok ? 'OK' : 'EXCEEDS'] }); }); });
    roTable($('sres-enst-check'), ['Section', 'Profile', 'h', 'Profile half-width', 'Reference half-width', 'E', 'Static max', 'Margin', 'Status'], rows);
    roTable($('sres-enst-lower'), ['Lower part', 'Mounted', 'Height', 'Wear + suspension', 'Min. height', 'Limit', 'Margin', 'Status'],
      st.lower.map(function (q) { return [q.name, q.mount === 'bogie' ? 'Bogie' : 'Body', fmt(q.h, 0), fmt(q.disp, 1), fmt(q.hmin, 1), fmt(q.lim, 0), cCell(q.margin), q.ok ? 'OK' : 'BELOW MIN']; }));
  }
  function renderSresEnVertical(v) {
    if (!v) { return; }
    var ZONE = { A: 'A', B: 'B', C: 'C', D: 'D', bogie: 'Bogie (primary)' }, POS = { between: 'Between', beyond: 'Beyond' }, SEC = { int: 'Interior', ext: 'Exterior', end: 'Car end' };
    roTable($('sres-en-vinfo'), ['Vertical data', 'Value'], [
      ['Suspension displacement Aff – body / bogie parts (mm)', fmt(v.Aff, 1) + ' / ' + fmt(v.Aff_bogie, 1)],
      ['ΔAff / s / ΔUsr', fmt(v.dAff, 1) + ' mm / ' + fmt(v.s, 3) + ' / ' + fmt(v.dUsr, 1) + ' mm'],
      ['Wheel wear Usr (mm) / air-spring half spacing b2 (mm)', fmt(v.Usr, 1) + ' / ' + fmt(v.b2, 0)],
      ['Lower parts from', v.src === 'table' ? 'Lower parts table (Car body & Bogie tab)' : 'Car body inputs (no rows for this car type)'],
      ['Suspension levels (10 mm extension each)', fmt(v.levels, 0)]
    ]);
    roTable($('sres-en-lower'), ['Lower part', 'Mounted', 'Position', 'Zone', 'n (m)', 'b', 'Height', 'Suspension', 'Wheel wear', 'Min. height', 'Limit', 'Gradient', 'Margin', 'Status'],
      v.lower.map(function (q) { return [q.name, q.mount === 'bogie' ? 'Bogie' : 'Body', POS[q.pos], ZONE[q.zone], fmt(q.n, 2), fmt(q.b, 0), fmt(q.h, 0), fmt(q.susp, 1), fmt(q.wear, 1),
        fmt(q.hmin, 1), fmt(q.lim, 0) + (q.limSrc === 'customer' ? ' (customer)' : ''), fmt(q.grad, 1), cCell(q.margin), q.ok ? 'OK' : 'BELOW MIN']; }));
    roTable($('sres-en-upper'), ['Section', 'Profile', 'n (m)', 'Profile top', 'Extension', 'Gradient', 'Height', 'KE top', 'Margin', 'Status'],
      v.upper.map(function (q) { return [SEC[q.section] + (q.below325 ? ' (top below 3 250 mm)' : ''), q.profile, fmt(q.n, 2), fmt(q.top, 0), fmt(q.ext, 0), fmt(q.grad, 1), fmt(q.value, 1), fmt(q.lim, 0), cCell(q.margin), q.ok ? 'OK' : 'INFRINGES']; }));
  }

  // ---------------------------------------------------------------- Dynamic Simulation
  function renderDsim() {
    var o = dynOpts();
    $('dsim-study-note').hidden = state.p.train.study !== 'backward';
    form($('f-dynamic'), S.dynamicOptions, o, function () { changed(false); },
      { profile: function () { return [''].concat(rsNames()); }, ss_ke: function () { return [''].concat(keNames()); }, load: loadNames });
    form($('f-dyn-step'), S.trackSweep, state.p.track.params);
    carPicker($('dsim-cars'), o);
    readiness($('ready-dsim'), 'dynamic');
  }
  function runDynamic() {
    var v = M.validate(state.p);
    if (!M.readiness(v, 'dynamic').ok) { $('dsim-status').textContent = 'Fix the input errors first.'; return; }
    var t0 = Date.now();
    try {
      state.drun = E.dynamicRun(state.p, staticOpts(), dynOpts());
      state.drunKey = inputsKey(state.p);
      var sm = state.drun.summary;
      if (!state.dCar || !state.drun.cars.some(function (c) { return c.car === state.dCar; })) { state.dCar = sm.xo && sm.xo.car ? sm.xo.car : state.drun.cars[0].car; }
      state.dCh = null;
      $('dsim-status').textContent = 'Done in ' + (Date.now() - t0) + ' ms: ' + sm.points + ' points × ' + state.drun.cars.length + ' car type(s), ' + (sm.ok ? 'all OK' : sm.check_n + ' point(s) to check') + '.';
      activate('dres'); refresh();
    } catch (e) { $('dsim-status').textContent = 'Run failed: ' + e.message; }
  }

  // ---------------------------------------------------------------- Dynamic Results
  function dstale() { return state.drun && state.drunKey !== inputsKey(state.p); }
  function dcar() { var r = state.drun; return r ? (r.cars.filter(function (c) { return c.car === state.dCar; })[0] || r.cars[0]) : null; }
  function renderDres() {
    var r = state.drun;
    $('dres-empty').hidden = !!r; $('dres-body').hidden = !r;
    if (!r) { return; }
    $('dres-stale').textContent = dstale() ? 'Inputs or options changed since this run – press Run dynamic simulation again.' : '';
    var sm = r.summary, c = dcar();
    // cards
    var cards = clear($('dres-cards'));
    function stat(k, v, u, key, bad) { cards.appendChild(el('div', { class: 'stat' + (key ? ' key' : '') + (bad ? ' bad' : '') }, [el('div', { class: 'v' }, [v, u ? el('span', { class: 'u', text: ' ' + u }) : null]), el('div', { class: 'k', text: k })])); }
    stat('Status', sm.ok ? 'ALL OK' : sm.check_n + ' points to check', null, true, !sm.ok);
    stat('Max excess over KE outside' + (sm.xo ? ' (' + sm.xo.car + ', ch ' + fmt(sm.xo.ch) + ')' : ''), sm.xo ? fmt(sm.xo.v, 1) : '—', 'mm');
    stat('Points above the SOD curve allowance', String(sm.sod_n), null, false, sm.sod_n > 0);
    stat('Min structure clearance' + (sm.sc ? ' (ch ' + fmt(sm.sc.ch) + ')' : ''), sm.sc ? fmt(sm.sc.v, 1) : 'n/a', sm.sc ? 'mm' : null, false, sm.sc && !sm.sc_ok);
    stat('Min underframe height' + (sm.uf ? ' (ch ' + fmt(sm.uf.ch) + ')' : ''), sm.uf ? fmt(sm.uf.v, 1) : '—', 'mm', false, !sm.uf_ok);
    stat('Min platform gap' + (sm.gm ? ' (ch ' + fmt(sm.gm.ch) + ')' : ''), sm.gm ? fmt(sm.gm.v, 1) : 'n/a', sm.gm ? 'mm' : null, false, sm.gm && !sm.gm_ok);
    stat('Min clearance to the SOD outline' + (sm.sodc ? ' (' + sm.sodc.car + ', ch ' + fmt(sm.sodc.ch) + ')' : ''), sm.sodc ? fmt(sm.sodc.v, 1) : 'n/a', sm.sodc ? 'mm' : null, false, sm.sodo_n > 0);
    stat('Min point-item margin' + (sm.itm ? ' (ch ' + fmt(sm.itm.ch) + ')' : ''), sm.itm ? fmt(sm.itm.v, 1) : 'n/a', sm.itm ? 'mm' : null, false, sm.it_n > 0);
    if (sm.simc) { stat('EN dynamic: swept envelope to SOD (' + sm.simc.car + ', ch ' + fmt(sm.simc.ch) + ')', fmt(sm.simc.v, 1), 'mm', false, sm.sim_n > 0); }
    // line summary (workbook layout)
    function ex(x, d) { return x ? [fmt(x.v, d === undefined ? 1 : d), fmt(x.ch, 1), x.car || ''] : ['n/a', '', '']; }
    function st(ok, txt) { return { v: txt, cls: ok ? 'okcell' : (txt ? 'badcell' : '') }; }
    roTable($('dres-summary'), ['Result', 'Value', 'At chainage (m)', 'Car type', 'Limit', 'Status'], [
      ['Alignment length evaluated (m)', fmt(sm.length, 1), '', '', '', ''],
      ['Points evaluated', sm.points + ' (every ' + sm.step + ' m)', '', '', '', ''],
      ['Maximum cant deficiency at line speed (mm)'].concat(ex(sm.def), [fmt(sm.def_lim), st(sm.def_ok, sm.def_ok ? 'OK' : 'ABOVE LIMIT')]),
      ['Maximum excess over KE – OUTSIDE, car end (mm)'].concat(ex(sm.xo), ['allowance', '']),
      ['Maximum excess over KE – INSIDE, mid-car (mm)'].concat(ex(sm.xi), ['allowance', '']),
      ['Points where excess > SOD curve allowance', String(sm.sod_n), sm.sod_first === null ? '' : fmt(sm.sod_first, 1), '', '0', st(!sm.sod_n, sm.sod_n ? 'CHECK' : 'OK')],
      ['Minimum structure clearance (mm)'].concat(ex(sm.sc), ['0', sm.sc ? st(sm.sc_ok, sm.sc_ok ? 'OK' : 'INFRINGES') : '']),
      ['Minimum underframe height, body-mounted (mm)'].concat(ex(sm.uf), [fmt(sm.uf_lim), st(sm.uf_ok, sm.uf_ok ? 'OK' : 'BELOW MIN')]),
      ['Minimum platform gap, worst movement (mm)'].concat(ex(sm.gm), ['0', sm.gm ? st(sm.gm_ok, sm.gm_ok ? 'OK' : 'CONTACT') : '']),
      ['Maximum nominal platform gap (mm)'].concat(ex(sm.gn), [fmt(sm.prm), sm.gn ? { v: sm.gn_info ? 'INFO: above PRM value' : 'OK', cls: sm.gn_info ? 'warncell' : 'okcell' } : '']),
      ['Minimum clearance to the SOD outline, whole profile (mm)'].concat(ex(sm.sodc), [fmt(sm.sodc_req), sm.sodc ? st(!sm.sodo_n, sm.sodo_n ? sm.sodo_n + ' points CHECK' : 'OK') : 'no SOD on the line']),
      ['Minimum point-item margin over its required clearance (mm)'].concat(ex(sm.itm), ['0', sm.itm ? st(!sm.it_n, sm.it_n ? sm.it_n + ' points CHECK' : 'OK') : 'no items']),
      ['Points with any CHECK', String(sm.check_n), '', '', '0', st(sm.ok, sm.ok ? 'ALL OK' : 'REVIEW')]
    ]);
    roTable($('dres-cars'), ['Car type', 'Max OUT excess (mm)', 'at (m)', 'Max IN excess (mm)', 'SOD checks', 'Min structure (mm)', 'Min underframe (mm)', 'Min gap (mm)', 'Min SOD outline (mm)', 'Min item margin (mm)', 'Status'], r.cars.map(function (x) {
      var q = x.summary;
      return { cls: x.car === c.car ? 'selrow' : '', cells: [x.car, fmt(q.xo.v, 1), fmt(q.xo.ch, 0), fmt(q.xi.v, 1), String(q.sod_n), q.sc ? fmt(q.sc.v, 1) : 'n/a', fmt(q.uf.v, 1), q.gm ? fmt(q.gm.v, 1) : 'n/a',
        q.sodc ? fmt(q.sodc.v, 1) : 'n/a', q.itm ? fmt(q.itm.v, 1) : 'n/a', st(q.ok, q.ok ? 'OK' : 'CHECK')] };
    }));
    // selector
    var sel = clear($('dres-car'));
    r.cars.forEach(function (x) { sel.appendChild(el('option', { value: x.car, text: x.car + (x.summary.ok ? '' : ' (CHECK)'), selected: x.car === c.car })); });
    var sl = $('dres-slider'); sl.min = r.sweep.ch0; sl.max = r.sweep.end; sl.step = r.sweep.step;
    if (state.dCh === null) { var xs0 = E.crossSection(state.p, r, c.car, null, staticOpts()); state.dCh = xs0 ? xs0.ch : r.sweep.ch0; }
    $('dres-ch').value = fmt(state.dCh, 1); sl.value = state.dCh;
    dynCharts(c); renderXs(); renderDresCcd(r);
    // elements
    roTable($('dres-elements'), ['No', 'Ch start', 'Ch end', 'Element', 'Hand', 'R start', 'R end', 'Speed', 'Max deficiency', 'Max OUT h2', 'Max IN h2', 'Max excess OUT', 'Max excess IN', 'Min structure', 'Min underframe', 'SOD', 'Min SOD outline', 'Min item margin', 'Status', 'Remarks'],
      c.elements.map(function (e) { return { cls: (state.dCh >= e.s0 && state.dCh < e.s1) ? 'selrow' : '', cells: [e.no, fmt(e.s0, 1), fmt(e.s1, 1), e.type, e.side || '–', e.R0 ? fmt(e.R0) : '∞', e.R1 ? fmt(e.R1) : '∞', fmt(e.V), fmt(e.def, 1), fmt(e.o2, 0), fmt(e.i2, 0), fmt(e.xo, 1), fmt(e.xi, 1), e.sc === null ? '' : fmt(e.sc, 0), fmt(e.uf, 0),
        e.sodn || '–', e.sodc === null ? '' : fmt(e.sodc, 1), e.itm === null ? '' : fmt(e.itm, 1), st(e.status === 'OK', e.status), e.remarks || ''] }; }));
    // speed step
    var ss = c.speedStep;
    $('dres-ss-note').textContent = 'Curve R = ' + (ss.R ? fmt(ss.R) + ' m' : 'tangent') + ', cant ' + fmt(ss.cant) + ' mm, wind ' + fmt(ss.wind) + ' km/h, KE: ' + ss.ke + ', car type ' + c.car + '.';
    roTable($('dres-ss'), ['V (km/h)', 'I (+def / −exc)', 'OUT h1', 'OUT h2', 'IN h1', 'IN h2', 'KE w h2', 'Max excess', 'Remark'], ss.rows.map(function (q) {
      return [fmt(q.V), fmt(q.I, 1), fmt(q.o1, 1), fmt(q.o2, 1), fmt(q.i1, 1), fmt(q.i2, 1), fmt(q.kw2, 1), { v: fmt(q.excess, 1), cls: q.excess > 0 ? 'warncell' : '' }, q.remark];
    }));
    chLine('chart-d-ss', [lineDs('Required OUT at h2', ss.rows.map(function (q) { return { x: q.V, y: q.o2 }; }), cssVar('--c4', '#dc2626')),
      lineDs('Required IN at h2', ss.rows.map(function (q) { return { x: q.V, y: q.i2 }; }), cssVar('--c5', '#7c3aed'), [5, 3]),
      lineDs('Customer KE half-width at h2', ss.rows.map(function (q) { return { x: q.V, y: q.kw2 }; }), cssVar('--c1', '#2563eb'))], 'Speed [km/h]', 'Half-width [mm]', true);
  }
  function renderDresCcd(r) {
    var cc = r.ccd;
    $('dres-ccd').hidden = !cc;
    if (!cc) { return; }
    function rw(lbl, x) { return [lbl, x ? cCell(x.v) : 'n/a', x ? fmt(x.ch, 1) : '', x ? x.ccd + ' (' + x.side + ')' : '']; }
    roTable($('dres-ccd-sum'), ['Check', 'Minimum margin', 'At chainage (m)', 'CCD (rail side)'], [
      rw('Envelope (gear and retracted shoe inside the envelope)', cc.ke), rw('Reach (rail within the shoe working range)', cc.reach),
      rw('Overlap of shoe and rail faces', cc.overlap), rw('Clearance to the rail parts', cc.clear),
      ['Chainages with a conductor rail / with CHECK', String(cc.n), cc.check_n ? cc.check_n + ' CHECK' : 'OK', '']]);
    var s = P.chainageSeries;
    chLine('chart-d-ccd', [lineDs('Envelope margin', s(cc.rows, 'ke'), cssVar('--c1', '#2563eb')), lineDs('Reach margin', s(cc.rows, 'reach'), cssVar('--c4', '#dc2626')),
      lineDs('Overlap margin', s(cc.rows, 'overlap'), cssVar('--c3', '#059669'), [5, 3]), lineDs('Clearance margin', s(cc.rows, 'clear'), cssVar('--c2', '#d97706'), [2, 2])], 'Chainage [m]', 'Margin [mm]');
    var low = cc.rows.slice().sort(function (a, b) { return a.m - b.m; }).slice(0, 20);
    roTable($('dres-ccd-table'), ['Chainage', 'R (m)', 'Rail', 'Deficiency / excess', 'CCD', 'Envelope', 'Reach', 'Overlap', 'Clearance', 'Status'], low.map(function (q) {
      return [fmt(q.ch, 1), q.R ? fmt(q.R) : '∞', q.side + ', ' + q.pos, fmt(q.def, 0) + ' / ' + fmt(q.exc, 0), q.ccd, q.ke === null ? 'n/a' : cCell(q.ke), cCell(q.reach), cCell(q.overlap), q.clear === null ? 'n/a' : cCell(q.clear), q.ok ? 'OK' : 'CHECK'];
    }));
  }
  function lineDs(label, data, color, dash, w) { return { label: label, data: data, borderColor: color, backgroundColor: color, borderWidth: w || 1.6, borderDash: dash || [], pointRadius: 0, spanGaps: false, tension: 0 }; }
  function markerDs(rows, keys) {
    var lo = Infinity, hi = -Infinity;
    rows.forEach(function (r) { keys.forEach(function (k) { var v = r[k]; if (v !== null && v !== undefined && isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }); });
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    return { label: 'Selected chainage', data: [{ x: state.dCh, y: lo }, { x: state.dCh, y: hi }], borderColor: cssVar('--muted', '#59636e'), borderWidth: 1, borderDash: [2, 3], pointRadius: 0, _marker: true };
  }
  function chLine(id, ds, xTitle, yTitle, points) {
    if (!root.Chart) { return; }
    if (state.charts[id]) { state.charts[id].destroy(); }
    state.charts[id] = new root.Chart($(id).getContext('2d'), {
      type: 'line', data: { datasets: ds },
      options: { animation: false, responsive: true, maintainAspectRatio: false, parsing: true, interaction: { mode: 'nearest', axis: 'x', intersect: false },
        elements: { point: { radius: points ? 2 : 0 } },
        scales: { x: { type: 'linear', title: { display: true, text: xTitle } }, y: { title: { display: true, text: yTitle } } },
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 18, filter: function (it, d) { return !d.datasets[it.datasetIndex]._marker; } } },
          tooltip: { filter: function (it) { return !it.dataset._marker; }, callbacks: { label: function (cx) { return cx.dataset.label + ': ' + fmt(cx.raw.y, 1) + ' at ' + fmt(cx.raw.x, 1); } } } } }
    });
    state.charts[id].canvas.onclick = function (ev) {
      if (!/^chart-d-(curv|speed|hw|excess|struct|uf|sodo|items)$/.test(id)) { return; }
      var ch = state.charts[id], x = ch.scales.x.getValueForPixel(ev.offsetX);
      if (isFinite(x)) { setCh(x); }
    };
  }
  function dynCharts(c) {
    var rows = c.rows, s = P.chainageSeries, c1 = cssVar('--c1', '#2563eb'), c2 = cssVar('--c2', '#d97706'), c3 = cssVar('--c3', '#059669'), c4 = cssVar('--c4', '#dc2626'), c5 = cssVar('--c5', '#7c3aed'), mu = cssVar('--muted', '#59636e');
    var X = 'Chainage [m]';
    chLine('chart-d-curv', [lineDs('Local curvature', s(rows, 'k', 1000), c1), lineDs('Governing |curvature| under the car', s(rows, 'kg', 1000), c5, [4, 3]), markerDs([{ a: 0 }], ['a'])], X, '1/km');
    state.charts['chart-d-curv'].data.datasets[2] = markerDs(rows.map(function (r) { return { a: r.k * 1000, b: r.kg * 1000 }; }), ['a', 'b']); state.charts['chart-d-curv'].update('none');
    chLine('chart-d-speed', [lineDs('Speed limit [km/h]', s(rows, 'V'), c3), lineDs('Applied cant [mm]', s(rows, 'cant'), c2), lineDs('Cant deficiency at line speed [mm]', s(rows, 'def'), c4, [4, 3]), markerDs(rows, ['V', 'cant', 'def'])], X, 'km/h / mm');
    chLine('chart-d-hw', [lineDs('Required OUT at h2', s(rows, 'o2'), c4), lineDs('Required IN at h2', s(rows, 'i2'), c5, [5, 3]), lineDs('Customer KE half-width at h2', s(rows, 'kw2'), c1, null, 2), markerDs(rows, ['o2', 'i2', 'kw2'])], X, 'Half-width [mm]');
    chLine('chart-d-excess', [lineDs('Excess OUTSIDE', s(rows, 'xo'), c4), lineDs('SOD allowance OUTSIDE', s(rows, 'To'), c4, [6, 4], 1), lineDs('Excess INSIDE', s(rows, 'xi'), c5), lineDs('SOD allowance INSIDE', s(rows, 'Ti'), c5, [6, 4], 1), markerDs(rows, ['xo', 'To', 'xi', 'Ti'])], X, 'mm');
    var has = rows.some(function (r) { return r.sc !== null; });
    chLine('chart-d-struct', [lineDs(has ? 'Structure clearance at h2' : 'No structure distances in the Track Data', s(rows, 'sc'), c3), lineDs('Limit 0', rows.map(function (r) { return { x: r.ch, y: 0 }; }), mu, [2, 2], 1), markerDs(rows, ['sc'])], X, 'mm');
    var lim = n0(state.p.ke.limits.uf_min_body_mm);
    chLine('chart-d-uf', [lineDs('Underframe height (worst case)', s(rows, 'uf'), c2), lineDs('Minimum clearance cb', rows.map(function (r) { return { x: r.ch, y: lim }; }), c4, [2, 2], 1), markerDs(rows.concat([{ uf: lim }]), ['uf'])], X, 'mm');
    var sreq = state.p.sod.margin_mm === null ? 50 : state.p.sod.margin_mm, hasS = rows.some(function (r) { return r.sodc !== null; }), hasI = rows.some(function (r) { return r.itm !== null; });
    chLine('chart-d-sodo', [lineDs(hasS ? 'Clearance to the SOD outline' : 'No SOD outline on the Track Data', s(rows, 'sodc'), c3), lineDs('Required clearance', rows.map(function (r) { return { x: r.ch, y: sreq }; }), c4, [2, 2], 1), markerDs(rows.concat([{ sodc: sreq }]), ['sodc'])], X, 'mm');
    chLine('chart-d-items', [lineDs(hasI ? 'Smallest item margin' : 'No point items on the line', s(rows, 'itm'), c5), lineDs('Limit 0', rows.map(function (r) { return { x: r.ch, y: 0 }; }), mu, [2, 2], 1), markerDs(rows.concat([{ itm: 0 }]), ['itm'])], X, 'mm');
  }
  function n0(v) { return v === null || v === undefined || !isFinite(v) ? 0 : Number(v); }
  function setCh(ch) {
    var r = state.drun; if (!r) { return; }
    state.dCh = Math.min(Math.max(Number(ch), r.sweep.ch0), r.sweep.end);
    $('dres-ch').value = fmt(state.dCh, 1); $('dres-slider').value = state.dCh;
    ['chart-d-curv', 'chart-d-speed', 'chart-d-hw', 'chart-d-excess', 'chart-d-struct', 'chart-d-uf', 'chart-d-sodo', 'chart-d-items'].forEach(function (id) {
      var ch = state.charts[id]; if (!ch) { return; }
      ch.data.datasets.forEach(function (d) { if (d._marker) { d.data[0].x = d.data[1].x = state.dCh; } });
      ch.update('none');
    });
    renderXs();
    var c = dcar();
    doc.querySelectorAll('#dres-elements tbody tr').forEach(function (tr, i) { var e = c.elements[i]; tr.className = (e && state.dCh >= e.s0 && state.dCh < e.s1) ? 'selrow' : ''; });
  }
  function renderXs() {
    var r = state.drun, c = dcar(), xs = E.crossSection(state.p, r, c.car, state.dCh, staticOpts());
    if (!xs) { return; }
    var ds = P.crossSectionDatasets(xs, { ke: cssVar('--c1', '#2563eb'), rs: cssVar('--c3', '#059669'), env: cssVar('--c4', '#dc2626'), sod: cssVar('--muted', '#6b7280'), rail: cssVar('--text', '#1b1f24'), str: cssVar('--c2', '#d97706'), sodo: cssVar('--c6', '#0f766e'), item: cssVar('--c5', '#be185d') });
    scatterChart('chart-d-xs', ds, P.profileAxes(ds), function (cx) { return cx.dataset.label + ': X ' + fmt(cx.raw.x) + ', Z ' + fmt(cx.raw.y) + ' mm'; });
    var q = xs.row, k = c.consts, curve = q.k > 0 ? 'Left-hand curve' : (q.k < 0 ? 'Right-hand curve' : 'Straight');
    roTable($('dres-xs'), ['Quantity', 'Value'], [
      ['Chainage plotted (sweep point)', fmt(q.ch, 1) + ' m'], ['Element', q.type + ' (element ' + q.el + ')'],
      ['Curve', curve + (q.kg ? ', governing R = ' + fmt(q.Rg) + ' m' : '')], ['Applied cant', fmt(q.cant, 1) + ' mm'], ['Speed limit', fmt(q.V) + ' km/h'],
      ['Cant deficiency at speed / excess stopped', fmt(q.def, 1) + ' / ' + fmt(q.exc, 1) + ' mm'], ['Wind speed / equivalent cant', fmt(q.Vw) + ' km/h / ' + fmt(q.Dw, 1) + ' mm'],
      ['Gauge widening', fmt(q.wd) + ' mm'], ['Overthrow mid / end', fmt(q.dgi, 1) + ' / ' + fmt(q.dga, 1) + ' mm'], ['Customer KE', q.ke],
      ['Required half-width at h2: OUT / IN (track plane)', fmt(q.o2, 1) + ' / ' + fmt(q.i2, 1) + ' mm'], ['KE half-width at h2', fmt(q.kw2, 1) + ' mm'],
      ['Excess over KE OUT / IN', { v: fmt(q.xo, 1) + ' / ' + fmt(q.xi, 1) + ' mm' }], ['SOD allowance OUT / IN', fmt(q.To, 1) + ' / ' + fmt(q.Ti, 1) + ' mm'],
      ['SOD check', { v: q.sod, cls: q.sod === 'OK' ? 'okcell' : 'badcell' }], ['Track angle φ = asin(E/G)', fmt(xs.phi * 1000, 2) + ' mrad'],
      ['Roll angle outside / inside', fmt(xs.tho * 1000, 2) + ' / ' + fmt(xs.thi * 1000, 2) + ' mrad'],
      ['Structure clearance at h2', q.sc === null ? 'n/a' : { v: fmt(q.sc, 1) + ' mm', cls: q.sc >= 0 ? 'okcell' : 'badcell' }],
      ['Underframe height (worst)', { v: fmt(q.uf, 1) + ' mm', cls: q.ufs === 'OK' ? 'okcell' : 'badcell' }],
      ['SOD outline (' + (state.p.sod.frame === 'vertical' ? 'vertical frame' : 'track plane') + ')', q.sodc === null ? 'none on this element' : { v: q.sodn + ': ' + fmt(q.sodc, 1) + ' mm at ' + q.sodp, cls: q.sods === 'OK' ? 'okcell' : 'badcell' }],
      ['Point items', q.itm === null ? 'none active' : { v: q.itn + ': clearance ' + fmt(q.itc, 1) + ' mm, margin ' + fmt(q.itm, 1) + ' mm', cls: q.its === 'OK' ? 'okcell' : 'badcell' }],
      ['Platform', q.pl ? q.pl + ': gap ' + fmt(q.gn, 1) + ' nominal, ' + fmt(q.gm, 1) + ' mm minimum (' + q.gs + ')' : '—'],
      ['Profile / s / hc', k.profile + ' / ' + fmt(k.s, 3) + ' / ' + fmt(k.hc, 3) + ' m']
    ]);
  }

  // ---------------------------------------------------------------- EN Dynamic Method (METHOD §15)
  function carRef() { return state.p.train.carTypes.map(function (c) { return c.name; }); }
  function renderEndyn() {
    var sim = state.p.sim;
    form($('f-sim'), S.simSettings, sim.settings, null, { ref: function () { return [''].concat(keNames()); } });
    function last(list, keys, schema) { return function () { var t = list(), l = t[t.length - 1], r = S.defaults(schema); if (l) { keys.forEach(function (k) { r[k] = l[k]; }); } else { r.car = carRef()[0] || ''; } return r; }; }
    table($('t-sim-cars'), sim.cars, S.simCar, { addLabel: 'Add car type', refs: { car: carRef }, newRow: last(function () { return sim.cars; }, [], S.simCar) });
    table($('t-sim-tr'), sim.transient, S.simTransient, { addLabel: 'Add row', refs: { car: carRef }, newRow: last(function () { return sim.transient; }, ['car', 'cond', 'v_kmh', 'cant_mm'], S.simTransient) });
    table($('t-sim-cv'), sim.curving, S.simCurving, { addLabel: 'Add radius', refs: { car: carRef }, newRow: last(function () { return sim.curving; }, ['car', 'cond'], S.simCurving) });
    table($('t-val-w'), sim.weigh, S.valWeigh, { addLabel: 'Add wheel', refs: { car: carRef }, newRow: last(function () { return sim.weigh; }, ['car', 'cond', 'axle'], S.valWeigh) });
    table($('t-val-r'), sim.rot, S.valRot, { addLabel: 'Add row', refs: { car: carRef }, newRow: last(function () { return sim.rot; }, ['car', 'cond', 'bogie'], S.valRot) });
    table($('t-val-s'), sim.sway, S.valSway, { addLabel: 'Add row', refs: { car: carRef }, newRow: last(function () { return sim.sway; }, ['car', 'cond', 'qty'], S.valSway) });
    table($('t-val-ride'), sim.ride, S.valRide, { addLabel: 'Add condition', refs: { car: carRef }, newRow: last(function () { return sim.ride; }, ['car'], S.valRide) });
    renderEndynResults();
  }
  function renderEndynResults() {
    function st(ok, txt) { return { v: txt, cls: ok ? 'okcell' : 'badcell' }; }
    var res = null;
    try { res = E.simRun(state.p, staticOpts()); } catch (e) { res = null; }
    state.simRes = res;
    var t = res && res.tangent;
    $('sim-empty').hidden = !!t;
    roTable($('sim-tangent'), ['Car type', 'Reference', 'Datums ±x (m)', 'Datum h', 'f_max', 'Points', 'Min margin', 'Condition', 'Case', 'Section', 'Point', 'Status'], t ? t.cars.map(function (c) {
      var w = c.worst;
      return [c.car, t.ref, fmt(c.xd, 2), fmt(c.hd, 0), fmt(c.fmax, 1), String(c.n), w ? cCell(w.margin) : '', w ? w.cond : '', w ? fmt(w.v) + ' km/h, ' + (w.kind === 'def' ? 'deficiency ' : 'excess ') + fmt(w.c) + ' mm' : '',
        w ? w.sec + ' at x ' + fmt(w.x, 2) + ' m' : '', w ? w.pt : '', c.ok ? 'OK' : 'EXCEEDS'];
    }) : []);
    var sel = $('sim-car'); clear(sel);
    (t ? t.cars : []).forEach(function (c) { sel.appendChild(el('option', { value: c.car, text: c.car, selected: c.car === state.simCar })); });
    var cr = t ? (t.cars.filter(function (c) { return c.car === sel.value; })[0] || t.cars[0]) : null;
    var rows = [];
    if (cr) { cr.conds.forEach(function (cd) { cd.disp.forEach(function (x) { rows.push([cd.cond, fmt(x.v), x.kind === 'def' ? 'Deficiency' : 'Excess', fmt(x.c), fmt(x.dplC, 1), fmt(x.dplL, 1), fmt(x.hdC, 1), fmt(x.huC, 1), fmt(x.thC, 2), fmt(x.thL, 2)]); }); }); }
    roTable($('sim-disp'), ['Condition', 'Speed', 'Case', 'Cant', 'Dpl centre', 'Dpl lead', 'Δh down centre', 'Δh up centre', 'θ centre', 'θ lead'], rows);
    var vr = [];
    function line(v, lbl, x, u) { if (!x) { return; } vr.push([v.car + ' / ' + v.cond, lbl, fmt(x.max, 2) + u + ' (≤ ' + x.lmax + u + ')', x.avg !== undefined ? fmt(x.avg, 2) + u + ' (≤ ' + x.lavg + u + ')' : (x.loop === null ? 'loop error not given' : fmt(x.loop, 2) + u + ' (≤ ' + x.lavg + u + ')'), st(x.ok, x.ok ? 'matched' : 'NOT matched')]); }
    (res ? res.validation : []).forEach(function (v) {
      if (v.weigh) { line(v, 'Weighbridge – wheel loads', v.weigh.wheel, ' %'); line(v, 'Weighbridge – wheelset loads', v.weigh.wheelset, ' %'); line(v, 'Weighbridge – side loads', v.weigh.side, ' %'); }
      line(v, 'Bogie rotation – max X factor', v.rot, ' %');
      if (v.sway) { [['roll1', 'Sway – primary roll angle', ' mrad'], ['roll2', 'Sway – secondary roll angle', ' mrad'], ['sway', 'Sway – solebar sway', ' mm'], ['drop', 'Sway – solebar drop', ' mm']].forEach(function (q) { line(v, q[1], v.sway[q[0]], q[2]); }); }
      vr.push([v.car + ' / ' + v.cond, 'Dynamic ride test', '', '', st(v.ride, v.ride ? 'matched' : 'not matched')]);
      vr.push({ cls: 'total', cells: [v.car + ' / ' + v.cond, 'Model status (Figure O.1)', '', '', { v: v.status, cls: v.level >= 1 ? 'okcell' : 'badcell' }] });
    });
    roTable($('sim-val'), ['Car / condition', 'Check', 'Maximum error', 'Average error', 'Result'], vr);
  }

  // ---------------------------------------------------------------- Tests (METHOD §13)
  function swayResults() { try { return E.swayEval(state.p, staticOpts()); } catch (e) { return []; } }
  function renderTests() {
    table($('t-meas'), state.p.tests.measured, S.measPoint, {
      addLabel: 'Add measured point',
      refs: { car: function () { return state.p.train.carTypes.map(function (c) { return c.name; }); } },
      newRow: function () { var t = state.p.tests.measured, last = t[t.length - 1], r = S.defaults(S.measPoint); if (last) { r.car = last.car; r.section = last.section; } else { r.car = (state.p.train.carTypes[0] || {}).name || ''; } r.pt = 'P' + (t.length + 1); return r; }
    });
    table($('t-sway'), state.p.tests.sway, S.swayTest, {
      addLabel: 'Add test row',
      refs: { car: function () { return state.p.train.carTypes.map(function (c) { return c.name; }); } },
      newRow: function () { var t = state.p.tests.sway, last = t[t.length - 1], r = S.defaults(S.swayTest); if (last) { ['car', 'load', 'h1_mm', 'h2_mm', 'h3_mm'].forEach(function (k) { r[k] = last[k]; }); } else { r.car = (state.p.train.carTypes[0] || {}).name || ''; } return r; }
    });
    renderTestsResults();
  }
  function measResults() { try { return E.measuredEval(state.p, state.run, staticOpts()); } catch (e) { return []; } }
  function renderTestsMeas() {
    var ms = measResults(), SECM = { int: 'Interior', ext: 'Exterior', end: 'Car end' };
    $('tests-meas-status').textContent = !state.run ? 'Run the static simulation to evaluate the measured points.' : (!state.p.tests.measured.length ? 'No measured points.' : (stale() ? 'Inputs changed since the static run – run it again.' : ''));
    roTable($('tests-meas-res'), ['Car type', 'Section', 'Points', 'Design profile', 'Largest deviation (wider +)', 'Min clearance with all movements', 'Status'], ms.map(function (g) {
      if (g.error) { return [g.car, SECM[g.section] || g.section, String(g.n), '', '', '', { v: g.error, cls: 'badcell' }]; }
      return [g.car, SECM[g.section] || g.section, String(g.n), g.profile, g.devMax ? fmt(g.devMax.dev, 1) + ' mm (' + g.devMax.pt + ')' : '–', { v: fmt(g.min.c, 1) + ' mm (' + g.min.pt + ', ' + g.min.case + ')', cls: g.min.c >= 0 ? 'okcell' : 'badcell' },
        { v: g.ok ? 'OK' : 'INFRINGES', cls: g.ok ? 'okcell' : 'badcell' }];
    }));
    var rows = []; ms.forEach(function (g) { (g.points || []).forEach(function (q) { rows.push([g.car + ' ' + (SECM[g.section] || g.section), q.pt, fmt(q.y, 1), fmt(q.z, 1), q.design === null ? '–' : fmt(q.design, 1), q.dev === null ? '–' : fmt(q.dev, 1), cCell(q.c), q.case]); }); });
    roTable($('tests-meas-pts'), ['Car / section', 'Pt', 'Y', 'Z', 'Design Y', 'Deviation', 'Clearance', 'Governing case'], rows);
  }
  function renderTestsResults() {
    renderTestsMeas();
    var sw = swayResults(), LOAD = { tare: 'Tare', crush: 'Crush', deflated: 'Deflated' };
    function st(ok, txt) { return { v: txt, cls: ok ? 'okcell' : 'badcell' }; }
    roTable($('tests-sway-res'), ['Car type', 'Load', 'Readings', 's measured', 'hc measured (mm)', 'RMS residual (mm)', 's / hc used', 'Per 100 mm cant at h1 / h2 / top: measured vs used (mm)', 'Status'], sw.map(function (r) {
      if (r.error) { return [r.car, LOAD[r.load] || r.load, String(r.n), '', '', '', '', r.error, st(false, 'ERROR')]; }
      return [r.car, LOAD[r.load], String(r.n), fmt(r.s, 3) + (r.sides.L && r.sides.R ? ' (L ' + fmt(r.sides.L.s, 3) + ', R ' + fmt(r.sides.R.s, 3) + ')' : ''), fmt(r.hc, 0), fmt(r.rms, 2),
        fmt(r.used.s, 3) + ' / ' + fmt(r.used.hc, 0), r.checks.map(function (c) { return fmt(c.measured, 1) + ' vs ' + fmt(c.used, 1); }).join(' · '), st(r.ok, r.ok ? 'OK' : 'CHECK')];
    }));
    var sel = clear($('tests-sway-sel')), good = sw.filter(function (r) { return !r.error; });
    good.forEach(function (r, i) { sel.appendChild(el('option', { value: String(i), text: r.car + ' – ' + LOAD[r.load], selected: i === (state.swaySel || 0) })); });
    var cur = good[Math.min(state.swaySel || 0, good.length - 1)];
    if (cur) { scatterChart('chart-sway', P.swayDatasets(cur, { l: cssVar('--c1', '#2563eb'), r: cssVar('--c5', '#7c3aed'), fit: cssVar('--c3', '#059669'), used: cssVar('--c4', '#dc2626') }), swayAxes(cur), null, 'Lateral displacement per 100 mm cant [mm]', 'Height above rail [mm]'); }
    else if (state.charts['chart-sway']) { state.charts['chart-sway'].destroy(); delete state.charts['chart-sway']; }
    // gauge test plan
    var r = state.run, body = $('tests-plan-body');
    body.hidden = !r;
    $('tests-plan-status').textContent = !r ? 'Run the static simulation to get the test plan.' : (stale() ? 'Inputs changed since the static run – run it again before using this plan.' : '');
    if (!r) { return; }
    var plan = E.gaugeTestPlan(state.p, r, sw), cs = clear($('tests-car'));
    plan.forEach(function (c) { cs.appendChild(el('option', { value: c.car, text: c.car, selected: c.car === state.testCar })); });
    var pc = plan.filter(function (c) { return c.car === state.testCar; })[0] || plan[0];
    state.testCar = pc.car;
    var ks = clear($('tests-case'));
    pc.cases.forEach(function (k) { ks.appendChild(el('option', { value: k.id, text: k.label, selected: k.id === state.testCase })); });
    var k = pc.cases.filter(function (x) { return x.id === state.testCase; })[0] || pc.cases[0];
    state.testCase = k.id;
    var lowWord = k.section === 'int' ? 'inside of the curve (cant excess)' : 'outside of the curve (cant deficiency)';
    roTable($('tests-plan-setup'), ['Test set-up – ' + pc.car + ', ' + k.label, 'Value'], [
      ['Shims under the low side: D = cant + wind equivalent cant', fmt(k.D, 1) + ' mm (' + fmt(k.cant, 1) + ' + ' + fmt(k.wind, 1) + ')'],
      ['Case represents', 'the ' + lowWord + '; body leans to the low side'],
      ['Section / yaw factor A', SEC_NAMES[k.section] + ' / ' + fmt(k.A, 4)],
      ['Wheel–rail play × A (wheelsets against the low-side rail)', fmt(k.play, 2) + ' mm'],
      ['Primary lateral play q × A (to the stops)', fmt(k.q, 2) + ' mm'],
      ['Secondary lateral play w × A (to the bump stops)', fmt(k.w, 2) + ' mm'],
      [k.section === 'int' ? 'Total lateral, both bogies pushed the same way' : 'Total lateral at the section, bogies pushed in opposite directions', fmt(k.Rlat, 2) + ' mm'],
      ['Load on the vehicle', k.load === 'crush' ? 'Crush (body lowering ' + fmt(k.drop, 1) + ' mm)' : 'Tare'],
      ['Design s / hc', fmt(k.s, 3) + ' / ' + fmt(k.hc * 1000, 0) + ' mm'],
      ['Measured s / hc (sway test)', k.sway ? fmt(k.sway.s, 3) + ' / ' + fmt(k.sway.hc, 0) + ' mm' : 'no sway test for this car type and load'],
      k.beyondSway ? { cells: ['Note', { v: 'Shim height above the largest shim of the sway test (' + fmt(k.sway.maxD) + ' mm): the roll is linear only by assumption beyond it', cls: 'warncell' }] } : null,
      { cls: 'total', cells: ['Smallest expected clearance to the template (= static run)', cCell(k.min.c)] },
      k.minMeasured ? { cells: ['Smallest clearance with the measured s, hc', cCell(k.minMeasured.cm)] } : null
    ].filter(function (x) { return x; }));
    scatterChart('chart-plan', P.testPlanDatasets(k, { tpl: cssVar('--c1', '#2563eb'), exp: cssVar('--c4', '#dc2626'), rs: cssVar('--c3', '#059669'), meas: cssVar('--c5', '#7c3aed') }),
      halfAxes(k.points), null, 'Half-width from the track centre in the shimmed track plane [mm]', 'Height above rail [mm]');
    roTable($('tests-plan-pts'), ['Pt', 'x0', 'h0', 'Expected x', 'Expected h', 'Template half-width', 'Template height', 'Not reproduced lat. N', 'Not reproduced vert. V', 'ΔX', 'ΔH', 'Clearance'].concat(k.sway ? ['x measured s', 'h measured s', 'Clearance measured s'] : []),
      k.points.map(function (q) {
        return { cls: q === k.min ? 'selrow' : '', cells: [q.pt, fmt(q.x0, 1), fmt(q.h0, 1), fmt(q.xt, 1), fmt(q.ht, 1), fmt(q.Wt, 1), fmt(q.Ht, 1), fmt(q.N, 2), fmt(q.V, 2), fmt(q.dX, 1), fmt(q.dH, 1), cCell(q.c)]
          .concat(k.sway ? [fmt(q.xm, 1), fmt(q.hm, 1), cCell(q.cm)] : []) };
      }));
  }
  function swayAxes(r) {
    var xs = r.curve.map(function (q) { return q.measured; }).concat(r.curve.map(function (q) { return q.used; }), r.points.map(function (q) { return q.y100; }));
    return { xmin: Math.floor(Math.min.apply(null, xs.concat([0])) / 10) * 10, xmax: Math.ceil(Math.max.apply(null, xs) / 10) * 10, ymin: 0, ymax: Math.ceil(r.curve[r.curve.length - 1].h / 500) * 500, step: 10, stepY: 500, aspect: 1 };
  }
  function halfAxes(pts) {
    var xs = [], ys = [];
    pts.forEach(function (q) { xs.push(q.x0, q.xt, q.Wt); ys.push(q.h0, q.ht); });
    var xmin = Math.floor((Math.min.apply(null, xs) - 100) / 200) * 200, xmax = Math.ceil((Math.max.apply(null, xs) + 100) / 200) * 200;
    return { xmin: xmin, xmax: xmax, ymin: Math.floor((Math.min.apply(null, ys) - 200) / 500) * 500, ymax: Math.ceil((Math.max.apply(null, ys) + 200) / 500) * 500,
      step: xmax - xmin > 1200 ? 400 : 200, stepY: 500, aspect: 1.1 };
  }

  // ---------------------------------------------------------------- Overall Summary
  function renderSummary() {
    renderSummaryDynamic();
    form($('f-report'), S.reportOptions, state.p.settings.report, function () { state.dirty = true; $('dirty').hidden = false; persist(); });
    $('btn-report').disabled = !state.run;
    $('report-status').textContent = state.run ? (state.drun ? '' : 'The dynamic simulation has not been run: the report will have no dynamic chapter.') : 'Run the static simulation first.';
    var v = state.validation, box = $('summary-inputs');
    roTable(box, ['Input tab', 'Errors', 'Warnings', 'Status'], Object.keys(INPUT_TABS).map(function (tab) {
      var ms = v.messages.filter(function (m) { return m.tab === tab; }), e = ms.filter(function (m) { return m.level === 'err'; }).length;
      return { cls: e ? 'worse' : '', cells: [INPUT_TABS[tab], String(e), String(ms.length - e), e ? 'Fix before running' : (ms.length ? 'Ready (check warnings)' : 'Ready')] };
    }));
    var sb = clear($('summary-static')), r = state.run;
    if (!r) { sb.appendChild(el('p', { class: 'muted', text: 'Not run yet (Static Simulation tab).' })); return; }
    if (stale()) { sb.appendChild(el('p', { class: 'pill err', text: 'Inputs changed since the last run – run again before using these figures.' })); }
    var t = el('div', { class: 'tablewrap' }); sb.appendChild(t);
    roTable(t, ['Car type', 'Governing case', 'Min clearance to KE (mm)', 'Vertical checks', 'Axle load (t)', 'Status'], r.cars.map(function (x) {
      var vOk = x.vertical.every(function (q) { return q.info || q.ok; });
      return [x.car, x.governing ? x.governing.label : '', cCell(x.governing ? x.governing.c : NaN), { v: vOk ? 'OK' : 'CHECK', cls: vOk ? 'okcell' : 'badcell' }, fmt(x.derived.shared.axle_t, 2), { v: x.ok ? 'OK' : 'CHECK', cls: x.ok ? 'okcell' : 'badcell' }];
    }));
    sb.appendChild(el('p', { class: r.ok ? 'pill ok' : 'pill err', text: (r.ok ? 'ALL OK' : 'CHECK') + (r.governing ? ' – governing: ' + r.governing.car + ', ' + r.governing.label + ', ' + fmt(r.governing.c, 1) + ' mm to ' + r.ke.name : '') }));
    if (r.en) {
      var eg = r.en.governing;
      sb.appendChild(el('p', { class: r.en.ok ? 'pill ok' : 'pill err', text: 'EN 15273-2:2009 kinematic: ' + (r.en.ok ? 'OK' : 'CHECK') + (eg ? ' – smallest margin ' + fmt(eg.margin, 1) + ' mm (' + eg.car + ', ' + SEC_NAMES[eg.section] + ', h ' + fmt(eg.h, 0) + ' mm)' : '') }));
    }
  }
  function renderSummaryDynamic() {
    var db = clear($('summary-dynamic')), d = state.drun;
    if (!d) { db.appendChild(el('p', { class: 'muted', text: 'Not run yet (Dynamic Simulation tab).' })); return; }
    if (dstale()) { db.appendChild(el('p', { class: 'pill err', text: 'Inputs changed since the last run – run again before using these figures.' })); }
    var t = el('div', { class: 'tablewrap' }); db.appendChild(t);
    roTable(t, ['Car type', 'Max OUT excess (mm)', 'Max IN excess (mm)', 'SOD checks', 'Min structure (mm)', 'Min underframe (mm)', 'Min gap (mm)', 'Status'], d.cars.map(function (x) {
      var q = x.summary;
      return [x.car, fmt(q.xo.v, 1) + ' @ ' + fmt(q.xo.ch), fmt(q.xi.v, 1) + ' @ ' + fmt(q.xi.ch), String(q.sod_n), q.sc ? fmt(q.sc.v, 1) : 'n/a', fmt(q.uf.v, 1), q.gm ? fmt(q.gm.v, 1) : 'n/a', { v: q.ok ? 'OK' : 'CHECK', cls: q.ok ? 'okcell' : 'badcell' }];
    }));
    db.appendChild(el('p', { class: d.ok ? 'pill ok' : 'pill err', text: (d.ok ? 'ALL OK along ' : d.summary.check_n + ' point(s) to check along ') + fmt(d.summary.length) + ' m (' + d.summary.points + ' points)' }));
  }

  // ---------------------------------------------------------------- Word report
  var RPT = { ke: '#2563eb', rs: '#059669', tare: '#dc2626', crush: '#d97706', int: '#059669', ext: '#7c3aed', end: '#dc2626', mu: '#6b7280' };
  function reportChart(type, ds, scales, w, h) {
    var cv = el('canvas', { width: String(w), height: String(h) }), box = $('report-canvas');
    box.appendChild(cv);
    var ink = '#222222', grid = '#d9d9d9';
    Object.keys(scales).forEach(function (k) {
      var sc = scales[k]; sc.ticks = sc.ticks || {}; sc.ticks.color = ink; sc.grid = sc.grid || {}; sc.grid.color = sc.grid.color || grid;
      if (sc.title) { sc.title.color = ink; sc.title.font = { size: 14 }; }
    });
    var ch = new root.Chart(cv.getContext('2d'), {
      type: type, data: { datasets: ds },
      options: { animation: false, responsive: false, devicePixelRatio: 1.5, color: ink, scales: scales, elements: { point: { radius: 0 } },
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 18, color: ink, font: { size: 13 }, filter: function (it, d) { return !d.datasets[it.datasetIndex]._marker; } } }, tooltip: { enabled: false } } },
      plugins: [{ id: 'white', beforeDraw: function (c) { var x = c.ctx; x.save(); x.globalCompositeOperation = 'destination-over'; x.fillStyle = '#ffffff'; x.fillRect(0, 0, c.width, c.height); x.restore(); } }]
    });
    var data = cv.toDataURL('image/png').split(',')[1], out = { data: data, w: cv.width, h: cv.height };
    ch.destroy(); box.removeChild(cv);
    return out;
  }
  function profileShot(ds) {
    var ax = P.profileAxes(ds), w = 1000, h = Math.max(520, Math.min(1100, Math.round(w / Math.max(0.6, ax.aspect))));
    return reportChart('scatter', ds, { x: { type: 'linear', min: ax.xmin, max: ax.xmax, title: { display: true, text: 'Y lateral from track centre [mm]' }, ticks: { stepSize: ax.step || 500 } },
      y: { min: ax.ymin, max: ax.ymax, title: { display: true, text: 'Z above top of rail [mm]' }, ticks: { stepSize: ax.stepY || 500 } } }, w, h);
  }
  function halfWidthShot(ds) {
    var xs = [], ys = [];
    ds.forEach(function (d) { d.data.forEach(function (q) { xs.push(q.x); ys.push(q.y); }); });
    var xmin = Math.floor((Math.min.apply(null, xs.concat([1000])) - 50) / 100) * 100, xmax = Math.ceil((Math.max.apply(null, xs.concat([1500])) + 50) / 100) * 100;
    var ymin = Math.floor(Math.min.apply(null, ys.concat([0])) / 500) * 500, ymax = Math.ceil(Math.max.apply(null, ys.concat([1000])) / 500) * 500;
    return reportChart('scatter', ds, { x: { type: 'linear', min: xmin, max: xmax, title: { display: true, text: 'Half-width [mm]' } }, y: { min: ymin, max: ymax, title: { display: true, text: 'Height above rail [mm]' } } }, 1000, 760);
  }
  function lineShot(ds, xTitle, yTitle) {
    return reportChart('line', ds, { x: { type: 'linear', title: { display: true, text: xTitle } }, y: { title: { display: true, text: yTitle } } }, 1100, 520);
  }
  function reportImages() {
    var r = state.run, d = state.drun, im = {};
    im.profiles = profileShot(P.profileDatasets(state.p, { ke: true, sod: false, rs: true, items: false }));
    r.cars.forEach(function (c, i) {
      var sec = c.governing ? c.governing.id.split('_')[0] : 'int';
      im['sec-' + i] = profileShot(P.sectionDatasets(r, c.car, sec, { ke: RPT.ke, rs: RPT.rs, tare: RPT.tare, crush: RPT.crush }));
      if (c.mcg) { im['mcg-' + i] = profileShot(P.mcgDatasets(r, c.car, 'all', { ke: RPT.ke, rs: RPT.mu, car: RPT.tare, int: RPT.rs, ext: RPT.ext, end: RPT.crush })); }
      im['ma-' + i] = halfWidthShot(P.methodADatasets(r, c.car, RPT));
      if (c.en) { im['en-' + i] = halfWidthShot(P.enDatasets(r, c.car, RPT)); }
    });
    if (d) {
      var q = d.summary, s = P.chainageSeries, X = 'Chainage [m]';
      var cx = d.cars.filter(function (c) { return c.car === q.xo.car; })[0] || d.cars[0], rows = cx.rows;
      im['dyn-excess'] = lineShot([lineDs('Excess OUTSIDE', s(rows, 'xo'), RPT.tare), lineDs('SOD allowance OUTSIDE', s(rows, 'To'), RPT.tare, [6, 4], 1),
        lineDs('Excess INSIDE', s(rows, 'xi'), RPT.ext), lineDs('SOD allowance INSIDE', s(rows, 'Ti'), RPT.ext, [6, 4], 1)], X, 'mm');
      var cs = d.cars.filter(function (c) { return q.sc && c.car === q.sc.car; })[0] || cx;
      im['dyn-struct'] = lineShot([lineDs('Structure clearance at h2', s(cs.rows, 'sc'), RPT.rs), lineDs('Limit 0', cs.rows.map(function (x) { return { x: x.ch, y: 0 }; }), RPT.mu, [2, 2], 1)], X, 'mm');
      if (q.sodc || q.itm) {
        var cso = d.cars.filter(function (c) { return q.sodc && c.car === q.sodc.car; })[0] || cx;
        im['dyn-sodo'] = lineShot([lineDs('Clearance to the SOD outline (' + cso.car + ')', s(cso.rows, 'sodc'), RPT.rs), lineDs('Required clearance', cso.rows.map(function (x) { return { x: x.ch, y: state.p.sod.margin_mm === null ? 50 : state.p.sod.margin_mm }; }), RPT.tare, [2, 2], 1),
          lineDs('Smallest point-item margin (all car types)', s(d.envelope, 'itm'), RPT.ext), lineDs('Limit 0', d.envelope.map(function (x) { return { x: x.ch, y: 0 }; }), RPT.mu, [2, 2], 1)], X, 'mm');
      }
      var xs = E.crossSection(state.p, d, q.xo.car, q.xo.ch, staticOpts());
      if (xs) { im['dyn-xs'] = profileShot(P.crossSectionDatasets(xs, {})); }
    }
    return im;
  }
  function downloadReport() {
    var st = $('report-status');
    if (!state.run) { st.textContent = 'Run the static simulation first.'; return; }
    if (typeof root.JSZip === 'undefined' || !root.Chart) { st.textContent = 'Zip or chart library missing (vendor/): the Word report cannot be written.'; return; }
    st.textContent = 'Writing the report…';
    var o = state.p.settings.report, date = new Date().toLocaleDateString('en-GB'), images;
    try { images = reportImages(); } catch (e) { st.textContent = 'Could not draw the charts: ' + e.message; return; }
    var bl = R.report.blocks({ p: state.p, sres: state.run, dres: state.drun, measured: measResults(), sim: (function () { try { return E.simRun(state.p, staticOpts()); } catch (e) { return null; } }()), opt: o, date: date, engineVersion: state.run.engineVersion, staleS: stale(), staleD: dstale(),
      messages: state.validation.messages, methodMd: R.methodMd, images: images, sway: swayResults(), plan: E.gaugeTestPlan(state.p, state.run, swayResults()) });
    var title = o.title || 'Vehicle gauging report';
    var parts = R.report.docxParts(bl, images, { header: title + (state.p.name ? ' – ' + state.p.name : ''), headerRight: (o.doc_no ? o.doc_no + '  ' : '') + 'Rev ' + (o.revision || '–'),
      footer: 'Rolling Stock Gauge Simulator · ' + date, title: title, creator: o.prepared || '' });
    var zip = new root.JSZip();
    Object.keys(parts.xml).forEach(function (k) { zip.file(k, parts.xml[k]); });
    Object.keys(parts.media).forEach(function (k) { zip.file(k, parts.media[k], { base64: true }); });
    zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }).then(function (b) {
      IO.downloadBlob(b, IO.fileSlug((o.doc_no ? o.doc_no + '-' : '') + (state.p.name || 'project')) + '-gauging-report.docx');
      st.textContent = 'Report written (' + parts.images + ' figures).';
    }, function (e) { st.textContent = 'Could not write the Word file: ' + e; });
  }

  // ---------------------------------------------------------------- Calculation Method tab
  function rich(text) {   // **bold** inline
    return String(text).split(/(\*\*[^*]+\*\*)/).filter(function (x) { return x; }).map(function (x) {
      return /^\*\*[^*]+\*\*$/.test(x) ? el('strong', { text: x.slice(2, -2) }) : doc.createTextNode(x);
    });
  }
  function renderCalc() {
    var sres = null, note = [];
    if (state.run && !stale()) { sres = state.run; }
    else { try { sres = E.staticRun(state.p, staticOpts()); note.push('Static numbers calculated now from the current inputs.'); } catch (e) { sres = null; note.push('Static numbers not available: ' + e.message); } }
    var dres = state.drun || null;
    if (dres && dstale()) { note.push('Dynamic numbers are from the last dynamic run (inputs changed since).'); }
    if (!dres) { note.push('Run the dynamic simulation for the dynamic examples.'); }
    $('cm-status').textContent = note.join(' ');
    var cs = clear($('calc-car')), cars = sres ? sres.cars.map(function (c) { return c.car; }) : [];
    if (cars.indexOf(state.calcCar) < 0) { state.calcCar = sres && sres.governing ? sres.governing.car : cars[0]; }
    cars.forEach(function (n) { cs.appendChild(el('option', { value: n, text: n, selected: n === state.calcCar })); });
    var kc = clear($('calc-case')), car = sres ? sres.cars.filter(function (c) { return c.car === state.calcCar; })[0] : null;
    if (car && !car.cases.some(function (k) { return k.id === state.calcCase; })) { state.calcCase = car.governing ? car.governing.id : car.cases[0].id; }
    (car ? car.cases : []).forEach(function (k) { kc.appendChild(el('option', { value: k.id, text: k.label + (car.governing && car.governing.id === k.id ? ' (governing)' : ''), selected: k.id === state.calcCase })); });
    var sw = swayResults(), ch = $('calc-ch').value === '' ? null : Number($('calc-ch').value);
    var list = R.calcsteps.steps({ p: state.p, sres: sres, dres: dres, car: state.calcCar, caseId: state.calcCase, ch: ch, sway: sw, plan: sres ? E.gaugeTestPlan(state.p, sres, sw) : [], measured: measResults() });
    var body = clear($('cm-body')), toc = clear($('cm-toc')), part = null;
    list.forEach(function (st) {
      if (st.part !== part) {
        part = st.part;
        var pid = 'cm-part-' + part.charAt(0);
        body.appendChild(el('h2', { class: 'part', id: pid, text: part }));
        toc.appendChild(el('button', { type: 'button', text: part, on: { click: function () { $(pid).scrollIntoView({ behavior: 'smooth', block: 'start' }); } } }));
      }
      var box = el('section', { class: 'step', id: 'cm-' + st.id });
      box.appendChild(el('h3', { text: st.title }));
      box.appendChild(el('div', { class: 'refs' }, (st.refs || []).map(function (r) { return el('span', { class: 'ref', title: r.what }, [el('b', { text: r.doc }), r.clause ? ' · ' + r.clause : '']); })));
      (st.text || []).forEach(function (t) { box.appendChild(el('p', {}, rich(t))); });
      if (st.formulas && st.formulas.length) { box.appendChild(el('pre', { class: 'formula', text: st.formulas.join('\n') })); }
      if (st.example || st.nodata) {
        var ex = el('div', { class: 'example' });
        ex.appendChild(el('h4', { text: 'In this project' }));
        if (st.example) { var tw = el('div', { class: 'tablewrap' }); ex.appendChild(tw); roTable(tw, st.example.head, st.example.rows); }
        else { ex.appendChild(el('p', { class: 'muted nodata', text: st.nodata })); }
        box.appendChild(ex);
      }
      body.appendChild(box);
      toc.appendChild(el('button', { type: 'button', class: 'sub', text: st.title, on: { click: function () { box.scrollIntoView({ behavior: 'smooth', block: 'start' }); } } }));
    });
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
  var RENDER = { train: renderTrain, bogie: renderBogie, ke: renderKE, rs: renderRS, track: renderTrack, ssim: renderSsim, sres: renderSres,
    summary: renderSummary, method: renderMethod, dsim: renderDsim, dres: renderDres, tests: renderTests, calc: renderCalc, endyn: renderEndyn };
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
  function scatterChart(id, ds, ax, tooltipLabel, xTitle, yTitle, legendPos) {
    if (!root.Chart) { return; }
    if (state.charts[id]) { state.charts[id].destroy(); }
    state.charts[id] = new root.Chart($(id).getContext('2d'), {
      type: 'scatter', data: { datasets: ds },
      options: {
        animation: false, responsive: true, maintainAspectRatio: true, aspectRatio: Math.max(0.55, Math.min(1.8, ax.aspect * 0.92)),
        scales: {
          x: { type: 'linear', min: ax.xmin, max: ax.xmax, title: { display: true, text: xTitle || 'Y lateral from track centre [mm]' }, ticks: { stepSize: ax.step || 500 } },
          y: { min: ax.ymin, max: ax.ymax, title: { display: true, text: yTitle || 'Z above top of rail [mm]' }, ticks: { stepSize: ax.stepY || 500 } }
        },
        plugins: {
          legend: { position: legendPos || 'bottom', labels: { boxWidth: 18 } },
          tooltip: { callbacks: { label: tooltipLabel || function (c) { return c.dataset.label + (c.raw.label ? ' — ' + c.raw.label : '') + ': Y ' + fmt(c.raw.x) + ', Z ' + fmt(c.raw.y) + ' mm'; } } }
        }
      }
    });
  }
  function profileChart(id, key) {
    var pv = state.pv[key], hl = null;
    if (state.tab === 'ke') { hl = { group: 'ke', name: (state.p.ke.profiles[state.sel.ke] || {}).name }; }
    if (state.tab === 'rs') { hl = { group: 'rs', name: (state.p.rs.profiles[state.sel.rs] || {}).name }; }
    var ds = P.profileDatasets(state.p, { ke: pv.ke, sod: pv.sod, rs: pv.rs, items: pv.items, highlight: hl });
    scatterChart(id, ds, P.profileAxes(ds));
  }
  function sectionChart(id, r, car, sec) {
    var ds = P.sectionDatasets(r, car, sec, { ke: cssVar('--c1', '#2563eb'), rs: cssVar('--c3', '#059669'), tare: cssVar('--c4', '#dc2626'), crush: cssVar('--c2', '#d97706') });
    scatterChart(id, ds, P.profileAxes(ds), null, null, null, 'bottom');
  }
  function methodAChart(r, car, en) {
    var cols = { ke: cssVar('--c1', '#2563eb'), int: cssVar('--c3', '#059669'), ext: cssVar('--c5', '#7c3aed'), end: cssVar('--c4', '#dc2626') };
    var ds = en ? P.enDatasets(r, car, cols) : P.methodADatasets(r, car, cols);
    var xs = [], ys = [];
    ds.forEach(function (d) { d.data.forEach(function (q) { xs.push(q.x); ys.push(q.y); }); });
    var xmin = Math.floor((Math.min.apply(null, xs.concat([1000])) - 50) / 100) * 100, xmax = Math.ceil((Math.max.apply(null, xs.concat([1500])) + 50) / 100) * 100;
    var ymin = Math.floor(Math.min.apply(null, ys.concat([0])) / 500) * 500, ymax = Math.ceil(Math.max.apply(null, ys.concat([1000])) / 500) * 500;
    if (!root.Chart) { return; }
    var id = en ? 'chart-en' : 'chart-methodA';
    if (state.charts[id]) { state.charts[id].destroy(); }
    state.charts[id] = new root.Chart($(id).getContext('2d'), {
      type: 'scatter', data: { datasets: ds },
      options: { animation: false, responsive: true, maintainAspectRatio: false,
        scales: { x: { type: 'linear', min: xmin, max: xmax, title: { display: true, text: 'Half-width [mm]' } }, y: { min: ymin, max: ymax, title: { display: true, text: 'Height above rail [mm]' } } },
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 18 } }, tooltip: { callbacks: { label: function (c) { return c.dataset.label + ': ' + fmt(c.raw.x, 1) + ' mm at h ' + fmt(c.raw.y) + ' mm'; } } } } }
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
    var seg = state.p.track.segments, rmin = Infinity, nc = 0;
    seg.forEach(function (x) { if (x.element === 'circular') { nc++; } [x.R_start_m, x.R_end_m].forEach(function (R) { if (R > 0) { rmin = Math.min(rmin, R); } }); });
    $('track-stats').textContent = seg.length + ' elements · ' + fmt(M.trackLength(seg)) + ' m · ' + nc + ' circular' + (isFinite(rmin) ? ' · min R ' + fmt(rmin) + ' m' : '');
  }

  // ---------------------------------------------------------------- refresh (messages, badges, live calculated tables)
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
    if (stale()) { ban.push('Static results are out of date (inputs changed since the last run).'); }
    if (dstale()) { ban.push('Dynamic results are out of date.'); }
    $('data-banner').textContent = ban.join(' ');
    if (state.tab === 'train') { drawTrain(); calcGeometry(); }
    if (state.tab === 'bogie') { calcBody(); calcPlay(); }
    if (state.tab === 'ke') { profileChart('chart-ke', 'ke'); }
    if (state.tab === 'rs') { profileChart('chart-rs', 'rs'); }
    if (state.tab === 'track') { trackChart(); }
    if (state.tab === 'summary') { renderSummary(); }
    if (state.tab === 'endyn') { renderEndynResults(); }
    if (state.tab === 'tests') { renderTestsResults(); }
    if (state.tab === 'ssim') { readiness($('ready-ssim'), 'static'); }
    if (state.tab === 'dsim') { readiness($('ready-dsim'), 'dynamic'); }
    if (state.tab === 'dres') { $('dres-stale').textContent = dstale() ? 'Inputs or options changed since this run – press Run dynamic simulation again.' : ''; }
    if (state.tab === 'sres') { $('sres-stale').textContent = stale() ? 'Inputs or options changed since this run – press Run static simulation again.' : ''; }
  }

  // ---------------------------------------------------------------- tab switching
  var TABS = ['train', 'bogie', 'ke', 'rs', 'track', 'ssim', 'sres', 'dsim', 'dres', 'endyn', 'tests', 'summary', 'calc', 'method'];
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
    state.sel = { ke: 0, sod: 0, rs: 0 }; state.run = null; state.runKey = null; state.drun = null; state.drunKey = null; state.dCh = null;
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
      p.bogies.push(M.record({ name: 'T' }, S.bogie));
      p.train.carTypes.push(M.record({ name: 'CAR', count: p.train.n_cars, bogie1: 'T', bogie2: 'T' }, S.carType));
      p.train.formation = new Array(p.train.n_cars + 1).join('CAR-').replace(/-$/, '');
      load(M.normalizeProject(p));
    });
    $('btn-preset').addEventListener('click', function () {
      var t = state.p.train.vehicle_type, lab = S.byKey(S.trainConfig, 'vehicle_type').o.filter(function (o) { return o[0] === t; })[0];
      if (!root.confirm('Load the typical ' + (lab ? lab[1] : t) + ' values into the train, car type, car body, bogie, customer-limit and track-parameter inputs?\nNames, formation, counts, bogie and profile assignments, KE, profiles and track segments are kept.')) { return; }
      state.p = M.applyVehicleType(state.p, R.presets.vehicleTypes, t); changed(true); renderAll();
    });
    $('btn-run-static').addEventListener('click', runStatic);
    $('btn-run-dynamic').addEventListener('click', runDynamic);
    $('dres-car').addEventListener('change', function () { state.dCar = this.value; renderDres(); });
    $('dres-ch').addEventListener('change', function () { var v = Number(this.value); if (isFinite(v)) { setCh(v); } });
    $('dres-slider').addEventListener('input', function () { setCh(Number(this.value)); });
    $('dres-worst').addEventListener('click', function () { var xs = E.crossSection(state.p, state.drun, dcar().car, null, staticOpts()); if (xs) { setCh(xs.ch); } });
    $('btn-export-dynamic').addEventListener('click', function () {
      if (!state.drun) { return; }
      IO.downloadWorkbook(IO.dynamicResultsWorkbook(state.drun, state.p, { stale: dstale() }), IO.fileSlug(state.p.name) + '-dynamic-results.xlsx');
    });
    $('sres-car').addEventListener('change', function () { state.resCar = this.value; renderSres(); });
    $('sres-mcg-sel').addEventListener('change', function () { state.mcgSel = this.value; var r = state.run, c = r && r.cars.filter(function (x) { return x.car === state.resCar; })[0]; if (c) { renderSresMcg(r, c); } });
    $('btn-mcg-copy').addEventListener('click', copyMcg);
    $('sres-case').addEventListener('change', function () { state.resCase = this.value; renderSres(); });
    $('sres-xs-sel').addEventListener('change', function () { state.resXs = this.value; renderSres(); });
    $('sres-en-sec').addEventListener('change', function () { renderSres(); });
    $('btn-report').addEventListener('click', downloadReport);
    $('calc-car').addEventListener('change', function () { state.calcCar = this.value; state.calcCase = null; renderCalc(); });
    $('calc-case').addEventListener('change', function () { state.calcCase = this.value; renderCalc(); });
    $('calc-ch').addEventListener('change', function () { renderCalc(); });
    $('tests-sway-sel').addEventListener('change', function () { state.swaySel = Number(this.value); renderTestsResults(); });
    $('tests-car').addEventListener('change', function () { state.testCar = this.value; renderTestsResults(); });
    $('tests-case').addEventListener('change', function () { state.testCase = this.value; renderTestsResults(); });
    $('btn-export-tests').addEventListener('click', function () {
      if (!state.run) { return; }
      IO.downloadWorkbook(IO.testsWorkbook(swayResults(), E.gaugeTestPlan(state.p, state.run, swayResults()), state.p, { stale: stale(), measured: measResults() }), IO.fileSlug(state.p.name) + '-tests.xlsx');
    });
    $('btn-export-static').addEventListener('click', function () {
      if (!state.run) { return; }
      IO.downloadWorkbook(IO.staticResultsWorkbook(state.run, state.p, { stale: stale() }), IO.fileSlug(state.p.name) + '-static-results.xlsx');
    });
    $('sim-car').addEventListener('change', function () { state.simCar = this.value; renderEndynResults(); });
    $('btn-export-sim').addEventListener('click', function () {
      var r = E.simRun(state.p, staticOpts()); if (!r) { return; }
      IO.downloadWorkbook(IO.simResultsWorkbook(r, state.p, { stale: false }), IO.fileSlug(state.p.name) + '-en-dynamic.xlsx');
    });
    $('file-o6').addEventListener('change', function () {
      var input = this, file = input.files[0]; input.value = '';
      if (!file) { return; }
      IO.readFile(file, function (err, wb) {
        if (err) { showMsgs($('o6-msg'), [{ level: 'err', text: err.message }]); return; }
        var res = IO.importO6(wb, state.p);
        if (res.imported.length) { state.p = M.normalizeProject(res.project); changed(true); }
        showMsgs($('o6-msg'), [{ level: 'ok', text: file.name + ':' }].concat(res.messages));
      });
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
    state.tab = TABS.indexOf(tab) >= 0 && tab !== 'sres' && tab !== 'dres' ? tab : 'train';
    $('project-name').value = state.p.name; $('project-notes').value = state.p.notes || '';
    state.validation = M.validate(state.p);
    activate(state.tab); refresh();
  }

  R.app = { state: state, activate: activate, load: load, refresh: refresh, runStatic: runStatic, runDynamic: runDynamic, setCh: setCh };
  if (doc.readyState === 'loading') { doc.addEventListener('DOMContentLoaded', start); } else { start(); }
}(typeof globalThis !== 'undefined' ? globalThis : this));
