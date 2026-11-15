/* Rolling Stock Gauge Simulator — Word (.docx) gauging report.
 * DOM-free: builds the report as blocks from the project and the run results, then the parts of the .docx
 * package (WordprocessingML). The page renders the chart images and zips the parts with the bundled JSZip.
 * No equations here: every number comes from js/engine.js results or from the inputs.
 * The http://schemas.openxmlformats.org/... strings are XML namespace names required by the file format, not network addresses.
 */
(function (root, factory) {
  'use strict';
  var R = root.RSGAUGE = root.RSGAUGE || {};
  var api = factory(R.schema || (typeof require === 'function' ? require('./schema.js') : null), R);
  R.report = api;
  if (typeof module === 'object' && module.exports) { module.exports = api; }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (S, R) {
  'use strict';

  // ------------------------------------------------------------------ formatting
  function fmt(v, d) {
    if (v === null || v === undefined || v === '' || (typeof v === 'number' && !isFinite(v))) { return '–'; }
    if (typeof v !== 'number') { return String(v); }
    var s = v.toFixed(d === undefined ? 0 : d);
    return s === '-0' || /^-0\.0*$/.test(s) ? s.slice(1) : s;
  }
  function fieldVal(fd, v) {
    if (v === null || v === undefined || v === '') { return '–'; }
    if (fd.t === 'sel' && fd.o) { var o = fd.o.filter(function (x) { return x[0] === v; })[0]; return o ? o[1] : String(v); }
    return typeof v === 'number' ? String(Math.round(v * 1e6) / 1e6) : String(v);
  }
  function unit(fd) { return fd.u ? ' [' + fd.u + ']' : ''; }
  function status(ok) { return ok ? 'OK' : 'CHECK'; }
  var SEC = { int: 'Interior', ext: 'Exterior', end: 'Car end' };

  // METHOD.md §11 (numbered list) and §12 (text) for the assumptions chapter
  function methodSection(md, num) {
    var m = String(md || '').split(/\n(?=## )/).filter(function (s) { return s.indexOf('## ' + num + '.') === 0; })[0];
    if (!m) { return { title: '', items: [], text: '' }; }
    var lines = m.split('\n'), title = lines.shift().replace(/^##\s*/, ''), items = [], text = [];
    lines.forEach(function (l) {
      if (/^\d+\.\s/.test(l)) { items.push(l.replace(/^\d+\.\s+/, '')); }
      else if (/^\s+\S/.test(l) && items.length) { items[items.length - 1] += ' ' + l.trim(); }
      else if (l.trim()) { text.push(l.trim()); }
    });
    return { title: title, items: items, text: text.join(' ') };
  }
  function plain(s) { return String(s).replace(/`([^`]+)`/g, '$1'); }

  // ------------------------------------------------------------------ report content
  // ctx: { p, sres, dres (or null), opt (report options), date, engineVersion, staleS, staleD, messages: [{tab, level, text}], methodMd, images: {id: true} }
  function blocks(ctx) {
    var p = ctx.p, s = ctx.sres, d = ctx.dres, o = ctx.opt || {}, t = p.train || {}, out = [], img = ctx.images || {};
    function add(b) { out.push(b); }
    function h1(x) { add({ type: 'h1', text: x }); }
    function h2(x) { add({ type: 'h2', text: x }); }
    function para(x) { add({ type: 'p', text: x }); }
    function note(x) { add({ type: 'note', text: x }); }
    function table(head, rows, widths) { add({ type: 'table', head: head, rows: rows, widths: widths }); }
    function image(id, caption) { if (img[id]) { add({ type: 'image', id: id, caption: caption }); } }
    var st = s ? p.settings['static'] : null, dy = p.settings.dynamic, en = !!(s && s.en);

    // ---- cover
    add({ type: 'title', text: o.title || 'Vehicle gauging report' });
    add({ type: 'subtitle', text: p.name || t.name || '' });
    table(['Item', 'Value'], [
      ['Customer', t.customer || '–'], ['Line / project', t.line || '–'], ['Train', (t.name || '–') + (t.formation ? ' (' + t.formation + ')' : '')],
      ['Document number', o.doc_no || '–'], ['Revision', o.revision || '–'], ['Date', ctx.date || '–'],
      ['Prepared by', o.prepared || ''], ['Checked by', o.checked || ''], ['Approved by', o.approved || ''],
      ['Calculation tool', 'Rolling Stock Gauge Simulator, engine ' + (ctx.engineVersion || '')]
    ], [0.35, 0.65]);
    if (p.fictional) { note('WARNING: this report is based on the fictional example data shipped with the tool, not on a real project.'); }
    if (ctx.staleS) { note('WARNING: the inputs were changed after the static run; the static results may be out of date.'); }
    if (ctx.staleD) { note('WARNING: the inputs were changed after the dynamic run; the dynamic results may be out of date.'); }
    if (!d) { note('The dynamic simulation has not been run; chapter 7 is not included.'); }
    add({ type: 'pagebreak' });

    // ---- 1 purpose
    var carNames = (t.carTypes || []).map(function (c) { return c.name; });
    var len = d ? d.summary.length : null;
    h1('1. Purpose and scope');
    para('This report gives the gauging of the ' + (t.name || 'train') + (t.formation ? ' (' + t.formation + ')' : '') + ', car types ' + carNames.join(', ') +
      ', against the customer kinematic envelope ' + (s ? '**' + s.ke.name + '**' : '') + '. It covers:');
    var scope = ['the static check of the RS profiles with all vehicle movements against the customer KE (Method B, six cases per car type);',
      'the maximum static half-width allowed by the customer KE (Method A) and the vertical checks;'];
    if (en) { scope.push('the check by the EN 15273-2:2009 kinematic method, with the customer KE as reference profile;'); }
    if (d) { scope.push('the dynamic check along ' + (t.line || 'the line') + ' (' + fmt(len) + ' m, every ' + fmt(d.summary.step) + ' m): required half-widths against the KE and the SOD allowance, structures, underframe height and platform gaps.'); }
    add({ type: 'list', items: scope });
    para('The equations, symbols and assumptions are those of the Method & Assumptions tab of the tool (chapter 8 lists the assumptions).');

    // ---- 2 summary
    h1('2. Summary of results');
    var rows = [];
    if (s) {
      var g = s.governing;
      rows.push(['Static clearance to the customer KE (Method B)', g ? fmt(g.c, 1) + ' mm' : '–', g ? g.car + ', ' + g.label : '', status(s.cars.every(function (c) { return c.cases.every(function (k) { return k.ok; }); }))]);
      var lowV = null;
      s.cars.forEach(function (c) { c.vertical.forEach(function (v) { if (!v.info && (!lowV || v.margin < lowV.margin)) { lowV = { margin: v.margin, car: c.car, label: v.label }; } }); });
      rows.push(['Vertical checks – smallest margin', lowV ? fmt(lowV.margin, 1) + ' mm' : '–', lowV ? lowV.car + ', ' + lowV.label : '', status(s.cars.every(function (c) { return c.vertical.every(function (v) { return v.info || v.ok; }); }))]);
      if (en) { var eg = s.en.governing; rows.push(['EN 15273-2:2009 – smallest margin to the maximum construction gauge', eg ? fmt(eg.margin, 1) + ' mm' : '–', eg ? eg.car + ', ' + SEC[eg.section] + ', h ' + fmt(eg.h) + ' mm' : '', status(s.en.ok)]); }
    }
    if (d) {
      var q = d.summary;
      rows.push(['Dynamic – points above the SOD allowance', String(q.sod_n), q.sod_first !== null && q.sod_first !== undefined ? 'first at ' + fmt(q.sod_first) + ' m' : '', status(q.sod_n === 0)]);
      rows.push(['Dynamic – largest excess over the KE, outside / inside', fmt(q.xo.v, 1) + ' / ' + fmt(q.xi.v, 1) + ' mm', q.xo.car + ' at ' + fmt(q.xo.ch) + ' m', 'info']);
      rows.push(['Dynamic – smallest structure clearance', q.sc ? fmt(q.sc.v, 1) + ' mm' : 'no structures', q.sc ? q.sc.car + ' at ' + fmt(q.sc.ch) + ' m' : '', status(q.sc_ok)]);
      rows.push(['Dynamic – smallest underframe height (limit ' + fmt(q.uf_lim) + ' mm)', fmt(q.uf.v, 1) + ' mm', q.uf.car + ' at ' + fmt(q.uf.ch) + ' m', status(q.uf_ok)]);
      if (q.gm) { rows.push(['Dynamic – platform gap, smallest / largest nominal', fmt(q.gm.v, 1) + ' / ' + fmt(q.gn.v, 1) + ' mm', q.gm.car + ' at ' + fmt(q.gm.ch) + ' m', status(q.gm_ok) + (q.gn_info ? ' (gap > ' + fmt(q.prm) + ' mm PRM: information)' : '')]); }
      rows.push(['Dynamic – largest cant deficiency (limit ' + fmt(q.def_lim) + ' mm)', fmt(q.def.v, 1) + ' mm', 'at ' + fmt(q.def.ch) + ' m', status(q.def_ok)]);
      if (q.sodc) { rows.push(['Dynamic – smallest clearance to the SOD outline (required ' + fmt(q.sodc_req) + ' mm)', fmt(q.sodc.v, 1) + ' mm', q.sodc.car + ' at ' + fmt(q.sodc.ch) + ' m', status(q.sodo_n === 0)]); }
      if (q.itm) { rows.push(['Dynamic – smallest point-item margin over its required clearance', fmt(q.itm.v, 1) + ' mm', q.itm.car + ' at ' + fmt(q.itm.ch) + ' m', status(q.it_n === 0)]); }
    }
    table(['Check', 'Result', 'Where', 'Status'], rows, [0.42, 0.18, 0.26, 0.14]);
    var allOk = (!s || s.ok) && (!d || d.ok);
    para(allOk ? '**Conclusion:** every check above is satisfied for the inputs and options of this report.'
      : '**Conclusion:** one or more checks are not satisfied (status CHECK); see the chapters below.');

    // ---- 3 inputs
    h1('3. Input data');
    h2('3.1 Train');
    table(['Parameter', 'Value'], S.trainFields.map(function (fd) { return [fd.l + unit(fd), fieldVal(fd, t[fd.k])]; }), [0.6, 0.4]);
    h2('3.2 Car types');
    var ct = t.carTypes || [];
    table(['Parameter'].concat(ct.map(function (c) { return c.name; })), S.carType.filter(function (fd) { return fd.k !== 'name'; }).map(function (fd) {
      return [fd.l + unit(fd)].concat(ct.map(function (c) { return fieldVal(fd, c[fd.k]); }));
    }));
    h2('3.3 Bogies');
    table(['Parameter'].concat(p.bogies.map(function (b) { return b.name; })), S.bogieMain.filter(function (fd) { return fd.k !== 'name'; }).map(function (fd) {
      return [fd.l + unit(fd)].concat(p.bogies.map(function (b) { return fieldVal(fd, b[fd.k]); }));
    }));
    h2('3.4 Car bodies');
    table(['Parameter'].concat(p.bodies.map(function (b) { return b.name; })), S.body.filter(function (fd) { return fd.k !== 'name'; }).map(function (fd) {
      return [fd.l + unit(fd)].concat(p.bodies.map(function (b) { return fieldVal(fd, b[fd.k]); }));
    }));
    h2('3.5 Customer KE, SOD and limits');
    table(['Profile', 'Type', 'Points', 'Height range [mm]', 'Largest half-width [mm]'], p.ke.profiles.map(function (k) { return prof(k, 'Customer KE'); }).concat(p.sod.profiles.map(function (k) { return prof(k, 'SOD'); })));
    table(['Limit', 'Value'], S.customerLimits.map(function (fd) { return [fd.l + unit(fd), fieldVal(fd, p.ke.limits[fd.k])]; }), [0.6, 0.4]);
    para('SOD frame: ' + (p.sod.frame === 'vertical' ? 'vertical (KE rotated by cant)' : 'track plane (same as the KE)') + '; required clearance of the vehicle envelope to the SOD outline: ' + fmt(p.sod.margin_mm) + ' mm.');
    if (p.sod.items.length) {
      table(['Point item', 'Type', 'Y [mm]', 'Z [mm]', 'Required [mm]', 'Side', 'Chainage [m]'], p.sod.items.map(function (it) {
        return [it.name || '', fieldVal(fd('type'), it.type), fmt(it.y), fmt(it.z), fmt(it.min_clear_mm), fieldVal(fd('side'), it.side), (it.ch_from_m === null ? 'start' : fmt(it.ch_from_m)) + ' – ' + (it.ch_to_m === null ? 'end' : fmt(it.ch_to_m))];
      }), [0.26, 0.12, 0.09, 0.09, 0.12, 0.1, 0.22]);
    }
    if (en) { para('EN 15273-2:2009 associated rules used with the customer KE as reference profile:'); table(['Rule', 'Value'], S.enParams.map(function (fd) { return [fd.l + unit(fd), fieldVal(fd, p.ke.en[fd.k])]; }), [0.6, 0.4]); }
    image('profiles', 'Customer KE and RS profiles (half-widths mirrored, mm).');
    h2('3.6 RS profiles');
    table(['Profile', 'Type', 'Points', 'Height range [mm]', 'Largest half-width [mm]'], p.rs.profiles.map(function (k) { return prof(k, 'RS profile'); }));
    h2('3.7 Track data');
    var tp = p.track.params, segs = p.track.segments, rmin = null, cmax = 0, vmax = 0, nc = 0;
    segs.forEach(function (x) {
      if (x.element === 'circular') { nc++; }
      [x.R_start_m, x.R_end_m].forEach(function (Rr) { if (Rr > 0 && (rmin === null || Rr < rmin)) { rmin = Rr; } });
      cmax = Math.max(cmax, Math.abs(x.cant_start_mm || 0), Math.abs(x.cant_end_mm || 0)); vmax = Math.max(vmax, x.speed_kmh || 0);
    });
    para(segs.length + ' track elements from ' + fmt(segs.length ? segs[0].from_m : 0) + ' m to ' + fmt(segs.length ? segs[segs.length - 1].to_m : 0) + ' m; ' + nc + ' circular curves, smallest radius ' + fmt(rmin) +
      ' m, largest cant ' + fmt(cmax) + ' mm, highest speed limit ' + fmt(vmax) + ' km/h. The element list is in Appendix A.');
    table(['Parameter', 'Value'], [].concat(S.trackOperating, S.trackTolerances, S.trackStatic, S.trackSweep).map(function (fd) { return [fd.l + unit(fd), fieldVal(fd, tp[fd.k])]; }), [0.6, 0.4]);

    // ---- 4 method and options
    h1('4. Method and options');
    para('Static check (Method B): each RS profile point is displaced by the lateral and vertical movements of the case (geometric overthrow at the static radius, ' +
      'wheel–rail and suspension plays with the yaw factor, quasi-static roll from cant and wind, random terms) and its clearance to the customer KE is measured. ' +
      'Six cases per car type: interior, exterior and car end, each in tare and crush. Method A gives the largest static half-width the KE allows at each height. ' +
      'The dynamic check sweeps every car type along the track data and keeps the worst car type at each chainage; it also checks the whole displaced profile against ' +
      'the SOD outline of each track element (tangent SOD widened by the curve allowance) and against the point items.');
    if (st) { h2('4.1 Static options'); table(['Option', 'Value'], S.staticOptions.map(function (fd) { return [fd.l, fieldVal(fd, st[fd.k])]; }), [0.65, 0.35]); }
    if (d) { h2('4.2 Dynamic options'); table(['Option', 'Value'], S.dynamicOptions.map(function (fd) { return [fd.l + unit(fd), fieldVal(fd, dy[fd.k])]; }), [0.65, 0.35]); }

    // ---- 5 static
    if (s) {
      h1('5. Static results');
      h2('5.1 Minimum clearance to the customer KE per case [mm]');
      table(['Car type'].concat(s.cars[0] ? s.cars[0].cases.map(function (k) { return k.label; }) : []), s.cars.map(function (c) {
        return [c.car].concat(c.cases.map(function (k) { return fmt(k.min.c, 1) + ' (' + k.min.pt + ')' + (k.ok ? '' : ' ✗'); }));
      }));
      para('Governing: **' + (s.governing ? s.governing.car + ', ' + s.governing.label + ', ' + fmt(s.governing.c, 1) + ' mm' : '–') + '**. Point names in brackets; ✗ = infringes the KE.');
      s.cars.forEach(function (c, ci) {
        h2('5.' + (ci + 2) + ' Car type ' + c.car);
        var gk = c.cases.filter(function (k) { return c.governing && k.id === c.governing.id; })[0] || c.cases[0];
        table(['Quantity'].concat(c.cases.map(function (k) { return k.label; })), [
          ['Section position n [m]'].concat(c.cases.map(function (k) { return fmt(k.params.n, 3); })),
          ['Profile'].concat(c.cases.map(function (k) { return k.profile; })),
          ['Geometric overthrow [mm]'].concat(c.cases.map(function (k) { return fmt(k.params.dg, 1); })),
          ['Quasi-static translation T [mm]'].concat(c.cases.map(function (k) { return fmt(k.params.T, 2); })),
          ['Roll angle θq [mrad]'].concat(c.cases.map(function (k) { return fmt(k.params.thq * 1000, 2); })),
          ['Minimum clearance [mm]'].concat(c.cases.map(function (k) { return fmt(k.min.c, 1); }))
        ]);
        image('sec-' + ci, c.car + ': ' + (gk ? gk.label : '') + ' (governing case), profile and displaced profile against the customer KE.');
        image('ma-' + ci, c.car + ': maximum static half-width (Method A)' + (c.en ? ' and EN 15273-2 maximum construction gauge' : '') + '.');
        var maRows = c.methodA.filter(function (x, i) { return i % 2 === 0 || i === c.methodA.length - 1; });
        table(['h [mm]', 'KE [mm]', 'Max Int', 'Max Ext', 'Max End', 'Margin Int', 'Margin Ext', 'Margin End'], maRows.map(function (x) {
          return [fmt(x.h), fmt(x.W, 1), fmt(x.max_int, 1), fmt(x.max_ext, 1), fmt(x.max_end, 1), fmt(x.margin_int, 1), fmt(x.margin_ext, 1), fmt(x.margin_end, 1)];
        }));
        table(['Vertical check', 'Value [mm]', 'Limit [mm]', 'Margin [mm]', 'Status'], c.vertical.map(function (v) {
          return [v.label, fmt(v.value, 1), v.info ? '–' : fmt(v.limit, 1), v.info ? '–' : fmt(v.margin, 1), v.info ? 'info' : status(v.ok)];
        }), [0.44, 0.14, 0.14, 0.14, 0.14]);
      });
      h2('5.' + (s.cars.length + 2) + ' Derived values');
      table(['Quantity'].concat(s.cars.map(function (c) { return c.car; })), [
        ['Pivot distance a [m]'].concat(s.cars.map(function (c) { return fmt(c.derived.geo.a, 3); })),
        ['Overhang n end [m]'].concat(s.cars.map(function (c) { return fmt(c.derived.geo.n_end, 3); })),
        ['Yaw factor A car end'].concat(s.cars.map(function (c) { return fmt(c.derived.geo.A_end, 4); })),
        ['Flexibility s tare / crush'].concat(s.cars.map(function (c) { return fmt(c.derived.s_t, 3) + ' / ' + fmt(c.derived.s_c, 3); })),
        ['Roll centre hc tare / crush [m]'].concat(s.cars.map(function (c) { return fmt(c.derived.hc_t, 3) + ' / ' + fmt(c.derived.hc_c, 3); })),
        ['Wind equivalent cant tare / crush [mm]'].concat(s.cars.map(function (c) { return fmt(c.derived.wind.Dw_t, 1) + ' / ' + fmt(c.derived.wind.Dw_c, 1); })),
        ['Axle load [t]'].concat(s.cars.map(function (c) { return fmt(c.derived.shared.axle_t, 2); }))
      ]);
      if (s.warnings.length) { para('Warnings of the static run:'); add({ type: 'list', items: s.warnings }); }

      // ---- 6 EN
      if (en) {
        h1('6. EN 15273-2:2009 kinematic method');
        para('The customer KE is the reference profile; the reductions Ei (between the bogie centres) and Ea (beyond) follow EN 15273-2:2009 Annex A with the rules of §3.5 ' +
          '(traction-unit formulae A.3.9.1.1 for a car with a motor bogie, coach formulae A.3.9.3.1 otherwise), worst of tare and crush.');
        table(['Car type', 'Formula set', 'd worn [mm]', 'Margin Int [mm]', 'Margin Ext [mm]', 'Margin End [mm]', 'Status'], s.cars.filter(function (c) { return c.en; }).map(function (c) {
          return [c.car, c.en.clause, fmt(c.en.d, 1)].concat(['int', 'ext', 'end'].map(function (k) { var m = c.en.checks[k].min; return m ? fmt(m.margin, 1) + ' at h ' + fmt(m.h) : '–'; }), [status(c.en.ok)]);
        }));
        s.cars.forEach(function (c, ci) { image('en-' + ci, c.car + ': EN 15273-2 maximum construction gauge against the workbook Method A.'); });
        para('Heights above the running surface (A.3.4). Lower parts: height (tare, new wheels) minus the Table A.1 displacements of the body zone ' +
          '(suspension Aff with ΔAff·n/a and 0,1·s·(b − b2), wheel wear Usr with ΔUsr·n/a; bogie-mounted parts: primary suspension and wheel wear) shall not be below ' +
          'the lower limit increased by the gradient-transition value A.16 / A.17. Upper parts: profile top + 10 mm per suspension level + A.18 / A.19 shall not exceed the KE top.');
        var lw = [], up = [];
        s.cars.forEach(function (c) { var v = c.en && c.en.vertical; if (!v) { return; }
          v.lower.forEach(function (q) { lw.push([c.car, q.name, q.zone === 'bogie' ? 'Bogie' : q.zone, fmt(q.h), fmt(q.susp + q.wear, 1), fmt(q.lim) + (q.grad ? ' + ' + fmt(q.grad, 1) : ''), fmt(q.margin, 1), status(q.ok)]); });
          v.upper.forEach(function (q) { up.push([c.car, SEC[q.section], fmt(q.top), fmt(q.ext + q.grad, 1), fmt(q.lim), fmt(q.margin, 1), status(q.ok)]); });
        });
        if (lw.length) { table(['Car type', 'Lower part', 'Zone', 'Height [mm]', 'Displacement [mm]', 'Limit [mm]', 'Margin [mm]', 'Status'], lw); }
        if (up.length) { table(['Car type', 'Section', 'Profile top [mm]', 'Extension + gradient [mm]', 'KE top [mm]', 'Margin [mm]', 'Status'], up); }
        var bpr = s.en && s.en.bogieParts ? s.en.bogieParts.rows : [];
        if (bpr.length) {
          para('Bogie parts (A.3.11): reduction formulae of independent-axle vehicles A.56–A.59 with w = 0 and a = distance between the end axles; KE half-width taken as the smallest over the height range of the part.');
          table(['Bogie type', 'Part', 'Position', 'Height [mm]', 'Half-width [mm]', 'E [mm]', 'EN max [mm]', 'Margin [mm]', 'Status'], bpr.map(function (q) {
            return [q.bogie, q.name, q.pos === 'beyond' ? 'Beyond, n ' + fmt(q.n, 2) + ' m' : 'Between, n ' + fmt(q.n, 2) + ' m', fmt(q.h), fmt(q.y), fmt(q.E, 1), fmt(q.max, 1), fmt(q.margin, 1), status(q.ok)];
          }));
        }
      }
    }

    // ---- 7 dynamic
    if (d) {
      var q2 = d.summary;
      h1('7. Dynamic results');
      para('Line ' + fmt(q2.length) + ' m, ' + q2.points + ' points every ' + fmt(q2.step) + ' m; customer KE as given per track element; worst car type per chainage. ' +
        (d.ok ? 'All points satisfy the checks.' : q2.check_n + ' point(s) need checking.'));
      h2('7.1 Per car type');
      table(['Car type', 'Max OUT excess', 'Max IN excess', 'Points > SOD', 'Min structure', 'Min underframe', 'Min gap', 'Min SOD outline', 'Min item margin', 'Status'], d.cars.map(function (c) {
        var x = c.summary;
        return [c.car, fmt(x.xo.v, 1) + ' @ ' + fmt(x.xo.ch), fmt(x.xi.v, 1) + ' @ ' + fmt(x.xi.ch), String(x.sod_n), x.sc ? fmt(x.sc.v, 1) : '–', fmt(x.uf.v, 1), x.gm ? fmt(x.gm.v, 1) : '–',
          x.sodc ? fmt(x.sodc.v, 1) : '–', x.itm ? fmt(x.itm.v, 1) : '–', status(x.ok)];
      }));
      note('Values in mm, chainage in m after @.');
      image('dyn-excess', 'Excess of the required half-widths over the customer KE, against the SOD allowance (governing car type ' + q2.xo.car + ').');
      image('dyn-struct', 'Structure clearance at h2 along the line (car type ' + (q2.sc ? q2.sc.car : q2.xo.car) + ').');
      image('dyn-sodo', 'Clearance of the whole dynamic envelope to the SOD outline (widened by the curve allowance) and smallest point-item margin along the line.');
      image('dyn-xs', 'Cross-section at the largest outside excess (' + q2.xo.car + ', ' + fmt(q2.xo.ch) + ' m), in the vertical frame.');
      h2('7.2 Per track element (worst car type)');
      table(['No', 'From–to [m]', 'Element', 'R [m]', 'V', 'Max def', 'Excess OUT', 'Excess IN', 'Min struct', 'Min uf', 'SOD', 'Min outline', 'Min item', 'Status'], d.elements.map(function (e) {
        return [String(e.no), fmt(e.s0) + '–' + fmt(e.s1), e.type + (e.side ? ' ' + e.side : ''), e.R0 || e.R1 ? fmt(e.R0) + (e.R1 !== e.R0 ? '→' + fmt(e.R1) : '') : '–', fmt(e.V),
          fmt(e.def, 1), fmt(e.xo, 1), fmt(e.xi, 1), e.sc === null ? '–' : fmt(e.sc, 1), fmt(e.uf, 1), e.sodn || '–', e.sodc === null ? '–' : fmt(e.sodc, 1), e.itm === null ? '–' : fmt(e.itm, 1), e.status];
      }), null, 7);
      var gcar = d.cars.filter(function (c) { return c.car === q2.xo.car; })[0] || d.cars[0], ss = gcar.speedStep;
      h2('7.3 Speed-step study (' + gcar.car + ', R ' + fmt(ss.R) + ' m, cant ' + fmt(ss.cant) + ' mm, wind ' + fmt(ss.wind) + ' km/h, ' + ss.ke + ')');
      table(['V [km/h]', 'I def(+)/exc(−)', 'OUT h1', 'OUT h2', 'IN h1', 'IN h2', 'KE h2', 'Max excess', 'Remark'], ss.rows.map(function (x) {
        return [fmt(x.V), fmt(x.I, 1), fmt(x.o1, 1), fmt(x.o2, 1), fmt(x.i1, 1), fmt(x.i2, 1), fmt(x.kw2, 1), fmt(x.excess, 1), x.remark || ''];
      }));
    }

    // ---- 8 test calculations
    h1('8. Test calculations');
    var LD = { tare: 'Tare', crush: 'Crush', deflated: 'Deflated' }, sw = ctx.sway || [];
    h2('8.1 Sway test evaluation');
    if (!sw.length) { para('No sway test entered.'); }
    else {
      para('Least-squares fit of y = s·(D/L)·(h − hc) to the readings; accepted when the measured roll displacement per 100 mm of cant does not exceed the value used in gauging at h1, h2 and the top of the RS profiles.');
      table(['Car type', 'Load', 'Readings', 's / hc measured', 'RMS [mm]', 's / hc used', 'h1: meas. / used', 'h2: meas. / used', 'Top: meas. / used', 'Status'], sw.map(function (r) {
        if (r.error) { return [r.car, LD[r.load] || r.load, String(r.n), r.error, '', '', '', '', '', 'CHECK']; }
        return [r.car, LD[r.load], String(r.n), fmt(r.s, 3) + ' / ' + fmt(r.hc), fmt(r.rms, 2), fmt(r.used.s, 3) + ' / ' + fmt(r.used.hc)].concat(r.checks.map(function (c) { return fmt(c.measured, 1) + ' / ' + fmt(c.used, 1); }), [status(r.ok)]);
      }), null, 7.5);
    }
    if (ctx.plan && ctx.plan.length) {
      h2('8.2 Kinematic gauge test plan');
      para('Each static case is reproduced on straight test track: shims D = cant + wind equivalent cant under the low side, and the wheel–rail play, primary q and secondary w pushed to the stops (× A; ' +
        'interior: both bogies the same way, exterior and car end: opposite ways). The test template is the customer KE minus the terms not reproduced; the expected clearances equal the static run. ' +
        'Positions are measured perpendicular to the shimmed rail plane. Point-by-point values are in the Tests export.');
      var trows = [];
      ctx.plan.forEach(function (c) { c.cases.forEach(function (k) {
        trows.push([c.car, k.label, fmt(k.D, 1) + (k.beyondSway ? ' *' : ''), fmt(k.Rlat, 1), k.load === 'crush' ? 'Crush' : 'Tare', fmt(k.min.c, 1) + ' (' + k.min.pt + ')', k.minMeasured ? fmt(k.minMeasured.cm, 1) : '–']);
      }); });
      table(['Car type', 'Case', 'Shims D [mm]', 'Lateral to impose [mm]', 'Load', 'Expected min clearance [mm]', 'With measured s, hc [mm]'], trows, [0.12, 0.2, 0.12, 0.14, 0.1, 0.18, 0.14]);
      if (trows.some(function (r) { return / \*$/.test(r[2]); })) { note('* Shim height above the largest shim of the sway test of that car type and load: the roll is linear only by assumption beyond the tested range.'); }
    }

    // ---- 9 assumptions
    h1('9. Assumptions and limitations');
    var a11 = methodSection(ctx.methodMd, 11), a12 = methodSection(ctx.methodMd, 12);
    add({ type: 'list', ordered: true, items: a11.items.map(plain) });
    if (en) { para('EN 15273-2: implemented from the 2009 edition (superseded by EN 15273-2:2013). Vertical (A.3.4): the GIC1 / GIC2 lower profiles are not encoded (lower limits as entered or the customer minimum), hump-shunting terms of A.3.4.1.5 and contact ramps (A.3.5) are not applied. Bogie parts (A.3.11) by A.56–A.59. Not covered: pantograph, doors and steps open, tilting vehicles, wagons.'); }
    if (a12.text) { para('Out of scope: ' + plain(a12.text)); }

    // ---- 9 warnings
    var msgs = (ctx.messages || []).filter(function (m) { return m.level === 'warn' || m.level === 'err'; });
    if (msgs.length) { h1('10. Input warnings'); add({ type: 'list', items: msgs.map(function (m) { return (m.level === 'err' ? 'Error: ' : '') + m.text; }) }); }

    // ---- appendices
    add({ type: 'pagebreak' });
    h1('Appendix A – Track data');
    table(['From [m]', 'To [m]', 'Element', 'Side', 'R start', 'R end', 'Cant s/e [mm]', 'V [km/h]', 'KE', 'Location', 'Struct [mm]', 'Platform [mm]'], segs.map(function (x) {
      return [fmt(x.from_m, 1), fmt(x.to_m, 1), x.element, x.side || '', fmt(x.R_start_m), fmt(x.R_end_m), fmt(x.cant_start_mm) + ' / ' + fmt(x.cant_end_mm), fmt(x.speed_kmh), x.ke || '(default)', x.location || '', x.struct_mm ? fmt(x.struct_mm) : '', x.platform_mm ? fmt(x.platform_mm) + ' ' + (x.platform_side || '') : ''];
    }), [0.07, 0.07, 0.1, 0.05, 0.07, 0.07, 0.1, 0.06, 0.14, 0.1, 0.07, 0.1], 7);
    if (s && o.appendix_points !== 'no') {
      h1('Appendix B – Points of the governing static cases');
      s.cars.forEach(function (c) {
        var gk = c.cases.filter(function (k) { return c.governing && k.id === c.governing.id; })[0];
        if (!gk) { return; }
        h2(c.car + ' – ' + gk.label + ' (' + gk.profile + ')');
        table(['Pt', 'x0', 'h0', 'Lateral E', 'x displ.', 'h displ.', 'KE width at h', 'ΔX', 'ΔH', 'Clearance', 'Status'], gk.points.map(function (x) {
          return [x.pt, fmt(x.x0, 1), fmt(x.h0, 1), fmt(x.E, 2), fmt(x.x, 1), fmt(x.h, 1), fmt(x.W, 1), fmt(x.dX, 1), fmt(x.dH, 1), fmt(x.c, 1), x.ok ? 'OK' : 'INFRINGES'];
        }), null, 7.5);
      });
    }
    return out;
  }
  function fd(k) { return S.sodItem.filter(function (x) { return x.k === k; })[0]; }
  function prof(k, type) {
    var pts = k.points || [], lo = null, hi = null, w = null;
    pts.forEach(function (q) { var y = q.y, z = q.z; if (z !== null && z !== undefined) { lo = lo === null ? z : Math.min(lo, z); hi = hi === null ? z : Math.max(hi, z); } if (y !== null && y !== undefined) { w = w === null ? Math.abs(y) : Math.max(w, Math.abs(y)); } });
    return [k.name, type, String(pts.length), fmt(lo) + ' – ' + fmt(hi), fmt(w)];
  }

  // ------------------------------------------------------------------ WordprocessingML
  var NS_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main', NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  var NS_WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing', NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  var NS_PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture', NS_PR = 'http://schemas.openxmlformats.org/package/2006/relationships';
  var NS_CT = 'http://schemas.openxmlformats.org/package/2006/content-types', REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
  var XMLH = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  var PAGE_TW = 9638, EMU_CM = 360000;   // A4 minus 2 × 2 cm margins (twips); EMU per cm

  function xesc(v) {
    return String(v === null || v === undefined ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  // **bold** inline
  function runs(text, rp) {
    return String(text).split(/(\*\*[^*]+\*\*)/).filter(function (x) { return x; }).map(function (x) {
      var b = /^\*\*[^*]+\*\*$/.test(x), tx = b ? x.slice(2, -2) : x, pr = (b ? '<w:b/>' : '') + (rp || '');
      return '<w:r>' + (pr ? '<w:rPr>' + pr + '</w:rPr>' : '') + '<w:t xml:space="preserve">' + xesc(tx) + '</w:t></w:r>';
    }).join('');
  }
  function p(text, style, ppr, rp) {
    return '<w:p>' + (style || ppr ? '<w:pPr>' + (style ? '<w:pStyle w:val="' + style + '"/>' : '') + (ppr || '') + '</w:pPr>' : '') + runs(text, rp) + '</w:p>';
  }
  function colWidths(n, frac) {
    if (frac && frac.length === n) { return frac.map(function (f) { return Math.round(PAGE_TW * f); }); }
    if (n <= 1) { return [PAGE_TW]; }
    var first = Math.round(PAGE_TW * (n === 2 ? 0.6 : n <= 4 ? 0.4 : n <= 7 ? 0.28 : 0.16)), rest = Math.floor((PAGE_TW - first) / (n - 1)), w = [first], i;
    for (i = 1; i < n; i++) { w.push(rest); }
    return w;
  }
  function tableXml(head, rows, frac, size) {
    var w = colWidths(head.length, frac), sz = size ? '<w:sz w:val="' + Math.round(size * 2) + '"/><w:szCs w:val="' + Math.round(size * 2) + '"/>' : (head.length > 7 ? '<w:sz w:val="16"/><w:szCs w:val="16"/>' : '<w:sz w:val="18"/><w:szCs w:val="18"/>');
    var b = '<w:tblBorders>' + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(function (s) { return '<w:' + s + ' w:val="single" w:sz="4" w:space="0" w:color="A6A6A6"/>'; }).join('') + '</w:tblBorders>';
    function tr(cells, hdr) {
      return '<w:tr>' + (hdr ? '<w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>' : '<w:trPr><w:cantSplit/></w:trPr>') + head.map(function (h, j) {
        var c = cells[j], txt = c === null || c === undefined ? '' : String(c), bad = !hdr && /^(CHECK|INFRINGES|EXCEEDS)/.test(txt);
        return '<w:tc><w:tcPr><w:tcW w:w="' + w[j] + '" w:type="dxa"/>' + (hdr ? '<w:shd w:val="clear" w:color="auto" w:fill="DCE6F2"/>' : bad ? '<w:shd w:val="clear" w:color="auto" w:fill="F8D7DA"/>' : '') +
          '</w:tcPr><w:p><w:pPr><w:spacing w:before="10" w:after="10" w:line="240" w:lineRule="auto"/>' + (j > 0 && !hdr && /^[-−]?\d/.test(txt) ? '<w:jc w:val="right"/>' : '') + '</w:pPr>' +
          runs(txt, (hdr ? '<w:b/>' : '') + sz) + '</w:p></w:tc>';
      }).join('') + '</w:tr>';
    }
    return '<w:tbl><w:tblPr><w:tblW w:w="' + PAGE_TW + '" w:type="dxa"/>' + b + '<w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="60" w:type="dxa"/><w:right w:w="60" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
      '<w:tblGrid>' + w.map(function (x) { return '<w:gridCol w:w="' + x + '"/>'; }).join('') + '</w:tblGrid>' +
      tr(head, true) + rows.map(function (r) { return tr(r, false); }).join('') + '</w:tbl>' + p('', null, '<w:spacing w:after="60"/>');
  }
  function imageXml(rid, n, wcm, hcm) {
    var cx = Math.round(wcm * EMU_CM), cy = Math.round(hcm * EMU_CM);
    return '<w:p><w:pPr><w:keepNext/><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="' + cx + '" cy="' + cy + '"/><wp:docPr id="' + n + '" name="Figure ' + n + '"/>' +
      '<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>' +
      '<pic:nvPicPr><pic:cNvPr id="' + n + '" name="image' + n + '.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="' + rid + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
      '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
  }
  // images: { id: { data: base64 PNG, w: px, h: px } }; meta: { header, footer }
  function docxParts(bl, images, meta) {
    images = images || {}; meta = meta || {};
    var rels = [], media = {}, n = 0, used = {};
    var brk = false;
    var body = bl.map(function (b) {
      if (b.type === 'pagebreak') { brk = true; return ''; }
      var pb = brk ? '<w:pageBreakBefore/>' : ''; brk = false;
      if (b.type === 'title') { return p(b.text, 'Title', pb); }
      if (b.type === 'h1') { return p(b.text, 'Heading1', pb); }
      if (pb) { return p('', null, pb) + blockXml(b); }
      return blockXml(b);
    }).join('');
    function blockXml(b) {
      if (b.type === 'title') { return p(b.text, 'Title'); }
      if (b.type === 'subtitle') { return p(b.text, 'Subtitle'); }
      if (b.type === 'h1') { return p(b.text, 'Heading1'); }
      if (b.type === 'h2') { return p(b.text, 'Heading2'); }
      if (b.type === 'note') { return p(b.text, null, null, '<w:i/><w:color w:val="9C0006"/>'); }
      if (b.type === 'list') {
        return (b.items || []).map(function (tx, k) { return p((b.ordered ? (k + 1) + '. ' : '• ') + tx, null, '<w:spacing w:after="60"/><w:ind w:left="567" w:hanging="340"/>'); }).join('');
      }
      if (b.type === 'table') { return tableXml(b.head, b.rows, b.widths, b.size); }
      if (b.type === 'image') {
        var im = images[b.id]; if (!im || !im.data) { return ''; }
        n++; var rid = 'rIdImg' + n, name = 'image' + n + '.png';
        media['word/media/' + name] = im.data; used[b.id] = true;
        rels.push('<Relationship Id="' + rid + '" Type="' + REL + 'image" Target="media/' + name + '"/>');
        var wcm = 15, hcm = Math.min(13, wcm * (im.h / im.w));   // figures at most 15 cm wide and 13 cm high
        if (hcm === 13) { wcm = hcm * im.w / im.h; }
        return imageXml(rid, n, wcm, hcm) + p('Figure ' + n + ' – ' + (b.caption || ''), 'Caption');
      }
      return p(b.text || '', null);
    }
    var footer = XMLH + '<w:ftr xmlns:w="' + NS_W + '"><w:p><w:pPr><w:tabs><w:tab w:val="right" w:pos="' + PAGE_TW + '"/></w:tabs></w:pPr>' + runs(meta.footer || '', '<w:sz w:val="16"/>') +
      '<w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:tab/><w:t xml:space="preserve">Page </w:t></w:r><w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>' +
      '<w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:t>1</w:t></w:r><w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="end"/></w:r>' +
      '<w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:t xml:space="preserve"> of </w:t></w:r><w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:instrText xml:space="preserve"> NUMPAGES </w:instrText></w:r>' +
      '<w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:t>1</w:t></w:r><w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>';
    var header = XMLH + '<w:hdr xmlns:w="' + NS_W + '"><w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="4" w:space="1" w:color="A6A6A6"/></w:pBdr><w:tabs><w:tab w:val="right" w:pos="' + PAGE_TW + '"/></w:tabs></w:pPr>' +
      runs(meta.header || '', '<w:sz w:val="16"/><w:color w:val="595959"/>') + '<w:r><w:rPr><w:sz w:val="16"/><w:color w:val="595959"/></w:rPr><w:tab/></w:r>' + runs(meta.headerRight || '', '<w:sz w:val="16"/><w:color w:val="595959"/>') + '</w:p></w:hdr>';
    var doc = XMLH + '<w:document xmlns:w="' + NS_W + '" xmlns:r="' + NS_R + '" xmlns:wp="' + NS_WP + '" xmlns:a="' + NS_A + '" xmlns:pic="' + NS_PIC + '"><w:body>' + body +
      '<w:sectPr><w:headerReference w:type="default" r:id="rIdHdr"/><w:footerReference w:type="default" r:id="rIdFtr"/><w:pgSz w:w="11906" w:h="16838"/>' +
      '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>';
    var parts = {
      '[Content_Types].xml': XMLH + '<Types xmlns="' + NS_CT + '"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
        '<Default Extension="png" ContentType="image/png"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
        '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' +
        '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
        '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' +
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>',
      '_rels/.rels': XMLH + '<Relationships xmlns="' + NS_PR + '"><Relationship Id="rId1" Type="' + REL + 'officeDocument" Target="word/document.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>',
      'word/_rels/document.xml.rels': XMLH + '<Relationships xmlns="' + NS_PR + '"><Relationship Id="rIdSty" Type="' + REL + 'styles" Target="styles.xml"/>' +
        '<Relationship Id="rIdSet" Type="' + REL + 'settings" Target="settings.xml"/><Relationship Id="rIdHdr" Type="' + REL + 'header" Target="header1.xml"/>' +
        '<Relationship Id="rIdFtr" Type="' + REL + 'footer" Target="footer1.xml"/>' + rels.join('') + '</Relationships>',
      'word/document.xml': doc, 'word/styles.xml': STYLES, 'word/header1.xml': header, 'word/footer1.xml': footer,
      'word/settings.xml': XMLH + '<w:settings xmlns:w="' + NS_W + '"><w:updateFields w:val="true"/><w:defaultTabStop w:val="709"/></w:settings>',
      'docProps/core.xml': XMLH + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">' +
        '<dc:title>' + xesc(meta.title || '') + '</dc:title><dc:creator>' + xesc(meta.creator || '') + '</dc:creator></cp:coreProperties>'
    };
    return { xml: parts, media: media, images: n };
  }
  var STYLES = XMLH + '<w:styles xmlns:w="' + NS_W + '">' +
    '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="20"/><w:szCs w:val="20"/><w:lang w:val="en-GB"/></w:rPr></w:rPrDefault>' +
    '<w:pPrDefault><w:pPr><w:spacing w:after="100" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="2400" w:after="200"/></w:pPr><w:rPr><w:b/><w:color w:val="1F3864"/><w:sz w:val="48"/><w:szCs w:val="48"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="600"/></w:pPr><w:rPr><w:color w:val="2F5496"/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="1F3864"/><w:sz w:val="30"/><w:szCs w:val="30"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:color w:val="2F5496"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="caption"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:jc w:val="center"/><w:spacing w:before="60" w:after="200"/></w:pPr><w:rPr><w:i/><w:color w:val="404040"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:style>' +
    '</w:styles>';

  return { blocks: blocks, docxParts: docxParts, methodSection: methodSection, xesc: xesc };
}));
