// Minimal dependency-free test runner: node tests/run-tests.js
// A test passes if its function returns normally, or returns a promise that resolves.
'use strict';
var fs = require('fs');
var path = require('path');

var files = fs.readdirSync(__dirname).filter(function (f) { return /\.test\.js$/.test(f); }).sort();
var passed = 0, failed = 0;

function pass(t, note) { passed++; console.log('  PASS  ' + t.name + (note ? '\n        ' + note : '')); }
function fail(t, e) { failed++; console.log('  FAIL  ' + t.name + '\n        ' + (e && e.message ? e.message : e)); }

(async function () {
  for (var i = 0; i < files.length; i++) {
    var tests = require(path.join(__dirname, files[i]));
    console.log('\n' + files[i]);
    for (var j = 0; j < tests.length; j++) {
      var t = tests[j];
      try {
        var note = t.fn();
        if (note && typeof note.then === 'function') { note = await note; }
        pass(t, note);
      } catch (e) { fail(t, e); }
    }
  }
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}());
