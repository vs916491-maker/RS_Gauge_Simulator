'use strict';
// Word report (js/report.js): content blocks from the sample runs and a well-formed .docx package.
var assert = require('assert');
var fs = require('fs'), path = require('path');
var M = require('../js/model.js'), E = require('../js/engine.js'), RP = require('../js/report.js');
var SAMPLE = require('../samples/sample-project.json');
var MD = fs.readFileSync(path.join(__dirname, '..', 'METHOD.md'), 'utf8');
var tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

// minimal XML well-formedness check: balanced tags, one root, no bare & or <
function wellFormed(xml, name) {
  var body = xml.replace(/^<\?xml[^>]*\?>/, ''), re = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+="[^"]*")*)\s*(\/?)>/g, stack = [], m, last = 0, roots = 0;
  while ((m = re.exec(body))) {
    var text = body.slice(last, m.index);
    assert.ok(!/<|&(?!(amp|lt|gt|quot|apos);)/.test(text), name + ': bad character data near ' + text.slice(0, 40));
    if (m[1]) { assert.strictEqual(stack.pop(), m[2], name + ': mismatched </' + m[2] + '>'); }
    else if (!m[4]) { if (!stack.length) { roots++; } stack.push(m[2]); }
    else if (!stack.length) { roots++; }
    last = re.lastIndex;
  }
  assert.strictEqual(stack.length, 0, name + ': unclosed ' + stack.join(','));
  assert.strictEqual(roots, 1, name + ': one root element');
  assert.ok(!body.slice(last).trim(), name + ': trailing text');
}
function run(withDyn, en) {
  var p = M.normalizeProject(JSON.parse(JSON.stringify(SAMPLE)));
  p.settings['static'].en_check = en ? 'yes' : 'no';
  p.name = 'Test & <project>';
  var s = E.staticRun(p, p.settings['static']), d = withDyn ? E.dynamicRun(p, p.settings['static'], p.settings.dynamic) : null;
  return { p: p, sres: s, dres: d, opt: p.settings.report, date: '15/11/2026', engineVersion: s.engineVersion, messages: M.validate(p).messages, methodMd: MD };
}
var PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('Report blocks: all chapters with static, EN and dynamic results', function () {
  var ctx = run(true, true), bl = RP.blocks(ctx), h1 = bl.filter(function (b) { return b.type === 'h1'; }).map(function (b) { return b.text; });
  ['1. Purpose and scope', '2. Summary of results', '3. Input data', '4. Method and options', '5. Static results', '6. EN 15273-2:2009 kinematic method', '7. Dynamic results',
    '8. Assumptions and limitations', 'Appendix A – Track data', 'Appendix B – Points of the governing static cases'].forEach(function (t) { assert.ok(h1.indexOf(t) >= 0, 'missing ' + t); });
  var sum = bl.filter(function (b) { return b.type === 'table' && b.head[0] === 'Check'; })[0];
  assert.ok(/39\.7 mm/.test(sum.rows[0][1]) && /TC, Exterior – Tare/.test(sum.rows[0][2]), 'governing static result in the summary: ' + sum.rows[0]);
  var a11 = bl.filter(function (b) { return b.type === 'list' && b.ordered; })[0];
  assert.strictEqual(a11.items.length, RP.methodSection(MD, 11).items.length);
  assert.ok(a11.items.length >= 8 && !/`/.test(a11.items.join('')), 'assumptions from METHOD §11 without code marks');
  var tA = bl.filter(function (b) { return b.type === 'table' && b.head[0] === 'From [m]'; })[0];
  assert.strictEqual(tA.rows.length, ctx.p.track.segments.length, 'Appendix A lists every track element');
  return bl.length + ' blocks';
});

test('Report blocks: without the dynamic run and EN, those chapters are left out and a note says so', function () {
  var ctx = run(false, false), bl = RP.blocks(ctx), txt = JSON.stringify(bl);
  assert.ok(txt.indexOf('7. Dynamic results') < 0 && txt.indexOf('6. EN 15273') < 0);
  assert.ok(/dynamic simulation has not been run/.test(txt));
  ctx.opt = JSON.parse(JSON.stringify(ctx.opt)); ctx.opt.appendix_points = 'no';
  assert.ok(JSON.stringify(RP.blocks(ctx)).indexOf('Appendix B') < 0);
});

test('Report .docx parts are well-formed, escaped, with one image relation per figure', function () {
  var ctx = run(true, true);
  ctx.images = { profiles: true, 'sec-0': true, 'dyn-xs': true };
  var imgs = { profiles: { data: PNG, w: 1000, h: 700 }, 'sec-0': { data: PNG, w: 1000, h: 1200 }, 'dyn-xs': { data: PNG, w: 1000, h: 800 } };
  var parts = RP.docxParts(RP.blocks(ctx), imgs, { header: 'Vehicle gauging report – A & B', headerRight: 'DOC-1 Rev A', footer: 'x', title: 't<1>' });
  Object.keys(parts.xml).forEach(function (k) { wellFormed(parts.xml[k], k); });
  assert.strictEqual(parts.images, 3); assert.strictEqual(Object.keys(parts.media).length, 3);
  assert.strictEqual((parts.xml['word/_rels/document.xml.rels'].match(/relationships\/image"/g) || []).length, 3);
  assert.strictEqual((parts.xml['word/document.xml'].match(/<a:blip r:embed=/g) || []).length, 3);
  assert.ok(parts.xml['word/document.xml'].indexOf('Test &amp; &lt;project&gt;') > 0, 'project name escaped');
  assert.ok(/Extension="png"/.test(parts.xml['[Content_Types].xml']));
  assert.ok(/NUMPAGES/.test(parts.xml['word/footer1.xml']) && /DOC-1 Rev A/.test(parts.xml['word/header1.xml']));
  // a tall image is limited to 13 cm high; figures are numbered in order
  var ext = parts.xml['word/document.xml'].match(/<wp:extent cx="(\d+)" cy="(\d+)"\/>/g).map(function (x) { return +x.match(/cy="(\d+)"/)[1]; });
  assert.ok(Math.max.apply(null, ext) <= 13 * 360000 + 1);
  assert.ok(/Figure 1 – Customer KE/.test(parts.xml['word/document.xml']) && /Figure 3 – Cross-section/.test(parts.xml['word/document.xml']), 'figures numbered');
  return Object.keys(parts.xml).length + ' XML parts';
});

module.exports = tests;
