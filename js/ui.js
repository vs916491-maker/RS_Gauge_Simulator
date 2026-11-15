/*
 * Builds the whole page: tabs, input forms and tables, previews, import/export, the static run and its results.
 * The only file touching the DOM. Contains no physics: every calculated value comes from js/engine.js.
 * Exposes RSGAUGE.app.
 */
(function (root) {
  'use strict';
  var R = root.RSGAUGE, S = R.schema, M = R.model, IO = R.io, P = R.plot, E = R.engine, MD = R.markdown;
  var doc = root.document, STORE = 'rsgauge.last.v2';
  var INPUT_TABS = { train: 'Train Configuration', bogie: 'Car body & Bogie', ke: 'Customer KE & SOD', rs: 'RS Profile', track: 'Track Data', ssim: 'Static Simulation', dsim: 'Dynamic Simulation' };

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
  function inputsKey(p) { var q = JSON.parse(JSON.stringify(p)); delete q.name; delete q.notes; if (q.settings) { delete q.settings.report; } return JSON.stringify(q); }   // report fields do not make results stale
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
    form($('f-train-config'), S.trainConfig, t, function () { changed(false); });
    form($('f-train-load'), S.trainLoad, t);
    grid($('g-cartypes'), t.carTypes, S.carType, {
      refs: { bogie1: bogieNames, bogie2: bogieNames, prof_int: rsNames, prof_ext: rsNames, prof_end: rsNames },
      groups: { name: 'Identification', length_m: 'Body geometry and pivots', ni_m: 'Sections checked', width_mm: 'Body and door sill', mass_tare_t: 'Masses and centre of gravity', bogie1: 'Bogies and section profiles' },
      addLabel: 'Add car type',
      newItem: function () {
        var c = M.record(S.defaults(S.carType), S.carType), arr = t.bogie_arrangement;
        c.name = uniqueName('CAR', t.carTypes);
        if (arr === 'shared_one') { c.end2 = 'shared'; } else if (arr === 'shared_both') { c.end1 = 'shared'; c.end2 = 'shared'; }
        if (state.p.bogies[0]) { c.bogie1 = c.bogie2 = state.p.bogies[0].name; }
        return c;
      },
      onAdd: function () { M.syncBodies(state.p); M.fillRefs(state.p); },
      onChange: function (it, k, old) {
        if (k === 'name') { renameRefs(state.p.bodies, ['car'], old, it.name); }
      }
    });
    drawTrain(); calcGeometry();
  }
  function calcGeometry() {
    var rows = state.p.train.carTypes.map(function (c) {
      var g = E.carGeometry(c);
      return [c.name, fmt(g.Lb, 3), fmt(g.n1, 3), fmt(g.n2, 3), { v: fmt(g.a, 3), cls: g.a > 0 ? '' : 'badcell' }, fmt(g.n_end, 3), fmt(g.ni, 3), fmt(g.na, 3), fmt(g.A_ext, 4), fmt(g.A_end, 4),
        { v: g.na_ok ? 'OK' : 'na > overhang – check', cls: g.na_ok ? 'okcell' : 'badcell' }];
    });
    roTable($('calc-geometry'), ['Car type', 'Lb (m)', 'n1 (m)', 'n2 (m)', 'Pivot distance a (m)', 'Largest overhang nE (m)', 'Interior ni (m)', 'Exterior na (m)', 'Yaw factor A exterior', 'Yaw factor A car end', 'Exterior within overhang'], rows);
  }
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
      var c = types[n], L = lens[i], w = L * k, flip = (i === tok.length - 1);
      s('rect', { x: x, y: 18, width: w, height: 34, rx: (i === 0 || flip) ? 8 : 3, class: c ? 'car-body' : 'car-body missing' });
      s('text', { x: x + w / 2, y: 40, 'text-anchor': 'middle', class: 'car-name' }, n + (c ? '' : ' ?'));
      s('text', { x: x + w / 2, y: 13, 'text-anchor': 'middle', class: 'car-no' }, 'Car ' + (i + 1) + ' · ' + fmt(L, 1) + ' m');
      if (c) {
        var g = E.carGeometry(c);
        var e1 = flip ? g.n2 : g.n1, e2 = flip ? g.n1 : g.n2, b1 = flip ? c.bogie2 : c.bogie1, b2 = flip ? c.bogie1 : c.bogie2;
        [[e1, b1], [L - e2, b2]].forEach(function (bp) {
          var bx = x + bp[0] * k, isM = /^M/i.test(bp[1] || '');
          s('rect', { x: bx - 14, y: 54, width: 28, height: 9, rx: 3, class: isM ? 'bg-m' : 'bg-t' });
          s('circle', { cx: bx - 8, cy: 68, r: 5, class: 'wheel' }); s('circle', { cx: bx + 8, cy: 68, r: 5, class: 'wheel' });
          s('text', { x: bx, y: 88, 'text-anchor': 'middle', class: 'car-no' }, bp[1] || '?');
        });
      }
      x += w + gap * k;
    });
    s('line', { x1: 6, y1: 73, x2: W - 6, y2: 73, class: 'rail' });
    box.appendChild(svg);
    box.appendChild(el('p', { class: 'muted', text: tok.length + ' cars · train length over bodies ' + fmt(total, 2) + ' m · filled bogie = motor (name starting with M)' }));
  }

  // ---------------------------------------------------------------- Car body & Bogie
  function renderBogie() {
    M.syncBodies(state.p);
    grid($('g-bodies'), state.p.bodies, S.body, {
      refs: { car: carNames }, canDelete: false,
      groups: { car: 'Car type', wind_len_m: 'Wind (equivalent cant method)', uf_h_mm: 'Lower parts', s_tare: 'Flexibility coefficient and roll centre – SPECIFIED (sway test or bogie supplier)' }
    });
    form($('f-wind'), S.trainWind, state.p.train);
    grid($('g-bogies'), state.p.bogies, S.bogie, {
      groups: { name: 'Bogie type', p_m: '1. Geometry and lateral plays', wheel_new_mm: '2. Vertical travels', mass_t: 'Mass and axles',
        kz_prim: '3. Suspension stiffness (theoretical s and hc)', bb_mm: '4. Play calculator inputs (information)' },
      addLabel: 'Add bogie type',
      newItem: function () { var b = M.record(S.defaults(S.bogie), S.bogie); b.name = uniqueName('B', state.p.bogies); return b; },
      onChange: function (it, k, old) { if (k === 'name') { renameRefs(state.p.train.carTypes, ['bogie1', 'bogie2'], old, it.name); } }
    });
    calcBody(); calcPlay();
  }
  function calcBody() {
    var o = staticOpts(), cars = state.p.train.carTypes, ds = cars.map(function (c) { return E.deriveCar(state.p, c, o); });
    function row(label, unit, fn, d) { return [label, unit].concat(ds.map(function (x) { var v = fn(x); return typeof v === 'object' && v !== null ? v : fmt(v, d); })); }
    function chk(v) { return { v: v, cls: v === 'OK' ? 'okcell' : 'badcell' }; }
    roTable($('calc-body'), ['Quantity', 'Unit'].concat(cars.map(function (c) { return c.name; })), [
      row('Wind-exposed area Aw', 'm²', function (d) { return d.wind.Aw; }, 2),
      row('Wind coefficient tare Cw0 (D = Cw·V²)', 'mm/(km/h)²', function (d) { return d.wind.Cw_t; }, 6),
      row('Wind coefficient crush Cw4', 'mm/(km/h)²', function (d) { return d.wind.Cw_c; }, 6),
      row('Wind force at open-line wind speed F', 'N', function (d) { return d.wind.F; }, 0),
      row('Wind equivalent cant tare Dw0', 'mm', function (d) { return d.wind.Dw_t; }, 2),
      row('Wind equivalent cant crush Dw4', 'mm', function (d) { return d.wind.Dw_c; }, 2),
      row('Radial wheel wear used Δw', 'mm', function (d) { return d.bogie.dn_wheel; }, 1),
      row('Total downward movement Σd (' + (o.vert_state === 'inflated' ? 'inflated' : 'deflated') + ')', 'mm', function (d) { return d.dn_total; }, 1),
      row('Total upward movement Σu', 'mm', function (d) { return d.up_total; }, 1),
      row('Secondary lateral play used w*', 'mm', function (d) { return d.w_use; }, 1),
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
    form($('f-en'), S.enParams, state.p.ke.en);
    previewSel('pv-ke-sel', 'ke', 'chart-ke');
    profileChart('chart-ke', 'ke');
  }
  function renderRS() {
    profileSet($('ps-rs'), 'rs', state.p.rs.profiles, S.rsProfile, { newName: 'RS profile', onRename: function (old, nu) {
      renameRefs(state.p.train.carTypes, ['prof_int', 'prof_ext', 'prof_end'], old, nu);
    } });
    previewSel('pv-rs-sel', 'rs', 'chart-rs');
    profileChart('chart-rs', 'rs');
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
  function renderSsim() {
    var o = staticOpts();
    form($('f-static'), S.staticOptions, o, function () { changed(false); }, { ke: keNames });
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
    stat('Governing clearance', g ? fmt(g.c, 1) : '—', 'mm', true);
    stat('Governing car and case', g ? g.car + ' · ' + g.label : '—');
    stat('Status', r.ok ? 'ALL OK' : 'CHECK');
    stat('Customer KE', r.ke.name);
    var lowV = null; r.cars.forEach(function (x) { x.vertical.forEach(function (v) { if (!v.info && (!lowV || v.margin < lowV.margin)) { lowV = { car: x.car, label: v.label, margin: v.margin }; } }); });
    stat('Smallest vertical margin', lowV ? fmt(lowV.margin, 1) : '—', 'mm');
    // table car x case
    var head = ['Car type'].concat(E.CASES.map(function (k) { return k.label; }), ['Governing', 'Vertical checks', 'Axle load (t)']);
    roTable($('sres-table'), head, r.cars.map(function (x) {
      var vOk = x.vertical.every(function (v) { return v.info || v.ok; });
      return { cls: x.car === c.car ? 'selrow' : '', cells: [x.car].concat(x.cases.map(function (k) { return { v: fmt(k.min.c, 1) + ' @ ' + k.min.pt, cls: k.ok ? 'okcell' : 'badcell', title: k.profile }; }),
        [x.governing ? x.governing.label : '', { v: vOk ? 'OK' : 'CHECK', cls: vOk ? 'okcell' : 'badcell' }, { v: fmt(x.derived.shared.axle_t, 2), cls: x.derived.shared.axle_ok ? '' : 'badcell' }]) };
    }), 'results');
    // section charts
    ['int', 'ext', 'end'].forEach(function (sec) { sectionChart('chart-sec-' + sec, r, c.car, sec); });
    // build-up
    var keys = [['n', 'Section position from pivot', 'm', 3], ['A', 'Yaw factor A', '–', 4], ['dg', 'Geometric overthrow at Rs', 'mm', 1], ['play', 'Wheel–rail half play × A', 'mm', 2], ['q', 'Primary lateral play × A', 'mm', 2],
      ['w', 'Secondary lateral play × A', 'mm', 2], ['fw', 'Rail gauge-face wear × A', 'mm', 2], ['widen', 'Gauge widening/2 × A', 'mm', 2], ['T', 'Quasi-static translation T', 'mm', 2, true],
      ['rnd_gauge', 'Random: track gauge tolerance', 'mm', 2], ['rnd_align', 'Random: alignment tolerance', 'mm', 2], ['cant', 'Cant excess (interior) / deficiency (exterior, end)', 'mm', 1], ['wind', 'Wind equivalent cant', 'mm', 2],
      ['cl', 'Cross-level error', 'mm', 1], ['s', 'Flexibility coefficient s', '–', 3], ['hc', 'Roll-centre height hc', 'm', 3], ['thq', 'Roll angle – quasi-static θq = s·(cant + wind)/G', 'rad', 5, true], ['thr', 'Roll angle – cross-level θr (random)', 'rad', 5],
      ['tht', 'Rigid tilt – cross-level θt', 'rad', 5], ['thtot', 'Total angle for vertical shift', 'rad', 5], ['drop', 'Body lowering (crush)', 'mm', 1], ['up', 'Upward movement combined with roll', 'mm', 1]];
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
    roTable($('sres-methodA'), ['h', 'KE width', 'Max static Int', 'Max static Ext', 'Max static End', 'Margin Int', 'Margin Ext', 'Margin End'],
      c.methodA.map(function (x) { return [fmt(x.h, 0), fmt(x.W, 1), fmt(x.max_int, 1), fmt(x.max_ext, 1), fmt(x.max_end, 1), mcell(x.margin_int), mcell(x.margin_ext), mcell(x.margin_end)]; }));
    renderSresEn(r, c);
    // vertical
    roTable($('sres-vertical'), ['Check', 'Value (mm)', 'Limit / reference (mm)', 'Margin (mm)', 'Status'], c.vertical.map(function (v) {
      return v.info ? [v.label, fmt(v.value, 1), '', '', ''] : [v.label, fmt(v.value, 1), fmt(v.limit, 1), cCell(v.margin), { v: v.ok ? 'OK' : (v.id.indexOf('uf') === 0 ? 'BELOW MIN' : 'INFRINGES'), cls: v.ok ? 'okcell' : 'badcell' }];
    }));
  }

  var SEC_NAMES = { int: 'Interior', ext: 'Exterior', end: 'Car end' };
  function renderSresEn(r, c) {
    var box = $('sres-en'), en = c.en;
    box.hidden = !en;
    if (!en) { return; }
    var R = en.rules;
    roTable($('sres-en-info'), ['Item', 'Interior', 'Exterior', 'Car end'], [
      ['Formula set', en.set === 'traction' ? 'Traction unit – ' + en.clause : 'Coach – ' + en.clause, '', ''],
      ['Position n from the bogie centre (m)'].concat(['int', 'ext', 'end'].map(function (k) { return fmt(en.sections[k].n, 3); })),
      ['Δ = a·n ∓ n² ± p²/4 (m²)'].concat(['int', 'ext', 'end'].map(function (k) { return fmt(en.sections[k].delta, 3); })),
      ['Formula branch – upper / lower parts'].concat(['int', 'ext', 'end'].map(function (k) { return en.sections[k].branch_up + ' / ' + en.sections[k].branch_low; })),
      ['x-term at R2 – upper (mm)'].concat(['int', 'ext', 'end'].map(function (k) { return fmt(en.sections[k].x_up, 2); })),
      ['(l_max − d)/2 with d worn = ' + fmt(en.d, 1) + ' mm', fmt(en.P, 2) + ' mm', '', ''],
      ['q / w used (mm)', fmt(en.q, 1) + ' / ' + fmt(en.w, 1), '', ''],
      ['Rules', 'l_max ' + fmt(R.lmax * 1000, 0) + ' mm, R1 ' + fmt(R.R1, 0) + ' m, R2 ' + fmt(R.R2, 0) + ' m, Ck ' + fmt(R.Ck_low, 2) + ' / ' + fmt(R.Ck_up, 2) + ' m², s0 ' + fmt(R.s0, 2) + ', hc0 ' + fmt(R.hc0 * 1000, 0) + ' mm', '', ''],
      { cls: 'total', cells: ['Minimum margin to the EN maximum construction gauge (mm)'].concat(['int', 'ext', 'end'].map(function (k) { var m = en.checks[k].min; return m ? cCell(m.margin) : ''; })) },
      ['At height (mm) / profile'].concat(['int', 'ext', 'end'].map(function (k) { var m = en.checks[k].min; return m ? fmt(m.h, 0) + ' / ' + en.checks[k].profile : ''; }))
    ]);
    methodAChart(r, c.car, true);
    function mcell(v) { return v === null ? '' : { v: fmt(v, 1), cls: v >= 0 ? '' : 'badcell' }; }
    roTable($('sres-en-table'), ['h', 'KE width', 'Ei Int', 'Ea Ext', 'Ea End', 'EN max Int', 'Method A Int', 'EN max End', 'Method A End', 'Margin Int', 'Margin Ext', 'Margin End'],
      en.rows.map(function (x) { return [fmt(x.h, 0), fmt(x.W, 1), fmt(x.E_int, 1), fmt(x.E_ext, 1), fmt(x.E_end, 1), fmt(x.max_int, 1), fmt(x.ma_int, 1), fmt(x.max_end, 1), fmt(x.ma_end, 1), mcell(x.margin_int), mcell(x.margin_ext), mcell(x.margin_end)]; }));
    var sec = $('sres-en-sec').value || 'int', ck = en.checks[sec];
    roTable($('sres-en-check'), ['h', 'Profile half-width', 'KE half-width', 'E', 'z_kin', 'Branch', 'Load', 'EN max', 'Margin', 'Status'],
      ck.points.map(function (q) { return { cls: q === ck.min ? 'selrow' : '', cells: [fmt(q.h, 0), fmt(q.x, 1), fmt(q.W, 1), fmt(q.E, 2), fmt(q.z, 2), q.branch, q.load, fmt(q.max, 1), cCell(q.margin), q.ok ? 'OK' : 'EXCEEDS'] }; }));
  }

  // ---------------------------------------------------------------- Dynamic Simulation
  function renderDsim() {
    var o = dynOpts();
    form($('f-dynamic'), S.dynamicOptions, o, function () { changed(false); },
      { profile: function () { return [''].concat(rsNames()); }, ss_ke: function () { return [''].concat(keNames()); } });
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
      ['Points with any CHECK', String(sm.check_n), '', '', '0', st(sm.ok, sm.ok ? 'ALL OK' : 'REVIEW')]
    ]);
    roTable($('dres-cars'), ['Car type', 'Max OUT excess (mm)', 'at (m)', 'Max IN excess (mm)', 'SOD checks', 'Min structure (mm)', 'Min underframe (mm)', 'Min gap (mm)', 'Status'], r.cars.map(function (x) {
      var q = x.summary;
      return { cls: x.car === c.car ? 'selrow' : '', cells: [x.car, fmt(q.xo.v, 1), fmt(q.xo.ch, 0), fmt(q.xi.v, 1), String(q.sod_n), q.sc ? fmt(q.sc.v, 1) : 'n/a', fmt(q.uf.v, 1), q.gm ? fmt(q.gm.v, 1) : 'n/a', st(q.ok, q.ok ? 'OK' : 'CHECK')] };
    }));
    // selector
    var sel = clear($('dres-car'));
    r.cars.forEach(function (x) { sel.appendChild(el('option', { value: x.car, text: x.car + (x.summary.ok ? '' : ' (CHECK)'), selected: x.car === c.car })); });
    var sl = $('dres-slider'); sl.min = r.sweep.ch0; sl.max = r.sweep.end; sl.step = r.sweep.step;
    if (state.dCh === null) { var xs0 = E.crossSection(state.p, r, c.car, null, staticOpts()); state.dCh = xs0 ? xs0.ch : r.sweep.ch0; }
    $('dres-ch').value = fmt(state.dCh, 1); sl.value = state.dCh;
    dynCharts(c); renderXs();
    // elements
    roTable($('dres-elements'), ['No', 'Ch start', 'Ch end', 'Element', 'Hand', 'R start', 'R end', 'Speed', 'Max deficiency', 'Max OUT h2', 'Max IN h2', 'Max excess OUT', 'Max excess IN', 'Min structure', 'Min underframe', 'Status', 'Remarks'],
      c.elements.map(function (e) { return { cls: (state.dCh >= e.s0 && state.dCh < e.s1) ? 'selrow' : '', cells: [e.no, fmt(e.s0, 1), fmt(e.s1, 1), e.type, e.side || '–', e.R0 ? fmt(e.R0) : '∞', e.R1 ? fmt(e.R1) : '∞', fmt(e.V), fmt(e.def, 1), fmt(e.o2, 0), fmt(e.i2, 0), fmt(e.xo, 1), fmt(e.xi, 1), e.sc === null ? '' : fmt(e.sc, 0), fmt(e.uf, 0), st(e.status === 'OK', e.status), e.remarks || ''] }; }));
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
      if (!/^chart-d-(curv|speed|hw|excess|struct|uf)$/.test(id)) { return; }
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
  }
  function n0(v) { return v === null || v === undefined || !isFinite(v) ? 0 : Number(v); }
  function setCh(ch) {
    var r = state.drun; if (!r) { return; }
    state.dCh = Math.min(Math.max(Number(ch), r.sweep.ch0), r.sweep.end);
    $('dres-ch').value = fmt(state.dCh, 1); $('dres-slider').value = state.dCh;
    ['chart-d-curv', 'chart-d-speed', 'chart-d-hw', 'chart-d-excess', 'chart-d-struct', 'chart-d-uf'].forEach(function (id) {
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
    var ds = P.crossSectionDatasets(xs, { ke: cssVar('--c1', '#2563eb'), rs: cssVar('--c3', '#059669'), env: cssVar('--c4', '#dc2626'), sod: cssVar('--muted', '#6b7280'), rail: cssVar('--text', '#1b1f24'), str: cssVar('--c2', '#d97706') });
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
      ['Platform', q.pl ? q.pl + ': gap ' + fmt(q.gn, 1) + ' nominal, ' + fmt(q.gm, 1) + ' mm minimum (' + q.gs + ')' : '—'],
      ['Profile / s / hc', k.profile + ' / ' + fmt(k.s, 3) + ' / ' + fmt(k.hc, 3) + ' m']
    ]);
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
    var bl = R.report.blocks({ p: state.p, sres: state.run, dres: state.drun, opt: o, date: date, engineVersion: state.run.engineVersion, staleS: stale(), staleD: dstale(),
      messages: state.validation.messages, methodMd: R.methodMd, images: images });
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
    summary: renderSummary, method: renderMethod, dsim: renderDsim, dres: renderDres };
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
    if (state.tab === 'ssim') { readiness($('ready-ssim'), 'static'); }
    if (state.tab === 'dsim') { readiness($('ready-dsim'), 'dynamic'); }
    if (state.tab === 'dres') { $('dres-stale').textContent = dstale() ? 'Inputs or options changed since this run – press Run dynamic simulation again.' : ''; }
    if (state.tab === 'sres') { $('sres-stale').textContent = stale() ? 'Inputs or options changed since this run – press Run static simulation again.' : ''; }
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
    $('sres-case').addEventListener('change', function () { state.resCase = this.value; renderSres(); });
    $('sres-en-sec').addEventListener('change', function () { renderSres(); });
    $('btn-report').addEventListener('click', downloadReport);
    $('btn-export-static').addEventListener('click', function () {
      if (!state.run) { return; }
      IO.downloadWorkbook(IO.staticResultsWorkbook(state.run, state.p, { stale: stale() }), IO.fileSlug(state.p.name) + '-static-results.xlsx');
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
