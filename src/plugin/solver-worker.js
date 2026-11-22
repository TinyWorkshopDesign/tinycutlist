// The nested Worker that runs PackingSolver inside Hew. tools/plugin-build.ts
// puts this after PackingSolver's own loader (solver/dist/packingsolver.js,
// made a classic script), so `PackingSolver` is defined above.
//
// The first message carries the compiled WebAssembly module: the plugin
// compiles it once and the loader instantiates it through `instantiateWasm`,
// so this Worker never fetches or compiles anything. Then each message is one
// `solve`, answered with its id. A solve blocks this Worker while it runs,
// never the plugin's own, which keeps answering Hew.
"use strict";

var ready = null;

onmessage = function (e) {
  var d = e.data;
  if (d.module) {
    ready = PackingSolver({
      instantiateWasm: function (imports, done) {
        WebAssembly.instantiate(d.module, imports).then(function (instance) {
          done(instance, d.module);
        });
        return {};
      },
      print: function () {},
      printErr: function () {},
    });
    return;
  }
  ready
    .then(function (m) {
      postMessage({ id: d.id, ok: true, result: m.solve(d.type, d.instance, d.params) });
    })
    .catch(function (err) {
      postMessage({ id: d.id, ok: false, error: String((err && err.message) || err) });
    });
};
