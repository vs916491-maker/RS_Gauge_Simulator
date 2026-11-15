'use strict';
// Static checks for the hard rules: opens from file://, offline, no build step, no ES modules, no CDN, no network.
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var root = path.join(__dirname, '..');

function read(p) { return fs.readFileSync(path.join(root, p), 'utf8'); }
function list(dir, ext) { return fs.readdirSync(path.join(root, dir)).filter(function (f) { return f.slice(-ext.length) === ext; }).map(function (f) { return dir + '/' + f; }); }

var tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

var html = read('index.html');
var own = ['index.html'].concat(list('css', '.css'), list('js', '.js'));

test('index.html loads only local classic scripts and styles that exist, in dependency order', function () {
  var refs = [], m, re = /<(?:script|link)\b[^>]*?(?:src|href)="([^"]+)"/g;
  while ((m = re.exec(html))) { refs.push(m[1]); }
  refs.forEach(function (r) {
    assert.ok(!/^[a-z][a-z0-9+.-]*:/i.test(r) && r.indexOf('//') !== 0, 'external reference: ' + r);
    assert.ok(fs.existsSync(path.join(root, r)), 'missing file: ' + r);
  });
  assert.ok(!/type\s*=\s*["']module["']/i.test(html), 'ES module script tag');
  var js = refs.filter(function (r) { return /\.js$/.test(r); });
  ['vendor/xlsx.full.min.js', 'vendor/chart.umd.js', 'js/schema.js', 'js/model.js', 'js/io.js', 'js/plot.js', 'js/ui.js'].reduce(function (prev, f) {
    var i = js.indexOf(f); assert.ok(i > prev, f + ' missing or loaded out of order'); return i;
  }, -1);
  list('js', '.js').forEach(function (f) { assert.ok(js.indexOf(f) >= 0, f + ' is not loaded by index.html'); });
  return refs.length + ' local references';
});

test('Own source has no http(s) URLs, imports/exports or network/worker APIs', function () {
  own.forEach(function (f) {
    var s = read(f);
    var urls = (s.match(/https?:\/\/[^\s'"<>)]+/gi) || []).filter(function (u) { return u !== 'http://www.w3.org/2000/svg'; });
    assert.ok(!urls.length, f + ' contains an http(s) URL: ' + urls[0]);
    assert.ok(!/(^|\n)\s*(import|export)\s+[\w{*]/.test(s), f + ' contains import/export');
    assert.ok(!/\bimport\s*\(/.test(s), f + ' uses dynamic import()');
    var code = s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.ok(!/\b(fetch|XMLHttpRequest|WebSocket|EventSource|importScripts|navigator\.sendBeacon)\b|new\s+Worker\b/.test(code), f + ' uses network/worker APIs');
    assert.ok(!/@import/.test(s), f + ' uses CSS @import');
  });
  return own.length + ' files scanned';
});

test('UI never injects HTML strings', function () {
  list('js', '.js').forEach(function (f) {
    var code = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(code), f + ' injects HTML');
  });
});

test('Vendor files are classic (non-module) builds with licences present', function () {
  [['vendor/xlsx.full.min.js', 100000], ['vendor/chart.umd.js', 100000]].forEach(function (fv) {
    var s = read(fv[0]);
    assert.ok(s.length > fv[1], fv[0] + ' looks truncated');
    assert.ok(!/(^|\n)\s*(import|export)\s+[\w{*]/.test(s.slice(0, 5000)), fv[0] + ' looks like an ES module');
  });
  ['vendor/LICENSE-sheetjs.txt', 'vendor/LICENSE-chartjs.txt', 'vendor/README.md'].forEach(function (f) { assert.ok(fs.existsSync(path.join(root, f)), f + ' missing'); });
});

test('Model, schema, IO and plot files are DOM-free and load in Node', function () {
  ['js/schema.js', 'js/model.js', 'js/plot.js'].forEach(function (f) {
    var s = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.ok(!/\b(document|window|localStorage|alert)\b/.test(s), f + ' touches the DOM');
    require('../' + f);
  });
  require('../js/io.js'); require('../js/markdown.js');   // markdown.js builds nodes on the document it is given; parseBlocks is DOM-free
});

module.exports = tests;
