#!/bin/sh
# Builds the single-threaded PackingSolver module from source into solver/dist.
# Needs Emscripten (emsdk): set EMSDK, or have emcmake on the PATH.
set -eu
cd "$(dirname "$0")/.."
if ! command -v emcmake >/dev/null 2>&1; then
  [ -n "${EMSDK:-}" ] && . "$EMSDK/emsdk_env.sh" >/dev/null 2>&1 || true
fi
command -v emcmake >/dev/null 2>&1 || { echo "emcmake not found: install emsdk and source emsdk_env.sh, or set EMSDK" >&2; exit 1; }
generator="Unix Makefiles"
command -v ninja >/dev/null 2>&1 && generator="Ninja"
emcmake cmake -S solver -B solver/build -G "$generator" -DCMAKE_BUILD_TYPE=Release
cmake --build solver/build --target packingsolver -j
mkdir -p solver/dist
cp solver/build/packingsolver.js solver/build/packingsolver.wasm solver/dist/
echo "built solver/dist/packingsolver.{js,wasm}"
