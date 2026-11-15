/*
 * Builds the whole page: tabs, input forms and tables, previews, import/export, the static run and its results.
 * The only file touching the DOM. Contains no physics: every calculated value comes from js/engine.js.
 * Exposes RSGAUGE.app.
 */
(function (root) {
  'use strict';
  var R = root.RSGAUGE, S = R.schema, M = R.model, IO = R.io, P = R.plot, E = R.engine, MD = R.markdown;
  var doc = root.document, STORE = 'rsgauge.last.v2';
  var INPUT_TABS = { train: 'Train Configuration', bogie: 'Car body & Bogie', ke: 'Customer KE & SOD', rs: 'RS Profile', track: 'Track Data', ssim: 'Static Simulation' };

  var state = {
    p: null, dirty: false, tab: 'train', restored: false, charts: {},
    sel: { ke: 0, sod: 0, rs: 0 }, mode: { ke: 'replace', rs: 'replace' },
    pv: { ke: { ke: true, sod: true, rs: false, items: true }, rs: { ke: true, sod: false, rs: true, items: false } },
    validation: null, timer: null,
    run: null, runKey: null, resCar: null, resCase: 'end_t'
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
  function inputsKey(p) { var q = JSON.parse(JSON.stringify(p)); delete q.name; delete q.notes; return JSON.stringify(q); }
  function staticOpts() { return state.p.settings['static']; }

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
    var box = clear($('ssim-cars')), want = (o.cars && o.cars !== 'all') ? String(o.cars).split(',') : null;
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
    readiness($('ready-ssim'));
  }
  function readiness(box) {
    clear(box);
    var v = state.validation;
    box.appendChild(el('p', { class: v.ok ? 'pill ok' : 'pill err', text: v.ok ? 'Inputs complete' + (v.warnings ? ' (' + v.warnings + ' warning' + (v.warnings > 1 ? 's' : '') + ')' : '') + ' – ready to run.' : v.errors + ' input error(s) to fix first – see Overall Summary.' }));
    $('btn-run-static').disabled = !v.ok;
  }
  function runStatic() {
    var v = M.validate(state.p);
    if (!v.ok) { $('ssim-status').textContent = 'Fix the input errors first.'; return; }
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
    // vertical
    roTable($('sres-vertical'), ['Check', 'Value (mm)', 'Limit / reference (mm)', 'Margin (mm)', 'Status'], c.vertical.map(function (v) {
      return v.info ? [v.label, fmt(v.value, 1), '', '', ''] : [v.label, fmt(v.value, 1), fmt(v.limit, 1), cCell(v.margin), { v: v.ok ? 'OK' : (v.id.indexOf('uf') === 0 ? 'BELOW MIN' : 'INFRINGES'), cls: v.ok ? 'okcell' : 'badcell' }];
    }));
  }

  // ---------------------------------------------------------------- Overall Summary
  function renderSummary() {
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
    summary: renderSummary, method: renderMethod, dsim: function () {}, dres: function () {} };
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
  function methodAChart(r, car) {
    var ds = P.methodADatasets(r, car, { ke: cssVar('--c1', '#2563eb'), int: cssVar('--c3', '#059669'), ext: cssVar('--c5', '#7c3aed'), end: cssVar('--c4', '#dc2626') });
    var xs = [], ys = [];
    ds.forEach(function (d) { d.data.forEach(function (q) { xs.push(q.x); ys.push(q.y); }); });
    var xmin = Math.floor((Math.min.apply(null, xs.concat([1000])) - 50) / 100) * 100, xmax = Math.ceil((Math.max.apply(null, xs.concat([1500])) + 50) / 100) * 100;
    var ymin = Math.floor(Math.min.apply(null, ys.concat([0])) / 500) * 500, ymax = Math.ceil(Math.max.apply(null, ys.concat([1000])) / 500) * 500;
    if (!root.Chart) { return; }
    var id = 'chart-methodA';
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
    $('data-banner').textContent = ban.join(' ');
    if (state.tab === 'train') { drawTrain(); calcGeometry(); }
    if (state.tab === 'bogie') { calcBody(); calcPlay(); }
    if (state.tab === 'ke') { profileChart('chart-ke', 'ke'); }
    if (state.tab === 'rs') { profileChart('chart-rs', 'rs'); }
    if (state.tab === 'track') { trackChart(); }
    if (state.tab === 'summary') { renderSummary(); }
    if (state.tab === 'ssim') { readiness($('ready-ssim')); }
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
    state.sel = { ke: 0, sod: 0, rs: 0 }; state.run = null; state.runKey = null;
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
    $('sres-car').addEventListener('change', function () { state.resCar = this.value; renderSres(); });
    $('sres-case').addEventListener('change', function () { state.resCase = this.value; renderSres(); });
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
    state.tab = TABS.indexOf(tab) >= 0 && tab !== 'sres' ? tab : 'train';
    $('project-name').value = state.p.name; $('project-notes').value = state.p.notes || '';
    state.validation = M.validate(state.p);
    activate(state.tab); refresh();
  }

  R.app = { state: state, activate: activate, load: load, refresh: refresh, runStatic: runStatic };
  if (doc.readyState === 'loading') { doc.addEventListener('DOMContentLoaded', start); } else { start(); }
}(typeof globalThis !== 'undefined' ? globalThis : this));
