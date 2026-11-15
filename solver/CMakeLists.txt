# PackingSolver (Florian Fontan, MIT) as a single-threaded WebAssembly module.
#
# Florian's own WebAssembly build (wasm/ in his repository) uses threads, so
# it needs SharedArrayBuffer and a cross-origin isolated page, which a Hew
# plugin doesn't get. This build compiles the same JavaScript API
# (wasm/src/packingsolver_wasm.cpp) without threads. Only `solve` works here,
# in "not-anytime-sequential" mode, which starts no thread since
# fontanf/packingsolver#859. It blocks while it computes, so call it from a
# Worker. `Session` needs a thread and fails.
#
#   source /path/to/emsdk/emsdk_env.sh
#   emcmake cmake -S solver -B solver/build -DCMAKE_BUILD_TYPE=Release
#   cmake --build solver/build --target packingsolver -j

cmake_minimum_required(VERSION 3.28)
project(TinyCutListSolver LANGUAGES CXX)

if(NOT EMSCRIPTEN)
    message(FATAL_ERROR "Build with the Emscripten toolchain (emcmake cmake ...)")
endif()

# HiGHS only (CLP has no WebAssembly build), and only the libraries.
set(PACKINGSOLVER_USE_CLP OFF)
set(PACKINGSOLVER_USE_HIGHS ON)
set(PACKINGSOLVER_BUILD_MAIN OFF)
set(PACKINGSOLVER_BUILD_TEST OFF)
set(PACKINGSOLVER_BUILD_PYTHON OFF)
set(PACKINGSOLVER_BUILD_WASM OFF)

# The library reports invalid inputs with C++ exceptions.
add_compile_options(-fwasm-exceptions)
add_link_options(-fwasm-exceptions)

include(FetchContent)
set(FETCHCONTENT_QUIET FALSE)
FetchContent_Declare(
    packingsolver
    GIT_REPOSITORY https://github.com/fontanf/packingsolver.git
    GIT_TAG 5b0402c9aaab3197488e57ff171e1a3413a7a338
    EXCLUDE_FROM_ALL)
FetchContent_MakeAvailable(packingsolver)

add_executable(packingsolver ${packingsolver_SOURCE_DIR}/wasm/src/packingsolver_wasm.cpp)
target_link_libraries(packingsolver PRIVATE
    PackingSolver_rectangleguillotine
    PackingSolver_rectangle
    PackingSolver_box
    PackingSolver_boxstacks
    PackingSolver_onedimensional
    PackingSolver_irregular)
target_link_options(packingsolver PRIVATE
    -lembind
    # `import PackingSolver from "./packingsolver.js"`, then `await PackingSolver()`,
    # in a page, a Worker or Node.
    -sMODULARIZE=1
    -sEXPORT_ES6=1
    -sEXPORT_NAME=PackingSolver
    -sENVIRONMENT=web,worker,node
    -sALLOW_MEMORY_GROWTH=1
    -sMAXIMUM_MEMORY=4GB)
set_target_properties(packingsolver PROPERTIES
    CXX_STANDARD 17
    SUFFIX ".js")
