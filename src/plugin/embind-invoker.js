// embind's `createJsInvoker` without code generation. Emscripten's own builds
// it with the Function constructor, which Hew's plugin realm refuses (its policy has no
// 'unsafe-eval'). tools/plugin-build.ts puts this in place of that one function
// in PackingSolver's loader. It answers the same factory: given the closure
// arguments craftInvokerFunction passes, a function that wires each argument,
// calls the C++ invoker, runs the destructors and unwires the result, in the
// same order the generated body does.
function createJsInvoker(argTypes, isClassMethodFunc, returns, isAsync) {
  var needsDestructorStack = usesDestructorStack(argTypes);
  var argsNeedStack = argsUseStackAlloc(argTypes);
  var useStackFrame = argsNeedStack && !isAsync && !needsDestructorStack;
  if (argsNeedStack && !useStackFrame) needsDestructorStack = true;
  var argCount = argTypes.length - 2;
  return function (humanName, throwBindingError, invoker, fn, runDestructors, fromRetWire, toClassParamWire) {
    var rest = Array.prototype.slice.call(arguments, 7);
    var k = 0;
    var saveStack = useStackFrame ? rest[k++] : null;
    var restoreStack = useStackFrame ? rest[k++] : null;
    var toArgWire = rest.slice(k, k + argCount);
    var dtors = rest.slice(k + argCount);
    return function () {
      var destructors = needsDestructorStack ? [] : null;
      var sp = useStackFrame ? saveStack() : 0;
      var wired = [fn];
      var thisWired;
      if (isClassMethodFunc) {
        thisWired = toClassParamWire(destructors, this);
        wired.push(thisWired);
      }
      var argWired = [];
      for (var i = 0; i < argCount; ++i) argWired.push(toArgWire[i](destructors, arguments[i]));
      var rv = invoker.apply(null, wired.concat(argWired));
      if (useStackFrame) restoreStack(sp);
      if (needsDestructorStack) runDestructors(destructors);
      else {
        var d = 0;
        for (i = isClassMethodFunc ? 1 : 2; i < argTypes.length; ++i) {
          if (argTypes[i].destructorFunction !== null) dtors[d++](i === 1 ? thisWired : argWired[i - 2]);
        }
      }
      if (returns) return fromRetWire(rv);
    };
  };
}
