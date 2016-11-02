"no use strict";
;(function(window) {
if (typeof window.window != "undefined" && window.document)
    return;
if (window.require && window.define)
    return;

if (!window.console) {
    window.console = function() {
        var msgs = Array.prototype.slice.call(arguments, 0);
        postMessage({type: "log", data: msgs});
    };
    window.console.error =
    window.console.warn = 
    window.console.log =
    window.console.trace = window.console;
}
window.window = window;
window.ace = window;

window.onerror = function(message, file, line, col, err) {
    postMessage({type: "error", data: {
        message: message,
        data: err.data,
        file: file,
        line: line, 
        col: col,
        stack: err.stack
    }});
};

window.normalizeModule = function(parentId, moduleName) {
    // normalize plugin requires
    if (moduleName.indexOf("!") !== -1) {
        var chunks = moduleName.split("!");
        return window.normalizeModule(parentId, chunks[0]) + "!" + window.normalizeModule(parentId, chunks[1]);
    }
    // normalize relative requires
    if (moduleName.charAt(0) == ".") {
        var base = parentId.split("/").slice(0, -1).join("/");
        moduleName = (base ? base + "/" : "") + moduleName;
        
        while (moduleName.indexOf(".") !== -1 && previous != moduleName) {
            var previous = moduleName;
            moduleName = moduleName.replace(/^\.\//, "").replace(/\/\.\//, "/").replace(/[^\/]+\/\.\.\//, "");
        }
    }
    
    return moduleName;
};

window.require = function require(parentId, id) {
    if (!id) {
        id = parentId;
        parentId = null;
    }
    if (!id.charAt)
        throw new Error("worker.js require() accepts only (parentId, id) as arguments");

    id = window.normalizeModule(parentId, id);

    var module = window.require.modules[id];
    if (module) {
        if (!module.initialized) {
            module.initialized = true;
            module.exports = module.factory().exports;
        }
        return module.exports;
    }
   
    if (!window.require.tlns)
        return console.log("unable to load " + id);
    
    var path = resolveModuleId(id, window.require.tlns);
    if (path.slice(-3) != ".js") path += ".js";
    
    window.require.id = id;
    window.require.modules[id] = {}; // prevent infinite loop on broken modules
    importScripts(path);
    return window.require(parentId, id);
};
function resolveModuleId(id, paths) {
    var testPath = id, tail = "";
    while (testPath) {
        var alias = paths[testPath];
        if (typeof alias == "string") {
            return alias + tail;
        } else if (alias) {
            return  alias.location.replace(/\/*$/, "/") + (tail || alias.main || alias.name);
        } else if (alias === false) {
            return "";
        }
        var i = testPath.lastIndexOf("/");
        if (i === -1) break;
        tail = testPath.substr(i) + tail;
        testPath = testPath.slice(0, i);
    }
    return id;
}
window.require.modules = {};
window.require.tlns = {};

window.define = function(id, deps, factory) {
    if (arguments.length == 2) {
        factory = deps;
        if (typeof id != "string") {
            deps = id;
            id = window.require.id;
        }
    } else if (arguments.length == 1) {
        factory = id;
        deps = [];
        id = window.require.id;
    }
    
    if (typeof factory != "function") {
        window.require.modules[id] = {
            exports: factory,
            initialized: true
        };
        return;
    }

    if (!deps.length)
        // If there is no dependencies, we inject "require", "exports" and
        // "module" as dependencies, to provide CommonJS compatibility.
        deps = ["require", "exports", "module"];

    var req = function(childId) {
        return window.require(id, childId);
    };

    window.require.modules[id] = {
        exports: {},
        factory: function() {
            var module = this;
            var returnExports = factory.apply(this, deps.map(function(dep) {
                switch (dep) {
                    // Because "require", "exports" and "module" aren't actual
                    // dependencies, we must handle them seperately.
                    case "require": return req;
                    case "exports": return module.exports;
                    case "module":  return module;
                    // But for all other dependencies, we can just go ahead and
                    // require them.
                    default:        return req(dep);
                }
            }));
            if (returnExports)
                module.exports = returnExports;
            return module;
        }
    };
};
window.define.amd = {};
require.tlns = {};
window.initBaseUrls  = function initBaseUrls(topLevelNamespaces) {
    for (var i in topLevelNamespaces)
        require.tlns[i] = topLevelNamespaces[i];
};

window.initSender = function initSender() {

    var EventEmitter = window.require("ace/lib/event_emitter").EventEmitter;
    var oop = window.require("ace/lib/oop");
    
    var Sender = function() {};
    
    (function() {
        
        oop.implement(this, EventEmitter);
                
        this.callback = function(data, callbackId) {
            postMessage({
                type: "call",
                id: callbackId,
                data: data
            });
        };
    
        this.emit = function(name, data) {
            postMessage({
                type: "event",
                name: name,
                data: data
            });
        };
        
    }).call(Sender.prototype);
    
    return new Sender();
};

var main = window.main = null;
var sender = window.sender = null;

window.onmessage = function(e) {
    var msg = e.data;
    if (msg.event && sender) {
        sender._signal(msg.event, msg.data);
    }
    else if (msg.command) {
        if (main[msg.command])
            main[msg.command].apply(main, msg.args);
        else if (window[msg.command])
            window[msg.command].apply(window, msg.args);
        else
            throw new Error("Unknown command:" + msg.command);
    }
    else if (msg.init) {
        window.initBaseUrls(msg.tlns);
        require("ace/lib/es5-shim");
        sender = window.sender = window.initSender();
        var clazz = require(msg.module)[msg.classname];
        main = window.main = new clazz(sender);
    }
};
})(this);

ace.define("ace/lib/oop",["require","exports","module"], function(require, exports, module) {
"use strict";

exports.inherits = function(ctor, superCtor) {
    ctor.super_ = superCtor;
    ctor.prototype = Object.create(superCtor.prototype, {
        constructor: {
            value: ctor,
            enumerable: false,
            writable: true,
            configurable: true
        }
    });
};

exports.mixin = function(obj, mixin) {
    for (var key in mixin) {
        obj[key] = mixin[key];
    }
    return obj;
};

exports.implement = function(proto, mixin) {
    exports.mixin(proto, mixin);
};

});

ace.define("ace/lib/lang",["require","exports","module"], function(require, exports, module) {
"use strict";

exports.last = function(a) {
    return a[a.length - 1];
};

exports.stringReverse = function(string) {
    return string.split("").reverse().join("");
};

exports.stringRepeat = function (string, count) {
    var result = '';
    while (count > 0) {
        if (count & 1)
            result += string;

        if (count >>= 1)
            string += string;
    }
    return result;
};

var trimBeginRegexp = /^\s\s*/;
var trimEndRegexp = /\s\s*$/;

exports.stringTrimLeft = function (string) {
    return string.replace(trimBeginRegexp, '');
};

exports.stringTrimRight = function (string) {
    return string.replace(trimEndRegexp, '');
};

exports.copyObject = function(obj) {
    var copy = {};
    for (var key in obj) {
        copy[key] = obj[key];
    }
    return copy;
};

exports.copyArray = function(array){
    var copy = [];
    for (var i=0, l=array.length; i<l; i++) {
        if (array[i] && typeof array[i] == "object")
            copy[i] = this.copyObject(array[i]);
        else 
            copy[i] = array[i];
    }
    return copy;
};

exports.deepCopy = function deepCopy(obj) {
    if (typeof obj !== "object" || !obj)
        return obj;
    var copy;
    if (Array.isArray(obj)) {
        copy = [];
        for (var key = 0; key < obj.length; key++) {
            copy[key] = deepCopy(obj[key]);
        }
        return copy;
    }
    if (Object.prototype.toString.call(obj) !== "[object Object]")
        return obj;
    
    copy = {};
    for (var key in obj)
        copy[key] = deepCopy(obj[key]);
    return copy;
};

exports.arrayToMap = function(arr) {
    var map = {};
    for (var i=0; i<arr.length; i++) {
        map[arr[i]] = 1;
    }
    return map;

};

exports.createMap = function(props) {
    var map = Object.create(null);
    for (var i in props) {
        map[i] = props[i];
    }
    return map;
};
exports.arrayRemove = function(array, value) {
  for (var i = 0; i <= array.length; i++) {
    if (value === array[i]) {
      array.splice(i, 1);
    }
  }
};

exports.escapeRegExp = function(str) {
    return str.replace(/([.*+?^${}()|[\]\/\\])/g, '\\$1');
};

exports.escapeHTML = function(str) {
    return str.replace(/&/g, "&#38;").replace(/"/g, "&#34;").replace(/'/g, "&#39;").replace(/</g, "&#60;");
};

exports.getMatchOffsets = function(string, regExp) {
    var matches = [];

    string.replace(regExp, function(str) {
        matches.push({
            offset: arguments[arguments.length-2],
            length: str.length
        });
    });

    return matches;
};
exports.deferredCall = function(fcn) {
    var timer = null;
    var callback = function() {
        timer = null;
        fcn();
    };

    var deferred = function(timeout) {
        deferred.cancel();
        timer = setTimeout(callback, timeout || 0);
        return deferred;
    };

    deferred.schedule = deferred;

    deferred.call = function() {
        this.cancel();
        fcn();
        return deferred;
    };

    deferred.cancel = function() {
        clearTimeout(timer);
        timer = null;
        return deferred;
    };
    
    deferred.isPending = function() {
        return timer;
    };

    return deferred;
};


exports.delayedCall = function(fcn, defaultTimeout) {
    var timer = null;
    var callback = function() {
        timer = null;
        fcn();
    };

    var _self = function(timeout) {
        if (timer == null)
            timer = setTimeout(callback, timeout || defaultTimeout);
    };

    _self.delay = function(timeout) {
        timer && clearTimeout(timer);
        timer = setTimeout(callback, timeout || defaultTimeout);
    };
    _self.schedule = _self;

    _self.call = function() {
        this.cancel();
        fcn();
    };

    _self.cancel = function() {
        timer && clearTimeout(timer);
        timer = null;
    };

    _self.isPending = function() {
        return timer;
    };

    return _self;
};
});

ace.define("ace/range",["require","exports","module"], function(require, exports, module) {
"use strict";
var comparePoints = function(p1, p2) {
    return p1.row - p2.row || p1.column - p2.column;
};
var Range = function(startRow, startColumn, endRow, endColumn) {
    this.start = {
        row: startRow,
        column: startColumn
    };

    this.end = {
        row: endRow,
        column: endColumn
    };
};

(function() {
    this.isEqual = function(range) {
        return this.start.row === range.start.row &&
            this.end.row === range.end.row &&
            this.start.column === range.start.column &&
            this.end.column === range.end.column;
    };
    this.toString = function() {
        return ("Range: [" + this.start.row + "/" + this.start.column +
            "] -> [" + this.end.row + "/" + this.end.column + "]");
    };

    this.contains = function(row, column) {
        return this.compare(row, column) == 0;
    };
    this.compareRange = function(range) {
        var cmp,
            end = range.end,
            start = range.start;

        cmp = this.compare(end.row, end.column);
        if (cmp == 1) {
            cmp = this.compare(start.row, start.column);
            if (cmp == 1) {
                return 2;
            } else if (cmp == 0) {
                return 1;
            } else {
                return 0;
            }
        } else if (cmp == -1) {
            return -2;
        } else {
            cmp = this.compare(start.row, start.column);
            if (cmp == -1) {
                return -1;
            } else if (cmp == 1) {
                return 42;
            } else {
                return 0;
            }
        }
    };
    this.comparePoint = function(p) {
        return this.compare(p.row, p.column);
    };
    this.containsRange = function(range) {
        return this.comparePoint(range.start) == 0 && this.comparePoint(range.end) == 0;
    };
    this.intersects = function(range) {
        var cmp = this.compareRange(range);
        return (cmp == -1 || cmp == 0 || cmp == 1);
    };
    this.isEnd = function(row, column) {
        return this.end.row == row && this.end.column == column;
    };
    this.isStart = function(row, column) {
        return this.start.row == row && this.start.column == column;
    };
    this.setStart = function(row, column) {
        if (typeof row == "object") {
            this.start.column = row.column;
            this.start.row = row.row;
        } else {
            this.start.row = row;
            this.start.column = column;
        }
    };
    this.setEnd = function(row, column) {
        if (typeof row == "object") {
            this.end.column = row.column;
            this.end.row = row.row;
        } else {
            this.end.row = row;
            this.end.column = column;
        }
    };
    this.inside = function(row, column) {
        if (this.compare(row, column) == 0) {
            if (this.isEnd(row, column) || this.isStart(row, column)) {
                return false;
            } else {
                return true;
            }
        }
        return false;
    };
    this.insideStart = function(row, column) {
        if (this.compare(row, column) == 0) {
            if (this.isEnd(row, column)) {
                return false;
            } else {
                return true;
            }
        }
        return false;
    };
    this.insideEnd = function(row, column) {
        if (this.compare(row, column) == 0) {
            if (this.isStart(row, column)) {
                return false;
            } else {
                return true;
            }
        }
        return false;
    };
    this.compare = function(row, column) {
        if (!this.isMultiLine()) {
            if (row === this.start.row) {
                return column < this.start.column ? -1 : (column > this.end.column ? 1 : 0);
            }
        }

        if (row < this.start.row)
            return -1;

        if (row > this.end.row)
            return 1;

        if (this.start.row === row)
            return column >= this.start.column ? 0 : -1;

        if (this.end.row === row)
            return column <= this.end.column ? 0 : 1;

        return 0;
    };
    this.compareStart = function(row, column) {
        if (this.start.row == row && this.start.column == column) {
            return -1;
        } else {
            return this.compare(row, column);
        }
    };
    this.compareEnd = function(row, column) {
        if (this.end.row == row && this.end.column == column) {
            return 1;
        } else {
            return this.compare(row, column);
        }
    };
    this.compareInside = function(row, column) {
        if (this.end.row == row && this.end.column == column) {
            return 1;
        } else if (this.start.row == row && this.start.column == column) {
            return -1;
        } else {
            return this.compare(row, column);
        }
    };
    this.clipRows = function(firstRow, lastRow) {
        if (this.end.row > lastRow)
            var end = {row: lastRow + 1, column: 0};
        else if (this.end.row < firstRow)
            var end = {row: firstRow, column: 0};

        if (this.start.row > lastRow)
            var start = {row: lastRow + 1, column: 0};
        else if (this.start.row < firstRow)
            var start = {row: firstRow, column: 0};

        return Range.fromPoints(start || this.start, end || this.end);
    };
    this.extend = function(row, column) {
        var cmp = this.compare(row, column);

        if (cmp == 0)
            return this;
        else if (cmp == -1)
            var start = {row: row, column: column};
        else
            var end = {row: row, column: column};

        return Range.fromPoints(start || this.start, end || this.end);
    };

    this.isEmpty = function() {
        return (this.start.row === this.end.row && this.start.column === this.end.column);
    };
    this.isMultiLine = function() {
        return (this.start.row !== this.end.row);
    };
    this.clone = function() {
        return Range.fromPoints(this.start, this.end);
    };
    this.collapseRows = function() {
        if (this.end.column == 0)
            return new Range(this.start.row, 0, Math.max(this.start.row, this.end.row-1), 0)
        else
            return new Range(this.start.row, 0, this.end.row, 0)
    };
    this.toScreenRange = function(session) {
        var screenPosStart = session.documentToScreenPosition(this.start);
        var screenPosEnd = session.documentToScreenPosition(this.end);

        return new Range(
            screenPosStart.row, screenPosStart.column,
            screenPosEnd.row, screenPosEnd.column
        );
    };
    this.moveBy = function(row, column) {
        this.start.row += row;
        this.start.column += column;
        this.end.row += row;
        this.end.column += column;
    };

}).call(Range.prototype);
Range.fromPoints = function(start, end) {
    return new Range(start.row, start.column, end.row, end.column);
};
Range.comparePoints = comparePoints;

Range.comparePoints = function(p1, p2) {
    return p1.row - p2.row || p1.column - p2.column;
};


exports.Range = Range;
});

ace.define("ace/apply_delta",["require","exports","module"], function(require, exports, module) {
"use strict";

function throwDeltaError(delta, errorText){
    console.log("Invalid Delta:", delta);
    throw "Invalid Delta: " + errorText;
}

function positionInDocument(docLines, position) {
    return position.row    >= 0 && position.row    <  docLines.length &&
           position.column >= 0 && position.column <= docLines[position.row].length;
}

function validateDelta(docLines, delta) {
    if (delta.action != "insert" && delta.action != "remove")
        throwDeltaError(delta, "delta.action must be 'insert' or 'remove'");
    if (!(delta.lines instanceof Array))
        throwDeltaError(delta, "delta.lines must be an Array");
    if (!delta.start || !delta.end)
       throwDeltaError(delta, "delta.start/end must be an present");
    var start = delta.start;
    if (!positionInDocument(docLines, delta.start))
        throwDeltaError(delta, "delta.start must be contained in document");
    var end = delta.end;
    if (delta.action == "remove" && !positionInDocument(docLines, end))
        throwDeltaError(delta, "delta.end must contained in document for 'remove' actions");
    var numRangeRows = end.row - start.row;
    var numRangeLastLineChars = (end.column - (numRangeRows == 0 ? start.column : 0));
    if (numRangeRows != delta.lines.length - 1 || delta.lines[numRangeRows].length != numRangeLastLineChars)
        throwDeltaError(delta, "delta.range must match delta lines");
}

exports.applyDelta = function(docLines, delta, doNotValidate) {
    
    var row = delta.start.row;
    var startColumn = delta.start.column;
    var line = docLines[row] || "";
    switch (delta.action) {
        case "insert":
            var lines = delta.lines;
            if (lines.length === 1) {
                docLines[row] = line.substring(0, startColumn) + delta.lines[0] + line.substring(startColumn);
            } else {
                var args = [row, 1].concat(delta.lines);
                docLines.splice.apply(docLines, args);
                docLines[row] = line.substring(0, startColumn) + docLines[row];
                docLines[row + delta.lines.length - 1] += line.substring(startColumn);
            }
            break;
        case "remove":
            var endColumn = delta.end.column;
            var endRow = delta.end.row;
            if (row === endRow) {
                docLines[row] = line.substring(0, startColumn) + line.substring(endColumn);
            } else {
                docLines.splice(
                    row, endRow - row + 1,
                    line.substring(0, startColumn) + docLines[endRow].substring(endColumn)
                );
            }
            break;
    }
}
});

ace.define("ace/lib/event_emitter",["require","exports","module"], function(require, exports, module) {
"use strict";

var EventEmitter = {};
var stopPropagation = function() { this.propagationStopped = true; };
var preventDefault = function() { this.defaultPrevented = true; };

EventEmitter._emit =
EventEmitter._dispatchEvent = function(eventName, e) {
    this._eventRegistry || (this._eventRegistry = {});
    this._defaultHandlers || (this._defaultHandlers = {});

    var listeners = this._eventRegistry[eventName] || [];
    var defaultHandler = this._defaultHandlers[eventName];
    if (!listeners.length && !defaultHandler)
        return;

    if (typeof e != "object" || !e)
        e = {};

    if (!e.type)
        e.type = eventName;
    if (!e.stopPropagation)
        e.stopPropagation = stopPropagation;
    if (!e.preventDefault)
        e.preventDefault = preventDefault;

    listeners = listeners.slice();
    for (var i=0; i<listeners.length; i++) {
        listeners[i](e, this);
        if (e.propagationStopped)
            break;
    }
    
    if (defaultHandler && !e.defaultPrevented)
        return defaultHandler(e, this);
};


EventEmitter._signal = function(eventName, e) {
    var listeners = (this._eventRegistry || {})[eventName];
    if (!listeners)
        return;
    listeners = listeners.slice();
    for (var i=0; i<listeners.length; i++)
        listeners[i](e, this);
};

EventEmitter.once = function(eventName, callback) {
    var _self = this;
    callback && this.addEventListener(eventName, function newCallback() {
        _self.removeEventListener(eventName, newCallback);
        callback.apply(null, arguments);
    });
};


EventEmitter.setDefaultHandler = function(eventName, callback) {
    var handlers = this._defaultHandlers
    if (!handlers)
        handlers = this._defaultHandlers = {_disabled_: {}};
    
    if (handlers[eventName]) {
        var old = handlers[eventName];
        var disabled = handlers._disabled_[eventName];
        if (!disabled)
            handlers._disabled_[eventName] = disabled = [];
        disabled.push(old);
        var i = disabled.indexOf(callback);
        if (i != -1) 
            disabled.splice(i, 1);
    }
    handlers[eventName] = callback;
};
EventEmitter.removeDefaultHandler = function(eventName, callback) {
    var handlers = this._defaultHandlers
    if (!handlers)
        return;
    var disabled = handlers._disabled_[eventName];
    
    if (handlers[eventName] == callback) {
        var old = handlers[eventName];
        if (disabled)
            this.setDefaultHandler(eventName, disabled.pop());
    } else if (disabled) {
        var i = disabled.indexOf(callback);
        if (i != -1)
            disabled.splice(i, 1);
    }
};

EventEmitter.on =
EventEmitter.addEventListener = function(eventName, callback, capturing) {
    this._eventRegistry = this._eventRegistry || {};

    var listeners = this._eventRegistry[eventName];
    if (!listeners)
        listeners = this._eventRegistry[eventName] = [];

    if (listeners.indexOf(callback) == -1)
        listeners[capturing ? "unshift" : "push"](callback);
    return callback;
};

EventEmitter.off =
EventEmitter.removeListener =
EventEmitter.removeEventListener = function(eventName, callback) {
    this._eventRegistry = this._eventRegistry || {};

    var listeners = this._eventRegistry[eventName];
    if (!listeners)
        return;

    var index = listeners.indexOf(callback);
    if (index !== -1)
        listeners.splice(index, 1);
};

EventEmitter.removeAllListeners = function(eventName) {
    if (this._eventRegistry) this._eventRegistry[eventName] = [];
};

exports.EventEmitter = EventEmitter;

});

ace.define("ace/anchor",["require","exports","module","ace/lib/oop","ace/lib/event_emitter"], function(require, exports, module) {
"use strict";

var oop = require("./lib/oop");
var EventEmitter = require("./lib/event_emitter").EventEmitter;

var Anchor = exports.Anchor = function(doc, row, column) {
    this.$onChange = this.onChange.bind(this);
    this.attach(doc);
    
    if (typeof column == "undefined")
        this.setPosition(row.row, row.column);
    else
        this.setPosition(row, column);
};

(function() {

    oop.implement(this, EventEmitter);
    this.getPosition = function() {
        return this.$clipPositionToDocument(this.row, this.column);
    };
    this.getDocument = function() {
        return this.document;
    };
    this.$insertRight = false;
    this.onChange = function(delta) {
        if (delta.start.row == delta.end.row && delta.start.row != this.row)
            return;

        if (delta.start.row > this.row)
            return;
            
        var point = $getTransformedPoint(delta, {row: this.row, column: this.column}, this.$insertRight);
        this.setPosition(point.row, point.column, true);
    };
    
    function $pointsInOrder(point1, point2, equalPointsInOrder) {
        var bColIsAfter = equalPointsInOrder ? point1.column <= point2.column : point1.column < point2.column;
        return (point1.row < point2.row) || (point1.row == point2.row && bColIsAfter);
    }
            
    function $getTransformedPoint(delta, point, moveIfEqual) {
        var deltaIsInsert = delta.action == "insert";
        var deltaRowShift = (deltaIsInsert ? 1 : -1) * (delta.end.row    - delta.start.row);
        var deltaColShift = (deltaIsInsert ? 1 : -1) * (delta.end.column - delta.start.column);
        var deltaStart = delta.start;
        var deltaEnd = deltaIsInsert ? deltaStart : delta.end; // Collapse insert range.
        if ($pointsInOrder(point, deltaStart, moveIfEqual)) {
            return {
                row: point.row,
                column: point.column
            };
        }
        if ($pointsInOrder(deltaEnd, point, !moveIfEqual)) {
            return {
                row: point.row + deltaRowShift,
                column: point.column + (point.row == deltaEnd.row ? deltaColShift : 0)
            };
        }
        
        return {
            row: deltaStart.row,
            column: deltaStart.column
        };
    }
    this.setPosition = function(row, column, noClip) {
        var pos;
        if (noClip) {
            pos = {
                row: row,
                column: column
            };
        } else {
            pos = this.$clipPositionToDocument(row, column);
        }

        if (this.row == pos.row && this.column == pos.column)
            return;

        var old = {
            row: this.row,
            column: this.column
        };

        this.row = pos.row;
        this.column = pos.column;
        this._signal("change", {
            old: old,
            value: pos
        });
    };
    this.detach = function() {
        this.document.removeEventListener("change", this.$onChange);
    };
    this.attach = function(doc) {
        this.document = doc || this.document;
        this.document.on("change", this.$onChange);
    };
    this.$clipPositionToDocument = function(row, column) {
        var pos = {};

        if (row >= this.document.getLength()) {
            pos.row = Math.max(0, this.document.getLength() - 1);
            pos.column = this.document.getLine(pos.row).length;
        }
        else if (row < 0) {
            pos.row = 0;
            pos.column = 0;
        }
        else {
            pos.row = row;
            pos.column = Math.min(this.document.getLine(pos.row).length, Math.max(0, column));
        }

        if (column < 0)
            pos.column = 0;

        return pos;
    };

}).call(Anchor.prototype);

});

ace.define("ace/document",["require","exports","module","ace/lib/oop","ace/apply_delta","ace/lib/event_emitter","ace/range","ace/anchor"], function(require, exports, module) {
"use strict";

var oop = require("./lib/oop");
var applyDelta = require("./apply_delta").applyDelta;
var EventEmitter = require("./lib/event_emitter").EventEmitter;
var Range = require("./range").Range;
var Anchor = require("./anchor").Anchor;

var Document = function(textOrLines) {
    this.$lines = [""];
    if (textOrLines.length === 0) {
        this.$lines = [""];
    } else if (Array.isArray(textOrLines)) {
        this.insertMergedLines({row: 0, column: 0}, textOrLines);
    } else {
        this.insert({row: 0, column:0}, textOrLines);
    }
};

(function() {

    oop.implement(this, EventEmitter);
    this.setValue = function(text) {
        var len = this.getLength() - 1;
        this.remove(new Range(0, 0, len, this.getLine(len).length));
        this.insert({row: 0, column: 0}, text);
    };
    this.getValue = function() {
        return this.getAllLines().join(this.getNewLineCharacter());
    };
    this.createAnchor = function(row, column) {
        return new Anchor(this, row, column);
    };
    if ("aaa".split(/a/).length === 0) {
        this.$split = function(text) {
            return text.replace(/\r\n|\r/g, "\n").split("\n");
        };
    } else {
        this.$split = function(text) {
            return text.split(/\r\n|\r|\n/);
        };
    }


    this.$detectNewLine = function(text) {
        var match = text.match(/^.*?(\r\n|\r|\n)/m);
        this.$autoNewLine = match ? match[1] : "\n";
        this._signal("changeNewLineMode");
    };
    this.getNewLineCharacter = function() {
        switch (this.$newLineMode) {
          case "windows":
            return "\r\n";
          case "unix":
            return "\n";
          default:
            return this.$autoNewLine || "\n";
        }
    };

    this.$autoNewLine = "";
    this.$newLineMode = "auto";
    this.setNewLineMode = function(newLineMode) {
        if (this.$newLineMode === newLineMode)
            return;

        this.$newLineMode = newLineMode;
        this._signal("changeNewLineMode");
    };
    this.getNewLineMode = function() {
        return this.$newLineMode;
    };
    this.isNewLine = function(text) {
        return (text == "\r\n" || text == "\r" || text == "\n");
    };
    this.getLine = function(row) {
        return this.$lines[row] || "";
    };
    this.getLines = function(firstRow, lastRow) {
        return this.$lines.slice(firstRow, lastRow + 1);
    };
    this.getAllLines = function() {
        return this.getLines(0, this.getLength());
    };
    this.getLength = function() {
        return this.$lines.length;
    };
    this.getTextRange = function(range) {
        return this.getLinesForRange(range).join(this.getNewLineCharacter());
    };
    this.getLinesForRange = function(range) {
        var lines;
        if (range.start.row === range.end.row) {
            lines = [this.getLine(range.start.row).substring(range.start.column, range.end.column)];
        } else {
            lines = this.getLines(range.start.row, range.end.row);
            lines[0] = (lines[0] || "").substring(range.start.column);
            var l = lines.length - 1;
            if (range.end.row - range.start.row == l)
                lines[l] = lines[l].substring(0, range.end.column);
        }
        return lines;
    };
    this.insertLines = function(row, lines) {
        console.warn("Use of document.insertLines is deprecated. Use the insertFullLines method instead.");
        return this.insertFullLines(row, lines);
    };
    this.removeLines = function(firstRow, lastRow) {
        console.warn("Use of document.removeLines is deprecated. Use the removeFullLines method instead.");
        return this.removeFullLines(firstRow, lastRow);
    };
    this.insertNewLine = function(position) {
        console.warn("Use of document.insertNewLine is deprecated. Use insertMergedLines(position, ['', '']) instead.");
        return this.insertMergedLines(position, ["", ""]);
    };
    this.insert = function(position, text) {
        if (this.getLength() <= 1)
            this.$detectNewLine(text);
        
        return this.insertMergedLines(position, this.$split(text));
    };
    this.insertInLine = function(position, text) {
        var start = this.clippedPos(position.row, position.column);
        var end = this.pos(position.row, position.column + text.length);
        
        this.applyDelta({
            start: start,
            end: end,
            action: "insert",
            lines: [text]
        }, true);
        
        return this.clonePos(end);
    };
    
    this.clippedPos = function(row, column) {
        var length = this.getLength();
        if (row === undefined) {
            row = length;
        } else if (row < 0) {
            row = 0;
        } else if (row >= length) {
            row = length - 1;
            column = undefined;
        }
        var line = this.getLine(row);
        if (column == undefined)
            column = line.length;
        column = Math.min(Math.max(column, 0), line.length);
        return {row: row, column: column};
    };
    
    this.clonePos = function(pos) {
        return {row: pos.row, column: pos.column};
    };
    
    this.pos = function(row, column) {
        return {row: row, column: column};
    };
    
    this.$clipPosition = function(position) {
        var length = this.getLength();
        if (position.row >= length) {
            position.row = Math.max(0, length - 1);
            position.column = this.getLine(length - 1).length;
        } else {
            position.row = Math.max(0, position.row);
            position.column = Math.min(Math.max(position.column, 0), this.getLine(position.row).length);
        }
        return position;
    };
    this.insertFullLines = function(row, lines) {
        row = Math.min(Math.max(row, 0), this.getLength());
        var column = 0;
        if (row < this.getLength()) {
            lines = lines.concat([""]);
            column = 0;
        } else {
            lines = [""].concat(lines);
            row--;
            column = this.$lines[row].length;
        }
        this.insertMergedLines({row: row, column: column}, lines);
    };    
    this.insertMergedLines = function(position, lines) {
        var start = this.clippedPos(position.row, position.column);
        var end = {
            row: start.row + lines.length - 1,
            column: (lines.length == 1 ? start.column : 0) + lines[lines.length - 1].length
        };
        
        this.applyDelta({
            start: start,
            end: end,
            action: "insert",
            lines: lines
        });
        
        return this.clonePos(end);
    };
    this.remove = function(range) {
        var start = this.clippedPos(range.start.row, range.start.column);
        var end = this.clippedPos(range.end.row, range.end.column);
        this.applyDelta({
            start: start,
            end: end,
            action: "remove",
            lines: this.getLinesForRange({start: start, end: end})
        });
        return this.clonePos(start);
    };
    this.removeInLine = function(row, startColumn, endColumn) {
        var start = this.clippedPos(row, startColumn);
        var end = this.clippedPos(row, endColumn);
        
        this.applyDelta({
            start: start,
            end: end,
            action: "remove",
            lines: this.getLinesForRange({start: start, end: end})
        }, true);
        
        return this.clonePos(start);
    };
    this.removeFullLines = function(firstRow, lastRow) {
        firstRow = Math.min(Math.max(0, firstRow), this.getLength() - 1);
        lastRow  = Math.min(Math.max(0, lastRow ), this.getLength() - 1);
        var deleteFirstNewLine = lastRow == this.getLength() - 1 && firstRow > 0;
        var deleteLastNewLine  = lastRow  < this.getLength() - 1;
        var startRow = ( deleteFirstNewLine ? firstRow - 1                  : firstRow                    );
        var startCol = ( deleteFirstNewLine ? this.getLine(startRow).length : 0                           );
        var endRow   = ( deleteLastNewLine  ? lastRow + 1                   : lastRow                     );
        var endCol   = ( deleteLastNewLine  ? 0                             : this.getLine(endRow).length ); 
        var range = new Range(startRow, startCol, endRow, endCol);
        var deletedLines = this.$lines.slice(firstRow, lastRow + 1);
        
        this.applyDelta({
            start: range.start,
            end: range.end,
            action: "remove",
            lines: this.getLinesForRange(range)
        });
        return deletedLines;
    };
    this.removeNewLine = function(row) {
        if (row < this.getLength() - 1 && row >= 0) {
            this.applyDelta({
                start: this.pos(row, this.getLine(row).length),
                end: this.pos(row + 1, 0),
                action: "remove",
                lines: ["", ""]
            });
        }
    };
    this.replace = function(range, text) {
        if (!(range instanceof Range))
            range = Range.fromPoints(range.start, range.end);
        if (text.length === 0 && range.isEmpty())
            return range.start;
        if (text == this.getTextRange(range))
            return range.end;

        this.remove(range);
        var end;
        if (text) {
            end = this.insert(range.start, text);
        }
        else {
            end = range.start;
        }
        
        return end;
    };
    this.applyDeltas = function(deltas) {
        for (var i=0; i<deltas.length; i++) {
            this.applyDelta(deltas[i]);
        }
    };
    this.revertDeltas = function(deltas) {
        for (var i=deltas.length-1; i>=0; i--) {
            this.revertDelta(deltas[i]);
        }
    };
    this.applyDelta = function(delta, doNotValidate) {
        var isInsert = delta.action == "insert";
        if (isInsert ? delta.lines.length <= 1 && !delta.lines[0]
            : !Range.comparePoints(delta.start, delta.end)) {
            return;
        }
        
        if (isInsert && delta.lines.length > 20000)
            this.$splitAndapplyLargeDelta(delta, 20000);
        applyDelta(this.$lines, delta, doNotValidate);
        this._signal("change", delta);
    };
    
    this.$splitAndapplyLargeDelta = function(delta, MAX) {
        var lines = delta.lines;
        var l = lines.length;
        var row = delta.start.row; 
        var column = delta.start.column;
        var from = 0, to = 0;
        do {
            from = to;
            to += MAX - 1;
            var chunk = lines.slice(from, to);
            if (to > l) {
                delta.lines = chunk;
                delta.start.row = row + from;
                delta.start.column = column;
                break;
            }
            chunk.push("");
            this.applyDelta({
                start: this.pos(row + from, column),
                end: this.pos(row + to, column = 0),
                action: delta.action,
                lines: chunk
            }, true);
        } while(true);
    };
    this.revertDelta = function(delta) {
        this.applyDelta({
            start: this.clonePos(delta.start),
            end: this.clonePos(delta.end),
            action: (delta.action == "insert" ? "remove" : "insert"),
            lines: delta.lines.slice()
        });
    };
    this.indexToPosition = function(index, startRow) {
        var lines = this.$lines || this.getAllLines();
        var newlineLength = this.getNewLineCharacter().length;
        for (var i = startRow || 0, l = lines.length; i < l; i++) {
            index -= lines[i].length + newlineLength;
            if (index < 0)
                return {row: i, column: index + lines[i].length + newlineLength};
        }
        return {row: l-1, column: lines[l-1].length};
    };
    this.positionToIndex = function(pos, startRow) {
        var lines = this.$lines || this.getAllLines();
        var newlineLength = this.getNewLineCharacter().length;
        var index = 0;
        var row = Math.min(pos.row, lines.length);
        for (var i = startRow || 0; i < row; ++i)
            index += lines[i].length + newlineLength;

        return index + pos.column;
    };

}).call(Document.prototype);

exports.Document = Document;
});

ace.define("ace/worker/mirror",["require","exports","module","ace/range","ace/document","ace/lib/lang"], function(require, exports, module) {
"use strict";

var Range = require("../range").Range;
var Document = require("../document").Document;
var lang = require("../lib/lang");
    
var Mirror = exports.Mirror = function(sender) {
    this.sender = sender;
    var doc = this.doc = new Document("");
    
    var deferredUpdate = this.deferredUpdate = lang.delayedCall(this.onUpdate.bind(this));
    
    var _self = this;
    sender.on("change", function(e) {
        var data = e.data;
        if (data[0].start) {
            doc.applyDeltas(data);
        } else {
            for (var i = 0; i < data.length; i += 2) {
                if (Array.isArray(data[i+1])) {
                    var d = {action: "insert", start: data[i], lines: data[i+1]};
                } else {
                    var d = {action: "remove", start: data[i], end: data[i+1]};
                }
                doc.applyDelta(d, true);
            }
        }
        if (_self.$timeout)
            return deferredUpdate.schedule(_self.$timeout);
        _self.onUpdate();
    });
};

(function() {
    
    this.$timeout = 500;
    
    this.setTimeout = function(timeout) {
        this.$timeout = timeout;
    };
    
    this.setValue = function(value) {
        this.doc.setValue(value);
        this.deferredUpdate.schedule(this.$timeout);
    };
    
    this.getValue = function(callbackId) {
        this.sender.callback(this.doc.getValue(), callbackId);
    };
    
    this.onUpdate = function() {
    };
    
    this.isPending = function() {
        return this.deferredUpdate.isPending();
    };
    
}).call(Mirror.prototype);

});

(function __htmllint_cut(){})
ace.define("ace/lib/htmllint",["require","exports","module"], function(require, exports, module) {
module.exports=function(t){function e(r){if(n[r])return n[r].exports;var i=n[r]={exports:{},id:r,loaded:!1};return t[r].call(i.exports,i,i.exports,e),i.loaded=!0,i.exports}var n={};return e.m=t,e.c=n,e.p="",e(0)}([function(t,e,n){var r=(n(1),n(3)),i=function(){var t=i.defaultLinter;return t.lint.apply(t,arguments)};t.exports=i,i.Linter=r,i.rules=n(89),i.messages=n(127),i.defaultLinter=new r(i.rules),i.use=function(t){}},function(t,e,n){var r;(function(t,i){(function(){function o(t,e){return t.set(e[0],e[1]),t}function a(t,e){return t.add(e),t}function s(t,e,n){switch(n.length){case 0:return t.call(e);case 1:return t.call(e,n[0]);case 2:return t.call(e,n[0],n[1]);case 3:return t.call(e,n[0],n[1],n[2])}return t.apply(e,n)}function u(t,e,n,r){for(var i=-1,o=null==t?0:t.length;++i<o;){var a=t[i];e(r,a,n(a),t)}return r}function c(t,e){for(var n=-1,r=null==t?0:t.length;++n<r&&e(t[n],n,t)!==!1;);return t}function l(t,e){for(var n=null==t?0:t.length;n--&&e(t[n],n,t)!==!1;);return t}function f(t,e){for(var n=-1,r=null==t?0:t.length;++n<r;)if(!e(t[n],n,t))return!1;return!0}function h(t,e){for(var n=-1,r=null==t?0:t.length,i=0,o=[];++n<r;){var a=t[n];e(a,n,t)&&(o[i++]=a)}return o}function p(t,e){var n=null==t?0:t.length;return!!n&&S(t,e,0)>-1}function d(t,e,n){for(var r=-1,i=null==t?0:t.length;++r<i;)if(n(e,t[r]))return!0;return!1}function g(t,e){for(var n=-1,r=null==t?0:t.length,i=Array(r);++n<r;)i[n]=e(t[n],n,t);return i}function v(t,e){for(var n=-1,r=e.length,i=t.length;++n<r;)t[i+n]=e[n];return t}function _(t,e,n,r){var i=-1,o=null==t?0:t.length;for(r&&o&&(n=t[++i]);++i<o;)n=e(n,t[i],i,t);return n}function m(t,e,n,r){var i=null==t?0:t.length;for(r&&i&&(n=t[--i]);i--;)n=e(n,t[i],i,t);return n}function b(t,e){for(var n=-1,r=null==t?0:t.length;++n<r;)if(e(t[n],n,t))return!0;return!1}function y(t){return t.split("")}function w(t){return t.match(Ue)||[]}function x(t,e,n){var r;return n(t,function(t,n,i){if(e(t,n,i))return r=n,!1}),r}function E(t,e,n,r){for(var i=t.length,o=n+(r?1:-1);r?o--:++o<i;)if(e(t[o],o,t))return o;return-1}function S(t,e,n){return e===e?J(t,e,n):E(t,L,n)}function A(t,e,n,r){for(var i=n-1,o=t.length;++i<o;)if(r(t[i],e))return i;return-1}function L(t){return t!==t}function k(t,e){var n=null==t?0:t.length;return n?D(t,e)/n:It}function T(t){return function(e){return null==e?it:e[t]}}function C(t){return function(e){return null==t?it:t[e]}}function R(t,e,n,r,i){return i(t,function(t,i,o){n=r?(r=!1,t):e(n,t,i,o)}),n}function O(t,e){var n=t.length;for(t.sort(e);n--;)t[n]=t[n].value;return t}function D(t,e){for(var n,r=-1,i=t.length;++r<i;){var o=e(t[r]);o!==it&&(n=n===it?o:n+o)}return n}function q(t,e){for(var n=-1,r=Array(t);++n<t;)r[n]=e(n);return r}function I(t,e){return g(e,function(e){return[e,t[e]]})}function B(t){return function(e){return t(e)}}function j(t,e){return g(e,function(e){return t[e]})}function N(t,e){return t.has(e)}function M(t,e){for(var n=-1,r=t.length;++n<r&&S(e,t[n],0)>-1;);return n}function P(t,e){for(var n=t.length;n--&&S(e,t[n],0)>-1;);return n}function U(t,e){for(var n=t.length,r=0;n--;)t[n]===e&&++r;return r}function z(t){return"\\"+Jn[t]}function F(t,e){return null==t?it:t[e]}function V(t){return Fn.test(t)}function H(t){return Vn.test(t)}function G(t){for(var e,n=[];!(e=t.next()).done;)n.push(e.value);return n}function W(t){var e=-1,n=Array(t.size);return t.forEach(function(t,r){n[++e]=[r,t]}),n}function Y(t,e){return function(n){return t(e(n))}}function $(t,e){for(var n=-1,r=t.length,i=0,o=[];++n<r;){var a=t[n];a!==e&&a!==ft||(t[n]=ft,o[i++]=n)}return o}function Z(t){var e=-1,n=Array(t.size);return t.forEach(function(t){n[++e]=t}),n}function K(t){var e=-1,n=Array(t.size);return t.forEach(function(t){n[++e]=[t,t]}),n}function J(t,e,n){for(var r=n-1,i=t.length;++r<i;)if(t[r]===e)return r;return-1}function X(t,e,n){for(var r=n+1;r--;)if(t[r]===e)return r;return r}function Q(t){return V(t)?et(t):dr(t)}function tt(t){return V(t)?nt(t):y(t)}function et(t){for(var e=Un.lastIndex=0;Un.test(t);)++e;return e}function nt(t){return t.match(Un)||[]}function rt(t){return t.match(zn)||[]}var it,ot="4.16.5",at=200,st="Unsupported core-js use. Try https://github.com/es-shims.",ut="Expected a function",ct="__lodash_hash_undefined__",lt=500,ft="__lodash_placeholder__",ht=1,pt=2,dt=4,gt=8,vt=16,_t=32,mt=64,bt=128,yt=256,wt=512,xt=1,Et=2,St=30,At="...",Lt=800,kt=16,Tt=1,Ct=2,Rt=3,Ot=1/0,Dt=9007199254740991,qt=1.7976931348623157e308,It=NaN,Bt=4294967295,jt=Bt-1,Nt=Bt>>>1,Mt=[["ary",bt],["bind",ht],["bindKey",pt],["curry",gt],["curryRight",vt],["flip",wt],["partial",_t],["partialRight",mt],["rearg",yt]],Pt="[object Arguments]",Ut="[object Array]",zt="[object AsyncFunction]",Ft="[object Boolean]",Vt="[object Date]",Ht="[object DOMException]",Gt="[object Error]",Wt="[object Function]",Yt="[object GeneratorFunction]",$t="[object Map]",Zt="[object Number]",Kt="[object Null]",Jt="[object Object]",Xt="[object Promise]",Qt="[object Proxy]",te="[object RegExp]",ee="[object Set]",ne="[object String]",re="[object Symbol]",ie="[object Undefined]",oe="[object WeakMap]",ae="[object WeakSet]",se="[object ArrayBuffer]",ue="[object DataView]",ce="[object Float32Array]",le="[object Float64Array]",fe="[object Int8Array]",he="[object Int16Array]",pe="[object Int32Array]",de="[object Uint8Array]",ge="[object Uint8ClampedArray]",ve="[object Uint16Array]",_e="[object Uint32Array]",me=/\b__p \+= '';/g,be=/\b(__p \+=) '' \+/g,ye=/(__e\(.*?\)|\b__t\)) \+\n'';/g,we=/&(?:amp|lt|gt|quot|#39);/g,xe=/[&<>"']/g,Ee=RegExp(we.source),Se=RegExp(xe.source),Ae=/<%-([\s\S]+?)%>/g,Le=/<%([\s\S]+?)%>/g,ke=/<%=([\s\S]+?)%>/g,Te=/\.|\[(?:[^[\]]*|(["'])(?:(?!\1)[^\\]|\\.)*?\1)\]/,Ce=/^\w*$/,Re=/^\./,Oe=/[^.[\]]+|\[(?:(-?\d+(?:\.\d+)?)|(["'])((?:(?!\2)[^\\]|\\.)*?)\2)\]|(?=(?:\.|\[\])(?:\.|\[\]|$))/g,De=/[\\^$.*+?()[\]{}|]/g,qe=RegExp(De.source),Ie=/^\s+|\s+$/g,Be=/^\s+/,je=/\s+$/,Ne=/\{(?:\n\/\* \[wrapped with .+\] \*\/)?\n?/,Me=/\{\n\/\* \[wrapped with (.+)\] \*/,Pe=/,? & /,Ue=/[^\x00-\x2f\x3a-\x40\x5b-\x60\x7b-\x7f]+/g,ze=/\\(\\)?/g,Fe=/\$\{([^\\}]*(?:\\.[^\\}]*)*)\}/g,Ve=/\w*$/,He=/^[-+]0x[0-9a-f]+$/i,Ge=/^0b[01]+$/i,We=/^\[object .+?Constructor\]$/,Ye=/^0o[0-7]+$/i,$e=/^(?:0|[1-9]\d*)$/,Ze=/[\xc0-\xd6\xd8-\xf6\xf8-\xff\u0100-\u017f]/g,Ke=/($^)/,Je=/['\n\r\u2028\u2029\\]/g,Xe="\\ud800-\\udfff",Qe="\\u0300-\\u036f\\ufe20-\\ufe23",tn="\\u20d0-\\u20f0",en="\\u2700-\\u27bf",nn="a-z\\xdf-\\xf6\\xf8-\\xff",rn="\\xac\\xb1\\xd7\\xf7",on="\\x00-\\x2f\\x3a-\\x40\\x5b-\\x60\\x7b-\\xbf",an="\\u2000-\\u206f",sn=" \\t\\x0b\\f\\xa0\\ufeff\\n\\r\\u2028\\u2029\\u1680\\u180e\\u2000\\u2001\\u2002\\u2003\\u2004\\u2005\\u2006\\u2007\\u2008\\u2009\\u200a\\u202f\\u205f\\u3000",un="A-Z\\xc0-\\xd6\\xd8-\\xde",cn="\\ufe0e\\ufe0f",ln=rn+on+an+sn,fn="['’]",hn="["+Xe+"]",pn="["+ln+"]",dn="["+Qe+tn+"]",gn="\\d+",vn="["+en+"]",_n="["+nn+"]",mn="[^"+Xe+ln+gn+en+nn+un+"]",bn="\\ud83c[\\udffb-\\udfff]",yn="(?:"+dn+"|"+bn+")",wn="[^"+Xe+"]",xn="(?:\\ud83c[\\udde6-\\uddff]){2}",En="[\\ud800-\\udbff][\\udc00-\\udfff]",Sn="["+un+"]",An="\\u200d",Ln="(?:"+_n+"|"+mn+")",kn="(?:"+Sn+"|"+mn+")",Tn="(?:"+fn+"(?:d|ll|m|re|s|t|ve))?",Cn="(?:"+fn+"(?:D|LL|M|RE|S|T|VE))?",Rn=yn+"?",On="["+cn+"]?",Dn="(?:"+An+"(?:"+[wn,xn,En].join("|")+")"+On+Rn+")*",qn="\\d*(?:(?:1st|2nd|3rd|(?![123])\\dth)\\b)",In="\\d*(?:(?:1ST|2ND|3RD|(?![123])\\dTH)\\b)",Bn=On+Rn+Dn,jn="(?:"+[vn,xn,En].join("|")+")"+Bn,Nn="(?:"+[wn+dn+"?",dn,xn,En,hn].join("|")+")",Mn=RegExp(fn,"g"),Pn=RegExp(dn,"g"),Un=RegExp(bn+"(?="+bn+")|"+Nn+Bn,"g"),zn=RegExp([Sn+"?"+_n+"+"+Tn+"(?="+[pn,Sn,"$"].join("|")+")",kn+"+"+Cn+"(?="+[pn,Sn+Ln,"$"].join("|")+")",Sn+"?"+Ln+"+"+Tn,Sn+"+"+Cn,In,qn,gn,jn].join("|"),"g"),Fn=RegExp("["+An+Xe+Qe+tn+cn+"]"),Vn=/[a-z][A-Z]|[A-Z]{2,}[a-z]|[0-9][a-zA-Z]|[a-zA-Z][0-9]|[^a-zA-Z0-9 ]/,Hn=["Array","Buffer","DataView","Date","Error","Float32Array","Float64Array","Function","Int8Array","Int16Array","Int32Array","Map","Math","Object","Promise","RegExp","Set","String","Symbol","TypeError","Uint8Array","Uint8ClampedArray","Uint16Array","Uint32Array","WeakMap","_","clearTimeout","isFinite","parseInt","setTimeout"],Gn=-1,Wn={};Wn[ce]=Wn[le]=Wn[fe]=Wn[he]=Wn[pe]=Wn[de]=Wn[ge]=Wn[ve]=Wn[_e]=!0,Wn[Pt]=Wn[Ut]=Wn[se]=Wn[Ft]=Wn[ue]=Wn[Vt]=Wn[Gt]=Wn[Wt]=Wn[$t]=Wn[Zt]=Wn[Jt]=Wn[te]=Wn[ee]=Wn[ne]=Wn[oe]=!1;var Yn={};Yn[Pt]=Yn[Ut]=Yn[se]=Yn[ue]=Yn[Ft]=Yn[Vt]=Yn[ce]=Yn[le]=Yn[fe]=Yn[he]=Yn[pe]=Yn[$t]=Yn[Zt]=Yn[Jt]=Yn[te]=Yn[ee]=Yn[ne]=Yn[re]=Yn[de]=Yn[ge]=Yn[ve]=Yn[_e]=!0,Yn[Gt]=Yn[Wt]=Yn[oe]=!1;var $n={"À":"A","Á":"A","Â":"A","Ã":"A","Ä":"A","Å":"A","à":"a","á":"a","â":"a","ã":"a","ä":"a","å":"a","Ç":"C","ç":"c","Ð":"D","ð":"d","È":"E","É":"E","Ê":"E","Ë":"E","è":"e","é":"e","ê":"e","ë":"e","Ì":"I","Í":"I","Î":"I","Ï":"I","ì":"i","í":"i","î":"i","ï":"i","Ñ":"N","ñ":"n","Ò":"O","Ó":"O","Ô":"O","Õ":"O","Ö":"O","Ø":"O","ò":"o","ó":"o","ô":"o","õ":"o","ö":"o","ø":"o","Ù":"U","Ú":"U","Û":"U","Ü":"U","ù":"u","ú":"u","û":"u","ü":"u","Ý":"Y","ý":"y","ÿ":"y","Æ":"Ae","æ":"ae","Þ":"Th","þ":"th","ß":"ss","Ā":"A","Ă":"A","Ą":"A","ā":"a","ă":"a","ą":"a","Ć":"C","Ĉ":"C","Ċ":"C","Č":"C","ć":"c","ĉ":"c","ċ":"c","č":"c","Ď":"D","Đ":"D","ď":"d","đ":"d","Ē":"E","Ĕ":"E","Ė":"E","Ę":"E","Ě":"E","ē":"e","ĕ":"e","ė":"e","ę":"e","ě":"e","Ĝ":"G","Ğ":"G","Ġ":"G","Ģ":"G","ĝ":"g","ğ":"g","ġ":"g","ģ":"g","Ĥ":"H","Ħ":"H","ĥ":"h","ħ":"h","Ĩ":"I","Ī":"I","Ĭ":"I","Į":"I","İ":"I","ĩ":"i","ī":"i","ĭ":"i","į":"i","ı":"i","Ĵ":"J","ĵ":"j","Ķ":"K","ķ":"k","ĸ":"k","Ĺ":"L","Ļ":"L","Ľ":"L","Ŀ":"L","Ł":"L","ĺ":"l","ļ":"l","ľ":"l","ŀ":"l","ł":"l","Ń":"N","Ņ":"N","Ň":"N","Ŋ":"N","ń":"n","ņ":"n","ň":"n","ŋ":"n","Ō":"O","Ŏ":"O","Ő":"O","ō":"o","ŏ":"o","ő":"o","Ŕ":"R","Ŗ":"R","Ř":"R","ŕ":"r","ŗ":"r","ř":"r","Ś":"S","Ŝ":"S","Ş":"S","Š":"S","ś":"s","ŝ":"s","ş":"s","š":"s","Ţ":"T","Ť":"T","Ŧ":"T","ţ":"t","ť":"t","ŧ":"t","Ũ":"U","Ū":"U","Ŭ":"U","Ů":"U","Ű":"U","Ų":"U","ũ":"u","ū":"u","ŭ":"u","ů":"u","ű":"u","ų":"u","Ŵ":"W","ŵ":"w","Ŷ":"Y","ŷ":"y","Ÿ":"Y","Ź":"Z","Ż":"Z","Ž":"Z","ź":"z","ż":"z","ž":"z","Ĳ":"IJ","ĳ":"ij","Œ":"Oe","œ":"oe","ŉ":"'n","ſ":"s"},Zn={"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"},Kn={"&amp;":"&","&lt;":"<","&gt;":">","&quot;":'"',"&#39;":"'"},Jn={"\\":"\\","'":"'","\n":"n","\r":"r","\u2028":"u2028","\u2029":"u2029"},Xn=parseFloat,Qn=parseInt,tr="object"==typeof t&&t&&t.Object===Object&&t,er="object"==typeof self&&self&&self.Object===Object&&self,nr=tr||er||Function("return this")(),rr="object"==typeof e&&e&&!e.nodeType&&e,ir=rr&&"object"==typeof i&&i&&!i.nodeType&&i,or=ir&&ir.exports===rr,ar=or&&tr.process,sr=function(){try{return ar&&ar.binding("util")}catch(t){}}(),ur=sr&&sr.isArrayBuffer,cr=sr&&sr.isDate,lr=sr&&sr.isMap,fr=sr&&sr.isRegExp,hr=sr&&sr.isSet,pr=sr&&sr.isTypedArray,dr=T("length"),gr=C($n),vr=C(Zn),_r=C(Kn),mr=function t(e){function n(t){if(ru(t)&&!gh(t)&&!(t instanceof y)){if(t instanceof i)return t;if(dl.call(t,"__wrapped__"))return ta(t)}return new i(t)}function r(){}function i(t,e){this.__wrapped__=t,this.__actions__=[],this.__chain__=!!e,this.__index__=0,this.__values__=it}function y(t){this.__wrapped__=t,this.__actions__=[],this.__dir__=1,this.__filtered__=!1,this.__iteratees__=[],this.__takeCount__=Bt,this.__views__=[]}function C(){var t=new y(this.__wrapped__);return t.__actions__=Ni(this.__actions__),t.__dir__=this.__dir__,t.__filtered__=this.__filtered__,t.__iteratees__=Ni(this.__iteratees__),t.__takeCount__=this.__takeCount__,t.__views__=Ni(this.__views__),t}function J(){if(this.__filtered__){var t=new y(this);t.__dir__=-1,t.__filtered__=!0}else t=this.clone(),t.__dir__*=-1;return t}function et(){var t=this.__wrapped__.value(),e=this.__dir__,n=gh(t),r=e<0,i=n?t.length:0,o=Eo(0,i,this.__views__),a=o.start,s=o.end,u=s-a,c=r?s:a-1,l=this.__iteratees__,f=l.length,h=0,p=Hl(u,this.__takeCount__);if(!n||i<at||i==u&&p==u)return mi(t,this.__actions__);var d=[];t:for(;u--&&h<p;){c+=e;for(var g=-1,v=t[c];++g<f;){var _=l[g],m=_.iteratee,b=_.type,y=m(v);if(b==Ct)v=y;else if(!y){if(b==Tt)continue t;break t}}d[h++]=v}return d}function nt(t){var e=-1,n=null==t?0:t.length;for(this.clear();++e<n;){var r=t[e];this.set(r[0],r[1])}}function Ue(){this.__data__=tf?tf(null):{},this.size=0}function Xe(t){var e=this.has(t)&&delete this.__data__[t];return this.size-=e?1:0,e}function Qe(t){var e=this.__data__;if(tf){var n=e[t];return n===ct?it:n}return dl.call(e,t)?e[t]:it}function tn(t){var e=this.__data__;return tf?e[t]!==it:dl.call(e,t)}function en(t,e){var n=this.__data__;return this.size+=this.has(t)?0:1,n[t]=tf&&e===it?ct:e,this}function nn(t){var e=-1,n=null==t?0:t.length;for(this.clear();++e<n;){var r=t[e];this.set(r[0],r[1])}}function rn(){this.__data__=[],this.size=0}function on(t){var e=this.__data__,n=On(e,t);if(n<0)return!1;var r=e.length-1;return n==r?e.pop():Tl.call(e,n,1),--this.size,!0}function an(t){var e=this.__data__,n=On(e,t);return n<0?it:e[n][1]}function sn(t){return On(this.__data__,t)>-1}function un(t,e){var n=this.__data__,r=On(n,t);return r<0?(++this.size,n.push([t,e])):n[r][1]=e,this}function cn(t){var e=-1,n=null==t?0:t.length;for(this.clear();++e<n;){var r=t[e];this.set(r[0],r[1])}}function ln(){this.size=0,this.__data__={hash:new nt,map:new(Kl||nn),string:new nt}}function fn(t){var e=bo(this,t).delete(t);return this.size-=e?1:0,e}function hn(t){return bo(this,t).get(t)}function pn(t){return bo(this,t).has(t)}function dn(t,e){var n=bo(this,t),r=n.size;return n.set(t,e),this.size+=n.size==r?0:1,this}function gn(t){var e=-1,n=null==t?0:t.length;for(this.__data__=new cn;++e<n;)this.add(t[e])}function vn(t){return this.__data__.set(t,ct),this}function _n(t){return this.__data__.has(t)}function mn(t){var e=this.__data__=new nn(t);this.size=e.size}function bn(){this.__data__=new nn,this.size=0}function yn(t){var e=this.__data__,n=e.delete(t);return this.size=e.size,n}function wn(t){return this.__data__.get(t)}function xn(t){return this.__data__.has(t)}function En(t,e){var n=this.__data__;if(n instanceof nn){var r=n.__data__;if(!Kl||r.length<at-1)return r.push([t,e]),this.size=++n.size,this;n=this.__data__=new cn(r)}return n.set(t,e),this.size=n.size,this}function Sn(t,e){var n=gh(t),r=!n&&dh(t),i=!n&&!r&&_h(t),o=!n&&!r&&!i&&xh(t),a=n||r||i||o,s=a?q(t.length,sl):[],u=s.length;for(var c in t)!e&&!dl.call(t,c)||a&&("length"==c||i&&("offset"==c||"parent"==c)||o&&("buffer"==c||"byteLength"==c||"byteOffset"==c)||Oo(c,u))||s.push(c);return s}function An(t){var e=t.length;return e?t[Qr(0,e-1)]:it}function Ln(t,e){return Ko(Ni(t),jn(e,0,t.length))}function kn(t){return Ko(Ni(t))}function Tn(t,e,n,r){return t===it||Vs(t,fl[n])&&!dl.call(r,n)?e:t}function Cn(t,e,n){(n===it||Vs(t[e],n))&&(n!==it||e in t)||In(t,e,n)}function Rn(t,e,n){var r=t[e];dl.call(t,e)&&Vs(r,n)&&(n!==it||e in t)||In(t,e,n)}function On(t,e){for(var n=t.length;n--;)if(Vs(t[n][0],e))return n;return-1}function Dn(t,e,n,r){return pf(t,function(t,i,o){e(r,t,n(t),o)}),r}function qn(t,e){return t&&Mi(e,Mu(e),t)}function In(t,e,n){"__proto__"==e&&Dl?Dl(t,e,{configurable:!0,enumerable:!0,value:n,writable:!0}):t[e]=n}function Bn(t,e){for(var n=-1,r=e.length,i=tl(r),o=null==t;++n<r;)i[n]=o?it:Bu(t,e[n]);return i}function jn(t,e,n){return t===t&&(n!==it&&(t=t<=n?t:n),e!==it&&(t=t>=e?t:e)),t}function Nn(t,e,n,r,i,o,a){var s;if(r&&(s=o?r(t,i,o,a):r(t)),s!==it)return s;if(!nu(t))return t;var u=gh(t);if(u){if(s=Lo(t),!e)return Ni(t,s)}else{var l=Af(t),f=l==Wt||l==Yt;if(_h(t))return Ai(t,e);if(l==Jt||l==Pt||f&&!o){if(s=ko(f?{}:t),!e)return Pi(t,qn(s,t))}else{if(!Yn[l])return o?t:{};s=To(t,l,Nn,e)}}a||(a=new mn);var h=a.get(t);if(h)return h;a.set(t,s);var p=u?it:(n?po:Mu)(t);return c(p||t,function(i,o){p&&(o=i,i=t[o]),Rn(s,o,Nn(i,e,n,r,o,t,a))}),s}function Un(t){var e=Mu(t);return function(n){return zn(n,t,e)}}function zn(t,e,n){var r=n.length;if(null==t)return!r;for(t=ol(t);r--;){var i=n[r],o=e[i],a=t[i];if(a===it&&!(i in t)||!o(a))return!1}return!0}function Fn(t,e,n){if("function"!=typeof t)throw new ul(ut);return Tf(function(){t.apply(it,n)},e)}function Vn(t,e,n,r){var i=-1,o=p,a=!0,s=t.length,u=[],c=e.length;if(!s)return u;n&&(e=g(e,B(n))),r?(o=d,a=!1):e.length>=at&&(o=N,a=!1,e=new gn(e));t:for(;++i<s;){var l=t[i],f=null==n?l:n(l);if(l=r||0!==l?l:0,a&&f===f){for(var h=c;h--;)if(e[h]===f)continue t;u.push(l)}else o(e,f,r)||u.push(l)}return u}function $n(t,e){var n=!0;return pf(t,function(t,r,i){return n=!!e(t,r,i)}),n}function Zn(t,e,n){for(var r=-1,i=t.length;++r<i;){var o=t[r],a=e(o);if(null!=a&&(s===it?a===a&&!du(a):n(a,s)))var s=a,u=o}return u}function Kn(t,e,n,r){var i=t.length;for(n=yu(n),n<0&&(n=-n>i?0:i+n),r=r===it||r>i?i:yu(r),r<0&&(r+=i),r=n>r?0:wu(r);n<r;)t[n++]=e;return t}function Jn(t,e){var n=[];return pf(t,function(t,r,i){e(t,r,i)&&n.push(t)}),n}function tr(t,e,n,r,i){var o=-1,a=t.length;for(n||(n=Ro),i||(i=[]);++o<a;){var s=t[o];e>0&&n(s)?e>1?tr(s,e-1,n,r,i):v(i,s):r||(i[i.length]=s)}return i}function er(t,e){return t&&gf(t,e,Mu)}function rr(t,e){return t&&vf(t,e,Mu)}function ir(t,e){return h(e,function(e){return Qs(t[e])})}function ar(t,e){e=qo(e,t)?[e]:Ei(e);for(var n=0,r=e.length;null!=t&&n<r;)t=t[Jo(e[n++])];return n&&n==r?t:it}function sr(t,e,n){var r=e(t);return gh(t)?r:v(r,n(t))}function dr(t){return null==t?t===it?ie:Kt:(t=ol(t),Ol&&Ol in t?xo(t):Ho(t))}function mr(t,e){return t>e}function yr(t,e){return null!=t&&dl.call(t,e)}function wr(t,e){return null!=t&&e in ol(t)}function xr(t,e,n){return t>=Hl(e,n)&&t<Vl(e,n)}function Er(t,e,n){for(var r=n?d:p,i=t[0].length,o=t.length,a=o,s=tl(o),u=1/0,c=[];a--;){var l=t[a];a&&e&&(l=g(l,B(e))),u=Hl(l.length,u),s[a]=!n&&(e||i>=120&&l.length>=120)?new gn(a&&l):it}l=t[0];var f=-1,h=s[0];t:for(;++f<i&&c.length<u;){var v=l[f],_=e?e(v):v;if(v=n||0!==v?v:0,!(h?N(h,_):r(c,_,n))){for(a=o;--a;){var m=s[a];if(!(m?N(m,_):r(t[a],_,n)))continue t}h&&h.push(_),c.push(v)}}return c}function Sr(t,e,n,r){return er(t,function(t,i,o){e(r,n(t),i,o)}),r}function Ar(t,e,n){qo(e,t)||(e=Ei(e),t=Wo(t,e),e=ba(e));var r=null==t?t:t[Jo(e)];return null==r?it:s(r,t,n)}function Lr(t){return ru(t)&&dr(t)==Pt}function kr(t){return ru(t)&&dr(t)==se}function Tr(t){return ru(t)&&dr(t)==Vt}function Cr(t,e,n,r,i){return t===e||(null==t||null==e||!nu(t)&&!ru(e)?t!==t&&e!==e:Rr(t,e,Cr,n,r,i))}function Rr(t,e,n,r,i,o){var a=gh(t),s=gh(e),u=Ut,c=Ut;a||(u=Af(t),u=u==Pt?Jt:u),s||(c=Af(e),c=c==Pt?Jt:c);var l=u==Jt,f=c==Jt,h=u==c;if(h&&_h(t)){if(!_h(e))return!1;a=!0,l=!1}if(h&&!l)return o||(o=new mn),a||xh(t)?co(t,e,n,r,i,o):lo(t,e,u,n,r,i,o);if(!(i&Et)){var p=l&&dl.call(t,"__wrapped__"),d=f&&dl.call(e,"__wrapped__");if(p||d){var g=p?t.value():t,v=d?e.value():e;return o||(o=new mn),n(g,v,r,i,o)}}return!!h&&(o||(o=new mn),fo(t,e,n,r,i,o))}function Or(t){return ru(t)&&Af(t)==$t}function Dr(t,e,n,r){var i=n.length,o=i,a=!r;if(null==t)return!o;for(t=ol(t);i--;){var s=n[i];if(a&&s[2]?s[1]!==t[s[0]]:!(s[0]in t))return!1}for(;++i<o;){s=n[i];var u=s[0],c=t[u],l=s[1];if(a&&s[2]){if(c===it&&!(u in t))return!1}else{var f=new mn;if(r)var h=r(c,l,u,t,e,f);if(!(h===it?Cr(l,c,r,xt|Et,f):h))return!1}}return!0}function qr(t){if(!nu(t)||jo(t))return!1;var e=Qs(t)?yl:We;return e.test(Xo(t))}function Ir(t){return ru(t)&&dr(t)==te}function Br(t){return ru(t)&&Af(t)==ee}function jr(t){return ru(t)&&eu(t.length)&&!!Wn[dr(t)]}function Nr(t){return"function"==typeof t?t:null==t?Tc:"object"==typeof t?gh(t)?Vr(t[0],t[1]):Fr(t):jc(t)}function Mr(t){if(!No(t))return Fl(t);var e=[];for(var n in ol(t))dl.call(t,n)&&"constructor"!=n&&e.push(n);return e}function Pr(t){if(!nu(t))return Vo(t);var e=No(t),n=[];for(var r in t)("constructor"!=r||!e&&dl.call(t,r))&&n.push(r);return n}function Ur(t,e){return t<e}function zr(t,e){var n=-1,r=Hs(t)?tl(t.length):[];return pf(t,function(t,i,o){r[++n]=e(t,i,o)}),r}function Fr(t){var e=yo(t);return 1==e.length&&e[0][2]?Po(e[0][0],e[0][1]):function(n){return n===t||Dr(n,t,e)}}function Vr(t,e){return qo(t)&&Mo(e)?Po(Jo(t),e):function(n){var r=Bu(n,t);return r===it&&r===e?Nu(n,t):Cr(e,r,it,xt|Et)}}function Hr(t,e,n,r,i){t!==e&&gf(e,function(o,a){if(nu(o))i||(i=new mn),Gr(t,e,a,n,Hr,r,i);else{var s=r?r(t[a],o,a+"",t,e,i):it;s===it&&(s=o),Cn(t,a,s)}},Pu)}function Gr(t,e,n,r,i,o,a){var s=t[n],u=e[n],c=a.get(u);if(c)return void Cn(t,n,c);var l=o?o(s,u,n+"",t,e,a):it,f=l===it;if(f){var h=gh(u),p=!h&&_h(u),d=!h&&!p&&xh(u);l=u,h||p||d?gh(s)?l=s:Gs(s)?l=Ni(s):p?(f=!1,l=Ai(u,!0)):d?(f=!1,l=Di(u,!0)):l=[]:fu(u)||dh(u)?(l=s,dh(s)?l=Eu(s):(!nu(s)||r&&Qs(s))&&(l=ko(u))):f=!1}f&&(a.set(u,l),i(l,u,r,o,a),a.delete(u)),Cn(t,n,l)}function Wr(t,e){var n=t.length;if(n)return e+=e<0?n:0,Oo(e,n)?t[e]:it}function Yr(t,e,n){var r=-1;e=g(e.length?e:[Tc],B(mo()));var i=zr(t,function(t,n,i){var o=g(e,function(e){return e(t)});return{criteria:o,index:++r,value:t}});return O(i,function(t,e){return Ii(t,e,n)})}function $r(t,e){return t=ol(t),Zr(t,e,function(e,n){return n in t})}function Zr(t,e,n){for(var r=-1,i=e.length,o={};++r<i;){var a=e[r],s=t[a];n(s,a)&&In(o,a,s)}return o}function Kr(t){return function(e){return ar(e,t)}}function Jr(t,e,n,r){var i=r?A:S,o=-1,a=e.length,s=t;for(t===e&&(e=Ni(e)),n&&(s=g(t,B(n)));++o<a;)for(var u=0,c=e[o],l=n?n(c):c;(u=i(s,l,u,r))>-1;)s!==t&&Tl.call(s,u,1),Tl.call(t,u,1);return t}function Xr(t,e){for(var n=t?e.length:0,r=n-1;n--;){var i=e[n];if(n==r||i!==o){var o=i;if(Oo(i))Tl.call(t,i,1);else if(qo(i,t))delete t[Jo(i)];else{var a=Ei(i),s=Wo(t,a);null!=s&&delete s[Jo(ba(a))]}}}return t}function Qr(t,e){return t+Nl(Yl()*(e-t+1))}function ti(t,e,n,r){for(var i=-1,o=Vl(jl((e-t)/(n||1)),0),a=tl(o);o--;)a[r?o:++i]=t,t+=n;return a}function ei(t,e){var n="";if(!t||e<1||e>Dt)return n;do e%2&&(n+=t),e=Nl(e/2),e&&(t+=t);while(e);return n}function ni(t,e){return Cf(Go(t,e,Tc),t+"")}function ri(t){return An(Ju(t))}function ii(t,e){var n=Ju(t);return Ko(n,jn(e,0,n.length))}function oi(t,e,n,r){if(!nu(t))return t;e=qo(e,t)?[e]:Ei(e);for(var i=-1,o=e.length,a=o-1,s=t;null!=s&&++i<o;){var u=Jo(e[i]),c=n;if(i!=a){var l=s[u];c=r?r(l,u,s):it,c===it&&(c=nu(l)?l:Oo(e[i+1])?[]:{})}Rn(s,u,c),s=s[u]}return t}function ai(t){return Ko(Ju(t))}function si(t,e,n){var r=-1,i=t.length;e<0&&(e=-e>i?0:i+e),n=n>i?i:n,n<0&&(n+=i),i=e>n?0:n-e>>>0,e>>>=0;for(var o=tl(i);++r<i;)o[r]=t[r+e];return o}function ui(t,e){var n;return pf(t,function(t,r,i){return n=e(t,r,i),!n}),!!n}function ci(t,e,n){var r=0,i=null==t?r:t.length;if("number"==typeof e&&e===e&&i<=Nt){for(;r<i;){var o=r+i>>>1,a=t[o];null!==a&&!du(a)&&(n?a<=e:a<e)?r=o+1:i=o}return i}return li(t,e,Tc,n)}function li(t,e,n,r){e=n(e);for(var i=0,o=null==t?0:t.length,a=e!==e,s=null===e,u=du(e),c=e===it;i<o;){var l=Nl((i+o)/2),f=n(t[l]),h=f!==it,p=null===f,d=f===f,g=du(f);if(a)var v=r||d;else v=c?d&&(r||h):s?d&&h&&(r||!p):u?d&&h&&!p&&(r||!g):!p&&!g&&(r?f<=e:f<e);v?i=l+1:o=l}return Hl(o,jt)}function fi(t,e){for(var n=-1,r=t.length,i=0,o=[];++n<r;){var a=t[n],s=e?e(a):a;if(!n||!Vs(s,u)){var u=s;o[i++]=0===a?0:a}}return o}function hi(t){return"number"==typeof t?t:du(t)?It:+t}function pi(t){if("string"==typeof t)return t;if(gh(t))return g(t,pi)+"";if(du(t))return ff?ff.call(t):"";var e=t+"";return"0"==e&&1/t==-Ot?"-0":e}function di(t,e,n){var r=-1,i=p,o=t.length,a=!0,s=[],u=s;if(n)a=!1,i=d;else if(o>=at){var c=e?null:wf(t);if(c)return Z(c);a=!1,i=N,u=new gn}else u=e?[]:s;t:for(;++r<o;){var l=t[r],f=e?e(l):l;if(l=n||0!==l?l:0,a&&f===f){for(var h=u.length;h--;)if(u[h]===f)continue t;e&&u.push(f),s.push(l)}else i(u,f,n)||(u!==s&&u.push(f),s.push(l))}return s}function gi(t,e){e=qo(e,t)?[e]:Ei(e),t=Wo(t,e);var n=Jo(ba(e));return!(null!=t&&dl.call(t,n))||delete t[n]}function vi(t,e,n,r){return oi(t,e,n(ar(t,e)),r)}function _i(t,e,n,r){for(var i=t.length,o=r?i:-1;(r?o--:++o<i)&&e(t[o],o,t););return n?si(t,r?0:o,r?o+1:i):si(t,r?o+1:0,r?i:o)}function mi(t,e){var n=t;return n instanceof y&&(n=n.value()),_(e,function(t,e){return e.func.apply(e.thisArg,v([t],e.args))},n)}function bi(t,e,n){var r=t.length;if(r<2)return r?di(t[0]):[];for(var i=-1,o=tl(r);++i<r;)for(var a=t[i],s=-1;++s<r;){var u=t[s];u!==a&&(o[i]=Vn(o[i]||a,u,e,n))}return di(tr(o,1),e,n)}function yi(t,e,n){for(var r=-1,i=t.length,o=e.length,a={};++r<i;){var s=r<o?e[r]:it;n(a,t[r],s)}return a}function wi(t){return Gs(t)?t:[]}function xi(t){return"function"==typeof t?t:Tc}function Ei(t){return gh(t)?t:Rf(t)}function Si(t,e,n){var r=t.length;return n=n===it?r:n,!e&&n>=r?t:si(t,e,n)}function Ai(t,e){if(e)return t.slice();var n=t.length,r=Sl?Sl(n):new t.constructor(n);return t.copy(r),r}function Li(t){var e=new t.constructor(t.byteLength);return new El(e).set(new El(t)),e}function ki(t,e){var n=e?Li(t.buffer):t.buffer;return new t.constructor(n,t.byteOffset,t.byteLength)}function Ti(t,e,n){var r=e?n(W(t),!0):W(t);return _(r,o,new t.constructor)}function Ci(t){var e=new t.constructor(t.source,Ve.exec(t));return e.lastIndex=t.lastIndex,e}function Ri(t,e,n){var r=e?n(Z(t),!0):Z(t);return _(r,a,new t.constructor)}function Oi(t){return lf?ol(lf.call(t)):{}}function Di(t,e){var n=e?Li(t.buffer):t.buffer;return new t.constructor(n,t.byteOffset,t.length)}function qi(t,e){if(t!==e){var n=t!==it,r=null===t,i=t===t,o=du(t),a=e!==it,s=null===e,u=e===e,c=du(e);if(!s&&!c&&!o&&t>e||o&&a&&u&&!s&&!c||r&&a&&u||!n&&u||!i)return 1;if(!r&&!o&&!c&&t<e||c&&n&&i&&!r&&!o||s&&n&&i||!a&&i||!u)return-1}return 0}function Ii(t,e,n){for(var r=-1,i=t.criteria,o=e.criteria,a=i.length,s=n.length;++r<a;){var u=qi(i[r],o[r]);if(u){if(r>=s)return u;var c=n[r];return u*("desc"==c?-1:1)}}return t.index-e.index}function Bi(t,e,n,r){for(var i=-1,o=t.length,a=n.length,s=-1,u=e.length,c=Vl(o-a,0),l=tl(u+c),f=!r;++s<u;)l[s]=e[s];for(;++i<a;)(f||i<o)&&(l[n[i]]=t[i]);for(;c--;)l[s++]=t[i++];return l}function ji(t,e,n,r){for(var i=-1,o=t.length,a=-1,s=n.length,u=-1,c=e.length,l=Vl(o-s,0),f=tl(l+c),h=!r;++i<l;)f[i]=t[i];for(var p=i;++u<c;)f[p+u]=e[u];for(;++a<s;)(h||i<o)&&(f[p+n[a]]=t[i++]);return f}function Ni(t,e){var n=-1,r=t.length;for(e||(e=tl(r));++n<r;)e[n]=t[n];return e}function Mi(t,e,n,r){var i=!n;n||(n={});for(var o=-1,a=e.length;++o<a;){var s=e[o],u=r?r(n[s],t[s],s,n,t):it;u===it&&(u=t[s]),i?In(n,s,u):Rn(n,s,u)}return n}function Pi(t,e){return Mi(t,Ef(t),e)}function Ui(t,e){return function(n,r){var i=gh(n)?u:Dn,o=e?e():{};return i(n,t,mo(r,2),o)}}function zi(t){return ni(function(e,n){var r=-1,i=n.length,o=i>1?n[i-1]:it,a=i>2?n[2]:it;for(o=t.length>3&&"function"==typeof o?(i--,o):it,a&&Do(n[0],n[1],a)&&(o=i<3?it:o,i=1),e=ol(e);++r<i;){var s=n[r];s&&t(e,s,r,o)}return e})}function Fi(t,e){return function(n,r){if(null==n)return n;if(!Hs(n))return t(n,r);for(var i=n.length,o=e?i:-1,a=ol(n);(e?o--:++o<i)&&r(a[o],o,a)!==!1;);return n}}function Vi(t){return function(e,n,r){for(var i=-1,o=ol(e),a=r(e),s=a.length;s--;){var u=a[t?s:++i];if(n(o[u],u,o)===!1)break}return e}}function Hi(t,e,n){function r(){var e=this&&this!==nr&&this instanceof r?o:t;return e.apply(i?n:this,arguments)}var i=e&ht,o=Yi(t);return r}function Gi(t){return function(e){e=Au(e);var n=V(e)?tt(e):it,r=n?n[0]:e.charAt(0),i=n?Si(n,1).join(""):e.slice(1);return r[t]()+i}}function Wi(t){return function(e){return _(Ec(rc(e).replace(Mn,"")),t,"")}}function Yi(t){return function(){var e=arguments;switch(e.length){case 0:return new t;case 1:return new t(e[0]);case 2:return new t(e[0],e[1]);case 3:return new t(e[0],e[1],e[2]);case 4:return new t(e[0],e[1],e[2],e[3]);case 5:return new t(e[0],e[1],e[2],e[3],e[4]);case 6:return new t(e[0],e[1],e[2],e[3],e[4],e[5]);case 7:return new t(e[0],e[1],e[2],e[3],e[4],e[5],e[6])}var n=hf(t.prototype),r=t.apply(n,e);return nu(r)?r:n}}function $i(t,e,n){function r(){for(var o=arguments.length,a=tl(o),u=o,c=_o(r);u--;)a[u]=arguments[u];var l=o<3&&a[0]!==c&&a[o-1]!==c?[]:$(a,c);if(o-=l.length,o<n)return oo(t,e,Ji,r.placeholder,it,a,l,it,it,n-o);var f=this&&this!==nr&&this instanceof r?i:t;return s(f,this,a)}var i=Yi(t);return r}function Zi(t){return function(e,n,r){var i=ol(e);if(!Hs(e)){var o=mo(n,3);e=Mu(e),n=function(t){return o(i[t],t,i)}}var a=t(e,n,r);return a>-1?i[o?e[a]:a]:it}}function Ki(t){return ho(function(e){var n=e.length,r=n,o=i.prototype.thru;for(t&&e.reverse();r--;){var a=e[r];if("function"!=typeof a)throw new ul(ut);if(o&&!s&&"wrapper"==vo(a))var s=new i([],!0)}for(r=s?r:n;++r<n;){a=e[r];var u=vo(a),c="wrapper"==u?xf(a):it;s=c&&Bo(c[0])&&c[1]==(bt|gt|_t|yt)&&!c[4].length&&1==c[9]?s[vo(c[0])].apply(s,c[3]):1==a.length&&Bo(a)?s[u]():s.thru(a)}return function(){var t=arguments,r=t[0];if(s&&1==t.length&&gh(r)&&r.length>=at)return s.plant(r).value();for(var i=0,o=n?e[i].apply(this,t):r;++i<n;)o=e[i].call(this,o);return o}})}function Ji(t,e,n,r,i,o,a,s,u,c){function l(){for(var _=arguments.length,m=tl(_),b=_;b--;)m[b]=arguments[b];if(d)var y=_o(l),w=U(m,y);if(r&&(m=Bi(m,r,i,d)),o&&(m=ji(m,o,a,d)),_-=w,d&&_<c){var x=$(m,y);return oo(t,e,Ji,l.placeholder,n,m,x,s,u,c-_)}var E=h?n:this,S=p?E[t]:t;return _=m.length,s?m=Yo(m,s):g&&_>1&&m.reverse(),f&&u<_&&(m.length=u),this&&this!==nr&&this instanceof l&&(S=v||Yi(S)),S.apply(E,m)}var f=e&bt,h=e&ht,p=e&pt,d=e&(gt|vt),g=e&wt,v=p?it:Yi(t);return l}function Xi(t,e){return function(n,r){return Sr(n,t,e(r),{})}}function Qi(t,e){return function(n,r){var i;if(n===it&&r===it)return e;if(n!==it&&(i=n),r!==it){if(i===it)return r;"string"==typeof n||"string"==typeof r?(n=pi(n),r=pi(r)):(n=hi(n),r=hi(r)),i=t(n,r)}return i}}function to(t){return ho(function(e){return e=g(e,B(mo())),ni(function(n){var r=this;return t(e,function(t){return s(t,r,n)})})})}function eo(t,e){e=e===it?" ":pi(e);var n=e.length;if(n<2)return n?ei(e,t):e;var r=ei(e,jl(t/Q(e)));return V(e)?Si(tt(r),0,t).join(""):r.slice(0,t)}function no(t,e,n,r){function i(){for(var e=-1,u=arguments.length,c=-1,l=r.length,f=tl(l+u),h=this&&this!==nr&&this instanceof i?a:t;++c<l;)f[c]=r[c];for(;u--;)f[c++]=arguments[++e];return s(h,o?n:this,f)}var o=e&ht,a=Yi(t);return i}function ro(t){return function(e,n,r){return r&&"number"!=typeof r&&Do(e,n,r)&&(n=r=it),e=bu(e),n===it?(n=e,e=0):n=bu(n),r=r===it?e<n?1:-1:bu(r),ti(e,n,r,t)}}function io(t){return function(e,n){return"string"==typeof e&&"string"==typeof n||(e=xu(e),n=xu(n)),t(e,n)}}function oo(t,e,n,r,i,o,a,s,u,c){var l=e&gt,f=l?a:it,h=l?it:a,p=l?o:it,d=l?it:o;e|=l?_t:mt,e&=~(l?mt:_t),e&dt||(e&=~(ht|pt));var g=[t,e,i,p,f,d,h,s,u,c],v=n.apply(it,g);return Bo(t)&&kf(v,g),v.placeholder=r,$o(v,t,e)}function ao(t){var e=il[t];return function(t,n){if(t=xu(t),n=Hl(yu(n),292)){var r=(Au(t)+"e").split("e"),i=e(r[0]+"e"+(+r[1]+n));return r=(Au(i)+"e").split("e"),+(r[0]+"e"+(+r[1]-n))}return e(t)}}function so(t){return function(e){var n=Af(e);return n==$t?W(e):n==ee?K(e):I(e,t(e))}}function uo(t,e,n,r,i,o,a,s){var u=e&pt;if(!u&&"function"!=typeof t)throw new ul(ut);var c=r?r.length:0;if(c||(e&=~(_t|mt),r=i=it),a=a===it?a:Vl(yu(a),0),s=s===it?s:yu(s),c-=i?i.length:0,e&mt){var l=r,f=i;r=i=it}var h=u?it:xf(t),p=[t,e,n,r,i,l,f,o,a,s];if(h&&zo(p,h),t=p[0],e=p[1],n=p[2],r=p[3],i=p[4],s=p[9]=null==p[9]?u?0:t.length:Vl(p[9]-c,0),!s&&e&(gt|vt)&&(e&=~(gt|vt)),e&&e!=ht)d=e==gt||e==vt?$i(t,e,s):e!=_t&&e!=(ht|_t)||i.length?Ji.apply(it,p):no(t,e,n,r);else var d=Hi(t,e,n);var g=h?_f:kf;return $o(g(d,p),t,e)}function co(t,e,n,r,i,o){var a=i&Et,s=t.length,u=e.length;if(s!=u&&!(a&&u>s))return!1;var c=o.get(t);if(c&&o.get(e))return c==e;var l=-1,f=!0,h=i&xt?new gn:it;for(o.set(t,e),o.set(e,t);++l<s;){var p=t[l],d=e[l];if(r)var g=a?r(d,p,l,e,t,o):r(p,d,l,t,e,o);if(g!==it){if(g)continue;f=!1;break}if(h){if(!b(e,function(t,e){if(!N(h,e)&&(p===t||n(p,t,r,i,o)))return h.push(e)})){f=!1;break}}else if(p!==d&&!n(p,d,r,i,o)){f=!1;break}}return o.delete(t),o.delete(e),f}function lo(t,e,n,r,i,o,a){switch(n){case ue:if(t.byteLength!=e.byteLength||t.byteOffset!=e.byteOffset)return!1;t=t.buffer,e=e.buffer;case se:return!(t.byteLength!=e.byteLength||!r(new El(t),new El(e)));case Ft:case Vt:case Zt:return Vs(+t,+e);case Gt:return t.name==e.name&&t.message==e.message;case te:case ne:return t==e+"";case $t:var s=W;case ee:var u=o&Et;if(s||(s=Z),t.size!=e.size&&!u)return!1;var c=a.get(t);if(c)return c==e;o|=xt,a.set(t,e);var l=co(s(t),s(e),r,i,o,a);return a.delete(t),l;case re:if(lf)return lf.call(t)==lf.call(e)}return!1}function fo(t,e,n,r,i,o){var a=i&Et,s=Mu(t),u=s.length,c=Mu(e),l=c.length;if(u!=l&&!a)return!1;
for(var f=u;f--;){var h=s[f];if(!(a?h in e:dl.call(e,h)))return!1}var p=o.get(t);if(p&&o.get(e))return p==e;var d=!0;o.set(t,e),o.set(e,t);for(var g=a;++f<u;){h=s[f];var v=t[h],_=e[h];if(r)var m=a?r(_,v,h,e,t,o):r(v,_,h,t,e,o);if(!(m===it?v===_||n(v,_,r,i,o):m)){d=!1;break}g||(g="constructor"==h)}if(d&&!g){var b=t.constructor,y=e.constructor;b!=y&&"constructor"in t&&"constructor"in e&&!("function"==typeof b&&b instanceof b&&"function"==typeof y&&y instanceof y)&&(d=!1)}return o.delete(t),o.delete(e),d}function ho(t){return Cf(Go(t,it,fa),t+"")}function po(t){return sr(t,Mu,Ef)}function go(t){return sr(t,Pu,Sf)}function vo(t){for(var e=t.name+"",n=nf[e],r=dl.call(nf,e)?n.length:0;r--;){var i=n[r],o=i.func;if(null==o||o==t)return i.name}return e}function _o(t){var e=dl.call(n,"placeholder")?n:t;return e.placeholder}function mo(){var t=n.iteratee||Cc;return t=t===Cc?Nr:t,arguments.length?t(arguments[0],arguments[1]):t}function bo(t,e){var n=t.__data__;return Io(e)?n["string"==typeof e?"string":"hash"]:n.map}function yo(t){for(var e=Mu(t),n=e.length;n--;){var r=e[n],i=t[r];e[n]=[r,i,Mo(i)]}return e}function wo(t,e){var n=F(t,e);return qr(n)?n:it}function xo(t){var e=dl.call(t,Ol),n=t[Ol];try{t[Ol]=it;var r=!0}catch(t){}var i=_l.call(t);return r&&(e?t[Ol]=n:delete t[Ol]),i}function Eo(t,e,n){for(var r=-1,i=n.length;++r<i;){var o=n[r],a=o.size;switch(o.type){case"drop":t+=a;break;case"dropRight":e-=a;break;case"take":e=Hl(e,t+a);break;case"takeRight":t=Vl(t,e-a)}}return{start:t,end:e}}function So(t){var e=t.match(Me);return e?e[1].split(Pe):[]}function Ao(t,e,n){e=qo(e,t)?[e]:Ei(e);for(var r=-1,i=e.length,o=!1;++r<i;){var a=Jo(e[r]);if(!(o=null!=t&&n(t,a)))break;t=t[a]}return o||++r!=i?o:(i=null==t?0:t.length,!!i&&eu(i)&&Oo(a,i)&&(gh(t)||dh(t)))}function Lo(t){var e=t.length,n=t.constructor(e);return e&&"string"==typeof t[0]&&dl.call(t,"index")&&(n.index=t.index,n.input=t.input),n}function ko(t){return"function"!=typeof t.constructor||No(t)?{}:hf(Al(t))}function To(t,e,n,r){var i=t.constructor;switch(e){case se:return Li(t);case Ft:case Vt:return new i(+t);case ue:return ki(t,r);case ce:case le:case fe:case he:case pe:case de:case ge:case ve:case _e:return Di(t,r);case $t:return Ti(t,r,n);case Zt:case ne:return new i(t);case te:return Ci(t);case ee:return Ri(t,r,n);case re:return Oi(t)}}function Co(t,e){var n=e.length;if(!n)return t;var r=n-1;return e[r]=(n>1?"& ":"")+e[r],e=e.join(n>2?", ":" "),t.replace(Ne,"{\n/* [wrapped with "+e+"] */\n")}function Ro(t){return gh(t)||dh(t)||!!(Cl&&t&&t[Cl])}function Oo(t,e){return e=null==e?Dt:e,!!e&&("number"==typeof t||$e.test(t))&&t>-1&&t%1==0&&t<e}function Do(t,e,n){if(!nu(n))return!1;var r=typeof e;return!!("number"==r?Hs(n)&&Oo(e,n.length):"string"==r&&e in n)&&Vs(n[e],t)}function qo(t,e){if(gh(t))return!1;var n=typeof t;return!("number"!=n&&"symbol"!=n&&"boolean"!=n&&null!=t&&!du(t))||(Ce.test(t)||!Te.test(t)||null!=e&&t in ol(e))}function Io(t){var e=typeof t;return"string"==e||"number"==e||"symbol"==e||"boolean"==e?"__proto__"!==t:null===t}function Bo(t){var e=vo(t),r=n[e];if("function"!=typeof r||!(e in y.prototype))return!1;if(t===r)return!0;var i=xf(r);return!!i&&t===i[0]}function jo(t){return!!vl&&vl in t}function No(t){var e=t&&t.constructor,n="function"==typeof e&&e.prototype||fl;return t===n}function Mo(t){return t===t&&!nu(t)}function Po(t,e){return function(n){return null!=n&&(n[t]===e&&(e!==it||t in ol(n)))}}function Uo(t){var e=Cs(t,function(t){return n.size===lt&&n.clear(),t}),n=e.cache;return e}function zo(t,e){var n=t[1],r=e[1],i=n|r,o=i<(ht|pt|bt),a=r==bt&&n==gt||r==bt&&n==yt&&t[7].length<=e[8]||r==(bt|yt)&&e[7].length<=e[8]&&n==gt;if(!o&&!a)return t;r&ht&&(t[2]=e[2],i|=n&ht?0:dt);var s=e[3];if(s){var u=t[3];t[3]=u?Bi(u,s,e[4]):s,t[4]=u?$(t[3],ft):e[4]}return s=e[5],s&&(u=t[5],t[5]=u?ji(u,s,e[6]):s,t[6]=u?$(t[5],ft):e[6]),s=e[7],s&&(t[7]=s),r&bt&&(t[8]=null==t[8]?e[8]:Hl(t[8],e[8])),null==t[9]&&(t[9]=e[9]),t[0]=e[0],t[1]=i,t}function Fo(t,e,n,r,i,o){return nu(t)&&nu(e)&&(o.set(e,t),Hr(t,e,it,Fo,o),o.delete(e)),t}function Vo(t){var e=[];if(null!=t)for(var n in ol(t))e.push(n);return e}function Ho(t){return _l.call(t)}function Go(t,e,n){return e=Vl(e===it?t.length-1:e,0),function(){for(var r=arguments,i=-1,o=Vl(r.length-e,0),a=tl(o);++i<o;)a[i]=r[e+i];i=-1;for(var u=tl(e+1);++i<e;)u[i]=r[i];return u[e]=n(a),s(t,this,u)}}function Wo(t,e){return 1==e.length?t:ar(t,si(e,0,-1))}function Yo(t,e){for(var n=t.length,r=Hl(e.length,n),i=Ni(t);r--;){var o=e[r];t[r]=Oo(o,n)?i[o]:it}return t}function $o(t,e,n){var r=e+"";return Cf(t,Co(r,Qo(So(r),n)))}function Zo(t){var e=0,n=0;return function(){var r=Gl(),i=kt-(r-n);if(n=r,i>0){if(++e>=Lt)return arguments[0]}else e=0;return t.apply(it,arguments)}}function Ko(t,e){var n=-1,r=t.length,i=r-1;for(e=e===it?r:e;++n<e;){var o=Qr(n,i),a=t[o];t[o]=t[n],t[n]=a}return t.length=e,t}function Jo(t){if("string"==typeof t||du(t))return t;var e=t+"";return"0"==e&&1/t==-Ot?"-0":e}function Xo(t){if(null!=t){try{return pl.call(t)}catch(t){}try{return t+""}catch(t){}}return""}function Qo(t,e){return c(Mt,function(n){var r="_."+n[0];e&n[1]&&!p(t,r)&&t.push(r)}),t.sort()}function ta(t){if(t instanceof y)return t.clone();var e=new i(t.__wrapped__,t.__chain__);return e.__actions__=Ni(t.__actions__),e.__index__=t.__index__,e.__values__=t.__values__,e}function ea(t,e,n){e=(n?Do(t,e,n):e===it)?1:Vl(yu(e),0);var r=null==t?0:t.length;if(!r||e<1)return[];for(var i=0,o=0,a=tl(jl(r/e));i<r;)a[o++]=si(t,i,i+=e);return a}function na(t){for(var e=-1,n=null==t?0:t.length,r=0,i=[];++e<n;){var o=t[e];o&&(i[r++]=o)}return i}function ra(){var t=arguments.length;if(!t)return[];for(var e=tl(t-1),n=arguments[0],r=t;r--;)e[r-1]=arguments[r];return v(gh(n)?Ni(n):[n],tr(e,1))}function ia(t,e,n){var r=null==t?0:t.length;return r?(e=n||e===it?1:yu(e),si(t,e<0?0:e,r)):[]}function oa(t,e,n){var r=null==t?0:t.length;return r?(e=n||e===it?1:yu(e),e=r-e,si(t,0,e<0?0:e)):[]}function aa(t,e){return t&&t.length?_i(t,mo(e,3),!0,!0):[]}function sa(t,e){return t&&t.length?_i(t,mo(e,3),!0):[]}function ua(t,e,n,r){var i=null==t?0:t.length;return i?(n&&"number"!=typeof n&&Do(t,e,n)&&(n=0,r=i),Kn(t,e,n,r)):[]}function ca(t,e,n){var r=null==t?0:t.length;if(!r)return-1;var i=null==n?0:yu(n);return i<0&&(i=Vl(r+i,0)),E(t,mo(e,3),i)}function la(t,e,n){var r=null==t?0:t.length;if(!r)return-1;var i=r-1;return n!==it&&(i=yu(n),i=n<0?Vl(r+i,0):Hl(i,r-1)),E(t,mo(e,3),i,!0)}function fa(t){var e=null==t?0:t.length;return e?tr(t,1):[]}function ha(t){var e=null==t?0:t.length;return e?tr(t,Ot):[]}function pa(t,e){var n=null==t?0:t.length;return n?(e=e===it?1:yu(e),tr(t,e)):[]}function da(t){for(var e=-1,n=null==t?0:t.length,r={};++e<n;){var i=t[e];r[i[0]]=i[1]}return r}function ga(t){return t&&t.length?t[0]:it}function va(t,e,n){var r=null==t?0:t.length;if(!r)return-1;var i=null==n?0:yu(n);return i<0&&(i=Vl(r+i,0)),S(t,e,i)}function _a(t){var e=null==t?0:t.length;return e?si(t,0,-1):[]}function ma(t,e){return null==t?"":zl.call(t,e)}function ba(t){var e=null==t?0:t.length;return e?t[e-1]:it}function ya(t,e,n){var r=null==t?0:t.length;if(!r)return-1;var i=r;return n!==it&&(i=yu(n),i=i<0?Vl(r+i,0):Hl(i,r-1)),e===e?X(t,e,i):E(t,L,i,!0)}function wa(t,e){return t&&t.length?Wr(t,yu(e)):it}function xa(t,e){return t&&t.length&&e&&e.length?Jr(t,e):t}function Ea(t,e,n){return t&&t.length&&e&&e.length?Jr(t,e,mo(n,2)):t}function Sa(t,e,n){return t&&t.length&&e&&e.length?Jr(t,e,it,n):t}function Aa(t,e){var n=[];if(!t||!t.length)return n;var r=-1,i=[],o=t.length;for(e=mo(e,3);++r<o;){var a=t[r];e(a,r,t)&&(n.push(a),i.push(r))}return Xr(t,i),n}function La(t){return null==t?t:$l.call(t)}function ka(t,e,n){var r=null==t?0:t.length;return r?(n&&"number"!=typeof n&&Do(t,e,n)?(e=0,n=r):(e=null==e?0:yu(e),n=n===it?r:yu(n)),si(t,e,n)):[]}function Ta(t,e){return ci(t,e)}function Ca(t,e,n){return li(t,e,mo(n,2))}function Ra(t,e){var n=null==t?0:t.length;if(n){var r=ci(t,e);if(r<n&&Vs(t[r],e))return r}return-1}function Oa(t,e){return ci(t,e,!0)}function Da(t,e,n){return li(t,e,mo(n,2),!0)}function qa(t,e){var n=null==t?0:t.length;if(n){var r=ci(t,e,!0)-1;if(Vs(t[r],e))return r}return-1}function Ia(t){return t&&t.length?fi(t):[]}function Ba(t,e){return t&&t.length?fi(t,mo(e,2)):[]}function ja(t){var e=null==t?0:t.length;return e?si(t,1,e):[]}function Na(t,e,n){return t&&t.length?(e=n||e===it?1:yu(e),si(t,0,e<0?0:e)):[]}function Ma(t,e,n){var r=null==t?0:t.length;return r?(e=n||e===it?1:yu(e),e=r-e,si(t,e<0?0:e,r)):[]}function Pa(t,e){return t&&t.length?_i(t,mo(e,3),!1,!0):[]}function Ua(t,e){return t&&t.length?_i(t,mo(e,3)):[]}function za(t){return t&&t.length?di(t):[]}function Fa(t,e){return t&&t.length?di(t,mo(e,2)):[]}function Va(t,e){return e="function"==typeof e?e:it,t&&t.length?di(t,it,e):[]}function Ha(t){if(!t||!t.length)return[];var e=0;return t=h(t,function(t){if(Gs(t))return e=Vl(t.length,e),!0}),q(e,function(e){return g(t,T(e))})}function Ga(t,e){if(!t||!t.length)return[];var n=Ha(t);return null==e?n:g(n,function(t){return s(e,it,t)})}function Wa(t,e){return yi(t||[],e||[],Rn)}function Ya(t,e){return yi(t||[],e||[],oi)}function $a(t){var e=n(t);return e.__chain__=!0,e}function Za(t,e){return e(t),t}function Ka(t,e){return e(t)}function Ja(){return $a(this)}function Xa(){return new i(this.value(),this.__chain__)}function Qa(){this.__values__===it&&(this.__values__=mu(this.value()));var t=this.__index__>=this.__values__.length,e=t?it:this.__values__[this.__index__++];return{done:t,value:e}}function ts(){return this}function es(t){for(var e,n=this;n instanceof r;){var i=ta(n);i.__index__=0,i.__values__=it,e?o.__wrapped__=i:e=i;var o=i;n=n.__wrapped__}return o.__wrapped__=t,e}function ns(){var t=this.__wrapped__;if(t instanceof y){var e=t;return this.__actions__.length&&(e=new y(this)),e=e.reverse(),e.__actions__.push({func:Ka,args:[La],thisArg:it}),new i(e,this.__chain__)}return this.thru(La)}function rs(){return mi(this.__wrapped__,this.__actions__)}function is(t,e,n){var r=gh(t)?f:$n;return n&&Do(t,e,n)&&(e=it),r(t,mo(e,3))}function os(t,e){var n=gh(t)?h:Jn;return n(t,mo(e,3))}function as(t,e){return tr(hs(t,e),1)}function ss(t,e){return tr(hs(t,e),Ot)}function us(t,e,n){return n=n===it?1:yu(n),tr(hs(t,e),n)}function cs(t,e){var n=gh(t)?c:pf;return n(t,mo(e,3))}function ls(t,e){var n=gh(t)?l:df;return n(t,mo(e,3))}function fs(t,e,n,r){t=Hs(t)?t:Ju(t),n=n&&!r?yu(n):0;var i=t.length;return n<0&&(n=Vl(i+n,0)),pu(t)?n<=i&&t.indexOf(e,n)>-1:!!i&&S(t,e,n)>-1}function hs(t,e){var n=gh(t)?g:zr;return n(t,mo(e,3))}function ps(t,e,n,r){return null==t?[]:(gh(e)||(e=null==e?[]:[e]),n=r?it:n,gh(n)||(n=null==n?[]:[n]),Yr(t,e,n))}function ds(t,e,n){var r=gh(t)?_:R,i=arguments.length<3;return r(t,mo(e,4),n,i,pf)}function gs(t,e,n){var r=gh(t)?m:R,i=arguments.length<3;return r(t,mo(e,4),n,i,df)}function vs(t,e){var n=gh(t)?h:Jn;return n(t,Rs(mo(e,3)))}function _s(t){var e=gh(t)?An:ri;return e(t)}function ms(t,e,n){e=(n?Do(t,e,n):e===it)?1:yu(e);var r=gh(t)?Ln:ii;return r(t,e)}function bs(t){var e=gh(t)?kn:ai;return e(t)}function ys(t){if(null==t)return 0;if(Hs(t))return pu(t)?Q(t):t.length;var e=Af(t);return e==$t||e==ee?t.size:Mr(t).length}function ws(t,e,n){var r=gh(t)?b:ui;return n&&Do(t,e,n)&&(e=it),r(t,mo(e,3))}function xs(t,e){if("function"!=typeof e)throw new ul(ut);return t=yu(t),function(){if(--t<1)return e.apply(this,arguments)}}function Es(t,e,n){return e=n?it:e,e=t&&null==e?t.length:e,uo(t,bt,it,it,it,it,e)}function Ss(t,e){var n;if("function"!=typeof e)throw new ul(ut);return t=yu(t),function(){return--t>0&&(n=e.apply(this,arguments)),t<=1&&(e=it),n}}function As(t,e,n){e=n?it:e;var r=uo(t,gt,it,it,it,it,it,e);return r.placeholder=As.placeholder,r}function Ls(t,e,n){e=n?it:e;var r=uo(t,vt,it,it,it,it,it,e);return r.placeholder=Ls.placeholder,r}function ks(t,e,n){function r(e){var n=h,r=p;return h=p=it,m=e,g=t.apply(r,n)}function i(t){return m=t,v=Tf(s,e),b?r(t):g}function o(t){var n=t-_,r=t-m,i=e-n;return y?Hl(i,d-r):i}function a(t){var n=t-_,r=t-m;return _===it||n>=e||n<0||y&&r>=d}function s(){var t=rh();return a(t)?u(t):void(v=Tf(s,o(t)))}function u(t){return v=it,w&&h?r(t):(h=p=it,g)}function c(){v!==it&&yf(v),m=0,h=_=p=v=it}function l(){return v===it?g:u(rh())}function f(){var t=rh(),n=a(t);if(h=arguments,p=this,_=t,n){if(v===it)return i(_);if(y)return v=Tf(s,e),r(_)}return v===it&&(v=Tf(s,e)),g}var h,p,d,g,v,_,m=0,b=!1,y=!1,w=!0;if("function"!=typeof t)throw new ul(ut);return e=xu(e)||0,nu(n)&&(b=!!n.leading,y="maxWait"in n,d=y?Vl(xu(n.maxWait)||0,e):d,w="trailing"in n?!!n.trailing:w),f.cancel=c,f.flush=l,f}function Ts(t){return uo(t,wt)}function Cs(t,e){if("function"!=typeof t||null!=e&&"function"!=typeof e)throw new ul(ut);var n=function(){var r=arguments,i=e?e.apply(this,r):r[0],o=n.cache;if(o.has(i))return o.get(i);var a=t.apply(this,r);return n.cache=o.set(i,a)||o,a};return n.cache=new(Cs.Cache||cn),n}function Rs(t){if("function"!=typeof t)throw new ul(ut);return function(){var e=arguments;switch(e.length){case 0:return!t.call(this);case 1:return!t.call(this,e[0]);case 2:return!t.call(this,e[0],e[1]);case 3:return!t.call(this,e[0],e[1],e[2])}return!t.apply(this,e)}}function Os(t){return Ss(2,t)}function Ds(t,e){if("function"!=typeof t)throw new ul(ut);return e=e===it?e:yu(e),ni(t,e)}function qs(t,e){if("function"!=typeof t)throw new ul(ut);return e=e===it?0:Vl(yu(e),0),ni(function(n){var r=n[e],i=Si(n,0,e);return r&&v(i,r),s(t,this,i)})}function Is(t,e,n){var r=!0,i=!0;if("function"!=typeof t)throw new ul(ut);return nu(n)&&(r="leading"in n?!!n.leading:r,i="trailing"in n?!!n.trailing:i),ks(t,e,{leading:r,maxWait:e,trailing:i})}function Bs(t){return Es(t,1)}function js(t,e){return ch(xi(e),t)}function Ns(){if(!arguments.length)return[];var t=arguments[0];return gh(t)?t:[t]}function Ms(t){return Nn(t,!1,!0)}function Ps(t,e){return e="function"==typeof e?e:it,Nn(t,!1,!0,e)}function Us(t){return Nn(t,!0,!0)}function zs(t,e){return e="function"==typeof e?e:it,Nn(t,!0,!0,e)}function Fs(t,e){return null==e||zn(t,e,Mu(e))}function Vs(t,e){return t===e||t!==t&&e!==e}function Hs(t){return null!=t&&eu(t.length)&&!Qs(t)}function Gs(t){return ru(t)&&Hs(t)}function Ws(t){return t===!0||t===!1||ru(t)&&dr(t)==Ft}function Ys(t){return ru(t)&&1===t.nodeType&&!fu(t)}function $s(t){if(null==t)return!0;if(Hs(t)&&(gh(t)||"string"==typeof t||"function"==typeof t.splice||_h(t)||xh(t)||dh(t)))return!t.length;var e=Af(t);if(e==$t||e==ee)return!t.size;if(No(t))return!Mr(t).length;for(var n in t)if(dl.call(t,n))return!1;return!0}function Zs(t,e){return Cr(t,e)}function Ks(t,e,n){n="function"==typeof n?n:it;var r=n?n(t,e):it;return r===it?Cr(t,e,n):!!r}function Js(t){if(!ru(t))return!1;var e=dr(t);return e==Gt||e==Ht||"string"==typeof t.message&&"string"==typeof t.name&&!fu(t)}function Xs(t){return"number"==typeof t&&Ul(t)}function Qs(t){if(!nu(t))return!1;var e=dr(t);return e==Wt||e==Yt||e==zt||e==Qt}function tu(t){return"number"==typeof t&&t==yu(t)}function eu(t){return"number"==typeof t&&t>-1&&t%1==0&&t<=Dt}function nu(t){var e=typeof t;return null!=t&&("object"==e||"function"==e)}function ru(t){return null!=t&&"object"==typeof t}function iu(t,e){return t===e||Dr(t,e,yo(e))}function ou(t,e,n){return n="function"==typeof n?n:it,Dr(t,e,yo(e),n)}function au(t){return lu(t)&&t!=+t}function su(t){if(Lf(t))throw new nl(st);return qr(t)}function uu(t){return null===t}function cu(t){return null==t}function lu(t){return"number"==typeof t||ru(t)&&dr(t)==Zt}function fu(t){if(!ru(t)||dr(t)!=Jt)return!1;var e=Al(t);if(null===e)return!0;var n=dl.call(e,"constructor")&&e.constructor;return"function"==typeof n&&n instanceof n&&pl.call(n)==ml}function hu(t){return tu(t)&&t>=-Dt&&t<=Dt}function pu(t){return"string"==typeof t||!gh(t)&&ru(t)&&dr(t)==ne}function du(t){return"symbol"==typeof t||ru(t)&&dr(t)==re}function gu(t){return t===it}function vu(t){return ru(t)&&Af(t)==oe}function _u(t){return ru(t)&&dr(t)==ae}function mu(t){if(!t)return[];if(Hs(t))return pu(t)?tt(t):Ni(t);if(Rl&&t[Rl])return G(t[Rl]());var e=Af(t),n=e==$t?W:e==ee?Z:Ju;return n(t)}function bu(t){if(!t)return 0===t?t:0;if(t=xu(t),t===Ot||t===-Ot){var e=t<0?-1:1;return e*qt}return t===t?t:0}function yu(t){var e=bu(t),n=e%1;return e===e?n?e-n:e:0}function wu(t){return t?jn(yu(t),0,Bt):0}function xu(t){if("number"==typeof t)return t;if(du(t))return It;if(nu(t)){var e="function"==typeof t.valueOf?t.valueOf():t;t=nu(e)?e+"":e}if("string"!=typeof t)return 0===t?t:+t;t=t.replace(Ie,"");var n=Ge.test(t);return n||Ye.test(t)?Qn(t.slice(2),n?2:8):He.test(t)?It:+t}function Eu(t){return Mi(t,Pu(t))}function Su(t){return jn(yu(t),-Dt,Dt)}function Au(t){return null==t?"":pi(t)}function Lu(t,e){var n=hf(t);return null==e?n:qn(n,e)}function ku(t,e){return x(t,mo(e,3),er)}function Tu(t,e){return x(t,mo(e,3),rr)}function Cu(t,e){return null==t?t:gf(t,mo(e,3),Pu)}function Ru(t,e){return null==t?t:vf(t,mo(e,3),Pu)}function Ou(t,e){return t&&er(t,mo(e,3))}function Du(t,e){return t&&rr(t,mo(e,3))}function qu(t){return null==t?[]:ir(t,Mu(t))}function Iu(t){return null==t?[]:ir(t,Pu(t))}function Bu(t,e,n){var r=null==t?it:ar(t,e);return r===it?n:r}function ju(t,e){return null!=t&&Ao(t,e,yr)}function Nu(t,e){return null!=t&&Ao(t,e,wr)}function Mu(t){return Hs(t)?Sn(t):Mr(t)}function Pu(t){return Hs(t)?Sn(t,!0):Pr(t)}function Uu(t,e){var n={};return e=mo(e,3),er(t,function(t,r,i){In(n,e(t,r,i),t)}),n}function zu(t,e){var n={};return e=mo(e,3),er(t,function(t,r,i){In(n,r,e(t,r,i))}),n}function Fu(t,e){return Vu(t,Rs(mo(e)))}function Vu(t,e){return null==t?{}:Zr(t,go(t),mo(e))}function Hu(t,e,n){e=qo(e,t)?[e]:Ei(e);var r=-1,i=e.length;for(i||(t=it,i=1);++r<i;){var o=null==t?it:t[Jo(e[r])];o===it&&(r=i,o=n),t=Qs(o)?o.call(t):o}return t}function Gu(t,e,n){return null==t?t:oi(t,e,n)}function Wu(t,e,n,r){return r="function"==typeof r?r:it,null==t?t:oi(t,e,n,r)}function Yu(t,e,n){var r=gh(t),i=r||_h(t)||xh(t);if(e=mo(e,4),null==n){var o=t&&t.constructor;n=i?r?new o:[]:nu(t)&&Qs(o)?hf(Al(t)):{}}return(i?c:er)(t,function(t,r,i){return e(n,t,r,i)}),n}function $u(t,e){return null==t||gi(t,e)}function Zu(t,e,n){return null==t?t:vi(t,e,xi(n))}function Ku(t,e,n,r){return r="function"==typeof r?r:it,null==t?t:vi(t,e,xi(n),r)}function Ju(t){return null==t?[]:j(t,Mu(t))}function Xu(t){return null==t?[]:j(t,Pu(t))}function Qu(t,e,n){return n===it&&(n=e,e=it),n!==it&&(n=xu(n),n=n===n?n:0),e!==it&&(e=xu(e),e=e===e?e:0),jn(xu(t),e,n)}function tc(t,e,n){return e=bu(e),n===it?(n=e,e=0):n=bu(n),t=xu(t),xr(t,e,n)}function ec(t,e,n){if(n&&"boolean"!=typeof n&&Do(t,e,n)&&(e=n=it),n===it&&("boolean"==typeof e?(n=e,e=it):"boolean"==typeof t&&(n=t,t=it)),t===it&&e===it?(t=0,e=1):(t=bu(t),e===it?(e=t,t=0):e=bu(e)),t>e){var r=t;t=e,e=r}if(n||t%1||e%1){var i=Yl();return Hl(t+i*(e-t+Xn("1e-"+((i+"").length-1))),e)}return Qr(t,e)}function nc(t){return $h(Au(t).toLowerCase())}function rc(t){return t=Au(t),t&&t.replace(Ze,gr).replace(Pn,"")}function ic(t,e,n){t=Au(t),e=pi(e);var r=t.length;n=n===it?r:jn(yu(n),0,r);var i=n;return n-=e.length,n>=0&&t.slice(n,i)==e}function oc(t){return t=Au(t),t&&Se.test(t)?t.replace(xe,vr):t}function ac(t){return t=Au(t),t&&qe.test(t)?t.replace(De,"\\$&"):t}function sc(t,e,n){t=Au(t),e=yu(e);var r=e?Q(t):0;if(!e||r>=e)return t;var i=(e-r)/2;return eo(Nl(i),n)+t+eo(jl(i),n)}function uc(t,e,n){t=Au(t),e=yu(e);var r=e?Q(t):0;return e&&r<e?t+eo(e-r,n):t}function cc(t,e,n){t=Au(t),e=yu(e);var r=e?Q(t):0;return e&&r<e?eo(e-r,n)+t:t}function lc(t,e,n){return n||null==e?e=0:e&&(e=+e),Wl(Au(t).replace(Be,""),e||0)}function fc(t,e,n){return e=(n?Do(t,e,n):e===it)?1:yu(e),ei(Au(t),e)}function hc(){var t=arguments,e=Au(t[0]);return t.length<3?e:e.replace(t[1],t[2])}function pc(t,e,n){return n&&"number"!=typeof n&&Do(t,e,n)&&(e=n=it),(n=n===it?Bt:n>>>0)?(t=Au(t),t&&("string"==typeof e||null!=e&&!yh(e))&&(e=pi(e),!e&&V(t))?Si(tt(t),0,n):t.split(e,n)):[]}function dc(t,e,n){return t=Au(t),n=jn(yu(n),0,t.length),e=pi(e),t.slice(n,n+e.length)==e}function gc(t,e,r){var i=n.templateSettings;r&&Do(t,e,r)&&(e=it),t=Au(t),e=kh({},e,i,Tn);var o,a,s=kh({},e.imports,i.imports,Tn),u=Mu(s),c=j(s,u),l=0,f=e.interpolate||Ke,h="__p += '",p=al((e.escape||Ke).source+"|"+f.source+"|"+(f===ke?Fe:Ke).source+"|"+(e.evaluate||Ke).source+"|$","g"),d="//# sourceURL="+("sourceURL"in e?e.sourceURL:"lodash.templateSources["+ ++Gn+"]")+"\n";t.replace(p,function(e,n,r,i,s,u){return r||(r=i),h+=t.slice(l,u).replace(Je,z),n&&(o=!0,h+="' +\n__e("+n+") +\n'"),s&&(a=!0,h+="';\n"+s+";\n__p += '"),r&&(h+="' +\n((__t = ("+r+")) == null ? '' : __t) +\n'"),l=u+e.length,e}),h+="';\n";var g=e.variable;g||(h="with (obj) {\n"+h+"\n}\n"),h=(a?h.replace(me,""):h).replace(be,"$1").replace(ye,"$1;"),h="function("+(g||"obj")+") {\n"+(g?"":"obj || (obj = {});\n")+"var __t, __p = ''"+(o?", __e = _.escape":"")+(a?", __j = Array.prototype.join;\nfunction print() { __p += __j.call(arguments, '') }\n":";\n")+h+"return __p\n}";var v=Zh(function(){return rl(u,d+"return "+h).apply(it,c)});if(v.source=h,Js(v))throw v;return v}function vc(t){return Au(t).toLowerCase()}function _c(t){return Au(t).toUpperCase()}function mc(t,e,n){if(t=Au(t),t&&(n||e===it))return t.replace(Ie,"");if(!t||!(e=pi(e)))return t;var r=tt(t),i=tt(e),o=M(r,i),a=P(r,i)+1;return Si(r,o,a).join("")}function bc(t,e,n){if(t=Au(t),t&&(n||e===it))return t.replace(je,"");if(!t||!(e=pi(e)))return t;var r=tt(t),i=P(r,tt(e))+1;return Si(r,0,i).join("")}function yc(t,e,n){if(t=Au(t),t&&(n||e===it))return t.replace(Be,"");if(!t||!(e=pi(e)))return t;var r=tt(t),i=M(r,tt(e));return Si(r,i).join("")}function wc(t,e){var n=St,r=At;if(nu(e)){var i="separator"in e?e.separator:i;n="length"in e?yu(e.length):n,r="omission"in e?pi(e.omission):r}t=Au(t);var o=t.length;if(V(t)){var a=tt(t);o=a.length}if(n>=o)return t;var s=n-Q(r);if(s<1)return r;var u=a?Si(a,0,s).join(""):t.slice(0,s);if(i===it)return u+r;if(a&&(s+=u.length-s),yh(i)){if(t.slice(s).search(i)){var c,l=u;for(i.global||(i=al(i.source,Au(Ve.exec(i))+"g")),i.lastIndex=0;c=i.exec(l);)var f=c.index;u=u.slice(0,f===it?s:f)}}else if(t.indexOf(pi(i),s)!=s){var h=u.lastIndexOf(i);h>-1&&(u=u.slice(0,h))}return u+r}function xc(t){return t=Au(t),t&&Ee.test(t)?t.replace(we,_r):t}function Ec(t,e,n){return t=Au(t),e=n?it:e,e===it?H(t)?rt(t):w(t):t.match(e)||[]}function Sc(t){var e=null==t?0:t.length,n=mo();return t=e?g(t,function(t){if("function"!=typeof t[1])throw new ul(ut);return[n(t[0]),t[1]]}):[],ni(function(n){for(var r=-1;++r<e;){var i=t[r];if(s(i[0],this,n))return s(i[1],this,n)}})}function Ac(t){return Un(Nn(t,!0))}function Lc(t){return function(){return t}}function kc(t,e){return null==t||t!==t?e:t}function Tc(t){return t}function Cc(t){return Nr("function"==typeof t?t:Nn(t,!0))}function Rc(t){return Fr(Nn(t,!0))}function Oc(t,e){return Vr(t,Nn(e,!0))}function Dc(t,e,n){var r=Mu(e),i=ir(e,r);null!=n||nu(e)&&(i.length||!r.length)||(n=e,e=t,t=this,i=ir(e,Mu(e)));var o=!(nu(n)&&"chain"in n&&!n.chain),a=Qs(t);return c(i,function(n){var r=e[n];t[n]=r,a&&(t.prototype[n]=function(){var e=this.__chain__;if(o||e){var n=t(this.__wrapped__),i=n.__actions__=Ni(this.__actions__);return i.push({func:r,args:arguments,thisArg:t}),n.__chain__=e,n}return r.apply(t,v([this.value()],arguments))})}),t}function qc(){return nr._===this&&(nr._=bl),this}function Ic(){}function Bc(t){return t=yu(t),ni(function(e){return Wr(e,t)})}function jc(t){return qo(t)?T(Jo(t)):Kr(t)}function Nc(t){return function(e){return null==t?it:ar(t,e)}}function Mc(){return[]}function Pc(){return!1}function Uc(){return{}}function zc(){return""}function Fc(){return!0}function Vc(t,e){if(t=yu(t),t<1||t>Dt)return[];var n=Bt,r=Hl(t,Bt);e=mo(e),t-=Bt;for(var i=q(r,e);++n<t;)e(n);return i}function Hc(t){return gh(t)?g(t,Jo):du(t)?[t]:Ni(Rf(t))}function Gc(t){var e=++gl;return Au(t)+e}function Wc(t){return t&&t.length?Zn(t,Tc,mr):it}function Yc(t,e){return t&&t.length?Zn(t,mo(e,2),mr):it}function $c(t){return k(t,Tc)}function Zc(t,e){return k(t,mo(e,2))}function Kc(t){return t&&t.length?Zn(t,Tc,Ur):it}function Jc(t,e){return t&&t.length?Zn(t,mo(e,2),Ur):it}function Xc(t){return t&&t.length?D(t,Tc):0}function Qc(t,e){return t&&t.length?D(t,mo(e,2)):0}e=null==e?nr:br.defaults(nr.Object(),e,br.pick(nr,Hn));var tl=e.Array,el=e.Date,nl=e.Error,rl=e.Function,il=e.Math,ol=e.Object,al=e.RegExp,sl=e.String,ul=e.TypeError,cl=tl.prototype,ll=rl.prototype,fl=ol.prototype,hl=e["__core-js_shared__"],pl=ll.toString,dl=fl.hasOwnProperty,gl=0,vl=function(){var t=/[^.]+$/.exec(hl&&hl.keys&&hl.keys.IE_PROTO||"");return t?"Symbol(src)_1."+t:""}(),_l=fl.toString,ml=pl.call(ol),bl=nr._,yl=al("^"+pl.call(dl).replace(De,"\\$&").replace(/hasOwnProperty|(function).*?(?=\\\()| for .+?(?=\\\])/g,"$1.*?")+"$"),wl=or?e.Buffer:it,xl=e.Symbol,El=e.Uint8Array,Sl=wl?wl.allocUnsafe:it,Al=Y(ol.getPrototypeOf,ol),Ll=ol.create,kl=fl.propertyIsEnumerable,Tl=cl.splice,Cl=xl?xl.isConcatSpreadable:it,Rl=xl?xl.iterator:it,Ol=xl?xl.toStringTag:it,Dl=function(){try{var t=wo(ol,"defineProperty");return t({},"",{}),t}catch(t){}}(),ql=e.clearTimeout!==nr.clearTimeout&&e.clearTimeout,Il=el&&el.now!==nr.Date.now&&el.now,Bl=e.setTimeout!==nr.setTimeout&&e.setTimeout,jl=il.ceil,Nl=il.floor,Ml=ol.getOwnPropertySymbols,Pl=wl?wl.isBuffer:it,Ul=e.isFinite,zl=cl.join,Fl=Y(ol.keys,ol),Vl=il.max,Hl=il.min,Gl=el.now,Wl=e.parseInt,Yl=il.random,$l=cl.reverse,Zl=wo(e,"DataView"),Kl=wo(e,"Map"),Jl=wo(e,"Promise"),Xl=wo(e,"Set"),Ql=wo(e,"WeakMap"),tf=wo(ol,"create"),ef=Ql&&new Ql,nf={},rf=Xo(Zl),of=Xo(Kl),af=Xo(Jl),sf=Xo(Xl),uf=Xo(Ql),cf=xl?xl.prototype:it,lf=cf?cf.valueOf:it,ff=cf?cf.toString:it,hf=function(){function t(){}return function(e){if(!nu(e))return{};if(Ll)return Ll(e);t.prototype=e;var n=new t;return t.prototype=it,n}}();n.templateSettings={escape:Ae,evaluate:Le,interpolate:ke,variable:"",imports:{_:n}},n.prototype=r.prototype,n.prototype.constructor=n,i.prototype=hf(r.prototype),i.prototype.constructor=i,y.prototype=hf(r.prototype),y.prototype.constructor=y,nt.prototype.clear=Ue,nt.prototype.delete=Xe,nt.prototype.get=Qe,nt.prototype.has=tn,nt.prototype.set=en,nn.prototype.clear=rn,nn.prototype.delete=on,nn.prototype.get=an,nn.prototype.has=sn,nn.prototype.set=un,cn.prototype.clear=ln,cn.prototype.delete=fn,cn.prototype.get=hn,cn.prototype.has=pn,cn.prototype.set=dn,gn.prototype.add=gn.prototype.push=vn,gn.prototype.has=_n,mn.prototype.clear=bn,mn.prototype.delete=yn,mn.prototype.get=wn,mn.prototype.has=xn,mn.prototype.set=En;var pf=Fi(er),df=Fi(rr,!0),gf=Vi(),vf=Vi(!0),_f=ef?function(t,e){return ef.set(t,e),t}:Tc,mf=Dl?function(t,e){return Dl(t,"toString",{configurable:!0,enumerable:!1,value:Lc(e),writable:!0})}:Tc,bf=ni,yf=ql||function(t){return nr.clearTimeout(t)},wf=Xl&&1/Z(new Xl([,-0]))[1]==Ot?function(t){return new Xl(t)}:Ic,xf=ef?function(t){return ef.get(t)}:Ic,Ef=Ml?Y(Ml,ol):Mc,Sf=Ml?function(t){for(var e=[];t;)v(e,Ef(t)),t=Al(t);return e}:Mc,Af=dr;(Zl&&Af(new Zl(new ArrayBuffer(1)))!=ue||Kl&&Af(new Kl)!=$t||Jl&&Af(Jl.resolve())!=Xt||Xl&&Af(new Xl)!=ee||Ql&&Af(new Ql)!=oe)&&(Af=function(t){var e=dr(t),n=e==Jt?t.constructor:it,r=n?Xo(n):"";if(r)switch(r){case rf:return ue;case of:return $t;case af:return Xt;case sf:return ee;case uf:return oe}return e});var Lf=hl?Qs:Pc,kf=Zo(_f),Tf=Bl||function(t,e){return nr.setTimeout(t,e)},Cf=Zo(mf),Rf=Uo(function(t){t=Au(t);var e=[];return Re.test(t)&&e.push(""),t.replace(Oe,function(t,n,r,i){e.push(r?i.replace(ze,"$1"):n||t)}),e}),Of=ni(function(t,e){return Gs(t)?Vn(t,tr(e,1,Gs,!0)):[]}),Df=ni(function(t,e){var n=ba(e);return Gs(n)&&(n=it),Gs(t)?Vn(t,tr(e,1,Gs,!0),mo(n,2)):[]}),qf=ni(function(t,e){var n=ba(e);return Gs(n)&&(n=it),Gs(t)?Vn(t,tr(e,1,Gs,!0),it,n):[]}),If=ni(function(t){var e=g(t,wi);return e.length&&e[0]===t[0]?Er(e):[]}),Bf=ni(function(t){var e=ba(t),n=g(t,wi);return e===ba(n)?e=it:n.pop(),n.length&&n[0]===t[0]?Er(n,mo(e,2)):[]}),jf=ni(function(t){var e=ba(t),n=g(t,wi);return e="function"==typeof e?e:it,e&&n.pop(),n.length&&n[0]===t[0]?Er(n,it,e):[]}),Nf=ni(xa),Mf=ho(function(t,e){var n=null==t?0:t.length,r=Bn(t,e);return Xr(t,g(e,function(t){return Oo(t,n)?+t:t}).sort(qi)),r}),Pf=ni(function(t){return di(tr(t,1,Gs,!0))}),Uf=ni(function(t){var e=ba(t);return Gs(e)&&(e=it),di(tr(t,1,Gs,!0),mo(e,2))}),zf=ni(function(t){var e=ba(t);return e="function"==typeof e?e:it,di(tr(t,1,Gs,!0),it,e)}),Ff=ni(function(t,e){return Gs(t)?Vn(t,e):[]}),Vf=ni(function(t){return bi(h(t,Gs))}),Hf=ni(function(t){var e=ba(t);return Gs(e)&&(e=it),bi(h(t,Gs),mo(e,2))}),Gf=ni(function(t){var e=ba(t);return e="function"==typeof e?e:it,bi(h(t,Gs),it,e)}),Wf=ni(Ha),Yf=ni(function(t){var e=t.length,n=e>1?t[e-1]:it;return n="function"==typeof n?(t.pop(),n):it,Ga(t,n)}),$f=ho(function(t){var e=t.length,n=e?t[0]:0,r=this.__wrapped__,o=function(e){return Bn(e,t)};return!(e>1||this.__actions__.length)&&r instanceof y&&Oo(n)?(r=r.slice(n,+n+(e?1:0)),r.__actions__.push({func:Ka,args:[o],thisArg:it}),new i(r,this.__chain__).thru(function(t){return e&&!t.length&&t.push(it),t})):this.thru(o)}),Zf=Ui(function(t,e,n){dl.call(t,n)?++t[n]:In(t,n,1)}),Kf=Zi(ca),Jf=Zi(la),Xf=Ui(function(t,e,n){dl.call(t,n)?t[n].push(e):In(t,n,[e])}),Qf=ni(function(t,e,n){var r=-1,i="function"==typeof e,o=qo(e),a=Hs(t)?tl(t.length):[];return pf(t,function(t){var u=i?e:o&&null!=t?t[e]:it;a[++r]=u?s(u,t,n):Ar(t,e,n)}),a}),th=Ui(function(t,e,n){In(t,n,e)}),eh=Ui(function(t,e,n){t[n?0:1].push(e)},function(){return[[],[]]}),nh=ni(function(t,e){if(null==t)return[];var n=e.length;return n>1&&Do(t,e[0],e[1])?e=[]:n>2&&Do(e[0],e[1],e[2])&&(e=[e[0]]),Yr(t,tr(e,1),[])}),rh=Il||function(){return nr.Date.now()},ih=ni(function(t,e,n){var r=ht;if(n.length){var i=$(n,_o(ih));r|=_t}return uo(t,r,e,n,i)}),oh=ni(function(t,e,n){var r=ht|pt;if(n.length){var i=$(n,_o(oh));r|=_t}return uo(e,r,t,n,i)}),ah=ni(function(t,e){return Fn(t,1,e)}),sh=ni(function(t,e,n){return Fn(t,xu(e)||0,n)});Cs.Cache=cn;var uh=bf(function(t,e){e=1==e.length&&gh(e[0])?g(e[0],B(mo())):g(tr(e,1),B(mo()));var n=e.length;return ni(function(r){for(var i=-1,o=Hl(r.length,n);++i<o;)r[i]=e[i].call(this,r[i]);return s(t,this,r)})}),ch=ni(function(t,e){var n=$(e,_o(ch));return uo(t,_t,it,e,n)}),lh=ni(function(t,e){var n=$(e,_o(lh));return uo(t,mt,it,e,n)}),fh=ho(function(t,e){return uo(t,yt,it,it,it,e)}),hh=io(mr),ph=io(function(t,e){return t>=e}),dh=Lr(function(){return arguments}())?Lr:function(t){return ru(t)&&dl.call(t,"callee")&&!kl.call(t,"callee")},gh=tl.isArray,vh=ur?B(ur):kr,_h=Pl||Pc,mh=cr?B(cr):Tr,bh=lr?B(lr):Or,yh=fr?B(fr):Ir,wh=hr?B(hr):Br,xh=pr?B(pr):jr,Eh=io(Ur),Sh=io(function(t,e){return t<=e}),Ah=zi(function(t,e){if(No(e)||Hs(e))return void Mi(e,Mu(e),t);for(var n in e)dl.call(e,n)&&Rn(t,n,e[n])}),Lh=zi(function(t,e){Mi(e,Pu(e),t)}),kh=zi(function(t,e,n,r){Mi(e,Pu(e),t,r)}),Th=zi(function(t,e,n,r){Mi(e,Mu(e),t,r)}),Ch=ho(Bn),Rh=ni(function(t){return t.push(it,Tn),s(kh,it,t)}),Oh=ni(function(t){return t.push(it,Fo),s(jh,it,t)}),Dh=Xi(function(t,e,n){t[e]=n},Lc(Tc)),qh=Xi(function(t,e,n){dl.call(t,e)?t[e].push(n):t[e]=[n]},mo),Ih=ni(Ar),Bh=zi(function(t,e,n){Hr(t,e,n)}),jh=zi(function(t,e,n,r){Hr(t,e,n,r)}),Nh=ho(function(t,e){return null==t?{}:(e=g(e,Jo),$r(t,Vn(go(t),e)))}),Mh=ho(function(t,e){return null==t?{}:$r(t,g(e,Jo))}),Ph=so(Mu),Uh=so(Pu),zh=Wi(function(t,e,n){return e=e.toLowerCase(),t+(n?nc(e):e)}),Fh=Wi(function(t,e,n){return t+(n?"-":"")+e.toLowerCase()}),Vh=Wi(function(t,e,n){return t+(n?" ":"")+e.toLowerCase()}),Hh=Gi("toLowerCase"),Gh=Wi(function(t,e,n){return t+(n?"_":"")+e.toLowerCase()}),Wh=Wi(function(t,e,n){return t+(n?" ":"")+$h(e)}),Yh=Wi(function(t,e,n){return t+(n?" ":"")+e.toUpperCase()}),$h=Gi("toUpperCase"),Zh=ni(function(t,e){try{return s(t,it,e)}catch(t){return Js(t)?t:new nl(t)}}),Kh=ho(function(t,e){return c(e,function(e){e=Jo(e),In(t,e,ih(t[e],t))}),t}),Jh=Ki(),Xh=Ki(!0),Qh=ni(function(t,e){return function(n){return Ar(n,t,e)}}),tp=ni(function(t,e){return function(n){return Ar(t,n,e)}}),ep=to(g),np=to(f),rp=to(b),ip=ro(),op=ro(!0),ap=Qi(function(t,e){return t+e},0),sp=ao("ceil"),up=Qi(function(t,e){return t/e},1),cp=ao("floor"),lp=Qi(function(t,e){return t*e},1),fp=ao("round"),hp=Qi(function(t,e){
return t-e},0);return n.after=xs,n.ary=Es,n.assign=Ah,n.assignIn=Lh,n.assignInWith=kh,n.assignWith=Th,n.at=Ch,n.before=Ss,n.bind=ih,n.bindAll=Kh,n.bindKey=oh,n.castArray=Ns,n.chain=$a,n.chunk=ea,n.compact=na,n.concat=ra,n.cond=Sc,n.conforms=Ac,n.constant=Lc,n.countBy=Zf,n.create=Lu,n.curry=As,n.curryRight=Ls,n.debounce=ks,n.defaults=Rh,n.defaultsDeep=Oh,n.defer=ah,n.delay=sh,n.difference=Of,n.differenceBy=Df,n.differenceWith=qf,n.drop=ia,n.dropRight=oa,n.dropRightWhile=aa,n.dropWhile=sa,n.fill=ua,n.filter=os,n.flatMap=as,n.flatMapDeep=ss,n.flatMapDepth=us,n.flatten=fa,n.flattenDeep=ha,n.flattenDepth=pa,n.flip=Ts,n.flow=Jh,n.flowRight=Xh,n.fromPairs=da,n.functions=qu,n.functionsIn=Iu,n.groupBy=Xf,n.initial=_a,n.intersection=If,n.intersectionBy=Bf,n.intersectionWith=jf,n.invert=Dh,n.invertBy=qh,n.invokeMap=Qf,n.iteratee=Cc,n.keyBy=th,n.keys=Mu,n.keysIn=Pu,n.map=hs,n.mapKeys=Uu,n.mapValues=zu,n.matches=Rc,n.matchesProperty=Oc,n.memoize=Cs,n.merge=Bh,n.mergeWith=jh,n.method=Qh,n.methodOf=tp,n.mixin=Dc,n.negate=Rs,n.nthArg=Bc,n.omit=Nh,n.omitBy=Fu,n.once=Os,n.orderBy=ps,n.over=ep,n.overArgs=uh,n.overEvery=np,n.overSome=rp,n.partial=ch,n.partialRight=lh,n.partition=eh,n.pick=Mh,n.pickBy=Vu,n.property=jc,n.propertyOf=Nc,n.pull=Nf,n.pullAll=xa,n.pullAllBy=Ea,n.pullAllWith=Sa,n.pullAt=Mf,n.range=ip,n.rangeRight=op,n.rearg=fh,n.reject=vs,n.remove=Aa,n.rest=Ds,n.reverse=La,n.sampleSize=ms,n.set=Gu,n.setWith=Wu,n.shuffle=bs,n.slice=ka,n.sortBy=nh,n.sortedUniq=Ia,n.sortedUniqBy=Ba,n.split=pc,n.spread=qs,n.tail=ja,n.take=Na,n.takeRight=Ma,n.takeRightWhile=Pa,n.takeWhile=Ua,n.tap=Za,n.throttle=Is,n.thru=Ka,n.toArray=mu,n.toPairs=Ph,n.toPairsIn=Uh,n.toPath=Hc,n.toPlainObject=Eu,n.transform=Yu,n.unary=Bs,n.union=Pf,n.unionBy=Uf,n.unionWith=zf,n.uniq=za,n.uniqBy=Fa,n.uniqWith=Va,n.unset=$u,n.unzip=Ha,n.unzipWith=Ga,n.update=Zu,n.updateWith=Ku,n.values=Ju,n.valuesIn=Xu,n.without=Ff,n.words=Ec,n.wrap=js,n.xor=Vf,n.xorBy=Hf,n.xorWith=Gf,n.zip=Wf,n.zipObject=Wa,n.zipObjectDeep=Ya,n.zipWith=Yf,n.entries=Ph,n.entriesIn=Uh,n.extend=Lh,n.extendWith=kh,Dc(n,n),n.add=ap,n.attempt=Zh,n.camelCase=zh,n.capitalize=nc,n.ceil=sp,n.clamp=Qu,n.clone=Ms,n.cloneDeep=Us,n.cloneDeepWith=zs,n.cloneWith=Ps,n.conformsTo=Fs,n.deburr=rc,n.defaultTo=kc,n.divide=up,n.endsWith=ic,n.eq=Vs,n.escape=oc,n.escapeRegExp=ac,n.every=is,n.find=Kf,n.findIndex=ca,n.findKey=ku,n.findLast=Jf,n.findLastIndex=la,n.findLastKey=Tu,n.floor=cp,n.forEach=cs,n.forEachRight=ls,n.forIn=Cu,n.forInRight=Ru,n.forOwn=Ou,n.forOwnRight=Du,n.get=Bu,n.gt=hh,n.gte=ph,n.has=ju,n.hasIn=Nu,n.head=ga,n.identity=Tc,n.includes=fs,n.indexOf=va,n.inRange=tc,n.invoke=Ih,n.isArguments=dh,n.isArray=gh,n.isArrayBuffer=vh,n.isArrayLike=Hs,n.isArrayLikeObject=Gs,n.isBoolean=Ws,n.isBuffer=_h,n.isDate=mh,n.isElement=Ys,n.isEmpty=$s,n.isEqual=Zs,n.isEqualWith=Ks,n.isError=Js,n.isFinite=Xs,n.isFunction=Qs,n.isInteger=tu,n.isLength=eu,n.isMap=bh,n.isMatch=iu,n.isMatchWith=ou,n.isNaN=au,n.isNative=su,n.isNil=cu,n.isNull=uu,n.isNumber=lu,n.isObject=nu,n.isObjectLike=ru,n.isPlainObject=fu,n.isRegExp=yh,n.isSafeInteger=hu,n.isSet=wh,n.isString=pu,n.isSymbol=du,n.isTypedArray=xh,n.isUndefined=gu,n.isWeakMap=vu,n.isWeakSet=_u,n.join=ma,n.kebabCase=Fh,n.last=ba,n.lastIndexOf=ya,n.lowerCase=Vh,n.lowerFirst=Hh,n.lt=Eh,n.lte=Sh,n.max=Wc,n.maxBy=Yc,n.mean=$c,n.meanBy=Zc,n.min=Kc,n.minBy=Jc,n.stubArray=Mc,n.stubFalse=Pc,n.stubObject=Uc,n.stubString=zc,n.stubTrue=Fc,n.multiply=lp,n.nth=wa,n.noConflict=qc,n.noop=Ic,n.now=rh,n.pad=sc,n.padEnd=uc,n.padStart=cc,n.parseInt=lc,n.random=ec,n.reduce=ds,n.reduceRight=gs,n.repeat=fc,n.replace=hc,n.result=Hu,n.round=fp,n.runInContext=t,n.sample=_s,n.size=ys,n.snakeCase=Gh,n.some=ws,n.sortedIndex=Ta,n.sortedIndexBy=Ca,n.sortedIndexOf=Ra,n.sortedLastIndex=Oa,n.sortedLastIndexBy=Da,n.sortedLastIndexOf=qa,n.startCase=Wh,n.startsWith=dc,n.subtract=hp,n.sum=Xc,n.sumBy=Qc,n.template=gc,n.times=Vc,n.toFinite=bu,n.toInteger=yu,n.toLength=wu,n.toLower=vc,n.toNumber=xu,n.toSafeInteger=Su,n.toString=Au,n.toUpper=_c,n.trim=mc,n.trimEnd=bc,n.trimStart=yc,n.truncate=wc,n.unescape=xc,n.uniqueId=Gc,n.upperCase=Yh,n.upperFirst=$h,n.each=cs,n.eachRight=ls,n.first=ga,Dc(n,function(){var t={};return er(n,function(e,r){dl.call(n.prototype,r)||(t[r]=e)}),t}(),{chain:!1}),n.VERSION=ot,c(["bind","bindKey","curry","curryRight","partial","partialRight"],function(t){n[t].placeholder=n}),c(["drop","take"],function(t,e){y.prototype[t]=function(n){var r=this.__filtered__;if(r&&!e)return new y(this);n=n===it?1:Vl(yu(n),0);var i=this.clone();return r?i.__takeCount__=Hl(n,i.__takeCount__):i.__views__.push({size:Hl(n,Bt),type:t+(i.__dir__<0?"Right":"")}),i},y.prototype[t+"Right"]=function(e){return this.reverse()[t](e).reverse()}}),c(["filter","map","takeWhile"],function(t,e){var n=e+1,r=n==Tt||n==Rt;y.prototype[t]=function(t){var e=this.clone();return e.__iteratees__.push({iteratee:mo(t,3),type:n}),e.__filtered__=e.__filtered__||r,e}}),c(["head","last"],function(t,e){var n="take"+(e?"Right":"");y.prototype[t]=function(){return this[n](1).value()[0]}}),c(["initial","tail"],function(t,e){var n="drop"+(e?"":"Right");y.prototype[t]=function(){return this.__filtered__?new y(this):this[n](1)}}),y.prototype.compact=function(){return this.filter(Tc)},y.prototype.find=function(t){return this.filter(t).head()},y.prototype.findLast=function(t){return this.reverse().find(t)},y.prototype.invokeMap=ni(function(t,e){return"function"==typeof t?new y(this):this.map(function(n){return Ar(n,t,e)})}),y.prototype.reject=function(t){return this.filter(Rs(mo(t)))},y.prototype.slice=function(t,e){t=yu(t);var n=this;return n.__filtered__&&(t>0||e<0)?new y(n):(t<0?n=n.takeRight(-t):t&&(n=n.drop(t)),e!==it&&(e=yu(e),n=e<0?n.dropRight(-e):n.take(e-t)),n)},y.prototype.takeRightWhile=function(t){return this.reverse().takeWhile(t).reverse()},y.prototype.toArray=function(){return this.take(Bt)},er(y.prototype,function(t,e){var r=/^(?:filter|find|map|reject)|While$/.test(e),o=/^(?:head|last)$/.test(e),a=n[o?"take"+("last"==e?"Right":""):e],s=o||/^find/.test(e);a&&(n.prototype[e]=function(){var e=this.__wrapped__,u=o?[1]:arguments,c=e instanceof y,l=u[0],f=c||gh(e),h=function(t){var e=a.apply(n,v([t],u));return o&&p?e[0]:e};f&&r&&"function"==typeof l&&1!=l.length&&(c=f=!1);var p=this.__chain__,d=!!this.__actions__.length,g=s&&!p,_=c&&!d;if(!s&&f){e=_?e:new y(this);var m=t.apply(e,u);return m.__actions__.push({func:Ka,args:[h],thisArg:it}),new i(m,p)}return g&&_?t.apply(this,u):(m=this.thru(h),g?o?m.value()[0]:m.value():m)})}),c(["pop","push","shift","sort","splice","unshift"],function(t){var e=cl[t],r=/^(?:push|sort|unshift)$/.test(t)?"tap":"thru",i=/^(?:pop|shift)$/.test(t);n.prototype[t]=function(){var t=arguments;if(i&&!this.__chain__){var n=this.value();return e.apply(gh(n)?n:[],t)}return this[r](function(n){return e.apply(gh(n)?n:[],t)})}}),er(y.prototype,function(t,e){var r=n[e];if(r){var i=r.name+"",o=nf[i]||(nf[i]=[]);o.push({name:e,func:r})}}),nf[Ji(it,pt).name]=[{name:"wrapper",func:it}],y.prototype.clone=C,y.prototype.reverse=J,y.prototype.value=et,n.prototype.at=$f,n.prototype.chain=Ja,n.prototype.commit=Xa,n.prototype.next=Qa,n.prototype.plant=es,n.prototype.reverse=ns,n.prototype.toJSON=n.prototype.valueOf=n.prototype.value=rs,n.prototype.first=n.prototype.head,Rl&&(n.prototype[Rl]=ts),n},br=mr();nr._=br,r=function(){return br}.call(e,n,e,i),!(r!==it&&(i.exports=r))}).call(this)}).call(e,function(){return this}(),n(2)(t))},function(t,e){t.exports=function(t){return t.webpackPolyfill||(t.deprecate=function(){},t.paths=[],t.children=[],t.webpackPolyfill=1),t}},function(t,e,n){var r=n(4),i=n(1),o=n(14),a=n(71),s=n(83),u=n(87),c=n(88),l=function(t){this.rules=u.fromRuleMap(t),this.parser=new o,this.inlineConfig=new c};t.exports=l,l.prototype.use=function(t){t.rules&&t.rules.forEach(function(t){this.rules.addRule(t)}.bind(this))},l.prototype.lint=function(t){var e=l.getOptions(arguments),n=a.shred(t),o=this.parser.parse(t),s=null,u=e.maxerr||0===e.maxerr?e.maxerr:1/0;return this.setupSubscriptions(),this.setupInlineConfigs(o),s=this.lintByLine(n,e),s=s.concat(this.lintDom(o,e)),s=s.concat(this.resetRules(e)),this.inlineConfig.clear(),u>=0&&(s=i.take(s,u)),r.all(s).then(function(t){return i.flattenDeep(t)})},l.prototype.lint=r.nodeify(l.prototype.lint),l.getOptions=function(t){var e=Array.prototype.slice.call(t,1);return e=i.flattenDeep(e),e.unshift("default"),s.flattenOpts(e)},l.prototype.setupSubscriptions=function(){this.rules.forEach(function(t){t.subscribers=this.rules.getSubscribers(t.name)}.bind(this))},l.prototype.lintByLine=function(t,e){return this.rules.getRule("line").lint(t,e,this.inlineConfig)},l.prototype.lintDom=function(t,e){return this.rules.getRule("dom").lint(t,e,this.inlineConfig)},l.prototype.resetRules=function(t){var e=[];return this.rules.forEach(function(n){if(n.end){var r=n.end(t);r&&e.push(r)}}),i.flattenDeep(e)},l.prototype.setupInlineConfigs=function(t){var e=[],n=function(t){"comment"===t.type&&(e.push(t),this.inlineConfig.feedComment(t)),t.children&&t.children.length>0&&t.children.forEach(function(t){n(t)})}.bind(this);t.length&&t.forEach(n)}},function(t,e,n){"use strict";t.exports=n(5)},function(t,e,n){"use strict";t.exports=n(6),n(8),n(9),n(10),n(11),n(13)},function(t,e,n){"use strict";function r(){}function i(t){try{return t.then}catch(t){return _=t,m}}function o(t,e){try{return t(e)}catch(t){return _=t,m}}function a(t,e,n){try{t(e,n)}catch(t){return _=t,m}}function s(t){if("object"!=typeof this)throw new TypeError("Promises must be constructed via new");if("function"!=typeof t)throw new TypeError("not a function");this._45=0,this._81=0,this._65=null,this._54=null,t!==r&&g(t,this)}function u(t,e,n){return new t.constructor(function(i,o){var a=new s(r);a.then(i,o),c(t,new d(e,n,a))})}function c(t,e){for(;3===t._81;)t=t._65;return s._10&&s._10(t),0===t._81?0===t._45?(t._45=1,void(t._54=e)):1===t._45?(t._45=2,void(t._54=[t._54,e])):void t._54.push(e):void l(t,e)}function l(t,e){v(function(){var n=1===t._81?e.onFulfilled:e.onRejected;if(null===n)return void(1===t._81?f(e.promise,t._65):h(e.promise,t._65));var r=o(n,t._65);r===m?h(e.promise,_):f(e.promise,r)})}function f(t,e){if(e===t)return h(t,new TypeError("A promise cannot be resolved with itself."));if(e&&("object"==typeof e||"function"==typeof e)){var n=i(e);if(n===m)return h(t,_);if(n===t.then&&e instanceof s)return t._81=3,t._65=e,void p(t);if("function"==typeof n)return void g(n.bind(e),t)}t._81=1,t._65=e,p(t)}function h(t,e){t._81=2,t._65=e,s._97&&s._97(t,e),p(t)}function p(t){if(1===t._45&&(c(t,t._54),t._54=null),2===t._45){for(var e=0;e<t._54.length;e++)c(t,t._54[e]);t._54=null}}function d(t,e,n){this.onFulfilled="function"==typeof t?t:null,this.onRejected="function"==typeof e?e:null,this.promise=n}function g(t,e){var n=!1,r=a(t,function(t){n||(n=!0,f(e,t))},function(t){n||(n=!0,h(e,t))});n||r!==m||(n=!0,h(e,_))}var v=n(7),_=null,m={};t.exports=s,s._10=null,s._97=null,s._61=r,s.prototype.then=function(t,e){if(this.constructor!==s)return u(this,t,e);var n=new s(r);return c(this,new d(t,e,n)),n}},function(t,e){(function(e){"use strict";function n(t){s.length||(a(),u=!0),s[s.length]=t}function r(){for(;c<s.length;){var t=c;if(c+=1,s[t].call(),c>l){for(var e=0,n=s.length-c;e<n;e++)s[e]=s[e+c];s.length-=c,c=0}}s.length=0,c=0,u=!1}function i(t){var e=1,n=new h(t),r=document.createTextNode("");return n.observe(r,{characterData:!0}),function(){e=-e,r.data=e}}function o(t){return function(){function e(){clearTimeout(n),clearInterval(r),t()}var n=setTimeout(e,0),r=setInterval(e,50)}}t.exports=n;var a,s=[],u=!1,c=0,l=1024,f="undefined"!=typeof e?e:self,h=f.MutationObserver||f.WebKitMutationObserver;a="function"==typeof h?i(r):o(r),n.requestFlush=a,n.makeRequestCallFromTimer=o}).call(e,function(){return this}())},function(t,e,n){"use strict";var r=n(6);t.exports=r,r.prototype.done=function(t,e){var n=arguments.length?this.then.apply(this,arguments):this;n.then(null,function(t){setTimeout(function(){throw t},0)})}},function(t,e,n){"use strict";var r=n(6);t.exports=r,r.prototype.finally=function(t){return this.then(function(e){return r.resolve(t()).then(function(){return e})},function(e){return r.resolve(t()).then(function(){throw e})})}},function(t,e,n){"use strict";function r(t){var e=new i(i._61);return e._81=1,e._65=t,e}var i=n(6);t.exports=i;var o=r(!0),a=r(!1),s=r(null),u=r(void 0),c=r(0),l=r("");i.resolve=function(t){if(t instanceof i)return t;if(null===t)return s;if(void 0===t)return u;if(t===!0)return o;if(t===!1)return a;if(0===t)return c;if(""===t)return l;if("object"==typeof t||"function"==typeof t)try{var e=t.then;if("function"==typeof e)return new i(e.bind(t))}catch(t){return new i(function(e,n){n(t)})}return r(t)},i.all=function(t){var e=Array.prototype.slice.call(t);return new i(function(t,n){function r(a,s){if(s&&("object"==typeof s||"function"==typeof s)){if(s instanceof i&&s.then===i.prototype.then){for(;3===s._81;)s=s._65;return 1===s._81?r(a,s._65):(2===s._81&&n(s._65),void s.then(function(t){r(a,t)},n))}var u=s.then;if("function"==typeof u){var c=new i(u.bind(s));return void c.then(function(t){r(a,t)},n)}}e[a]=s,0===--o&&t(e)}if(0===e.length)return t([]);for(var o=e.length,a=0;a<e.length;a++)r(a,e[a])})},i.reject=function(t){return new i(function(e,n){n(t)})},i.race=function(t){return new i(function(e,n){t.forEach(function(t){i.resolve(t).then(e,n)})})},i.prototype.catch=function(t){return this.then(null,t)}},function(t,e,n){"use strict";function r(t,e){for(var n=[],r=0;r<e;r++)n.push("a"+r);var i=["return function ("+n.join(",")+") {","var self = this;","return new Promise(function (rs, rj) {","var res = fn.call(",["self"].concat(n).concat([s]).join(","),");","if (res &&",'(typeof res === "object" || typeof res === "function") &&','typeof res.then === "function"',") {rs(res);}","});","};"].join("");return Function(["Promise","fn"],i)(o,t)}function i(t){for(var e=Math.max(t.length-1,3),n=[],r=0;r<e;r++)n.push("a"+r);var i=["return function ("+n.join(",")+") {","var self = this;","var args;","var argLength = arguments.length;","if (arguments.length > "+e+") {","args = new Array(arguments.length + 1);","for (var i = 0; i < arguments.length; i++) {","args[i] = arguments[i];","}","}","return new Promise(function (rs, rj) {","var cb = "+s+";","var res;","switch (argLength) {",n.concat(["extra"]).map(function(t,e){return"case "+e+":res = fn.call("+["self"].concat(n.slice(0,e)).concat("cb").join(",")+");break;"}).join(""),"default:","args[argLength] = cb;","res = fn.apply(self, args);","}","if (res &&",'(typeof res === "object" || typeof res === "function") &&','typeof res.then === "function"',") {rs(res);}","});","};"].join("");return Function(["Promise","fn"],i)(o,t)}var o=n(6),a=n(12);t.exports=o,o.denodeify=function(t,e){return"number"==typeof e&&e!==1/0?r(t,e):i(t)};var s="function (err, res) {if (err) { rj(err); } else { rs(res); }}";o.nodeify=function(t){return function(){var e=Array.prototype.slice.call(arguments),n="function"==typeof e[e.length-1]?e.pop():null,r=this;try{return t.apply(this,arguments).nodeify(n,r)}catch(t){if(null===n||"undefined"==typeof n)return new o(function(e,n){n(t)});a(function(){n.call(r,t)})}}},o.prototype.nodeify=function(t,e){return"function"!=typeof t?this:void this.then(function(n){a(function(){t.call(e,null,n)})},function(n){a(function(){t.call(e,n)})})}},function(t,e,n){"use strict";function r(){if(u.length)throw u.shift()}function i(t){var e;e=s.length?s.pop():new o,e.task=t,a(e)}function o(){this.task=null}var a=n(7),s=[],u=[],c=a.makeRequestCallFromTimer(r);t.exports=i,o.prototype.call=function(){try{this.task.call()}catch(t){i.onerror?i.onerror(t):(u.push(t),c())}finally{this.task=null,s[s.length]=this}}},function(t,e,n){"use strict";var r=n(6);t.exports=r,r.enableSynchronous=function(){r.prototype.isPending=function(){return 0==this.getState()},r.prototype.isFulfilled=function(){return 1==this.getState()},r.prototype.isRejected=function(){return 2==this.getState()},r.prototype.getValue=function(){if(3===this._81)return this._65.getValue();if(!this.isFulfilled())throw new Error("Cannot get a value of an unfulfilled promise.");return this._65},r.prototype.getReason=function(){if(3===this._81)return this._65.getReason();if(!this.isRejected())throw new Error("Cannot get a rejection reason of a non-rejected promise.");return this._65},r.prototype.getState=function(){return 3===this._81?this._65.getState():this._81===-1||this._81===-2?0:this._81}},r.disableSynchronous=function(){r.prototype.isPending=void 0,r.prototype.isFulfilled=void 0,r.prototype.isRejected=void 0,r.prototype.getValue=void 0,r.prototype.getReason=void 0,r.prototype.getState=void 0}},function(t,e,n){var r=n(15),i=n(67),o=n(71),a=function(){this.domBuilder=new i,this.parser=new r.Parser(this.domBuilder,{decodeEntities:!1,lowerCaseAttributeNames:!1,lowerCaseTags:!1,recognizeCDATA:!1,recognizeSelfClosing:!1,xmlNode:!1}),this.domBuilder.initialize(this.parser)};t.exports=a,a.prototype.parse=function(t){var e=null;return this.domBuilder.htmlText=t,this.domBuilder.lineColFunc=o.getLineColFunc(t),this.parser.write(t),this.parser.end(),this.parser.startIndex=0,this.parser.endIndex=-1,e=this.domBuilder.dom,this.parser.reset(),e}},function(t,e,n){function r(e,n){return delete t.exports[e],t.exports[e]=n,n}var i=n(16),o=n(25);t.exports={Parser:i,Tokenizer:n(17),ElementType:n(26),DomHandler:o,get FeedHandler(){return r("FeedHandler",n(29))},get Stream(){return r("Stream",n(30))},get WritableStream(){return r("WritableStream",n(31))},get ProxyHandler(){return r("ProxyHandler",n(53))},get DomUtils(){return r("DomUtils",n(54))},get CollectingHandler(){return r("CollectingHandler",n(66))},DefaultHandler:o,get RssHandler(){return r("RssHandler",this.FeedHandler)},parseDOM:function(t,e){var n=new o(e);return new i(n,e).end(t),n.dom},parseFeed:function(e,n){var r=new t.exports.FeedHandler(n);return new i(r,n).end(e),r.dom},createDomStream:function(t,e,n){var r=new o(t,e,n);return new i(r,e)},EVENTS:{attribute:2,cdatastart:0,cdataend:0,text:1,processinginstruction:2,comment:1,commentend:0,closetag:1,opentag:2,opentagname:1,error:1,end:0}}},function(t,e,n){function r(t,e){this._options=e||{},this._cbs=t||{},this._tagname="",this._attribname="",this._attribvalue="",this._attribs=null,this._stack=[],this.startIndex=0,this.endIndex=null,this._lowerCaseTagNames="lowerCaseTags"in this._options?!!this._options.lowerCaseTags:!this._options.xmlMode,this._lowerCaseAttributeNames="lowerCaseAttributeNames"in this._options?!!this._options.lowerCaseAttributeNames:!this._options.xmlMode,this._options.Tokenizer&&(i=this._options.Tokenizer),this._tokenizer=new i(this._options,this),this._cbs.onparserinit&&this._cbs.onparserinit(this)}var i=n(17),o={input:!0,option:!0,optgroup:!0,select:!0,button:!0,datalist:!0,textarea:!0},a={tr:{tr:!0,th:!0,td:!0},th:{th:!0},td:{thead:!0,th:!0,td:!0},body:{head:!0,link:!0,script:!0},li:{li:!0},p:{p:!0},h1:{p:!0},h2:{p:!0},h3:{p:!0},h4:{p:!0},h5:{p:!0},h6:{p:!0},select:o,input:o,output:o,button:o,datalist:o,textarea:o,option:{option:!0},optgroup:{optgroup:!0}},s={__proto__:null,area:!0,base:!0,basefont:!0,br:!0,col:!0,command:!0,embed:!0,frame:!0,hr:!0,img:!0,input:!0,isindex:!0,keygen:!0,link:!0,meta:!0,param:!0,source:!0,track:!0,wbr:!0,path:!0,circle:!0,ellipse:!0,line:!0,rect:!0,use:!0,stop:!0,polyline:!0,polygon:!0},u=/\s|\//;n(23)(r,n(24).EventEmitter),r.prototype._updatePosition=function(t){null===this.endIndex?this._tokenizer._sectionStart<=t?this.startIndex=0:this.startIndex=this._tokenizer._sectionStart-t:this.startIndex=this.endIndex+1,this.endIndex=this._tokenizer.getAbsoluteIndex()},r.prototype.ontext=function(t){this._updatePosition(1),this.endIndex--,this._cbs.ontext&&this._cbs.ontext(t)},r.prototype.onopentagname=function(t){if(this._lowerCaseTagNames&&(t=t.toLowerCase()),this._tagname=t,!this._options.xmlMode&&t in a)for(var e;(e=this._stack[this._stack.length-1])in a[t];this.onclosetag(e));!this._options.xmlMode&&t in s||this._stack.push(t),this._cbs.onopentagname&&this._cbs.onopentagname(t),this._cbs.onopentag&&(this._attribs={})},r.prototype.onopentagend=function(){this._updatePosition(1),this._attribs&&(this._cbs.onopentag&&this._cbs.onopentag(this._tagname,this._attribs),this._attribs=null),!this._options.xmlMode&&this._cbs.onclosetag&&this._tagname in s&&this._cbs.onclosetag(this._tagname),this._tagname=""},r.prototype.onclosetag=function(t){if(this._updatePosition(1),this._lowerCaseTagNames&&(t=t.toLowerCase()),!this._stack.length||t in s&&!this._options.xmlMode)this._options.xmlMode||"br"!==t&&"p"!==t||(this.onopentagname(t),this._closeCurrentTag());else{var e=this._stack.lastIndexOf(t);if(e!==-1)if(this._cbs.onclosetag)for(e=this._stack.length-e;e--;)this._cbs.onclosetag(this._stack.pop());else this._stack.length=e;else"p"!==t||this._options.xmlMode||(this.onopentagname(t),this._closeCurrentTag())}},r.prototype.onselfclosingtag=function(){this._options.xmlMode||this._options.recognizeSelfClosing?this._closeCurrentTag():this.onopentagend()},r.prototype._closeCurrentTag=function(){var t=this._tagname;this.onopentagend(),this._stack[this._stack.length-1]===t&&(this._cbs.onclosetag&&this._cbs.onclosetag(t),this._stack.pop())},r.prototype.onattribname=function(t){this._lowerCaseAttributeNames&&(t=t.toLowerCase()),this._attribname=t},r.prototype.onattribdata=function(t){this._attribvalue+=t},r.prototype.onattribend=function(){this._cbs.onattribute&&this._cbs.onattribute(this._attribname,this._attribvalue),this._attribs&&!Object.prototype.hasOwnProperty.call(this._attribs,this._attribname)&&(this._attribs[this._attribname]=this._attribvalue),this._attribname="",this._attribvalue=""},r.prototype._getInstructionName=function(t){var e=t.search(u),n=e<0?t:t.substr(0,e);return this._lowerCaseTagNames&&(n=n.toLowerCase()),n},r.prototype.ondeclaration=function(t){if(this._cbs.onprocessinginstruction){var e=this._getInstructionName(t);this._cbs.onprocessinginstruction("!"+e,"!"+t)}},r.prototype.onprocessinginstruction=function(t){if(this._cbs.onprocessinginstruction){var e=this._getInstructionName(t);this._cbs.onprocessinginstruction("?"+e,"?"+t)}},r.prototype.oncomment=function(t){this._updatePosition(4),this._cbs.oncomment&&this._cbs.oncomment(t),this._cbs.oncommentend&&this._cbs.oncommentend()},r.prototype.oncdata=function(t){this._updatePosition(1),this._options.xmlMode||this._options.recognizeCDATA?(this._cbs.oncdatastart&&this._cbs.oncdatastart(),this._cbs.ontext&&this._cbs.ontext(t),this._cbs.oncdataend&&this._cbs.oncdataend()):this.oncomment("[CDATA["+t+"]]")},r.prototype.onerror=function(t){this._cbs.onerror&&this._cbs.onerror(t)},r.prototype.onend=function(){if(this._cbs.onclosetag)for(var t=this._stack.length;t>0;this._cbs.onclosetag(this._stack[--t]));this._cbs.onend&&this._cbs.onend()},r.prototype.reset=function(){this._cbs.onreset&&this._cbs.onreset(),this._tokenizer.reset(),this._tagname="",this._attribname="",this._attribs=null,this._stack=[],this._cbs.onparserinit&&this._cbs.onparserinit(this)},r.prototype.parseComplete=function(t){this.reset(),this.end(t)},r.prototype.write=function(t){this._tokenizer.write(t)},r.prototype.end=function(t){this._tokenizer.end(t)},r.prototype.pause=function(){this._tokenizer.pause()},r.prototype.resume=function(){this._tokenizer.resume()},r.prototype.parseChunk=r.prototype.write,r.prototype.done=r.prototype.end,t.exports=r},function(t,e,n){function r(t){return" "===t||"\n"===t||"\t"===t||"\f"===t||"\r"===t}function i(t,e){return function(n){n===t&&(this._state=e)}}function o(t,e,n){var r=t.toLowerCase();return t===r?function(t){t===r?this._state=e:(this._state=n,this._index--)}:function(i){i===r||i===t?this._state=e:(this._state=n,this._index--)}}function a(t,e){var n=t.toLowerCase();return function(r){r===n||r===t?this._state=e:(this._state=g,this._index--)}}function s(t,e){this._state=p,this._buffer="",this._sectionStart=0,this._index=0,this._bufferOffset=0,this._baseState=p,this._special=gt,this._cbs=e,this._running=!0,this._ended=!1,this._xmlMode=!(!t||!t.xmlMode),this._decodeEntities=!(!t||!t.decodeEntities)}t.exports=s;var u=n(18),c=n(20),l=n(21),f=n(22),h=0,p=h++,d=h++,g=h++,v=h++,_=h++,m=h++,b=h++,y=h++,w=h++,x=h++,E=h++,S=h++,A=h++,L=h++,k=h++,T=h++,C=h++,R=h++,O=h++,D=h++,q=h++,I=h++,B=h++,j=h++,N=h++,M=h++,P=h++,U=h++,z=h++,F=h++,V=h++,H=h++,G=h++,W=h++,Y=h++,$=h++,Z=h++,K=h++,J=h++,X=h++,Q=h++,tt=h++,et=h++,nt=h++,rt=h++,it=h++,ot=h++,at=h++,st=h++,ut=h++,ct=h++,lt=h++,ft=h++,ht=h++,pt=h++,dt=0,gt=dt++,vt=dt++,_t=dt++;s.prototype._stateText=function(t){"<"===t?(this._index>this._sectionStart&&this._cbs.ontext(this._getSection()),this._state=d,this._sectionStart=this._index):this._decodeEntities&&this._special===gt&&"&"===t&&(this._index>this._sectionStart&&this._cbs.ontext(this._getSection()),this._baseState=p,this._state=ct,this._sectionStart=this._index)},s.prototype._stateBeforeTagName=function(t){"/"===t?this._state=_:"<"===t?(this._cbs.ontext(this._getSection()),this._sectionStart=this._index):">"===t||this._special!==gt||r(t)?this._state=p:"!"===t?(this._state=k,this._sectionStart=this._index+1):"?"===t?(this._state=C,this._sectionStart=this._index+1):(this._state=this._xmlMode||"s"!==t&&"S"!==t?g:V,this._sectionStart=this._index)},s.prototype._stateInTagName=function(t){("/"===t||">"===t||r(t))&&(this._emitToken("onopentagname"),this._state=y,this._index--)},s.prototype._stateBeforeCloseingTagName=function(t){r(t)||(">"===t?this._state=p:this._special!==gt?"s"===t||"S"===t?this._state=H:(this._state=p,this._index--):(this._state=m,this._sectionStart=this._index))},s.prototype._stateInCloseingTagName=function(t){(">"===t||r(t))&&(this._emitToken("onclosetag"),this._state=b,this._index--)},s.prototype._stateAfterCloseingTagName=function(t){">"===t&&(this._state=p,this._sectionStart=this._index+1)},s.prototype._stateBeforeAttributeName=function(t){">"===t?(this._cbs.onopentagend(),this._state=p,this._sectionStart=this._index+1):"/"===t?this._state=v:r(t)||(this._state=w,this._sectionStart=this._index)},s.prototype._stateInSelfClosingTag=function(t){">"===t?(this._cbs.onselfclosingtag(),this._state=p,this._sectionStart=this._index+1):r(t)||(this._state=y,this._index--)},s.prototype._stateInAttributeName=function(t){("="===t||"/"===t||">"===t||r(t))&&(this._cbs.onattribname(this._getSection()),this._sectionStart=-1,this._state=x,this._index--)},s.prototype._stateAfterAttributeName=function(t){"="===t?this._state=E:"/"===t||">"===t?(this._cbs.onattribend(),this._state=y,this._index--):r(t)||(this._cbs.onattribend(),this._state=w,this._sectionStart=this._index)},s.prototype._stateBeforeAttributeValue=function(t){'"'===t?(this._state=S,this._sectionStart=this._index+1):"'"===t?(this._state=A,this._sectionStart=this._index+1):r(t)||(this._state=L,this._sectionStart=this._index,this._index--)},s.prototype._stateInAttributeValueDoubleQuotes=function(t){'"'===t?(this._emitToken("onattribdata"),this._cbs.onattribend(),this._state=y):this._decodeEntities&&"&"===t&&(this._emitToken("onattribdata"),this._baseState=this._state,this._state=ct,this._sectionStart=this._index)},s.prototype._stateInAttributeValueSingleQuotes=function(t){"'"===t?(this._emitToken("onattribdata"),this._cbs.onattribend(),this._state=y):this._decodeEntities&&"&"===t&&(this._emitToken("onattribdata"),this._baseState=this._state,this._state=ct,this._sectionStart=this._index)},s.prototype._stateInAttributeValueNoQuotes=function(t){r(t)||">"===t?(this._emitToken("onattribdata"),this._cbs.onattribend(),this._state=y,this._index--):this._decodeEntities&&"&"===t&&(this._emitToken("onattribdata"),this._baseState=this._state,this._state=ct,this._sectionStart=this._index)},s.prototype._stateBeforeDeclaration=function(t){this._state="["===t?I:"-"===t?R:T},s.prototype._stateInDeclaration=function(t){">"===t&&(this._cbs.ondeclaration(this._getSection()),this._state=p,this._sectionStart=this._index+1)},s.prototype._stateInProcessingInstruction=function(t){">"===t&&(this._cbs.onprocessinginstruction(this._getSection()),this._state=p,this._sectionStart=this._index+1)},s.prototype._stateBeforeComment=function(t){"-"===t?(this._state=O,this._sectionStart=this._index+1):this._state=T},s.prototype._stateInComment=function(t){"-"===t&&(this._state=D)},s.prototype._stateAfterComment1=function(t){"-"===t?this._state=q:this._state=O},s.prototype._stateAfterComment2=function(t){">"===t?(this._cbs.oncomment(this._buffer.substring(this._sectionStart,this._index-2)),this._state=p,this._sectionStart=this._index+1):"-"!==t&&(this._state=O)},s.prototype._stateBeforeCdata1=o("C",B,T),s.prototype._stateBeforeCdata2=o("D",j,T),s.prototype._stateBeforeCdata3=o("A",N,T),s.prototype._stateBeforeCdata4=o("T",M,T),s.prototype._stateBeforeCdata5=o("A",P,T),s.prototype._stateBeforeCdata6=function(t){"["===t?(this._state=U,this._sectionStart=this._index+1):(this._state=T,this._index--)},s.prototype._stateInCdata=function(t){"]"===t&&(this._state=z)},s.prototype._stateAfterCdata1=i("]",F),s.prototype._stateAfterCdata2=function(t){">"===t?(this._cbs.oncdata(this._buffer.substring(this._sectionStart,this._index-2)),this._state=p,this._sectionStart=this._index+1):"]"!==t&&(this._state=U)},s.prototype._stateBeforeSpecial=function(t){"c"===t||"C"===t?this._state=G:"t"===t||"T"===t?this._state=et:(this._state=g,this._index--)},s.prototype._stateBeforeSpecialEnd=function(t){this._special!==vt||"c"!==t&&"C"!==t?this._special!==_t||"t"!==t&&"T"!==t?this._state=p:this._state=ot:this._state=K},s.prototype._stateBeforeScript1=a("R",W),s.prototype._stateBeforeScript2=a("I",Y),s.prototype._stateBeforeScript3=a("P",$),s.prototype._stateBeforeScript4=a("T",Z),s.prototype._stateBeforeScript5=function(t){("/"===t||">"===t||r(t))&&(this._special=vt),this._state=g,this._index--},s.prototype._stateAfterScript1=o("R",J,p),s.prototype._stateAfterScript2=o("I",X,p),s.prototype._stateAfterScript3=o("P",Q,p),s.prototype._stateAfterScript4=o("T",tt,p),s.prototype._stateAfterScript5=function(t){">"===t||r(t)?(this._special=gt,this._state=m,this._sectionStart=this._index-6,this._index--):this._state=p},s.prototype._stateBeforeStyle1=a("Y",nt),s.prototype._stateBeforeStyle2=a("L",rt),s.prototype._stateBeforeStyle3=a("E",it),s.prototype._stateBeforeStyle4=function(t){("/"===t||">"===t||r(t))&&(this._special=_t),this._state=g,this._index--},s.prototype._stateAfterStyle1=o("Y",at,p),s.prototype._stateAfterStyle2=o("L",st,p),s.prototype._stateAfterStyle3=o("E",ut,p),s.prototype._stateAfterStyle4=function(t){">"===t||r(t)?(this._special=gt,this._state=m,this._sectionStart=this._index-5,this._index--):this._state=p},s.prototype._stateBeforeEntity=o("#",lt,ft),s.prototype._stateBeforeNumericEntity=o("X",pt,ht),s.prototype._parseNamedEntityStrict=function(){if(this._sectionStart+1<this._index){var t=this._buffer.substring(this._sectionStart+1,this._index),e=this._xmlMode?f:c;e.hasOwnProperty(t)&&(this._emitPartial(e[t]),this._sectionStart=this._index+1)}},s.prototype._parseLegacyEntity=function(){var t=this._sectionStart+1,e=this._index-t;for(e>6&&(e=6);e>=2;){var n=this._buffer.substr(t,e);if(l.hasOwnProperty(n))return this._emitPartial(l[n]),void(this._sectionStart+=e+1);e--}},s.prototype._stateInNamedEntity=function(t){";"===t?(this._parseNamedEntityStrict(),this._sectionStart+1<this._index&&!this._xmlMode&&this._parseLegacyEntity(),this._state=this._baseState):(t<"a"||t>"z")&&(t<"A"||t>"Z")&&(t<"0"||t>"9")&&(this._xmlMode||this._sectionStart+1===this._index||(this._baseState!==p?"="!==t&&this._parseNamedEntityStrict():this._parseLegacyEntity()),this._state=this._baseState,this._index--)},s.prototype._decodeNumericEntity=function(t,e){var n=this._sectionStart+t;if(n!==this._index){var r=this._buffer.substring(n,this._index),i=parseInt(r,e);this._emitPartial(u(i)),this._sectionStart=this._index}else this._sectionStart--;this._state=this._baseState},s.prototype._stateInNumericEntity=function(t){";"===t?(this._decodeNumericEntity(2,10),this._sectionStart++):(t<"0"||t>"9")&&(this._xmlMode?this._state=this._baseState:this._decodeNumericEntity(2,10),
this._index--)},s.prototype._stateInHexEntity=function(t){";"===t?(this._decodeNumericEntity(3,16),this._sectionStart++):(t<"a"||t>"f")&&(t<"A"||t>"F")&&(t<"0"||t>"9")&&(this._xmlMode?this._state=this._baseState:this._decodeNumericEntity(3,16),this._index--)},s.prototype._cleanup=function(){this._sectionStart<0?(this._buffer="",this._bufferOffset+=this._index,this._index=0):this._running&&(this._state===p?(this._sectionStart!==this._index&&this._cbs.ontext(this._buffer.substr(this._sectionStart)),this._buffer="",this._bufferOffset+=this._index,this._index=0):this._sectionStart===this._index?(this._buffer="",this._bufferOffset+=this._index,this._index=0):(this._buffer=this._buffer.substr(this._sectionStart),this._index-=this._sectionStart,this._bufferOffset+=this._sectionStart),this._sectionStart=0)},s.prototype.write=function(t){this._ended&&this._cbs.onerror(Error(".write() after done!")),this._buffer+=t,this._parse()},s.prototype._parse=function(){for(;this._index<this._buffer.length&&this._running;){var t=this._buffer.charAt(this._index);this._state===p?this._stateText(t):this._state===d?this._stateBeforeTagName(t):this._state===g?this._stateInTagName(t):this._state===_?this._stateBeforeCloseingTagName(t):this._state===m?this._stateInCloseingTagName(t):this._state===b?this._stateAfterCloseingTagName(t):this._state===v?this._stateInSelfClosingTag(t):this._state===y?this._stateBeforeAttributeName(t):this._state===w?this._stateInAttributeName(t):this._state===x?this._stateAfterAttributeName(t):this._state===E?this._stateBeforeAttributeValue(t):this._state===S?this._stateInAttributeValueDoubleQuotes(t):this._state===A?this._stateInAttributeValueSingleQuotes(t):this._state===L?this._stateInAttributeValueNoQuotes(t):this._state===k?this._stateBeforeDeclaration(t):this._state===T?this._stateInDeclaration(t):this._state===C?this._stateInProcessingInstruction(t):this._state===R?this._stateBeforeComment(t):this._state===O?this._stateInComment(t):this._state===D?this._stateAfterComment1(t):this._state===q?this._stateAfterComment2(t):this._state===I?this._stateBeforeCdata1(t):this._state===B?this._stateBeforeCdata2(t):this._state===j?this._stateBeforeCdata3(t):this._state===N?this._stateBeforeCdata4(t):this._state===M?this._stateBeforeCdata5(t):this._state===P?this._stateBeforeCdata6(t):this._state===U?this._stateInCdata(t):this._state===z?this._stateAfterCdata1(t):this._state===F?this._stateAfterCdata2(t):this._state===V?this._stateBeforeSpecial(t):this._state===H?this._stateBeforeSpecialEnd(t):this._state===G?this._stateBeforeScript1(t):this._state===W?this._stateBeforeScript2(t):this._state===Y?this._stateBeforeScript3(t):this._state===$?this._stateBeforeScript4(t):this._state===Z?this._stateBeforeScript5(t):this._state===K?this._stateAfterScript1(t):this._state===J?this._stateAfterScript2(t):this._state===X?this._stateAfterScript3(t):this._state===Q?this._stateAfterScript4(t):this._state===tt?this._stateAfterScript5(t):this._state===et?this._stateBeforeStyle1(t):this._state===nt?this._stateBeforeStyle2(t):this._state===rt?this._stateBeforeStyle3(t):this._state===it?this._stateBeforeStyle4(t):this._state===ot?this._stateAfterStyle1(t):this._state===at?this._stateAfterStyle2(t):this._state===st?this._stateAfterStyle3(t):this._state===ut?this._stateAfterStyle4(t):this._state===ct?this._stateBeforeEntity(t):this._state===lt?this._stateBeforeNumericEntity(t):this._state===ft?this._stateInNamedEntity(t):this._state===ht?this._stateInNumericEntity(t):this._state===pt?this._stateInHexEntity(t):this._cbs.onerror(Error("unknown _state"),this._state),this._index++}this._cleanup()},s.prototype.pause=function(){this._running=!1},s.prototype.resume=function(){this._running=!0,this._index<this._buffer.length&&this._parse(),this._ended&&this._finish()},s.prototype.end=function(t){this._ended&&this._cbs.onerror(Error(".end() after done!")),t&&this.write(t),this._ended=!0,this._running&&this._finish()},s.prototype._finish=function(){this._sectionStart<this._index&&this._handleTrailingData(),this._cbs.onend()},s.prototype._handleTrailingData=function(){var t=this._buffer.substr(this._sectionStart);this._state===U||this._state===z||this._state===F?this._cbs.oncdata(t):this._state===O||this._state===D||this._state===q?this._cbs.oncomment(t):this._state!==ft||this._xmlMode?this._state!==ht||this._xmlMode?this._state!==pt||this._xmlMode?this._state!==g&&this._state!==y&&this._state!==E&&this._state!==x&&this._state!==w&&this._state!==A&&this._state!==S&&this._state!==L&&this._state!==m&&this._cbs.ontext(t):(this._decodeNumericEntity(3,16),this._sectionStart<this._index&&(this._state=this._baseState,this._handleTrailingData())):(this._decodeNumericEntity(2,10),this._sectionStart<this._index&&(this._state=this._baseState,this._handleTrailingData())):(this._parseLegacyEntity(),this._sectionStart<this._index&&(this._state=this._baseState,this._handleTrailingData()))},s.prototype.reset=function(){s.call(this,{xmlMode:this._xmlMode,decodeEntities:this._decodeEntities},this._cbs)},s.prototype.getAbsoluteIndex=function(){return this._bufferOffset+this._index},s.prototype._getSection=function(){return this._buffer.substring(this._sectionStart,this._index)},s.prototype._emitToken=function(t){this._cbs[t](this._getSection()),this._sectionStart=-1},s.prototype._emitPartial=function(t){this._baseState!==p?this._cbs.onattribdata(t):this._cbs.ontext(t)}},function(t,e,n){function r(t){if(t>=55296&&t<=57343||t>1114111)return"�";t in i&&(t=i[t]);var e="";return t>65535&&(t-=65536,e+=String.fromCharCode(t>>>10&1023|55296),t=56320|1023&t),e+=String.fromCharCode(t)}var i=n(19);t.exports=r},function(t,e){t.exports={0:65533,128:8364,130:8218,131:402,132:8222,133:8230,134:8224,135:8225,136:710,137:8240,138:352,139:8249,140:338,142:381,145:8216,146:8217,147:8220,148:8221,149:8226,150:8211,151:8212,152:732,153:8482,154:353,155:8250,156:339,158:382,159:376}},function(t,e){t.exports={Aacute:"Á",aacute:"á",Abreve:"Ă",abreve:"ă",ac:"∾",acd:"∿",acE:"∾̳",Acirc:"Â",acirc:"â",acute:"´",Acy:"А",acy:"а",AElig:"Æ",aelig:"æ",af:"⁡",Afr:"𝔄",afr:"𝔞",Agrave:"À",agrave:"à",alefsym:"ℵ",aleph:"ℵ",Alpha:"Α",alpha:"α",Amacr:"Ā",amacr:"ā",amalg:"⨿",amp:"&",AMP:"&",andand:"⩕",And:"⩓",and:"∧",andd:"⩜",andslope:"⩘",andv:"⩚",ang:"∠",ange:"⦤",angle:"∠",angmsdaa:"⦨",angmsdab:"⦩",angmsdac:"⦪",angmsdad:"⦫",angmsdae:"⦬",angmsdaf:"⦭",angmsdag:"⦮",angmsdah:"⦯",angmsd:"∡",angrt:"∟",angrtvb:"⊾",angrtvbd:"⦝",angsph:"∢",angst:"Å",angzarr:"⍼",Aogon:"Ą",aogon:"ą",Aopf:"𝔸",aopf:"𝕒",apacir:"⩯",ap:"≈",apE:"⩰",ape:"≊",apid:"≋",apos:"'",ApplyFunction:"⁡",approx:"≈",approxeq:"≊",Aring:"Å",aring:"å",Ascr:"𝒜",ascr:"𝒶",Assign:"≔",ast:"*",asymp:"≈",asympeq:"≍",Atilde:"Ã",atilde:"ã",Auml:"Ä",auml:"ä",awconint:"∳",awint:"⨑",backcong:"≌",backepsilon:"϶",backprime:"‵",backsim:"∽",backsimeq:"⋍",Backslash:"∖",Barv:"⫧",barvee:"⊽",barwed:"⌅",Barwed:"⌆",barwedge:"⌅",bbrk:"⎵",bbrktbrk:"⎶",bcong:"≌",Bcy:"Б",bcy:"б",bdquo:"„",becaus:"∵",because:"∵",Because:"∵",bemptyv:"⦰",bepsi:"϶",bernou:"ℬ",Bernoullis:"ℬ",Beta:"Β",beta:"β",beth:"ℶ",between:"≬",Bfr:"𝔅",bfr:"𝔟",bigcap:"⋂",bigcirc:"◯",bigcup:"⋃",bigodot:"⨀",bigoplus:"⨁",bigotimes:"⨂",bigsqcup:"⨆",bigstar:"★",bigtriangledown:"▽",bigtriangleup:"△",biguplus:"⨄",bigvee:"⋁",bigwedge:"⋀",bkarow:"⤍",blacklozenge:"⧫",blacksquare:"▪",blacktriangle:"▴",blacktriangledown:"▾",blacktriangleleft:"◂",blacktriangleright:"▸",blank:"␣",blk12:"▒",blk14:"░",blk34:"▓",block:"█",bne:"=⃥",bnequiv:"≡⃥",bNot:"⫭",bnot:"⌐",Bopf:"𝔹",bopf:"𝕓",bot:"⊥",bottom:"⊥",bowtie:"⋈",boxbox:"⧉",boxdl:"┐",boxdL:"╕",boxDl:"╖",boxDL:"╗",boxdr:"┌",boxdR:"╒",boxDr:"╓",boxDR:"╔",boxh:"─",boxH:"═",boxhd:"┬",boxHd:"╤",boxhD:"╥",boxHD:"╦",boxhu:"┴",boxHu:"╧",boxhU:"╨",boxHU:"╩",boxminus:"⊟",boxplus:"⊞",boxtimes:"⊠",boxul:"┘",boxuL:"╛",boxUl:"╜",boxUL:"╝",boxur:"└",boxuR:"╘",boxUr:"╙",boxUR:"╚",boxv:"│",boxV:"║",boxvh:"┼",boxvH:"╪",boxVh:"╫",boxVH:"╬",boxvl:"┤",boxvL:"╡",boxVl:"╢",boxVL:"╣",boxvr:"├",boxvR:"╞",boxVr:"╟",boxVR:"╠",bprime:"‵",breve:"˘",Breve:"˘",brvbar:"¦",bscr:"𝒷",Bscr:"ℬ",bsemi:"⁏",bsim:"∽",bsime:"⋍",bsolb:"⧅",bsol:"\\",bsolhsub:"⟈",bull:"•",bullet:"•",bump:"≎",bumpE:"⪮",bumpe:"≏",Bumpeq:"≎",bumpeq:"≏",Cacute:"Ć",cacute:"ć",capand:"⩄",capbrcup:"⩉",capcap:"⩋",cap:"∩",Cap:"⋒",capcup:"⩇",capdot:"⩀",CapitalDifferentialD:"ⅅ",caps:"∩︀",caret:"⁁",caron:"ˇ",Cayleys:"ℭ",ccaps:"⩍",Ccaron:"Č",ccaron:"č",Ccedil:"Ç",ccedil:"ç",Ccirc:"Ĉ",ccirc:"ĉ",Cconint:"∰",ccups:"⩌",ccupssm:"⩐",Cdot:"Ċ",cdot:"ċ",cedil:"¸",Cedilla:"¸",cemptyv:"⦲",cent:"¢",centerdot:"·",CenterDot:"·",cfr:"𝔠",Cfr:"ℭ",CHcy:"Ч",chcy:"ч",check:"✓",checkmark:"✓",Chi:"Χ",chi:"χ",circ:"ˆ",circeq:"≗",circlearrowleft:"↺",circlearrowright:"↻",circledast:"⊛",circledcirc:"⊚",circleddash:"⊝",CircleDot:"⊙",circledR:"®",circledS:"Ⓢ",CircleMinus:"⊖",CirclePlus:"⊕",CircleTimes:"⊗",cir:"○",cirE:"⧃",cire:"≗",cirfnint:"⨐",cirmid:"⫯",cirscir:"⧂",ClockwiseContourIntegral:"∲",CloseCurlyDoubleQuote:"”",CloseCurlyQuote:"’",clubs:"♣",clubsuit:"♣",colon:":",Colon:"∷",Colone:"⩴",colone:"≔",coloneq:"≔",comma:",",commat:"@",comp:"∁",compfn:"∘",complement:"∁",complexes:"ℂ",cong:"≅",congdot:"⩭",Congruent:"≡",conint:"∮",Conint:"∯",ContourIntegral:"∮",copf:"𝕔",Copf:"ℂ",coprod:"∐",Coproduct:"∐",copy:"©",COPY:"©",copysr:"℗",CounterClockwiseContourIntegral:"∳",crarr:"↵",cross:"✗",Cross:"⨯",Cscr:"𝒞",cscr:"𝒸",csub:"⫏",csube:"⫑",csup:"⫐",csupe:"⫒",ctdot:"⋯",cudarrl:"⤸",cudarrr:"⤵",cuepr:"⋞",cuesc:"⋟",cularr:"↶",cularrp:"⤽",cupbrcap:"⩈",cupcap:"⩆",CupCap:"≍",cup:"∪",Cup:"⋓",cupcup:"⩊",cupdot:"⊍",cupor:"⩅",cups:"∪︀",curarr:"↷",curarrm:"⤼",curlyeqprec:"⋞",curlyeqsucc:"⋟",curlyvee:"⋎",curlywedge:"⋏",curren:"¤",curvearrowleft:"↶",curvearrowright:"↷",cuvee:"⋎",cuwed:"⋏",cwconint:"∲",cwint:"∱",cylcty:"⌭",dagger:"†",Dagger:"‡",daleth:"ℸ",darr:"↓",Darr:"↡",dArr:"⇓",dash:"‐",Dashv:"⫤",dashv:"⊣",dbkarow:"⤏",dblac:"˝",Dcaron:"Ď",dcaron:"ď",Dcy:"Д",dcy:"д",ddagger:"‡",ddarr:"⇊",DD:"ⅅ",dd:"ⅆ",DDotrahd:"⤑",ddotseq:"⩷",deg:"°",Del:"∇",Delta:"Δ",delta:"δ",demptyv:"⦱",dfisht:"⥿",Dfr:"𝔇",dfr:"𝔡",dHar:"⥥",dharl:"⇃",dharr:"⇂",DiacriticalAcute:"´",DiacriticalDot:"˙",DiacriticalDoubleAcute:"˝",DiacriticalGrave:"`",DiacriticalTilde:"˜",diam:"⋄",diamond:"⋄",Diamond:"⋄",diamondsuit:"♦",diams:"♦",die:"¨",DifferentialD:"ⅆ",digamma:"ϝ",disin:"⋲",div:"÷",divide:"÷",divideontimes:"⋇",divonx:"⋇",DJcy:"Ђ",djcy:"ђ",dlcorn:"⌞",dlcrop:"⌍",dollar:"$",Dopf:"𝔻",dopf:"𝕕",Dot:"¨",dot:"˙",DotDot:"⃜",doteq:"≐",doteqdot:"≑",DotEqual:"≐",dotminus:"∸",dotplus:"∔",dotsquare:"⊡",doublebarwedge:"⌆",DoubleContourIntegral:"∯",DoubleDot:"¨",DoubleDownArrow:"⇓",DoubleLeftArrow:"⇐",DoubleLeftRightArrow:"⇔",DoubleLeftTee:"⫤",DoubleLongLeftArrow:"⟸",DoubleLongLeftRightArrow:"⟺",DoubleLongRightArrow:"⟹",DoubleRightArrow:"⇒",DoubleRightTee:"⊨",DoubleUpArrow:"⇑",DoubleUpDownArrow:"⇕",DoubleVerticalBar:"∥",DownArrowBar:"⤓",downarrow:"↓",DownArrow:"↓",Downarrow:"⇓",DownArrowUpArrow:"⇵",DownBreve:"̑",downdownarrows:"⇊",downharpoonleft:"⇃",downharpoonright:"⇂",DownLeftRightVector:"⥐",DownLeftTeeVector:"⥞",DownLeftVectorBar:"⥖",DownLeftVector:"↽",DownRightTeeVector:"⥟",DownRightVectorBar:"⥗",DownRightVector:"⇁",DownTeeArrow:"↧",DownTee:"⊤",drbkarow:"⤐",drcorn:"⌟",drcrop:"⌌",Dscr:"𝒟",dscr:"𝒹",DScy:"Ѕ",dscy:"ѕ",dsol:"⧶",Dstrok:"Đ",dstrok:"đ",dtdot:"⋱",dtri:"▿",dtrif:"▾",duarr:"⇵",duhar:"⥯",dwangle:"⦦",DZcy:"Џ",dzcy:"џ",dzigrarr:"⟿",Eacute:"É",eacute:"é",easter:"⩮",Ecaron:"Ě",ecaron:"ě",Ecirc:"Ê",ecirc:"ê",ecir:"≖",ecolon:"≕",Ecy:"Э",ecy:"э",eDDot:"⩷",Edot:"Ė",edot:"ė",eDot:"≑",ee:"ⅇ",efDot:"≒",Efr:"𝔈",efr:"𝔢",eg:"⪚",Egrave:"È",egrave:"è",egs:"⪖",egsdot:"⪘",el:"⪙",Element:"∈",elinters:"⏧",ell:"ℓ",els:"⪕",elsdot:"⪗",Emacr:"Ē",emacr:"ē",empty:"∅",emptyset:"∅",EmptySmallSquare:"◻",emptyv:"∅",EmptyVerySmallSquare:"▫",emsp13:" ",emsp14:" ",emsp:" ",ENG:"Ŋ",eng:"ŋ",ensp:" ",Eogon:"Ę",eogon:"ę",Eopf:"𝔼",eopf:"𝕖",epar:"⋕",eparsl:"⧣",eplus:"⩱",epsi:"ε",Epsilon:"Ε",epsilon:"ε",epsiv:"ϵ",eqcirc:"≖",eqcolon:"≕",eqsim:"≂",eqslantgtr:"⪖",eqslantless:"⪕",Equal:"⩵",equals:"=",EqualTilde:"≂",equest:"≟",Equilibrium:"⇌",equiv:"≡",equivDD:"⩸",eqvparsl:"⧥",erarr:"⥱",erDot:"≓",escr:"ℯ",Escr:"ℰ",esdot:"≐",Esim:"⩳",esim:"≂",Eta:"Η",eta:"η",ETH:"Ð",eth:"ð",Euml:"Ë",euml:"ë",euro:"€",excl:"!",exist:"∃",Exists:"∃",expectation:"ℰ",exponentiale:"ⅇ",ExponentialE:"ⅇ",fallingdotseq:"≒",Fcy:"Ф",fcy:"ф",female:"♀",ffilig:"ﬃ",fflig:"ﬀ",ffllig:"ﬄ",Ffr:"𝔉",ffr:"𝔣",filig:"ﬁ",FilledSmallSquare:"◼",FilledVerySmallSquare:"▪",fjlig:"fj",flat:"♭",fllig:"ﬂ",fltns:"▱",fnof:"ƒ",Fopf:"𝔽",fopf:"𝕗",forall:"∀",ForAll:"∀",fork:"⋔",forkv:"⫙",Fouriertrf:"ℱ",fpartint:"⨍",frac12:"½",frac13:"⅓",frac14:"¼",frac15:"⅕",frac16:"⅙",frac18:"⅛",frac23:"⅔",frac25:"⅖",frac34:"¾",frac35:"⅗",frac38:"⅜",frac45:"⅘",frac56:"⅚",frac58:"⅝",frac78:"⅞",frasl:"⁄",frown:"⌢",fscr:"𝒻",Fscr:"ℱ",gacute:"ǵ",Gamma:"Γ",gamma:"γ",Gammad:"Ϝ",gammad:"ϝ",gap:"⪆",Gbreve:"Ğ",gbreve:"ğ",Gcedil:"Ģ",Gcirc:"Ĝ",gcirc:"ĝ",Gcy:"Г",gcy:"г",Gdot:"Ġ",gdot:"ġ",ge:"≥",gE:"≧",gEl:"⪌",gel:"⋛",geq:"≥",geqq:"≧",geqslant:"⩾",gescc:"⪩",ges:"⩾",gesdot:"⪀",gesdoto:"⪂",gesdotol:"⪄",gesl:"⋛︀",gesles:"⪔",Gfr:"𝔊",gfr:"𝔤",gg:"≫",Gg:"⋙",ggg:"⋙",gimel:"ℷ",GJcy:"Ѓ",gjcy:"ѓ",gla:"⪥",gl:"≷",glE:"⪒",glj:"⪤",gnap:"⪊",gnapprox:"⪊",gne:"⪈",gnE:"≩",gneq:"⪈",gneqq:"≩",gnsim:"⋧",Gopf:"𝔾",gopf:"𝕘",grave:"`",GreaterEqual:"≥",GreaterEqualLess:"⋛",GreaterFullEqual:"≧",GreaterGreater:"⪢",GreaterLess:"≷",GreaterSlantEqual:"⩾",GreaterTilde:"≳",Gscr:"𝒢",gscr:"ℊ",gsim:"≳",gsime:"⪎",gsiml:"⪐",gtcc:"⪧",gtcir:"⩺",gt:">",GT:">",Gt:"≫",gtdot:"⋗",gtlPar:"⦕",gtquest:"⩼",gtrapprox:"⪆",gtrarr:"⥸",gtrdot:"⋗",gtreqless:"⋛",gtreqqless:"⪌",gtrless:"≷",gtrsim:"≳",gvertneqq:"≩︀",gvnE:"≩︀",Hacek:"ˇ",hairsp:" ",half:"½",hamilt:"ℋ",HARDcy:"Ъ",hardcy:"ъ",harrcir:"⥈",harr:"↔",hArr:"⇔",harrw:"↭",Hat:"^",hbar:"ℏ",Hcirc:"Ĥ",hcirc:"ĥ",hearts:"♥",heartsuit:"♥",hellip:"…",hercon:"⊹",hfr:"𝔥",Hfr:"ℌ",HilbertSpace:"ℋ",hksearow:"⤥",hkswarow:"⤦",hoarr:"⇿",homtht:"∻",hookleftarrow:"↩",hookrightarrow:"↪",hopf:"𝕙",Hopf:"ℍ",horbar:"―",HorizontalLine:"─",hscr:"𝒽",Hscr:"ℋ",hslash:"ℏ",Hstrok:"Ħ",hstrok:"ħ",HumpDownHump:"≎",HumpEqual:"≏",hybull:"⁃",hyphen:"‐",Iacute:"Í",iacute:"í",ic:"⁣",Icirc:"Î",icirc:"î",Icy:"И",icy:"и",Idot:"İ",IEcy:"Е",iecy:"е",iexcl:"¡",iff:"⇔",ifr:"𝔦",Ifr:"ℑ",Igrave:"Ì",igrave:"ì",ii:"ⅈ",iiiint:"⨌",iiint:"∭",iinfin:"⧜",iiota:"℩",IJlig:"Ĳ",ijlig:"ĳ",Imacr:"Ī",imacr:"ī",image:"ℑ",ImaginaryI:"ⅈ",imagline:"ℐ",imagpart:"ℑ",imath:"ı",Im:"ℑ",imof:"⊷",imped:"Ƶ",Implies:"⇒",incare:"℅",in:"∈",infin:"∞",infintie:"⧝",inodot:"ı",intcal:"⊺",int:"∫",Int:"∬",integers:"ℤ",Integral:"∫",intercal:"⊺",Intersection:"⋂",intlarhk:"⨗",intprod:"⨼",InvisibleComma:"⁣",InvisibleTimes:"⁢",IOcy:"Ё",iocy:"ё",Iogon:"Į",iogon:"į",Iopf:"𝕀",iopf:"𝕚",Iota:"Ι",iota:"ι",iprod:"⨼",iquest:"¿",iscr:"𝒾",Iscr:"ℐ",isin:"∈",isindot:"⋵",isinE:"⋹",isins:"⋴",isinsv:"⋳",isinv:"∈",it:"⁢",Itilde:"Ĩ",itilde:"ĩ",Iukcy:"І",iukcy:"і",Iuml:"Ï",iuml:"ï",Jcirc:"Ĵ",jcirc:"ĵ",Jcy:"Й",jcy:"й",Jfr:"𝔍",jfr:"𝔧",jmath:"ȷ",Jopf:"𝕁",jopf:"𝕛",Jscr:"𝒥",jscr:"𝒿",Jsercy:"Ј",jsercy:"ј",Jukcy:"Є",jukcy:"є",Kappa:"Κ",kappa:"κ",kappav:"ϰ",Kcedil:"Ķ",kcedil:"ķ",Kcy:"К",kcy:"к",Kfr:"𝔎",kfr:"𝔨",kgreen:"ĸ",KHcy:"Х",khcy:"х",KJcy:"Ќ",kjcy:"ќ",Kopf:"𝕂",kopf:"𝕜",Kscr:"𝒦",kscr:"𝓀",lAarr:"⇚",Lacute:"Ĺ",lacute:"ĺ",laemptyv:"⦴",lagran:"ℒ",Lambda:"Λ",lambda:"λ",lang:"⟨",Lang:"⟪",langd:"⦑",langle:"⟨",lap:"⪅",Laplacetrf:"ℒ",laquo:"«",larrb:"⇤",larrbfs:"⤟",larr:"←",Larr:"↞",lArr:"⇐",larrfs:"⤝",larrhk:"↩",larrlp:"↫",larrpl:"⤹",larrsim:"⥳",larrtl:"↢",latail:"⤙",lAtail:"⤛",lat:"⪫",late:"⪭",lates:"⪭︀",lbarr:"⤌",lBarr:"⤎",lbbrk:"❲",lbrace:"{",lbrack:"[",lbrke:"⦋",lbrksld:"⦏",lbrkslu:"⦍",Lcaron:"Ľ",lcaron:"ľ",Lcedil:"Ļ",lcedil:"ļ",lceil:"⌈",lcub:"{",Lcy:"Л",lcy:"л",ldca:"⤶",ldquo:"“",ldquor:"„",ldrdhar:"⥧",ldrushar:"⥋",ldsh:"↲",le:"≤",lE:"≦",LeftAngleBracket:"⟨",LeftArrowBar:"⇤",leftarrow:"←",LeftArrow:"←",Leftarrow:"⇐",LeftArrowRightArrow:"⇆",leftarrowtail:"↢",LeftCeiling:"⌈",LeftDoubleBracket:"⟦",LeftDownTeeVector:"⥡",LeftDownVectorBar:"⥙",LeftDownVector:"⇃",LeftFloor:"⌊",leftharpoondown:"↽",leftharpoonup:"↼",leftleftarrows:"⇇",leftrightarrow:"↔",LeftRightArrow:"↔",Leftrightarrow:"⇔",leftrightarrows:"⇆",leftrightharpoons:"⇋",leftrightsquigarrow:"↭",LeftRightVector:"⥎",LeftTeeArrow:"↤",LeftTee:"⊣",LeftTeeVector:"⥚",leftthreetimes:"⋋",LeftTriangleBar:"⧏",LeftTriangle:"⊲",LeftTriangleEqual:"⊴",LeftUpDownVector:"⥑",LeftUpTeeVector:"⥠",LeftUpVectorBar:"⥘",LeftUpVector:"↿",LeftVectorBar:"⥒",LeftVector:"↼",lEg:"⪋",leg:"⋚",leq:"≤",leqq:"≦",leqslant:"⩽",lescc:"⪨",les:"⩽",lesdot:"⩿",lesdoto:"⪁",lesdotor:"⪃",lesg:"⋚︀",lesges:"⪓",lessapprox:"⪅",lessdot:"⋖",lesseqgtr:"⋚",lesseqqgtr:"⪋",LessEqualGreater:"⋚",LessFullEqual:"≦",LessGreater:"≶",lessgtr:"≶",LessLess:"⪡",lesssim:"≲",LessSlantEqual:"⩽",LessTilde:"≲",lfisht:"⥼",lfloor:"⌊",Lfr:"𝔏",lfr:"𝔩",lg:"≶",lgE:"⪑",lHar:"⥢",lhard:"↽",lharu:"↼",lharul:"⥪",lhblk:"▄",LJcy:"Љ",ljcy:"љ",llarr:"⇇",ll:"≪",Ll:"⋘",llcorner:"⌞",Lleftarrow:"⇚",llhard:"⥫",lltri:"◺",Lmidot:"Ŀ",lmidot:"ŀ",lmoustache:"⎰",lmoust:"⎰",lnap:"⪉",lnapprox:"⪉",lne:"⪇",lnE:"≨",lneq:"⪇",lneqq:"≨",lnsim:"⋦",loang:"⟬",loarr:"⇽",lobrk:"⟦",longleftarrow:"⟵",LongLeftArrow:"⟵",Longleftarrow:"⟸",longleftrightarrow:"⟷",LongLeftRightArrow:"⟷",Longleftrightarrow:"⟺",longmapsto:"⟼",longrightarrow:"⟶",LongRightArrow:"⟶",Longrightarrow:"⟹",looparrowleft:"↫",looparrowright:"↬",lopar:"⦅",Lopf:"𝕃",lopf:"𝕝",loplus:"⨭",lotimes:"⨴",lowast:"∗",lowbar:"_",LowerLeftArrow:"↙",LowerRightArrow:"↘",loz:"◊",lozenge:"◊",lozf:"⧫",lpar:"(",lparlt:"⦓",lrarr:"⇆",lrcorner:"⌟",lrhar:"⇋",lrhard:"⥭",lrm:"‎",lrtri:"⊿",lsaquo:"‹",lscr:"𝓁",Lscr:"ℒ",lsh:"↰",Lsh:"↰",lsim:"≲",lsime:"⪍",lsimg:"⪏",lsqb:"[",lsquo:"‘",lsquor:"‚",Lstrok:"Ł",lstrok:"ł",ltcc:"⪦",ltcir:"⩹",lt:"<",LT:"<",Lt:"≪",ltdot:"⋖",lthree:"⋋",ltimes:"⋉",ltlarr:"⥶",ltquest:"⩻",ltri:"◃",ltrie:"⊴",ltrif:"◂",ltrPar:"⦖",lurdshar:"⥊",luruhar:"⥦",lvertneqq:"≨︀",lvnE:"≨︀",macr:"¯",male:"♂",malt:"✠",maltese:"✠",Map:"⤅",map:"↦",mapsto:"↦",mapstodown:"↧",mapstoleft:"↤",mapstoup:"↥",marker:"▮",mcomma:"⨩",Mcy:"М",mcy:"м",mdash:"—",mDDot:"∺",measuredangle:"∡",MediumSpace:" ",Mellintrf:"ℳ",Mfr:"𝔐",mfr:"𝔪",mho:"℧",micro:"µ",midast:"*",midcir:"⫰",mid:"∣",middot:"·",minusb:"⊟",minus:"−",minusd:"∸",minusdu:"⨪",MinusPlus:"∓",mlcp:"⫛",mldr:"…",mnplus:"∓",models:"⊧",Mopf:"𝕄",mopf:"𝕞",mp:"∓",mscr:"𝓂",Mscr:"ℳ",mstpos:"∾",Mu:"Μ",mu:"μ",multimap:"⊸",mumap:"⊸",nabla:"∇",Nacute:"Ń",nacute:"ń",nang:"∠⃒",nap:"≉",napE:"⩰̸",napid:"≋̸",napos:"ŉ",napprox:"≉",natural:"♮",naturals:"ℕ",natur:"♮",nbsp:" ",nbump:"≎̸",nbumpe:"≏̸",ncap:"⩃",Ncaron:"Ň",ncaron:"ň",Ncedil:"Ņ",ncedil:"ņ",ncong:"≇",ncongdot:"⩭̸",ncup:"⩂",Ncy:"Н",ncy:"н",ndash:"–",nearhk:"⤤",nearr:"↗",neArr:"⇗",nearrow:"↗",ne:"≠",nedot:"≐̸",NegativeMediumSpace:"​",NegativeThickSpace:"​",NegativeThinSpace:"​",NegativeVeryThinSpace:"​",nequiv:"≢",nesear:"⤨",nesim:"≂̸",NestedGreaterGreater:"≫",NestedLessLess:"≪",NewLine:"\n",nexist:"∄",nexists:"∄",Nfr:"𝔑",nfr:"𝔫",ngE:"≧̸",nge:"≱",ngeq:"≱",ngeqq:"≧̸",ngeqslant:"⩾̸",nges:"⩾̸",nGg:"⋙̸",ngsim:"≵",nGt:"≫⃒",ngt:"≯",ngtr:"≯",nGtv:"≫̸",nharr:"↮",nhArr:"⇎",nhpar:"⫲",ni:"∋",nis:"⋼",nisd:"⋺",niv:"∋",NJcy:"Њ",njcy:"њ",nlarr:"↚",nlArr:"⇍",nldr:"‥",nlE:"≦̸",nle:"≰",nleftarrow:"↚",nLeftarrow:"⇍",nleftrightarrow:"↮",nLeftrightarrow:"⇎",nleq:"≰",nleqq:"≦̸",nleqslant:"⩽̸",nles:"⩽̸",nless:"≮",nLl:"⋘̸",nlsim:"≴",nLt:"≪⃒",nlt:"≮",nltri:"⋪",nltrie:"⋬",nLtv:"≪̸",nmid:"∤",NoBreak:"⁠",NonBreakingSpace:" ",nopf:"𝕟",Nopf:"ℕ",Not:"⫬",not:"¬",NotCongruent:"≢",NotCupCap:"≭",NotDoubleVerticalBar:"∦",NotElement:"∉",NotEqual:"≠",NotEqualTilde:"≂̸",NotExists:"∄",NotGreater:"≯",NotGreaterEqual:"≱",NotGreaterFullEqual:"≧̸",NotGreaterGreater:"≫̸",NotGreaterLess:"≹",NotGreaterSlantEqual:"⩾̸",NotGreaterTilde:"≵",NotHumpDownHump:"≎̸",NotHumpEqual:"≏̸",notin:"∉",notindot:"⋵̸",notinE:"⋹̸",notinva:"∉",notinvb:"⋷",notinvc:"⋶",NotLeftTriangleBar:"⧏̸",NotLeftTriangle:"⋪",NotLeftTriangleEqual:"⋬",NotLess:"≮",NotLessEqual:"≰",NotLessGreater:"≸",NotLessLess:"≪̸",NotLessSlantEqual:"⩽̸",NotLessTilde:"≴",NotNestedGreaterGreater:"⪢̸",NotNestedLessLess:"⪡̸",notni:"∌",notniva:"∌",notnivb:"⋾",notnivc:"⋽",NotPrecedes:"⊀",NotPrecedesEqual:"⪯̸",NotPrecedesSlantEqual:"⋠",NotReverseElement:"∌",NotRightTriangleBar:"⧐̸",NotRightTriangle:"⋫",NotRightTriangleEqual:"⋭",NotSquareSubset:"⊏̸",NotSquareSubsetEqual:"⋢",NotSquareSuperset:"⊐̸",NotSquareSupersetEqual:"⋣",NotSubset:"⊂⃒",NotSubsetEqual:"⊈",NotSucceeds:"⊁",NotSucceedsEqual:"⪰̸",NotSucceedsSlantEqual:"⋡",NotSucceedsTilde:"≿̸",NotSuperset:"⊃⃒",NotSupersetEqual:"⊉",NotTilde:"≁",NotTildeEqual:"≄",NotTildeFullEqual:"≇",NotTildeTilde:"≉",NotVerticalBar:"∤",nparallel:"∦",npar:"∦",nparsl:"⫽⃥",npart:"∂̸",npolint:"⨔",npr:"⊀",nprcue:"⋠",nprec:"⊀",npreceq:"⪯̸",npre:"⪯̸",nrarrc:"⤳̸",nrarr:"↛",nrArr:"⇏",nrarrw:"↝̸",nrightarrow:"↛",nRightarrow:"⇏",nrtri:"⋫",nrtrie:"⋭",nsc:"⊁",nsccue:"⋡",nsce:"⪰̸",Nscr:"𝒩",nscr:"𝓃",nshortmid:"∤",nshortparallel:"∦",nsim:"≁",nsime:"≄",nsimeq:"≄",nsmid:"∤",nspar:"∦",nsqsube:"⋢",nsqsupe:"⋣",nsub:"⊄",nsubE:"⫅̸",nsube:"⊈",nsubset:"⊂⃒",nsubseteq:"⊈",nsubseteqq:"⫅̸",nsucc:"⊁",nsucceq:"⪰̸",nsup:"⊅",nsupE:"⫆̸",nsupe:"⊉",nsupset:"⊃⃒",nsupseteq:"⊉",nsupseteqq:"⫆̸",ntgl:"≹",Ntilde:"Ñ",ntilde:"ñ",ntlg:"≸",ntriangleleft:"⋪",ntrianglelefteq:"⋬",ntriangleright:"⋫",ntrianglerighteq:"⋭",Nu:"Ν",nu:"ν",num:"#",numero:"№",numsp:" ",nvap:"≍⃒",nvdash:"⊬",nvDash:"⊭",nVdash:"⊮",nVDash:"⊯",nvge:"≥⃒",nvgt:">⃒",nvHarr:"⤄",nvinfin:"⧞",nvlArr:"⤂",nvle:"≤⃒",nvlt:"<⃒",nvltrie:"⊴⃒",nvrArr:"⤃",nvrtrie:"⊵⃒",nvsim:"∼⃒",nwarhk:"⤣",nwarr:"↖",nwArr:"⇖",nwarrow:"↖",nwnear:"⤧",Oacute:"Ó",oacute:"ó",oast:"⊛",Ocirc:"Ô",ocirc:"ô",ocir:"⊚",Ocy:"О",ocy:"о",odash:"⊝",Odblac:"Ő",odblac:"ő",odiv:"⨸",odot:"⊙",odsold:"⦼",OElig:"Œ",oelig:"œ",ofcir:"⦿",Ofr:"𝔒",ofr:"𝔬",ogon:"˛",Ograve:"Ò",ograve:"ò",ogt:"⧁",ohbar:"⦵",ohm:"Ω",oint:"∮",olarr:"↺",olcir:"⦾",olcross:"⦻",oline:"‾",olt:"⧀",Omacr:"Ō",omacr:"ō",Omega:"Ω",omega:"ω",Omicron:"Ο",omicron:"ο",omid:"⦶",ominus:"⊖",Oopf:"𝕆",oopf:"𝕠",opar:"⦷",OpenCurlyDoubleQuote:"“",OpenCurlyQuote:"‘",operp:"⦹",oplus:"⊕",orarr:"↻",Or:"⩔",or:"∨",ord:"⩝",order:"ℴ",orderof:"ℴ",ordf:"ª",ordm:"º",origof:"⊶",oror:"⩖",orslope:"⩗",orv:"⩛",oS:"Ⓢ",Oscr:"𝒪",oscr:"ℴ",Oslash:"Ø",oslash:"ø",osol:"⊘",Otilde:"Õ",otilde:"õ",otimesas:"⨶",Otimes:"⨷",otimes:"⊗",Ouml:"Ö",ouml:"ö",ovbar:"⌽",OverBar:"‾",OverBrace:"⏞",OverBracket:"⎴",OverParenthesis:"⏜",para:"¶",parallel:"∥",par:"∥",parsim:"⫳",parsl:"⫽",part:"∂",PartialD:"∂",Pcy:"П",pcy:"п",percnt:"%",period:".",permil:"‰",perp:"⊥",pertenk:"‱",Pfr:"𝔓",pfr:"𝔭",Phi:"Φ",phi:"φ",phiv:"ϕ",phmmat:"ℳ",phone:"☎",Pi:"Π",pi:"π",pitchfork:"⋔",piv:"ϖ",planck:"ℏ",planckh:"ℎ",plankv:"ℏ",plusacir:"⨣",plusb:"⊞",pluscir:"⨢",plus:"+",plusdo:"∔",plusdu:"⨥",pluse:"⩲",PlusMinus:"±",plusmn:"±",plussim:"⨦",plustwo:"⨧",pm:"±",Poincareplane:"ℌ",pointint:"⨕",popf:"𝕡",Popf:"ℙ",pound:"£",prap:"⪷",Pr:"⪻",pr:"≺",prcue:"≼",precapprox:"⪷",prec:"≺",preccurlyeq:"≼",Precedes:"≺",PrecedesEqual:"⪯",PrecedesSlantEqual:"≼",PrecedesTilde:"≾",preceq:"⪯",precnapprox:"⪹",precneqq:"⪵",precnsim:"⋨",pre:"⪯",prE:"⪳",precsim:"≾",prime:"′",Prime:"″",primes:"ℙ",prnap:"⪹",prnE:"⪵",prnsim:"⋨",prod:"∏",Product:"∏",profalar:"⌮",profline:"⌒",profsurf:"⌓",prop:"∝",Proportional:"∝",Proportion:"∷",propto:"∝",prsim:"≾",prurel:"⊰",Pscr:"𝒫",pscr:"𝓅",Psi:"Ψ",psi:"ψ",puncsp:" ",Qfr:"𝔔",qfr:"𝔮",qint:"⨌",qopf:"𝕢",Qopf:"ℚ",qprime:"⁗",Qscr:"𝒬",qscr:"𝓆",quaternions:"ℍ",quatint:"⨖",quest:"?",questeq:"≟",quot:'"',QUOT:'"',rAarr:"⇛",race:"∽̱",Racute:"Ŕ",racute:"ŕ",radic:"√",raemptyv:"⦳",rang:"⟩",Rang:"⟫",rangd:"⦒",range:"⦥",rangle:"⟩",raquo:"»",rarrap:"⥵",rarrb:"⇥",rarrbfs:"⤠",rarrc:"⤳",rarr:"→",Rarr:"↠",rArr:"⇒",rarrfs:"⤞",rarrhk:"↪",rarrlp:"↬",rarrpl:"⥅",rarrsim:"⥴",Rarrtl:"⤖",rarrtl:"↣",rarrw:"↝",ratail:"⤚",rAtail:"⤜",ratio:"∶",rationals:"ℚ",rbarr:"⤍",rBarr:"⤏",RBarr:"⤐",rbbrk:"❳",rbrace:"}",rbrack:"]",rbrke:"⦌",rbrksld:"⦎",rbrkslu:"⦐",Rcaron:"Ř",rcaron:"ř",Rcedil:"Ŗ",rcedil:"ŗ",rceil:"⌉",rcub:"}",Rcy:"Р",rcy:"р",rdca:"⤷",rdldhar:"⥩",rdquo:"”",rdquor:"”",rdsh:"↳",real:"ℜ",realine:"ℛ",realpart:"ℜ",reals:"ℝ",Re:"ℜ",rect:"▭",reg:"®",REG:"®",ReverseElement:"∋",ReverseEquilibrium:"⇋",ReverseUpEquilibrium:"⥯",rfisht:"⥽",rfloor:"⌋",rfr:"𝔯",Rfr:"ℜ",rHar:"⥤",rhard:"⇁",rharu:"⇀",rharul:"⥬",Rho:"Ρ",rho:"ρ",rhov:"ϱ",RightAngleBracket:"⟩",RightArrowBar:"⇥",rightarrow:"→",RightArrow:"→",Rightarrow:"⇒",RightArrowLeftArrow:"⇄",rightarrowtail:"↣",RightCeiling:"⌉",RightDoubleBracket:"⟧",RightDownTeeVector:"⥝",RightDownVectorBar:"⥕",RightDownVector:"⇂",RightFloor:"⌋",rightharpoondown:"⇁",rightharpoonup:"⇀",rightleftarrows:"⇄",rightleftharpoons:"⇌",rightrightarrows:"⇉",rightsquigarrow:"↝",RightTeeArrow:"↦",RightTee:"⊢",RightTeeVector:"⥛",rightthreetimes:"⋌",RightTriangleBar:"⧐",RightTriangle:"⊳",RightTriangleEqual:"⊵",RightUpDownVector:"⥏",RightUpTeeVector:"⥜",RightUpVectorBar:"⥔",RightUpVector:"↾",RightVectorBar:"⥓",RightVector:"⇀",ring:"˚",risingdotseq:"≓",rlarr:"⇄",rlhar:"⇌",rlm:"‏",rmoustache:"⎱",rmoust:"⎱",rnmid:"⫮",roang:"⟭",roarr:"⇾",robrk:"⟧",ropar:"⦆",ropf:"𝕣",Ropf:"ℝ",roplus:"⨮",rotimes:"⨵",RoundImplies:"⥰",rpar:")",rpargt:"⦔",rppolint:"⨒",rrarr:"⇉",Rrightarrow:"⇛",rsaquo:"›",rscr:"𝓇",Rscr:"ℛ",rsh:"↱",Rsh:"↱",rsqb:"]",rsquo:"’",rsquor:"’",rthree:"⋌",rtimes:"⋊",rtri:"▹",rtrie:"⊵",rtrif:"▸",rtriltri:"⧎",RuleDelayed:"⧴",ruluhar:"⥨",rx:"℞",Sacute:"Ś",sacute:"ś",sbquo:"‚",scap:"⪸",Scaron:"Š",scaron:"š",Sc:"⪼",sc:"≻",sccue:"≽",sce:"⪰",scE:"⪴",Scedil:"Ş",scedil:"ş",Scirc:"Ŝ",scirc:"ŝ",scnap:"⪺",scnE:"⪶",scnsim:"⋩",scpolint:"⨓",scsim:"≿",Scy:"С",scy:"с",sdotb:"⊡",sdot:"⋅",sdote:"⩦",searhk:"⤥",searr:"↘",seArr:"⇘",searrow:"↘",sect:"§",semi:";",seswar:"⤩",setminus:"∖",setmn:"∖",sext:"✶",Sfr:"𝔖",sfr:"𝔰",sfrown:"⌢",sharp:"♯",SHCHcy:"Щ",shchcy:"щ",SHcy:"Ш",shcy:"ш",ShortDownArrow:"↓",ShortLeftArrow:"←",shortmid:"∣",shortparallel:"∥",ShortRightArrow:"→",ShortUpArrow:"↑",shy:"­",Sigma:"Σ",sigma:"σ",sigmaf:"ς",sigmav:"ς",sim:"∼",simdot:"⩪",sime:"≃",simeq:"≃",simg:"⪞",simgE:"⪠",siml:"⪝",simlE:"⪟",simne:"≆",simplus:"⨤",simrarr:"⥲",slarr:"←",SmallCircle:"∘",smallsetminus:"∖",smashp:"⨳",smeparsl:"⧤",smid:"∣",smile:"⌣",smt:"⪪",smte:"⪬",smtes:"⪬︀",SOFTcy:"Ь",softcy:"ь",solbar:"⌿",solb:"⧄",sol:"/",Sopf:"𝕊",sopf:"𝕤",spades:"♠",spadesuit:"♠",spar:"∥",sqcap:"⊓",sqcaps:"⊓︀",sqcup:"⊔",sqcups:"⊔︀",Sqrt:"√",sqsub:"⊏",sqsube:"⊑",sqsubset:"⊏",sqsubseteq:"⊑",sqsup:"⊐",sqsupe:"⊒",sqsupset:"⊐",sqsupseteq:"⊒",square:"□",Square:"□",SquareIntersection:"⊓",SquareSubset:"⊏",SquareSubsetEqual:"⊑",SquareSuperset:"⊐",SquareSupersetEqual:"⊒",SquareUnion:"⊔",squarf:"▪",squ:"□",squf:"▪",srarr:"→",Sscr:"𝒮",sscr:"𝓈",ssetmn:"∖",ssmile:"⌣",sstarf:"⋆",Star:"⋆",star:"☆",starf:"★",straightepsilon:"ϵ",straightphi:"ϕ",strns:"¯",sub:"⊂",Sub:"⋐",subdot:"⪽",subE:"⫅",sube:"⊆",subedot:"⫃",submult:"⫁",subnE:"⫋",subne:"⊊",subplus:"⪿",subrarr:"⥹",subset:"⊂",Subset:"⋐",subseteq:"⊆",subseteqq:"⫅",SubsetEqual:"⊆",subsetneq:"⊊",subsetneqq:"⫋",subsim:"⫇",subsub:"⫕",subsup:"⫓",succapprox:"⪸",succ:"≻",succcurlyeq:"≽",Succeeds:"≻",SucceedsEqual:"⪰",SucceedsSlantEqual:"≽",SucceedsTilde:"≿",succeq:"⪰",succnapprox:"⪺",succneqq:"⪶",succnsim:"⋩",succsim:"≿",SuchThat:"∋",sum:"∑",Sum:"∑",sung:"♪",sup1:"¹",sup2:"²",sup3:"³",sup:"⊃",Sup:"⋑",supdot:"⪾",supdsub:"⫘",supE:"⫆",supe:"⊇",supedot:"⫄",Superset:"⊃",SupersetEqual:"⊇",suphsol:"⟉",suphsub:"⫗",suplarr:"⥻",supmult:"⫂",supnE:"⫌",supne:"⊋",supplus:"⫀",supset:"⊃",Supset:"⋑",supseteq:"⊇",supseteqq:"⫆",supsetneq:"⊋",supsetneqq:"⫌",supsim:"⫈",supsub:"⫔",supsup:"⫖",swarhk:"⤦",swarr:"↙",swArr:"⇙",swarrow:"↙",swnwar:"⤪",szlig:"ß",Tab:"\t",target:"⌖",Tau:"Τ",tau:"τ",tbrk:"⎴",Tcaron:"Ť",tcaron:"ť",Tcedil:"Ţ",tcedil:"ţ",Tcy:"Т",tcy:"т",tdot:"⃛",telrec:"⌕",Tfr:"𝔗",tfr:"𝔱",there4:"∴",therefore:"∴",Therefore:"∴",Theta:"Θ",theta:"θ",thetasym:"ϑ",thetav:"ϑ",thickapprox:"≈",thicksim:"∼",ThickSpace:"  ",ThinSpace:" ",thinsp:" ",thkap:"≈",thksim:"∼",THORN:"Þ",thorn:"þ",tilde:"˜",Tilde:"∼",TildeEqual:"≃",TildeFullEqual:"≅",TildeTilde:"≈",timesbar:"⨱",timesb:"⊠",times:"×",timesd:"⨰",tint:"∭",toea:"⤨",topbot:"⌶",topcir:"⫱",top:"⊤",Topf:"𝕋",topf:"𝕥",topfork:"⫚",tosa:"⤩",tprime:"‴",trade:"™",TRADE:"™",triangle:"▵",triangledown:"▿",triangleleft:"◃",trianglelefteq:"⊴",triangleq:"≜",triangleright:"▹",trianglerighteq:"⊵",tridot:"◬",trie:"≜",triminus:"⨺",TripleDot:"⃛",triplus:"⨹",trisb:"⧍",tritime:"⨻",trpezium:"⏢",Tscr:"𝒯",tscr:"𝓉",TScy:"Ц",tscy:"ц",TSHcy:"Ћ",tshcy:"ћ",Tstrok:"Ŧ",tstrok:"ŧ",twixt:"≬",twoheadleftarrow:"↞",twoheadrightarrow:"↠",Uacute:"Ú",uacute:"ú",uarr:"↑",Uarr:"↟",uArr:"⇑",Uarrocir:"⥉",Ubrcy:"Ў",ubrcy:"ў",Ubreve:"Ŭ",ubreve:"ŭ",Ucirc:"Û",ucirc:"û",Ucy:"У",ucy:"у",udarr:"⇅",Udblac:"Ű",udblac:"ű",udhar:"⥮",ufisht:"⥾",Ufr:"𝔘",ufr:"𝔲",Ugrave:"Ù",ugrave:"ù",uHar:"⥣",uharl:"↿",uharr:"↾",uhblk:"▀",ulcorn:"⌜",ulcorner:"⌜",ulcrop:"⌏",ultri:"◸",Umacr:"Ū",umacr:"ū",uml:"¨",UnderBar:"_",UnderBrace:"⏟",UnderBracket:"⎵",UnderParenthesis:"⏝",Union:"⋃",UnionPlus:"⊎",Uogon:"Ų",uogon:"ų",Uopf:"𝕌",uopf:"𝕦",UpArrowBar:"⤒",uparrow:"↑",UpArrow:"↑",Uparrow:"⇑",UpArrowDownArrow:"⇅",updownarrow:"↕",UpDownArrow:"↕",Updownarrow:"⇕",UpEquilibrium:"⥮",upharpoonleft:"↿",upharpoonright:"↾",uplus:"⊎",UpperLeftArrow:"↖",UpperRightArrow:"↗",upsi:"υ",Upsi:"ϒ",upsih:"ϒ",Upsilon:"Υ",upsilon:"υ",UpTeeArrow:"↥",UpTee:"⊥",upuparrows:"⇈",urcorn:"⌝",urcorner:"⌝",urcrop:"⌎",Uring:"Ů",uring:"ů",urtri:"◹",Uscr:"𝒰",uscr:"𝓊",utdot:"⋰",Utilde:"Ũ",utilde:"ũ",utri:"▵",utrif:"▴",uuarr:"⇈",Uuml:"Ü",uuml:"ü",uwangle:"⦧",vangrt:"⦜",varepsilon:"ϵ",varkappa:"ϰ",varnothing:"∅",varphi:"ϕ",varpi:"ϖ",varpropto:"∝",varr:"↕",vArr:"⇕",varrho:"ϱ",varsigma:"ς",varsubsetneq:"⊊︀",varsubsetneqq:"⫋︀",varsupsetneq:"⊋︀",varsupsetneqq:"⫌︀",vartheta:"ϑ",vartriangleleft:"⊲",vartriangleright:"⊳",vBar:"⫨",Vbar:"⫫",vBarv:"⫩",Vcy:"В",vcy:"в",vdash:"⊢",vDash:"⊨",Vdash:"⊩",VDash:"⊫",Vdashl:"⫦",veebar:"⊻",vee:"∨",Vee:"⋁",veeeq:"≚",vellip:"⋮",verbar:"|",Verbar:"‖",vert:"|",Vert:"‖",VerticalBar:"∣",VerticalLine:"|",VerticalSeparator:"❘",VerticalTilde:"≀",VeryThinSpace:" ",Vfr:"𝔙",vfr:"𝔳",vltri:"⊲",vnsub:"⊂⃒",vnsup:"⊃⃒",Vopf:"𝕍",vopf:"𝕧",vprop:"∝",vrtri:"⊳",Vscr:"𝒱",vscr:"𝓋",vsubnE:"⫋︀",vsubne:"⊊︀",vsupnE:"⫌︀",vsupne:"⊋︀",Vvdash:"⊪",vzigzag:"⦚",Wcirc:"Ŵ",wcirc:"ŵ",wedbar:"⩟",wedge:"∧",Wedge:"⋀",wedgeq:"≙",weierp:"℘",Wfr:"𝔚",wfr:"𝔴",Wopf:"𝕎",wopf:"𝕨",wp:"℘",wr:"≀",wreath:"≀",Wscr:"𝒲",wscr:"𝓌",xcap:"⋂",xcirc:"◯",xcup:"⋃",xdtri:"▽",Xfr:"𝔛",xfr:"𝔵",xharr:"⟷",xhArr:"⟺",Xi:"Ξ",xi:"ξ",xlarr:"⟵",xlArr:"⟸",xmap:"⟼",xnis:"⋻",xodot:"⨀",Xopf:"𝕏",xopf:"𝕩",xoplus:"⨁",xotime:"⨂",xrarr:"⟶",xrArr:"⟹",Xscr:"𝒳",xscr:"𝓍",xsqcup:"⨆",xuplus:"⨄",xutri:"△",xvee:"⋁",xwedge:"⋀",Yacute:"Ý",yacute:"ý",YAcy:"Я",yacy:"я",Ycirc:"Ŷ",ycirc:"ŷ",Ycy:"Ы",ycy:"ы",yen:"¥",Yfr:"𝔜",yfr:"𝔶",YIcy:"Ї",yicy:"ї",Yopf:"𝕐",yopf:"𝕪",Yscr:"𝒴",yscr:"𝓎",YUcy:"Ю",yucy:"ю",yuml:"ÿ",Yuml:"Ÿ",Zacute:"Ź",zacute:"ź",Zcaron:"Ž",zcaron:"ž",Zcy:"З",zcy:"з",Zdot:"Ż",zdot:"ż",zeetrf:"ℨ",ZeroWidthSpace:"​",Zeta:"Ζ",zeta:"ζ",zfr:"𝔷",Zfr:"ℨ",ZHcy:"Ж",zhcy:"ж",zigrarr:"⇝",zopf:"𝕫",Zopf:"ℤ",Zscr:"𝒵",zscr:"𝓏",zwj:"‍",zwnj:"‌"}},function(t,e){t.exports={Aacute:"Á",aacute:"á",Acirc:"Â",acirc:"â",acute:"´",AElig:"Æ",aelig:"æ",Agrave:"À",agrave:"à",amp:"&",AMP:"&",Aring:"Å",aring:"å",Atilde:"Ã",atilde:"ã",Auml:"Ä",auml:"ä",brvbar:"¦",Ccedil:"Ç",ccedil:"ç",cedil:"¸",cent:"¢",copy:"©",COPY:"©",curren:"¤",deg:"°",divide:"÷",Eacute:"É",eacute:"é",Ecirc:"Ê",ecirc:"ê",Egrave:"È",egrave:"è",ETH:"Ð",eth:"ð",Euml:"Ë",euml:"ë",frac12:"½",frac14:"¼",frac34:"¾",gt:">",GT:">",Iacute:"Í",iacute:"í",Icirc:"Î",icirc:"î",iexcl:"¡",Igrave:"Ì",igrave:"ì",iquest:"¿",Iuml:"Ï",iuml:"ï",laquo:"«",lt:"<",LT:"<",macr:"¯",micro:"µ",middot:"·",nbsp:" ",not:"¬",Ntilde:"Ñ",ntilde:"ñ",Oacute:"Ó",oacute:"ó",Ocirc:"Ô",ocirc:"ô",Ograve:"Ò",ograve:"ò",ordf:"ª",ordm:"º",Oslash:"Ø",oslash:"ø",Otilde:"Õ",otilde:"õ",Ouml:"Ö",ouml:"ö",para:"¶",plusmn:"±",pound:"£",quot:'"',QUOT:'"',raquo:"»",reg:"®",REG:"®",sect:"§",shy:"­",sup1:"¹",sup2:"²",sup3:"³",szlig:"ß",THORN:"Þ",thorn:"þ",times:"×",Uacute:"Ú",uacute:"ú",Ucirc:"Û",ucirc:"û",Ugrave:"Ù",ugrave:"ù",uml:"¨",Uuml:"Ü",uuml:"ü",Yacute:"Ý",yacute:"ý",yen:"¥",yuml:"ÿ"}},function(t,e){t.exports={amp:"&",apos:"'",gt:">",lt:"<",quot:'"'}},function(t,e){"function"==typeof Object.create?t.exports=function(t,e){
t.super_=e,t.prototype=Object.create(e.prototype,{constructor:{value:t,enumerable:!1,writable:!0,configurable:!0}})}:t.exports=function(t,e){t.super_=e;var n=function(){};n.prototype=e.prototype,t.prototype=new n,t.prototype.constructor=t}},function(t,e){function n(){this._events=this._events||{},this._maxListeners=this._maxListeners||void 0}function r(t){return"function"==typeof t}function i(t){return"number"==typeof t}function o(t){return"object"==typeof t&&null!==t}function a(t){return void 0===t}t.exports=n,n.EventEmitter=n,n.prototype._events=void 0,n.prototype._maxListeners=void 0,n.defaultMaxListeners=10,n.prototype.setMaxListeners=function(t){if(!i(t)||t<0||isNaN(t))throw TypeError("n must be a positive number");return this._maxListeners=t,this},n.prototype.emit=function(t){var e,n,i,s,u,c;if(this._events||(this._events={}),"error"===t&&(!this._events.error||o(this._events.error)&&!this._events.error.length)){if(e=arguments[1],e instanceof Error)throw e;var l=new Error('Uncaught, unspecified "error" event. ('+e+")");throw l.context=e,l}if(n=this._events[t],a(n))return!1;if(r(n))switch(arguments.length){case 1:n.call(this);break;case 2:n.call(this,arguments[1]);break;case 3:n.call(this,arguments[1],arguments[2]);break;default:s=Array.prototype.slice.call(arguments,1),n.apply(this,s)}else if(o(n))for(s=Array.prototype.slice.call(arguments,1),c=n.slice(),i=c.length,u=0;u<i;u++)c[u].apply(this,s);return!0},n.prototype.addListener=function(t,e){var i;if(!r(e))throw TypeError("listener must be a function");return this._events||(this._events={}),this._events.newListener&&this.emit("newListener",t,r(e.listener)?e.listener:e),this._events[t]?o(this._events[t])?this._events[t].push(e):this._events[t]=[this._events[t],e]:this._events[t]=e,o(this._events[t])&&!this._events[t].warned&&(i=a(this._maxListeners)?n.defaultMaxListeners:this._maxListeners,i&&i>0&&this._events[t].length>i&&(this._events[t].warned=!0,console.error("(node) warning: possible EventEmitter memory leak detected. %d listeners added. Use emitter.setMaxListeners() to increase limit.",this._events[t].length),"function"==typeof console.trace&&console.trace())),this},n.prototype.on=n.prototype.addListener,n.prototype.once=function(t,e){function n(){this.removeListener(t,n),i||(i=!0,e.apply(this,arguments))}if(!r(e))throw TypeError("listener must be a function");var i=!1;return n.listener=e,this.on(t,n),this},n.prototype.removeListener=function(t,e){var n,i,a,s;if(!r(e))throw TypeError("listener must be a function");if(!this._events||!this._events[t])return this;if(n=this._events[t],a=n.length,i=-1,n===e||r(n.listener)&&n.listener===e)delete this._events[t],this._events.removeListener&&this.emit("removeListener",t,e);else if(o(n)){for(s=a;s-- >0;)if(n[s]===e||n[s].listener&&n[s].listener===e){i=s;break}if(i<0)return this;1===n.length?(n.length=0,delete this._events[t]):n.splice(i,1),this._events.removeListener&&this.emit("removeListener",t,e)}return this},n.prototype.removeAllListeners=function(t){var e,n;if(!this._events)return this;if(!this._events.removeListener)return 0===arguments.length?this._events={}:this._events[t]&&delete this._events[t],this;if(0===arguments.length){for(e in this._events)"removeListener"!==e&&this.removeAllListeners(e);return this.removeAllListeners("removeListener"),this._events={},this}if(n=this._events[t],r(n))this.removeListener(t,n);else if(n)for(;n.length;)this.removeListener(t,n[n.length-1]);return delete this._events[t],this},n.prototype.listeners=function(t){var e;return e=this._events&&this._events[t]?r(this._events[t])?[this._events[t]]:this._events[t].slice():[]},n.prototype.listenerCount=function(t){if(this._events){var e=this._events[t];if(r(e))return 1;if(e)return e.length}return 0},n.listenerCount=function(t,e){return t.listenerCount(e)}},function(t,e,n){function r(t,e,n){"object"==typeof t?(n=e,e=t,t=null):"function"==typeof e&&(n=e,e=u),this._callback=t,this._options=e||u,this._elementCB=n,this.dom=[],this._done=!1,this._tagStack=[],this._parser=this._parser||null}var i=n(26),o=/\s+/g,a=n(27),s=n(28),u={normalizeWhitespace:!1,withStartIndices:!1};r.prototype.onparserinit=function(t){this._parser=t},r.prototype.onreset=function(){r.call(this,this._callback,this._options,this._elementCB)},r.prototype.onend=function(){this._done||(this._done=!0,this._parser=null,this._handleCallback(null))},r.prototype._handleCallback=r.prototype.onerror=function(t){if("function"==typeof this._callback)this._callback(t,this.dom);else if(t)throw t},r.prototype.onclosetag=function(){var t=this._tagStack.pop();this._elementCB&&this._elementCB(t)},r.prototype._addDomElement=function(t){var e=this._tagStack[this._tagStack.length-1],n=e?e.children:this.dom,r=n[n.length-1];t.next=null,this._options.withStartIndices&&(t.startIndex=this._parser.startIndex),this._options.withDomLvl1&&(t.__proto__="tag"===t.type?s:a),r?(t.prev=r,r.next=t):t.prev=null,n.push(t),t.parent=e||null},r.prototype.onopentag=function(t,e){var n={type:"script"===t?i.Script:"style"===t?i.Style:i.Tag,name:t,attribs:e,children:[]};this._addDomElement(n),this._tagStack.push(n)},r.prototype.ontext=function(t){var e,n=this._options.normalizeWhitespace||this._options.ignoreWhitespace;!this._tagStack.length&&this.dom.length&&(e=this.dom[this.dom.length-1]).type===i.Text?n?e.data=(e.data+t).replace(o," "):e.data+=t:this._tagStack.length&&(e=this._tagStack[this._tagStack.length-1])&&(e=e.children[e.children.length-1])&&e.type===i.Text?n?e.data=(e.data+t).replace(o," "):e.data+=t:(n&&(t=t.replace(o," ")),this._addDomElement({data:t,type:i.Text}))},r.prototype.oncomment=function(t){var e=this._tagStack[this._tagStack.length-1];if(e&&e.type===i.Comment)return void(e.data+=t);var n={data:t,type:i.Comment};this._addDomElement(n),this._tagStack.push(n)},r.prototype.oncdatastart=function(){var t={children:[{data:"",type:i.Text}],type:i.CDATA};this._addDomElement(t),this._tagStack.push(t)},r.prototype.oncommentend=r.prototype.oncdataend=function(){this._tagStack.pop()},r.prototype.onprocessinginstruction=function(t,e){this._addDomElement({name:t,data:e,type:i.Directive})},t.exports=r},function(t,e){t.exports={Text:"text",Directive:"directive",Comment:"comment",Script:"script",Style:"style",Tag:"tag",CDATA:"cdata",Doctype:"doctype",isTag:function(t){return"tag"===t.type||"script"===t.type||"style"===t.type}}},function(t,e){var n=t.exports={get firstChild(){var t=this.children;return t&&t[0]||null},get lastChild(){var t=this.children;return t&&t[t.length-1]||null},get nodeType(){return i[this.type]||i.element}},r={tagName:"name",childNodes:"children",parentNode:"parent",previousSibling:"prev",nextSibling:"next",nodeValue:"data"},i={element:1,text:3,cdata:4,comment:8};Object.keys(r).forEach(function(t){var e=r[t];Object.defineProperty(n,t,{get:function(){return this[e]||null},set:function(t){return this[e]=t,t}})})},function(t,e,n){var r=n(27),i=t.exports=Object.create(r),o={tagName:"name"};Object.keys(o).forEach(function(t){var e=o[t];Object.defineProperty(i,t,{get:function(){return this[e]||null},set:function(t){return this[e]=t,t}})})},function(t,e,n){function r(t,e){this.init(t,e)}function i(t,e){return l.getElementsByTagName(t,e,!0)}function o(t,e){return l.getElementsByTagName(t,e,!0,1)[0]}function a(t,e,n){return l.getText(l.getElementsByTagName(t,e,n,1)).trim()}function s(t,e,n,r,i){var o=a(n,r,i);o&&(t[e]=o)}var u=n(15),c=u.DomHandler,l=u.DomUtils;n(23)(r,c),r.prototype.init=c;var f=function(t){return"rss"===t||"feed"===t||"rdf:RDF"===t};r.prototype.onend=function(){var t,e,n={},r=o(f,this.dom);r&&("feed"===r.name?(e=r.children,n.type="atom",s(n,"id","id",e),s(n,"title","title",e),(t=o("link",e))&&(t=t.attribs)&&(t=t.href)&&(n.link=t),s(n,"description","subtitle",e),(t=a("updated",e))&&(n.updated=new Date(t)),s(n,"author","email",e,!0),n.items=i("entry",e).map(function(t){var e,n={};return t=t.children,s(n,"id","id",t),s(n,"title","title",t),(e=o("link",t))&&(e=e.attribs)&&(e=e.href)&&(n.link=e),(e=a("summary",t)||a("content",t))&&(n.description=e),(e=a("updated",t))&&(n.pubDate=new Date(e)),n})):(e=o("channel",r.children).children,n.type=r.name.substr(0,3),n.id="",s(n,"title","title",e),s(n,"link","link",e),s(n,"description","description",e),(t=a("lastBuildDate",e))&&(n.updated=new Date(t)),s(n,"author","managingEditor",e,!0),n.items=i("item",r.children).map(function(t){var e,n={};return t=t.children,s(n,"id","guid",t),s(n,"title","title",t),s(n,"link","link",t),s(n,"description","description",t),(e=a("pubDate",t))&&(n.pubDate=new Date(e)),n}))),this.dom=n,c.prototype._handleCallback.call(this,r?null:Error("couldn't find root of feed"))},t.exports=r},function(t,e,n){function r(t){o.call(this,new i(this),t)}function i(t){this.scope=t}t.exports=r;var o=n(31);n(23)(r,o),r.prototype.readable=!0;var a=n(15).EVENTS;Object.keys(a).forEach(function(t){if(0===a[t])i.prototype["on"+t]=function(){this.scope.emit(t)};else if(1===a[t])i.prototype["on"+t]=function(e){this.scope.emit(t,e)};else{if(2!==a[t])throw Error("wrong number of arguments!");i.prototype["on"+t]=function(e,n){this.scope.emit(t,e,n)}}})},function(t,e,n){function r(t,e){var n=this._parser=new i(t,e),r=this._decoder=new a;o.call(this,{decodeStrings:!1}),this.once("finish",function(){n.end(r.end())})}t.exports=r;var i=n(16),o=n(32).Writable||n(52).Writable,a=n(45).StringDecoder,s=n(37).Buffer;n(23)(r,o),o.prototype._write=function(t,e,n){t instanceof s&&(t=this._decoder.write(t)),this._parser.write(t),n()}},function(t,e,n){function r(){i.call(this)}t.exports=r;var i=n(24).EventEmitter,o=n(23);o(r,i),r.Readable=n(33),r.Writable=n(48),r.Duplex=n(49),r.Transform=n(50),r.PassThrough=n(51),r.Stream=r,r.prototype.pipe=function(t,e){function n(e){t.writable&&!1===t.write(e)&&c.pause&&c.pause()}function r(){c.readable&&c.resume&&c.resume()}function o(){l||(l=!0,t.end())}function a(){l||(l=!0,"function"==typeof t.destroy&&t.destroy())}function s(t){if(u(),0===i.listenerCount(this,"error"))throw t}function u(){c.removeListener("data",n),t.removeListener("drain",r),c.removeListener("end",o),c.removeListener("close",a),c.removeListener("error",s),t.removeListener("error",s),c.removeListener("end",u),c.removeListener("close",u),t.removeListener("close",u)}var c=this;c.on("data",n),t.on("drain",r),t._isStdio||e&&e.end===!1||(c.on("end",o),c.on("close",a));var l=!1;return c.on("error",s),t.on("error",s),c.on("end",u),c.on("close",u),t.on("close",u),t.emit("pipe",c),t}},function(t,e,n){(function(r){e=t.exports=n(35),e.Stream=n(32),e.Readable=e,e.Writable=n(44),e.Duplex=n(43),e.Transform=n(46),e.PassThrough=n(47),r.browser||"disable"!==r.env.READABLE_STREAM||(t.exports=n(32))}).call(e,n(34))},function(t,e){function n(){throw new Error("setTimeout has not been defined")}function r(){throw new Error("clearTimeout has not been defined")}function i(t){if(l===setTimeout)return setTimeout(t,0);if((l===n||!l)&&setTimeout)return l=setTimeout,setTimeout(t,0);try{return l(t,0)}catch(e){try{return l.call(null,t,0)}catch(e){return l.call(this,t,0)}}}function o(t){if(f===clearTimeout)return clearTimeout(t);if((f===r||!f)&&clearTimeout)return f=clearTimeout,clearTimeout(t);try{return f(t)}catch(e){try{return f.call(null,t)}catch(e){return f.call(this,t)}}}function a(){g&&p&&(g=!1,p.length?d=p.concat(d):v=-1,d.length&&s())}function s(){if(!g){var t=i(a);g=!0;for(var e=d.length;e;){for(p=d,d=[];++v<e;)p&&p[v].run();v=-1,e=d.length}p=null,g=!1,o(t)}}function u(t,e){this.fun=t,this.array=e}function c(){}var l,f,h=t.exports={};!function(){try{l="function"==typeof setTimeout?setTimeout:n}catch(t){l=n}try{f="function"==typeof clearTimeout?clearTimeout:r}catch(t){f=r}}();var p,d=[],g=!1,v=-1;h.nextTick=function(t){var e=new Array(arguments.length-1);if(arguments.length>1)for(var n=1;n<arguments.length;n++)e[n-1]=arguments[n];d.push(new u(t,e)),1!==d.length||g||i(s)},u.prototype.run=function(){this.fun.apply(null,this.array)},h.title="browser",h.browser=!0,h.env={},h.argv=[],h.version="",h.versions={},h.on=c,h.addListener=c,h.once=c,h.off=c,h.removeListener=c,h.removeAllListeners=c,h.emit=c,h.binding=function(t){throw new Error("process.binding is not supported")},h.cwd=function(){return"/"},h.chdir=function(t){throw new Error("process.chdir is not supported")},h.umask=function(){return 0}},function(t,e,n){(function(e){function r(t,e){var r=n(43);t=t||{};var i=t.highWaterMark,o=t.objectMode?16:16384;this.highWaterMark=i||0===i?i:o,this.highWaterMark=~~this.highWaterMark,this.buffer=[],this.length=0,this.pipes=null,this.pipesCount=0,this.flowing=null,this.ended=!1,this.endEmitted=!1,this.reading=!1,this.sync=!0,this.needReadable=!1,this.emittedReadable=!1,this.readableListening=!1,this.objectMode=!!t.objectMode,e instanceof r&&(this.objectMode=this.objectMode||!!t.readableObjectMode),this.defaultEncoding=t.defaultEncoding||"utf8",this.ranOut=!1,this.awaitDrain=0,this.readingMore=!1,this.decoder=null,this.encoding=null,t.encoding&&(T||(T=n(45).StringDecoder),this.decoder=new T(t.encoding),this.encoding=t.encoding)}function i(t){n(43);return this instanceof i?(this._readableState=new r(t,this),this.readable=!0,void L.call(this)):new i(t)}function o(t,e,n,r,i){var o=c(e,n);if(o)t.emit("error",o);else if(k.isNullOrUndefined(n))e.reading=!1,e.ended||l(t,e);else if(e.objectMode||n&&n.length>0)if(e.ended&&!i){var s=new Error("stream.push() after EOF");t.emit("error",s)}else if(e.endEmitted&&i){var s=new Error("stream.unshift() after end event");t.emit("error",s)}else!e.decoder||i||r||(n=e.decoder.write(n)),i||(e.reading=!1),e.flowing&&0===e.length&&!e.sync?(t.emit("data",n),t.read(0)):(e.length+=e.objectMode?1:n.length,i?e.buffer.unshift(n):e.buffer.push(n),e.needReadable&&f(t)),p(t,e);else i||(e.reading=!1);return a(e)}function a(t){return!t.ended&&(t.needReadable||t.length<t.highWaterMark||0===t.length)}function s(t){if(t>=R)t=R;else{t--;for(var e=1;e<32;e<<=1)t|=t>>e;t++}return t}function u(t,e){return 0===e.length&&e.ended?0:e.objectMode?0===t?0:1:isNaN(t)||k.isNull(t)?e.flowing&&e.buffer.length?e.buffer[0].length:e.length:t<=0?0:(t>e.highWaterMark&&(e.highWaterMark=s(t)),t>e.length?e.ended?e.length:(e.needReadable=!0,0):t)}function c(t,e){var n=null;return k.isBuffer(e)||k.isString(e)||k.isNullOrUndefined(e)||t.objectMode||(n=new TypeError("Invalid non-string/buffer chunk")),n}function l(t,e){if(e.decoder&&!e.ended){var n=e.decoder.end();n&&n.length&&(e.buffer.push(n),e.length+=e.objectMode?1:n.length)}e.ended=!0,f(t)}function f(t){var n=t._readableState;n.needReadable=!1,n.emittedReadable||(C("emitReadable",n.flowing),n.emittedReadable=!0,n.sync?e.nextTick(function(){h(t)}):h(t))}function h(t){C("emit readable"),t.emit("readable"),m(t)}function p(t,n){n.readingMore||(n.readingMore=!0,e.nextTick(function(){d(t,n)}))}function d(t,e){for(var n=e.length;!e.reading&&!e.flowing&&!e.ended&&e.length<e.highWaterMark&&(C("maybeReadMore read 0"),t.read(0),n!==e.length);)n=e.length;e.readingMore=!1}function g(t){return function(){var e=t._readableState;C("pipeOnDrain",e.awaitDrain),e.awaitDrain&&e.awaitDrain--,0===e.awaitDrain&&A.listenerCount(t,"data")&&(e.flowing=!0,m(t))}}function v(t,n){n.resumeScheduled||(n.resumeScheduled=!0,e.nextTick(function(){_(t,n)}))}function _(t,e){e.resumeScheduled=!1,t.emit("resume"),m(t),e.flowing&&!e.reading&&t.read(0)}function m(t){var e=t._readableState;if(C("flow",e.flowing),e.flowing)do var n=t.read();while(null!==n&&e.flowing)}function b(t,e){var n,r=e.buffer,i=e.length,o=!!e.decoder,a=!!e.objectMode;if(0===r.length)return null;if(0===i)n=null;else if(a)n=r.shift();else if(!t||t>=i)n=o?r.join(""):S.concat(r,i),r.length=0;else if(t<r[0].length){var s=r[0];n=s.slice(0,t),r[0]=s.slice(t)}else if(t===r[0].length)n=r.shift();else{n=o?"":new S(t);for(var u=0,c=0,l=r.length;c<l&&u<t;c++){var s=r[0],f=Math.min(t-u,s.length);o?n+=s.slice(0,f):s.copy(n,u,0,f),f<s.length?r[0]=s.slice(f):r.shift(),u+=f}}return n}function y(t){var n=t._readableState;if(n.length>0)throw new Error("endReadable called on non-empty stream");n.endEmitted||(n.ended=!0,e.nextTick(function(){n.endEmitted||0!==n.length||(n.endEmitted=!0,t.readable=!1,t.emit("end"))}))}function w(t,e){for(var n=0,r=t.length;n<r;n++)e(t[n],n)}function x(t,e){for(var n=0,r=t.length;n<r;n++)if(t[n]===e)return n;return-1}t.exports=i;var E=n(36),S=n(37).Buffer;i.ReadableState=r;var A=n(24).EventEmitter;A.listenerCount||(A.listenerCount=function(t,e){return t.listeners(e).length});var L=n(32),k=n(41);k.inherits=n(23);var T,C=n(42);C=C&&C.debuglog?C.debuglog("stream"):function(){},k.inherits(i,L),i.prototype.push=function(t,e){var n=this._readableState;return k.isString(t)&&!n.objectMode&&(e=e||n.defaultEncoding,e!==n.encoding&&(t=new S(t,e),e="")),o(this,n,t,e,!1)},i.prototype.unshift=function(t){var e=this._readableState;return o(this,e,t,"",!0)},i.prototype.setEncoding=function(t){return T||(T=n(45).StringDecoder),this._readableState.decoder=new T(t),this._readableState.encoding=t,this};var R=8388608;i.prototype.read=function(t){C("read",t);var e=this._readableState,n=t;if((!k.isNumber(t)||t>0)&&(e.emittedReadable=!1),0===t&&e.needReadable&&(e.length>=e.highWaterMark||e.ended))return C("read: emitReadable",e.length,e.ended),0===e.length&&e.ended?y(this):f(this),null;if(t=u(t,e),0===t&&e.ended)return 0===e.length&&y(this),null;var r=e.needReadable;C("need readable",r),(0===e.length||e.length-t<e.highWaterMark)&&(r=!0,C("length less than watermark",r)),(e.ended||e.reading)&&(r=!1,C("reading or ended",r)),r&&(C("do read"),e.reading=!0,e.sync=!0,0===e.length&&(e.needReadable=!0),this._read(e.highWaterMark),e.sync=!1),r&&!e.reading&&(t=u(n,e));var i;return i=t>0?b(t,e):null,k.isNull(i)&&(e.needReadable=!0,t=0),e.length-=t,0!==e.length||e.ended||(e.needReadable=!0),n!==t&&e.ended&&0===e.length&&y(this),k.isNull(i)||this.emit("data",i),i},i.prototype._read=function(t){this.emit("error",new Error("not implemented"))},i.prototype.pipe=function(t,n){function r(t){C("onunpipe"),t===f&&o()}function i(){C("onend"),t.end()}function o(){C("cleanup"),t.removeListener("close",u),t.removeListener("finish",c),t.removeListener("drain",v),t.removeListener("error",s),t.removeListener("unpipe",r),f.removeListener("end",i),f.removeListener("end",o),f.removeListener("data",a),!h.awaitDrain||t._writableState&&!t._writableState.needDrain||v()}function a(e){C("ondata");var n=t.write(e);!1===n&&(C("false write response, pause",f._readableState.awaitDrain),f._readableState.awaitDrain++,f.pause())}function s(e){C("onerror",e),l(),t.removeListener("error",s),0===A.listenerCount(t,"error")&&t.emit("error",e)}function u(){t.removeListener("finish",c),l()}function c(){C("onfinish"),t.removeListener("close",u),l()}function l(){C("unpipe"),f.unpipe(t)}var f=this,h=this._readableState;switch(h.pipesCount){case 0:h.pipes=t;break;case 1:h.pipes=[h.pipes,t];break;default:h.pipes.push(t)}h.pipesCount+=1,C("pipe count=%d opts=%j",h.pipesCount,n);var p=(!n||n.end!==!1)&&t!==e.stdout&&t!==e.stderr,d=p?i:o;h.endEmitted?e.nextTick(d):f.once("end",d),t.on("unpipe",r);var v=g(f);return t.on("drain",v),f.on("data",a),t._events&&t._events.error?E(t._events.error)?t._events.error.unshift(s):t._events.error=[s,t._events.error]:t.on("error",s),t.once("close",u),t.once("finish",c),t.emit("pipe",f),h.flowing||(C("pipe resume"),f.resume()),t},i.prototype.unpipe=function(t){var e=this._readableState;if(0===e.pipesCount)return this;if(1===e.pipesCount)return t&&t!==e.pipes?this:(t||(t=e.pipes),e.pipes=null,e.pipesCount=0,e.flowing=!1,t&&t.emit("unpipe",this),this);if(!t){var n=e.pipes,r=e.pipesCount;e.pipes=null,e.pipesCount=0,e.flowing=!1;for(var i=0;i<r;i++)n[i].emit("unpipe",this);return this}var i=x(e.pipes,t);return i===-1?this:(e.pipes.splice(i,1),e.pipesCount-=1,1===e.pipesCount&&(e.pipes=e.pipes[0]),t.emit("unpipe",this),this)},i.prototype.on=function(t,n){var r=L.prototype.on.call(this,t,n);if("data"===t&&!1!==this._readableState.flowing&&this.resume(),"readable"===t&&this.readable){var i=this._readableState;if(!i.readableListening)if(i.readableListening=!0,i.emittedReadable=!1,i.needReadable=!0,i.reading)i.length&&f(this,i);else{var o=this;e.nextTick(function(){C("readable nexttick read 0"),o.read(0)})}}return r},i.prototype.addListener=i.prototype.on,i.prototype.resume=function(){var t=this._readableState;return t.flowing||(C("resume"),t.flowing=!0,t.reading||(C("resume read 0"),this.read(0)),v(this,t)),this},i.prototype.pause=function(){return C("call pause flowing=%j",this._readableState.flowing),!1!==this._readableState.flowing&&(C("pause"),this._readableState.flowing=!1,this.emit("pause")),this},i.prototype.wrap=function(t){var e=this._readableState,n=!1,r=this;t.on("end",function(){if(C("wrapped end"),e.decoder&&!e.ended){var t=e.decoder.end();t&&t.length&&r.push(t)}r.push(null)}),t.on("data",function(i){if(C("wrapped data"),e.decoder&&(i=e.decoder.write(i)),i&&(e.objectMode||i.length)){var o=r.push(i);o||(n=!0,t.pause())}});for(var i in t)k.isFunction(t[i])&&k.isUndefined(this[i])&&(this[i]=function(e){return function(){return t[e].apply(t,arguments)}}(i));var o=["error","close","destroy","pause","resume"];return w(o,function(e){t.on(e,r.emit.bind(r,e))}),r._read=function(e){C("wrapped _read",e),n&&(n=!1,t.resume())},r},i._fromList=b}).call(e,n(34))},function(t,e){t.exports=Array.isArray||function(t){return"[object Array]"==Object.prototype.toString.call(t)}},function(t,e,n){(function(t,r){/*!
	 * The buffer module from node.js, for the browser.
	 *
	 * @author   Feross Aboukhadijeh <feross@feross.org> <http://feross.org>
	 * @license  MIT
	 */
"use strict";function i(){try{var t=new Uint8Array(1);return t.__proto__={__proto__:Uint8Array.prototype,foo:function(){return 42}},42===t.foo()&&"function"==typeof t.subarray&&0===t.subarray(1,1).byteLength}catch(t){return!1}}function o(){return t.TYPED_ARRAY_SUPPORT?2147483647:1073741823}function a(e,n){if(o()<n)throw new RangeError("Invalid typed array length");return t.TYPED_ARRAY_SUPPORT?(e=new Uint8Array(n),e.__proto__=t.prototype):(null===e&&(e=new t(n)),e.length=n),e}function t(e,n,r){if(!(t.TYPED_ARRAY_SUPPORT||this instanceof t))return new t(e,n,r);if("number"==typeof e){if("string"==typeof n)throw new Error("If encoding is specified then the first argument must be a string");return l(this,e)}return s(this,e,n,r)}function s(t,e,n,r){if("number"==typeof e)throw new TypeError('"value" argument must not be a number');return"undefined"!=typeof ArrayBuffer&&e instanceof ArrayBuffer?p(t,e,n,r):"string"==typeof e?f(t,e,n):d(t,e)}function u(t){if("number"!=typeof t)throw new TypeError('"size" argument must be a number');if(t<0)throw new RangeError('"size" argument must not be negative')}function c(t,e,n,r){return u(e),e<=0?a(t,e):void 0!==n?"string"==typeof r?a(t,e).fill(n,r):a(t,e).fill(n):a(t,e)}function l(e,n){if(u(n),e=a(e,n<0?0:0|g(n)),!t.TYPED_ARRAY_SUPPORT)for(var r=0;r<n;++r)e[r]=0;return e}function f(e,n,r){if("string"==typeof r&&""!==r||(r="utf8"),!t.isEncoding(r))throw new TypeError('"encoding" must be a valid string encoding');var i=0|_(n,r);e=a(e,i);var o=e.write(n,r);return o!==i&&(e=e.slice(0,o)),e}function h(t,e){var n=e.length<0?0:0|g(e.length);t=a(t,n);for(var r=0;r<n;r+=1)t[r]=255&e[r];return t}function p(e,n,r,i){if(n.byteLength,r<0||n.byteLength<r)throw new RangeError("'offset' is out of bounds");if(n.byteLength<r+(i||0))throw new RangeError("'length' is out of bounds");return n=void 0===r&&void 0===i?new Uint8Array(n):void 0===i?new Uint8Array(n,r):new Uint8Array(n,r,i),t.TYPED_ARRAY_SUPPORT?(e=n,e.__proto__=t.prototype):e=h(e,n),e}function d(e,n){if(t.isBuffer(n)){var r=0|g(n.length);return e=a(e,r),0===e.length?e:(n.copy(e,0,0,r),e)}if(n){if("undefined"!=typeof ArrayBuffer&&n.buffer instanceof ArrayBuffer||"length"in n)return"number"!=typeof n.length||K(n.length)?a(e,0):h(e,n);if("Buffer"===n.type&&Q(n.data))return h(e,n.data)}throw new TypeError("First argument must be a string, Buffer, ArrayBuffer, Array, or array-like object.")}function g(t){if(t>=o())throw new RangeError("Attempt to allocate Buffer larger than maximum size: 0x"+o().toString(16)+" bytes");return 0|t}function v(e){return+e!=e&&(e=0),t.alloc(+e)}function _(e,n){if(t.isBuffer(e))return e.length;if("undefined"!=typeof ArrayBuffer&&"function"==typeof ArrayBuffer.isView&&(ArrayBuffer.isView(e)||e instanceof ArrayBuffer))return e.byteLength;"string"!=typeof e&&(e=""+e);var r=e.length;if(0===r)return 0;for(var i=!1;;)switch(n){case"ascii":case"latin1":case"binary":return r;case"utf8":case"utf-8":case void 0:return G(e).length;case"ucs2":case"ucs-2":case"utf16le":case"utf-16le":return 2*r;case"hex":return r>>>1;case"base64":return $(e).length;default:if(i)return G(e).length;n=(""+n).toLowerCase(),i=!0}}function m(t,e,n){var r=!1;if((void 0===e||e<0)&&(e=0),e>this.length)return"";if((void 0===n||n>this.length)&&(n=this.length),n<=0)return"";if(n>>>=0,e>>>=0,n<=e)return"";for(t||(t="utf8");;)switch(t){case"hex":return q(this,e,n);case"utf8":case"utf-8":return C(this,e,n);case"ascii":return O(this,e,n);case"latin1":case"binary":return D(this,e,n);case"base64":return T(this,e,n);case"ucs2":case"ucs-2":case"utf16le":case"utf-16le":return I(this,e,n);default:if(r)throw new TypeError("Unknown encoding: "+t);t=(t+"").toLowerCase(),r=!0}}function b(t,e,n){var r=t[e];t[e]=t[n],t[n]=r}function y(e,n,r,i,o){if(0===e.length)return-1;if("string"==typeof r?(i=r,r=0):r>2147483647?r=2147483647:r<-2147483648&&(r=-2147483648),r=+r,isNaN(r)&&(r=o?0:e.length-1),r<0&&(r=e.length+r),r>=e.length){if(o)return-1;r=e.length-1}else if(r<0){if(!o)return-1;r=0}if("string"==typeof n&&(n=t.from(n,i)),t.isBuffer(n))return 0===n.length?-1:w(e,n,r,i,o);if("number"==typeof n)return n&=255,t.TYPED_ARRAY_SUPPORT&&"function"==typeof Uint8Array.prototype.indexOf?o?Uint8Array.prototype.indexOf.call(e,n,r):Uint8Array.prototype.lastIndexOf.call(e,n,r):w(e,[n],r,i,o);throw new TypeError("val must be string, number or Buffer")}function w(t,e,n,r,i){function o(t,e){return 1===a?t[e]:t.readUInt16BE(e*a)}var a=1,s=t.length,u=e.length;if(void 0!==r&&(r=String(r).toLowerCase(),"ucs2"===r||"ucs-2"===r||"utf16le"===r||"utf-16le"===r)){if(t.length<2||e.length<2)return-1;a=2,s/=2,u/=2,n/=2}var c;if(i){var l=-1;for(c=n;c<s;c++)if(o(t,c)===o(e,l===-1?0:c-l)){if(l===-1&&(l=c),c-l+1===u)return l*a}else l!==-1&&(c-=c-l),l=-1}else for(n+u>s&&(n=s-u),c=n;c>=0;c--){for(var f=!0,h=0;h<u;h++)if(o(t,c+h)!==o(e,h)){f=!1;break}if(f)return c}return-1}function x(t,e,n,r){n=Number(n)||0;var i=t.length-n;r?(r=Number(r),r>i&&(r=i)):r=i;var o=e.length;if(o%2!==0)throw new TypeError("Invalid hex string");r>o/2&&(r=o/2);for(var a=0;a<r;++a){var s=parseInt(e.substr(2*a,2),16);if(isNaN(s))return a;t[n+a]=s}return a}function E(t,e,n,r){return Z(G(e,t.length-n),t,n,r)}function S(t,e,n,r){return Z(W(e),t,n,r)}function A(t,e,n,r){return S(t,e,n,r)}function L(t,e,n,r){return Z($(e),t,n,r)}function k(t,e,n,r){return Z(Y(e,t.length-n),t,n,r)}function T(t,e,n){return 0===e&&n===t.length?J.fromByteArray(t):J.fromByteArray(t.slice(e,n))}function C(t,e,n){n=Math.min(t.length,n);for(var r=[],i=e;i<n;){var o=t[i],a=null,s=o>239?4:o>223?3:o>191?2:1;if(i+s<=n){var u,c,l,f;switch(s){case 1:o<128&&(a=o);break;case 2:u=t[i+1],128===(192&u)&&(f=(31&o)<<6|63&u,f>127&&(a=f));break;case 3:u=t[i+1],c=t[i+2],128===(192&u)&&128===(192&c)&&(f=(15&o)<<12|(63&u)<<6|63&c,f>2047&&(f<55296||f>57343)&&(a=f));break;case 4:u=t[i+1],c=t[i+2],l=t[i+3],128===(192&u)&&128===(192&c)&&128===(192&l)&&(f=(15&o)<<18|(63&u)<<12|(63&c)<<6|63&l,f>65535&&f<1114112&&(a=f))}}null===a?(a=65533,s=1):a>65535&&(a-=65536,r.push(a>>>10&1023|55296),a=56320|1023&a),r.push(a),i+=s}return R(r)}function R(t){var e=t.length;if(e<=tt)return String.fromCharCode.apply(String,t);for(var n="",r=0;r<e;)n+=String.fromCharCode.apply(String,t.slice(r,r+=tt));return n}function O(t,e,n){var r="";n=Math.min(t.length,n);for(var i=e;i<n;++i)r+=String.fromCharCode(127&t[i]);return r}function D(t,e,n){var r="";n=Math.min(t.length,n);for(var i=e;i<n;++i)r+=String.fromCharCode(t[i]);return r}function q(t,e,n){var r=t.length;(!e||e<0)&&(e=0),(!n||n<0||n>r)&&(n=r);for(var i="",o=e;o<n;++o)i+=H(t[o]);return i}function I(t,e,n){for(var r=t.slice(e,n),i="",o=0;o<r.length;o+=2)i+=String.fromCharCode(r[o]+256*r[o+1]);return i}function B(t,e,n){if(t%1!==0||t<0)throw new RangeError("offset is not uint");if(t+e>n)throw new RangeError("Trying to access beyond buffer length")}function j(e,n,r,i,o,a){if(!t.isBuffer(e))throw new TypeError('"buffer" argument must be a Buffer instance');if(n>o||n<a)throw new RangeError('"value" argument is out of bounds');if(r+i>e.length)throw new RangeError("Index out of range")}function N(t,e,n,r){e<0&&(e=65535+e+1);for(var i=0,o=Math.min(t.length-n,2);i<o;++i)t[n+i]=(e&255<<8*(r?i:1-i))>>>8*(r?i:1-i)}function M(t,e,n,r){e<0&&(e=4294967295+e+1);for(var i=0,o=Math.min(t.length-n,4);i<o;++i)t[n+i]=e>>>8*(r?i:3-i)&255}function P(t,e,n,r,i,o){if(n+r>t.length)throw new RangeError("Index out of range");if(n<0)throw new RangeError("Index out of range")}function U(t,e,n,r,i){return i||P(t,e,n,4,3.4028234663852886e38,-3.4028234663852886e38),X.write(t,e,n,r,23,4),n+4}function z(t,e,n,r,i){return i||P(t,e,n,8,1.7976931348623157e308,-1.7976931348623157e308),X.write(t,e,n,r,52,8),n+8}function F(t){if(t=V(t).replace(et,""),t.length<2)return"";for(;t.length%4!==0;)t+="=";return t}function V(t){return t.trim?t.trim():t.replace(/^\s+|\s+$/g,"")}function H(t){return t<16?"0"+t.toString(16):t.toString(16)}function G(t,e){e=e||1/0;for(var n,r=t.length,i=null,o=[],a=0;a<r;++a){if(n=t.charCodeAt(a),n>55295&&n<57344){if(!i){if(n>56319){(e-=3)>-1&&o.push(239,191,189);continue}if(a+1===r){(e-=3)>-1&&o.push(239,191,189);continue}i=n;continue}if(n<56320){(e-=3)>-1&&o.push(239,191,189),i=n;continue}n=(i-55296<<10|n-56320)+65536}else i&&(e-=3)>-1&&o.push(239,191,189);if(i=null,n<128){if((e-=1)<0)break;o.push(n)}else if(n<2048){if((e-=2)<0)break;o.push(n>>6|192,63&n|128)}else if(n<65536){if((e-=3)<0)break;o.push(n>>12|224,n>>6&63|128,63&n|128)}else{if(!(n<1114112))throw new Error("Invalid code point");if((e-=4)<0)break;o.push(n>>18|240,n>>12&63|128,n>>6&63|128,63&n|128)}}return o}function W(t){for(var e=[],n=0;n<t.length;++n)e.push(255&t.charCodeAt(n));return e}function Y(t,e){for(var n,r,i,o=[],a=0;a<t.length&&!((e-=2)<0);++a)n=t.charCodeAt(a),r=n>>8,i=n%256,o.push(i),o.push(r);return o}function $(t){return J.toByteArray(F(t))}function Z(t,e,n,r){for(var i=0;i<r&&!(i+n>=e.length||i>=t.length);++i)e[i+n]=t[i];return i}function K(t){return t!==t}var J=n(38),X=n(39),Q=n(40);e.Buffer=t,e.SlowBuffer=v,e.INSPECT_MAX_BYTES=50,t.TYPED_ARRAY_SUPPORT=void 0!==r.TYPED_ARRAY_SUPPORT?r.TYPED_ARRAY_SUPPORT:i(),e.kMaxLength=o(),t.poolSize=8192,t._augment=function(e){return e.__proto__=t.prototype,e},t.from=function(t,e,n){return s(null,t,e,n)},t.TYPED_ARRAY_SUPPORT&&(t.prototype.__proto__=Uint8Array.prototype,t.__proto__=Uint8Array,"undefined"!=typeof Symbol&&Symbol.species&&t[Symbol.species]===t&&Object.defineProperty(t,Symbol.species,{value:null,configurable:!0})),t.alloc=function(t,e,n){return c(null,t,e,n)},t.allocUnsafe=function(t){return l(null,t)},t.allocUnsafeSlow=function(t){return l(null,t)},t.isBuffer=function(t){return!(null==t||!t._isBuffer)},t.compare=function(e,n){if(!t.isBuffer(e)||!t.isBuffer(n))throw new TypeError("Arguments must be Buffers");if(e===n)return 0;for(var r=e.length,i=n.length,o=0,a=Math.min(r,i);o<a;++o)if(e[o]!==n[o]){r=e[o],i=n[o];break}return r<i?-1:i<r?1:0},t.isEncoding=function(t){switch(String(t).toLowerCase()){case"hex":case"utf8":case"utf-8":case"ascii":case"latin1":case"binary":case"base64":case"ucs2":case"ucs-2":case"utf16le":case"utf-16le":return!0;default:return!1}},t.concat=function(e,n){if(!Q(e))throw new TypeError('"list" argument must be an Array of Buffers');if(0===e.length)return t.alloc(0);var r;if(void 0===n)for(n=0,r=0;r<e.length;++r)n+=e[r].length;var i=t.allocUnsafe(n),o=0;for(r=0;r<e.length;++r){var a=e[r];if(!t.isBuffer(a))throw new TypeError('"list" argument must be an Array of Buffers');a.copy(i,o),o+=a.length}return i},t.byteLength=_,t.prototype._isBuffer=!0,t.prototype.swap16=function(){var t=this.length;if(t%2!==0)throw new RangeError("Buffer size must be a multiple of 16-bits");for(var e=0;e<t;e+=2)b(this,e,e+1);return this},t.prototype.swap32=function(){var t=this.length;if(t%4!==0)throw new RangeError("Buffer size must be a multiple of 32-bits");for(var e=0;e<t;e+=4)b(this,e,e+3),b(this,e+1,e+2);return this},t.prototype.swap64=function(){var t=this.length;if(t%8!==0)throw new RangeError("Buffer size must be a multiple of 64-bits");for(var e=0;e<t;e+=8)b(this,e,e+7),b(this,e+1,e+6),b(this,e+2,e+5),b(this,e+3,e+4);return this},t.prototype.toString=function(){var t=0|this.length;return 0===t?"":0===arguments.length?C(this,0,t):m.apply(this,arguments)},t.prototype.equals=function(e){if(!t.isBuffer(e))throw new TypeError("Argument must be a Buffer");return this===e||0===t.compare(this,e)},t.prototype.inspect=function(){var t="",n=e.INSPECT_MAX_BYTES;return this.length>0&&(t=this.toString("hex",0,n).match(/.{2}/g).join(" "),this.length>n&&(t+=" ... ")),"<Buffer "+t+">"},t.prototype.compare=function(e,n,r,i,o){if(!t.isBuffer(e))throw new TypeError("Argument must be a Buffer");if(void 0===n&&(n=0),void 0===r&&(r=e?e.length:0),void 0===i&&(i=0),void 0===o&&(o=this.length),n<0||r>e.length||i<0||o>this.length)throw new RangeError("out of range index");if(i>=o&&n>=r)return 0;if(i>=o)return-1;if(n>=r)return 1;if(n>>>=0,r>>>=0,i>>>=0,o>>>=0,this===e)return 0;for(var a=o-i,s=r-n,u=Math.min(a,s),c=this.slice(i,o),l=e.slice(n,r),f=0;f<u;++f)if(c[f]!==l[f]){a=c[f],s=l[f];break}return a<s?-1:s<a?1:0},t.prototype.includes=function(t,e,n){return this.indexOf(t,e,n)!==-1},t.prototype.indexOf=function(t,e,n){return y(this,t,e,n,!0)},t.prototype.lastIndexOf=function(t,e,n){return y(this,t,e,n,!1)},t.prototype.write=function(t,e,n,r){if(void 0===e)r="utf8",n=this.length,e=0;else if(void 0===n&&"string"==typeof e)r=e,n=this.length,e=0;else{if(!isFinite(e))throw new Error("Buffer.write(string, encoding, offset[, length]) is no longer supported");e|=0,isFinite(n)?(n|=0,void 0===r&&(r="utf8")):(r=n,n=void 0)}var i=this.length-e;if((void 0===n||n>i)&&(n=i),t.length>0&&(n<0||e<0)||e>this.length)throw new RangeError("Attempt to write outside buffer bounds");r||(r="utf8");for(var o=!1;;)switch(r){case"hex":return x(this,t,e,n);case"utf8":case"utf-8":return E(this,t,e,n);case"ascii":return S(this,t,e,n);case"latin1":case"binary":return A(this,t,e,n);case"base64":return L(this,t,e,n);case"ucs2":case"ucs-2":case"utf16le":case"utf-16le":return k(this,t,e,n);default:if(o)throw new TypeError("Unknown encoding: "+r);r=(""+r).toLowerCase(),o=!0}},t.prototype.toJSON=function(){return{type:"Buffer",data:Array.prototype.slice.call(this._arr||this,0)}};var tt=4096;t.prototype.slice=function(e,n){var r=this.length;e=~~e,n=void 0===n?r:~~n,e<0?(e+=r,e<0&&(e=0)):e>r&&(e=r),n<0?(n+=r,n<0&&(n=0)):n>r&&(n=r),n<e&&(n=e);var i;if(t.TYPED_ARRAY_SUPPORT)i=this.subarray(e,n),i.__proto__=t.prototype;else{var o=n-e;i=new t(o,void 0);for(var a=0;a<o;++a)i[a]=this[a+e]}return i},t.prototype.readUIntLE=function(t,e,n){t|=0,e|=0,n||B(t,e,this.length);for(var r=this[t],i=1,o=0;++o<e&&(i*=256);)r+=this[t+o]*i;return r},t.prototype.readUIntBE=function(t,e,n){t|=0,e|=0,n||B(t,e,this.length);for(var r=this[t+--e],i=1;e>0&&(i*=256);)r+=this[t+--e]*i;return r},t.prototype.readUInt8=function(t,e){return e||B(t,1,this.length),this[t]},t.prototype.readUInt16LE=function(t,e){return e||B(t,2,this.length),this[t]|this[t+1]<<8},t.prototype.readUInt16BE=function(t,e){return e||B(t,2,this.length),this[t]<<8|this[t+1]},t.prototype.readUInt32LE=function(t,e){return e||B(t,4,this.length),(this[t]|this[t+1]<<8|this[t+2]<<16)+16777216*this[t+3]},t.prototype.readUInt32BE=function(t,e){return e||B(t,4,this.length),16777216*this[t]+(this[t+1]<<16|this[t+2]<<8|this[t+3])},t.prototype.readIntLE=function(t,e,n){t|=0,e|=0,n||B(t,e,this.length);for(var r=this[t],i=1,o=0;++o<e&&(i*=256);)r+=this[t+o]*i;return i*=128,r>=i&&(r-=Math.pow(2,8*e)),r},t.prototype.readIntBE=function(t,e,n){t|=0,e|=0,n||B(t,e,this.length);for(var r=e,i=1,o=this[t+--r];r>0&&(i*=256);)o+=this[t+--r]*i;return i*=128,o>=i&&(o-=Math.pow(2,8*e)),o},t.prototype.readInt8=function(t,e){return e||B(t,1,this.length),128&this[t]?(255-this[t]+1)*-1:this[t]},t.prototype.readInt16LE=function(t,e){e||B(t,2,this.length);var n=this[t]|this[t+1]<<8;return 32768&n?4294901760|n:n},t.prototype.readInt16BE=function(t,e){e||B(t,2,this.length);var n=this[t+1]|this[t]<<8;return 32768&n?4294901760|n:n},t.prototype.readInt32LE=function(t,e){return e||B(t,4,this.length),this[t]|this[t+1]<<8|this[t+2]<<16|this[t+3]<<24},t.prototype.readInt32BE=function(t,e){return e||B(t,4,this.length),this[t]<<24|this[t+1]<<16|this[t+2]<<8|this[t+3]},t.prototype.readFloatLE=function(t,e){return e||B(t,4,this.length),X.read(this,t,!0,23,4)},t.prototype.readFloatBE=function(t,e){return e||B(t,4,this.length),X.read(this,t,!1,23,4)},t.prototype.readDoubleLE=function(t,e){return e||B(t,8,this.length),X.read(this,t,!0,52,8)},t.prototype.readDoubleBE=function(t,e){return e||B(t,8,this.length),X.read(this,t,!1,52,8)},t.prototype.writeUIntLE=function(t,e,n,r){if(t=+t,e|=0,n|=0,!r){var i=Math.pow(2,8*n)-1;j(this,t,e,n,i,0)}var o=1,a=0;for(this[e]=255&t;++a<n&&(o*=256);)this[e+a]=t/o&255;return e+n},t.prototype.writeUIntBE=function(t,e,n,r){if(t=+t,e|=0,n|=0,!r){var i=Math.pow(2,8*n)-1;j(this,t,e,n,i,0)}var o=n-1,a=1;for(this[e+o]=255&t;--o>=0&&(a*=256);)this[e+o]=t/a&255;return e+n},t.prototype.writeUInt8=function(e,n,r){return e=+e,n|=0,r||j(this,e,n,1,255,0),t.TYPED_ARRAY_SUPPORT||(e=Math.floor(e)),this[n]=255&e,n+1},t.prototype.writeUInt16LE=function(e,n,r){return e=+e,n|=0,r||j(this,e,n,2,65535,0),t.TYPED_ARRAY_SUPPORT?(this[n]=255&e,this[n+1]=e>>>8):N(this,e,n,!0),n+2},t.prototype.writeUInt16BE=function(e,n,r){return e=+e,n|=0,r||j(this,e,n,2,65535,0),t.TYPED_ARRAY_SUPPORT?(this[n]=e>>>8,this[n+1]=255&e):N(this,e,n,!1),n+2},t.prototype.writeUInt32LE=function(e,n,r){return e=+e,n|=0,r||j(this,e,n,4,4294967295,0),t.TYPED_ARRAY_SUPPORT?(this[n+3]=e>>>24,this[n+2]=e>>>16,this[n+1]=e>>>8,this[n]=255&e):M(this,e,n,!0),n+4},t.prototype.writeUInt32BE=function(e,n,r){return e=+e,n|=0,r||j(this,e,n,4,4294967295,0),t.TYPED_ARRAY_SUPPORT?(this[n]=e>>>24,this[n+1]=e>>>16,this[n+2]=e>>>8,this[n+3]=255&e):M(this,e,n,!1),n+4},t.prototype.writeIntLE=function(t,e,n,r){if(t=+t,e|=0,!r){var i=Math.pow(2,8*n-1);j(this,t,e,n,i-1,-i)}var o=0,a=1,s=0;for(this[e]=255&t;++o<n&&(a*=256);)t<0&&0===s&&0!==this[e+o-1]&&(s=1),this[e+o]=(t/a>>0)-s&255;return e+n},t.prototype.writeIntBE=function(t,e,n,r){if(t=+t,e|=0,!r){var i=Math.pow(2,8*n-1);j(this,t,e,n,i-1,-i)}var o=n-1,a=1,s=0;for(this[e+o]=255&t;--o>=0&&(a*=256);)t<0&&0===s&&0!==this[e+o+1]&&(s=1),this[e+o]=(t/a>>0)-s&255;return e+n},t.prototype.writeInt8=function(e,n,r){return e=+e,n|=0,r||j(this,e,n,1,127,-128),t.TYPED_ARRAY_SUPPORT||(e=Math.floor(e)),e<0&&(e=255+e+1),this[n]=255&e,n+1},t.prototype.writeInt16LE=function(e,n,r){return e=+e,n|=0,r||j(this,e,n,2,32767,-32768),t.TYPED_ARRAY_SUPPORT?(this[n]=255&e,this[n+1]=e>>>8):N(this,e,n,!0),n+2},t.prototype.writeInt16BE=function(e,n,r){return e=+e,n|=0,r||j(this,e,n,2,32767,-32768),t.TYPED_ARRAY_SUPPORT?(this[n]=e>>>8,this[n+1]=255&e):N(this,e,n,!1),n+2},t.prototype.writeInt32LE=function(e,n,r){return e=+e,n|=0,r||j(this,e,n,4,2147483647,-2147483648),t.TYPED_ARRAY_SUPPORT?(this[n]=255&e,this[n+1]=e>>>8,this[n+2]=e>>>16,this[n+3]=e>>>24):M(this,e,n,!0),n+4},t.prototype.writeInt32BE=function(e,n,r){return e=+e,n|=0,r||j(this,e,n,4,2147483647,-2147483648),e<0&&(e=4294967295+e+1),t.TYPED_ARRAY_SUPPORT?(this[n]=e>>>24,this[n+1]=e>>>16,this[n+2]=e>>>8,this[n+3]=255&e):M(this,e,n,!1),n+4},t.prototype.writeFloatLE=function(t,e,n){return U(this,t,e,!0,n)},t.prototype.writeFloatBE=function(t,e,n){return U(this,t,e,!1,n)},t.prototype.writeDoubleLE=function(t,e,n){return z(this,t,e,!0,n)},t.prototype.writeDoubleBE=function(t,e,n){return z(this,t,e,!1,n)},t.prototype.copy=function(e,n,r,i){if(r||(r=0),i||0===i||(i=this.length),n>=e.length&&(n=e.length),n||(n=0),i>0&&i<r&&(i=r),i===r)return 0;if(0===e.length||0===this.length)return 0;if(n<0)throw new RangeError("targetStart out of bounds");if(r<0||r>=this.length)throw new RangeError("sourceStart out of bounds");if(i<0)throw new RangeError("sourceEnd out of bounds");i>this.length&&(i=this.length),e.length-n<i-r&&(i=e.length-n+r);var o,a=i-r;if(this===e&&r<n&&n<i)for(o=a-1;o>=0;--o)e[o+n]=this[o+r];else if(a<1e3||!t.TYPED_ARRAY_SUPPORT)for(o=0;o<a;++o)e[o+n]=this[o+r];else Uint8Array.prototype.set.call(e,this.subarray(r,r+a),n);return a},t.prototype.fill=function(e,n,r,i){if("string"==typeof e){if("string"==typeof n?(i=n,n=0,r=this.length):"string"==typeof r&&(i=r,r=this.length),1===e.length){var o=e.charCodeAt(0);o<256&&(e=o)}if(void 0!==i&&"string"!=typeof i)throw new TypeError("encoding must be a string");if("string"==typeof i&&!t.isEncoding(i))throw new TypeError("Unknown encoding: "+i)}else"number"==typeof e&&(e&=255);if(n<0||this.length<n||this.length<r)throw new RangeError("Out of range index");if(r<=n)return this;n>>>=0,r=void 0===r?this.length:r>>>0,e||(e=0);var a;if("number"==typeof e)for(a=n;a<r;++a)this[a]=e;else{var s=t.isBuffer(e)?e:G(new t(e,i).toString()),u=s.length;for(a=0;a<r-n;++a)this[a+n]=s[a%u]}return this};var et=/[^+\/0-9A-Za-z-_]/g}).call(e,n(37).Buffer,function(){return this}())},function(t,e){"use strict";function n(t){var e=t.length;if(e%4>0)throw new Error("Invalid string. Length must be a multiple of 4");return"="===t[e-2]?2:"="===t[e-1]?1:0}function r(t){return 3*t.length/4-n(t)}function i(t){var e,r,i,o,a,s,u=t.length;a=n(t),s=new l(3*u/4-a),i=a>0?u-4:u;var f=0;for(e=0,r=0;e<i;e+=4,r+=3)o=c[t.charCodeAt(e)]<<18|c[t.charCodeAt(e+1)]<<12|c[t.charCodeAt(e+2)]<<6|c[t.charCodeAt(e+3)],s[f++]=o>>16&255,s[f++]=o>>8&255,s[f++]=255&o;return 2===a?(o=c[t.charCodeAt(e)]<<2|c[t.charCodeAt(e+1)]>>4,s[f++]=255&o):1===a&&(o=c[t.charCodeAt(e)]<<10|c[t.charCodeAt(e+1)]<<4|c[t.charCodeAt(e+2)]>>2,s[f++]=o>>8&255,s[f++]=255&o),s}function o(t){return u[t>>18&63]+u[t>>12&63]+u[t>>6&63]+u[63&t]}function a(t,e,n){for(var r,i=[],a=e;a<n;a+=3)r=(t[a]<<16)+(t[a+1]<<8)+t[a+2],i.push(o(r));return i.join("")}function s(t){for(var e,n=t.length,r=n%3,i="",o=[],s=16383,c=0,l=n-r;c<l;c+=s)o.push(a(t,c,c+s>l?l:c+s));return 1===r?(e=t[n-1],i+=u[e>>2],i+=u[e<<4&63],i+="=="):2===r&&(e=(t[n-2]<<8)+t[n-1],i+=u[e>>10],i+=u[e>>4&63],i+=u[e<<2&63],i+="="),o.push(i),o.join("")}e.byteLength=r,e.toByteArray=i,e.fromByteArray=s;for(var u=[],c=[],l="undefined"!=typeof Uint8Array?Uint8Array:Array,f="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",h=0,p=f.length;h<p;++h)u[h]=f[h],c[f.charCodeAt(h)]=h;c["-".charCodeAt(0)]=62,c["_".charCodeAt(0)]=63},function(t,e){e.read=function(t,e,n,r,i){var o,a,s=8*i-r-1,u=(1<<s)-1,c=u>>1,l=-7,f=n?i-1:0,h=n?-1:1,p=t[e+f];for(f+=h,o=p&(1<<-l)-1,p>>=-l,l+=s;l>0;o=256*o+t[e+f],f+=h,l-=8);for(a=o&(1<<-l)-1,o>>=-l,l+=r;l>0;a=256*a+t[e+f],f+=h,l-=8);if(0===o)o=1-c;else{if(o===u)return a?NaN:(p?-1:1)*(1/0);a+=Math.pow(2,r),o-=c}return(p?-1:1)*a*Math.pow(2,o-r)},e.write=function(t,e,n,r,i,o){var a,s,u,c=8*o-i-1,l=(1<<c)-1,f=l>>1,h=23===i?Math.pow(2,-24)-Math.pow(2,-77):0,p=r?0:o-1,d=r?1:-1,g=e<0||0===e&&1/e<0?1:0;for(e=Math.abs(e),isNaN(e)||e===1/0?(s=isNaN(e)?1:0,a=l):(a=Math.floor(Math.log(e)/Math.LN2),e*(u=Math.pow(2,-a))<1&&(a--,u*=2),e+=a+f>=1?h/u:h*Math.pow(2,1-f),e*u>=2&&(a++,u/=2),a+f>=l?(s=0,a=l):a+f>=1?(s=(e*u-1)*Math.pow(2,i),a+=f):(s=e*Math.pow(2,f-1)*Math.pow(2,i),a=0));i>=8;t[n+p]=255&s,p+=d,s/=256,i-=8);for(a=a<<i|s,c+=i;c>0;t[n+p]=255&a,p+=d,a/=256,c-=8);t[n+p-d]|=128*g}},function(t,e){var n={}.toString;t.exports=Array.isArray||function(t){return"[object Array]"==n.call(t)}},function(t,e,n){(function(t){function n(t){return Array.isArray?Array.isArray(t):"[object Array]"===v(t)}function r(t){return"boolean"==typeof t}function i(t){return null===t}function o(t){return null==t}function a(t){return"number"==typeof t}function s(t){return"string"==typeof t}function u(t){return"symbol"==typeof t}function c(t){return void 0===t}function l(t){return"[object RegExp]"===v(t)}function f(t){return"object"==typeof t&&null!==t}function h(t){return"[object Date]"===v(t)}function p(t){return"[object Error]"===v(t)||t instanceof Error}function d(t){return"function"==typeof t}function g(t){return null===t||"boolean"==typeof t||"number"==typeof t||"string"==typeof t||"symbol"==typeof t||"undefined"==typeof t}function v(t){return Object.prototype.toString.call(t)}e.isArray=n,e.isBoolean=r,e.isNull=i,e.isNullOrUndefined=o,e.isNumber=a,e.isString=s,e.isSymbol=u,e.isUndefined=c,e.isRegExp=l,e.isObject=f,e.isDate=h,e.isError=p,e.isFunction=d,e.isPrimitive=g,e.isBuffer=t.isBuffer}).call(e,n(37).Buffer)},function(t,e){},function(t,e,n){(function(e){function r(t){return this instanceof r?(u.call(this,t),c.call(this,t),t&&t.readable===!1&&(this.readable=!1),t&&t.writable===!1&&(this.writable=!1),this.allowHalfOpen=!0,t&&t.allowHalfOpen===!1&&(this.allowHalfOpen=!1),void this.once("end",i)):new r(t)}function i(){this.allowHalfOpen||this._writableState.ended||e.nextTick(this.end.bind(this))}function o(t,e){for(var n=0,r=t.length;n<r;n++)e(t[n],n)}t.exports=r;var a=Object.keys||function(t){var e=[];for(var n in t)e.push(n);return e},s=n(41);s.inherits=n(23);var u=n(35),c=n(44);s.inherits(r,u),o(a(c.prototype),function(t){r.prototype[t]||(r.prototype[t]=c.prototype[t])})}).call(e,n(34))},function(t,e,n){(function(e){function r(t,e,n){this.chunk=t,this.encoding=e,this.callback=n}function i(t,e){var r=n(43);t=t||{};var i=t.highWaterMark,o=t.objectMode?16:16384;this.highWaterMark=i||0===i?i:o,this.objectMode=!!t.objectMode,e instanceof r&&(this.objectMode=this.objectMode||!!t.writableObjectMode),this.highWaterMark=~~this.highWaterMark,this.needDrain=!1,this.ending=!1,this.ended=!1,this.finished=!1;var a=t.decodeStrings===!1;this.decodeStrings=!a,this.defaultEncoding=t.defaultEncoding||"utf8",this.length=0,this.writing=!1,this.corked=0,this.sync=!0,this.bufferProcessing=!1,this.onwrite=function(t){p(e,t)},this.writecb=null,this.writelen=0,this.buffer=[],this.pendingcb=0,this.prefinished=!1,this.errorEmitted=!1}function o(t){var e=n(43);return this instanceof o||this instanceof e?(this._writableState=new i(t,this),this.writable=!0,void E.call(this)):new o(t)}function a(t,n,r){var i=new Error("write after end");t.emit("error",i),e.nextTick(function(){r(i)})}function s(t,n,r,i){var o=!0;if(!(x.isBuffer(r)||x.isString(r)||x.isNullOrUndefined(r)||n.objectMode)){var a=new TypeError("Invalid non-string/buffer chunk");t.emit("error",a),e.nextTick(function(){i(a)}),o=!1}return o}function u(t,e,n){return!t.objectMode&&t.decodeStrings!==!1&&x.isString(e)&&(e=new w(e,n)),e}function c(t,e,n,i,o){n=u(e,n,i),x.isBuffer(n)&&(i="buffer");var a=e.objectMode?1:n.length;e.length+=a;var s=e.length<e.highWaterMark;return s||(e.needDrain=!0),e.writing||e.corked?e.buffer.push(new r(n,i,o)):l(t,e,!1,a,n,i,o),s}function l(t,e,n,r,i,o,a){e.writelen=r,e.writecb=a,e.writing=!0,e.sync=!0,n?t._writev(i,e.onwrite):t._write(i,o,e.onwrite),e.sync=!1}function f(t,n,r,i,o){r?e.nextTick(function(){n.pendingcb--,o(i)}):(n.pendingcb--,o(i)),t._writableState.errorEmitted=!0,t.emit("error",i)}function h(t){t.writing=!1,t.writecb=null,t.length-=t.writelen,t.writelen=0}function p(t,n){var r=t._writableState,i=r.sync,o=r.writecb;if(h(r),n)f(t,r,i,n,o);else{var a=_(t,r);a||r.corked||r.bufferProcessing||!r.buffer.length||v(t,r),i?e.nextTick(function(){d(t,r,a,o)}):d(t,r,a,o)}}function d(t,e,n,r){n||g(t,e),e.pendingcb--,r(),b(t,e)}function g(t,e){0===e.length&&e.needDrain&&(e.needDrain=!1,t.emit("drain"))}function v(t,e){if(e.bufferProcessing=!0,t._writev&&e.buffer.length>1){for(var n=[],r=0;r<e.buffer.length;r++)n.push(e.buffer[r].callback);e.pendingcb++,l(t,e,!0,e.length,e.buffer,"",function(t){for(var r=0;r<n.length;r++)e.pendingcb--,n[r](t)}),e.buffer=[]}else{for(var r=0;r<e.buffer.length;r++){var i=e.buffer[r],o=i.chunk,a=i.encoding,s=i.callback,u=e.objectMode?1:o.length;if(l(t,e,!1,u,o,a,s),e.writing){r++;break}}r<e.buffer.length?e.buffer=e.buffer.slice(r):e.buffer.length=0}e.bufferProcessing=!1}function _(t,e){return e.ending&&0===e.length&&!e.finished&&!e.writing}function m(t,e){e.prefinished||(e.prefinished=!0,t.emit("prefinish"))}function b(t,e){var n=_(t,e);return n&&(0===e.pendingcb?(m(t,e),e.finished=!0,t.emit("finish")):m(t,e)),n}function y(t,n,r){n.ending=!0,b(t,n),r&&(n.finished?e.nextTick(r):t.once("finish",r)),n.ended=!0}t.exports=o;var w=n(37).Buffer;o.WritableState=i;var x=n(41);x.inherits=n(23);var E=n(32);x.inherits(o,E),o.prototype.pipe=function(){this.emit("error",new Error("Cannot pipe. Not readable."))},o.prototype.write=function(t,e,n){var r=this._writableState,i=!1;return x.isFunction(e)&&(n=e,e=null),x.isBuffer(t)?e="buffer":e||(e=r.defaultEncoding),x.isFunction(n)||(n=function(){}),r.ended?a(this,r,n):s(this,r,t,n)&&(r.pendingcb++,i=c(this,r,t,e,n)),i},o.prototype.cork=function(){var t=this._writableState;t.corked++},o.prototype.uncork=function(){var t=this._writableState;t.corked&&(t.corked--,t.writing||t.corked||t.finished||t.bufferProcessing||!t.buffer.length||v(this,t))},o.prototype._write=function(t,e,n){n(new Error("not implemented"))},o.prototype._writev=null,o.prototype.end=function(t,e,n){var r=this._writableState;x.isFunction(t)?(n=t,t=null,e=null):x.isFunction(e)&&(n=e,e=null),x.isNullOrUndefined(t)||this.write(t,e),r.corked&&(r.corked=1,this.uncork()),r.ending||r.finished||y(this,r,n)}}).call(e,n(34))},function(t,e,n){function r(t){if(t&&!u(t))throw new Error("Unknown encoding: "+t)}function i(t){return t.toString(this.encoding)}function o(t){this.charReceived=t.length%2,this.charLength=this.charReceived?2:0}function a(t){this.charReceived=t.length%3,this.charLength=this.charReceived?3:0}var s=n(37).Buffer,u=s.isEncoding||function(t){switch(t&&t.toLowerCase()){case"hex":case"utf8":case"utf-8":case"ascii":case"binary":case"base64":case"ucs2":case"ucs-2":case"utf16le":case"utf-16le":case"raw":return!0;default:return!1}},c=e.StringDecoder=function(t){switch(this.encoding=(t||"utf8").toLowerCase().replace(/[-_]/,""),r(t),this.encoding){case"utf8":this.surrogateSize=3;break;case"ucs2":case"utf16le":this.surrogateSize=2,this.detectIncompleteChar=o;break;case"base64":this.surrogateSize=3,this.detectIncompleteChar=a;break;default:return void(this.write=i)}this.charBuffer=new s(6),this.charReceived=0,this.charLength=0};c.prototype.write=function(t){for(var e="";this.charLength;){var n=t.length>=this.charLength-this.charReceived?this.charLength-this.charReceived:t.length;if(t.copy(this.charBuffer,this.charReceived,0,n),this.charReceived+=n,this.charReceived<this.charLength)return"";t=t.slice(n,t.length),e=this.charBuffer.slice(0,this.charLength).toString(this.encoding);var r=e.charCodeAt(e.length-1);if(!(r>=55296&&r<=56319)){if(this.charReceived=this.charLength=0,0===t.length)return e;break}this.charLength+=this.surrogateSize,e=""}this.detectIncompleteChar(t);var i=t.length;this.charLength&&(t.copy(this.charBuffer,0,t.length-this.charReceived,i),i-=this.charReceived),e+=t.toString(this.encoding,0,i);var i=e.length-1,r=e.charCodeAt(i);if(r>=55296&&r<=56319){var o=this.surrogateSize;return this.charLength+=o,this.charReceived+=o,this.charBuffer.copy(this.charBuffer,o,0,o),t.copy(this.charBuffer,0,0,o),e.substring(0,i)}return e},c.prototype.detectIncompleteChar=function(t){for(var e=t.length>=3?3:t.length;e>0;e--){var n=t[t.length-e];if(1==e&&n>>5==6){this.charLength=2;break}if(e<=2&&n>>4==14){this.charLength=3;break}if(e<=3&&n>>3==30){this.charLength=4;break}}this.charReceived=e},c.prototype.end=function(t){var e="";if(t&&t.length&&(e=this.write(t)),this.charReceived){var n=this.charReceived,r=this.charBuffer,i=this.encoding;e+=r.slice(0,n).toString(i)}return e}},function(t,e,n){function r(t,e){this.afterTransform=function(t,n){return i(e,t,n)},this.needTransform=!1,this.transforming=!1,this.writecb=null,this.writechunk=null}function i(t,e,n){var r=t._transformState;r.transforming=!1;var i=r.writecb;if(!i)return t.emit("error",new Error("no writecb in Transform class"));r.writechunk=null,r.writecb=null,u.isNullOrUndefined(n)||t.push(n),i&&i(e);var o=t._readableState;o.reading=!1,(o.needReadable||o.length<o.highWaterMark)&&t._read(o.highWaterMark)}function o(t){if(!(this instanceof o))return new o(t);s.call(this,t),this._transformState=new r(t,this);var e=this;this._readableState.needReadable=!0,this._readableState.sync=!1,this.once("prefinish",function(){u.isFunction(this._flush)?this._flush(function(t){a(e,t)}):a(e)})}function a(t,e){if(e)return t.emit("error",e);var n=t._writableState,r=t._transformState;if(n.length)throw new Error("calling transform done when ws.length != 0");if(r.transforming)throw new Error("calling transform done when still transforming");return t.push(null)}t.exports=o;var s=n(43),u=n(41);u.inherits=n(23),u.inherits(o,s),o.prototype.push=function(t,e){return this._transformState.needTransform=!1,s.prototype.push.call(this,t,e)},o.prototype._transform=function(t,e,n){throw new Error("not implemented")},o.prototype._write=function(t,e,n){var r=this._transformState;if(r.writecb=n,r.writechunk=t,r.writeencoding=e,!r.transforming){var i=this._readableState;(r.needTransform||i.needReadable||i.length<i.highWaterMark)&&this._read(i.highWaterMark)}},o.prototype._read=function(t){var e=this._transformState;u.isNull(e.writechunk)||!e.writecb||e.transforming?e.needTransform=!0:(e.transforming=!0,
this._transform(e.writechunk,e.writeencoding,e.afterTransform))}},function(t,e,n){function r(t){return this instanceof r?void i.call(this,t):new r(t)}t.exports=r;var i=n(46),o=n(41);o.inherits=n(23),o.inherits(r,i),r.prototype._transform=function(t,e,n){n(null,t)}},function(t,e,n){t.exports=n(44)},function(t,e,n){t.exports=n(43)},function(t,e,n){t.exports=n(46)},function(t,e,n){t.exports=n(47)},function(t,e){},function(t,e,n){function r(t){this._cbs=t||{}}t.exports=r;var i=n(15).EVENTS;Object.keys(i).forEach(function(t){if(0===i[t])t="on"+t,r.prototype[t]=function(){this._cbs[t]&&this._cbs[t]()};else if(1===i[t])t="on"+t,r.prototype[t]=function(e){this._cbs[t]&&this._cbs[t](e)};else{if(2!==i[t])throw Error("wrong number of arguments");t="on"+t,r.prototype[t]=function(e,n){this._cbs[t]&&this._cbs[t](e,n)}}})},function(t,e,n){var r=t.exports;[n(55),n(61),n(62),n(63),n(64),n(65)].forEach(function(t){Object.keys(t).forEach(function(e){r[e]=t[e].bind(r)})})},function(t,e,n){function r(t,e){return t.children?t.children.map(function(t){return a(t,e)}).join(""):""}function i(t){return Array.isArray(t)?t.map(i).join(""):s(t)||t.type===o.CDATA?i(t.children):t.type===o.Text?t.data:""}var o=n(26),a=n(56),s=o.isTag;t.exports={getInnerHTML:r,getOuterHTML:a,getText:i}},function(t,e,n){function r(t,e){if(t){var n,r="";for(var i in t)n=t[i],r&&(r+=" "),r+=!n&&f[i]?i:i+'="'+(e.decodeEntities?l.encodeXML(n):n)+'"';return r}}function i(t,e){"svg"===t.name&&(e={decodeEntities:e.decodeEntities,xmlMode:!0});var n="<"+t.name,i=r(t.attribs,e);return i&&(n+=" "+i),!e.xmlMode||t.children&&0!==t.children.length?(n+=">",t.children&&(n+=d(t.children,e)),p[t.name]&&!e.xmlMode||(n+="</"+t.name+">")):n+="/>",n}function o(t){return"<"+t.data+">"}function a(t,e){var n=t.data||"";return!e.decodeEntities||t.parent&&t.parent.name in h||(n=l.encodeXML(n)),n}function s(t){return"<![CDATA["+t.children[0].data+"]]>"}function u(t){return"<!--"+t.data+"-->"}var c=n(57),l=n(58),f={__proto__:null,allowfullscreen:!0,async:!0,autofocus:!0,autoplay:!0,checked:!0,controls:!0,default:!0,defer:!0,disabled:!0,hidden:!0,ismap:!0,loop:!0,multiple:!0,muted:!0,open:!0,readonly:!0,required:!0,reversed:!0,scoped:!0,seamless:!0,selected:!0,typemustmatch:!0},h={__proto__:null,style:!0,script:!0,xmp:!0,iframe:!0,noembed:!0,noframes:!0,plaintext:!0,noscript:!0},p={__proto__:null,area:!0,base:!0,basefont:!0,br:!0,col:!0,command:!0,embed:!0,frame:!0,hr:!0,img:!0,input:!0,isindex:!0,keygen:!0,link:!0,meta:!0,param:!0,source:!0,track:!0,wbr:!0},d=t.exports=function(t,e){Array.isArray(t)||t.cheerio||(t=[t]),e=e||{};for(var n="",r=0;r<t.length;r++){var l=t[r];n+="root"===l.type?d(l.children,e):c.isTag(l)?i(l,e):l.type===c.Directive?o(l):l.type===c.Comment?u(l):l.type===c.CDATA?s(l):a(l,e)}return n}},function(t,e){t.exports={Text:"text",Directive:"directive",Comment:"comment",Script:"script",Style:"style",Tag:"tag",CDATA:"cdata",isTag:function(t){return"tag"===t.type||"script"===t.type||"style"===t.type}}},function(t,e,n){var r=n(59),i=n(60);e.decode=function(t,e){return(!e||e<=0?i.XML:i.HTML)(t)},e.decodeStrict=function(t,e){return(!e||e<=0?i.XML:i.HTMLStrict)(t)},e.encode=function(t,e){return(!e||e<=0?r.XML:r.HTML)(t)},e.encodeXML=r.XML,e.encodeHTML4=e.encodeHTML5=e.encodeHTML=r.HTML,e.decodeXML=e.decodeXMLStrict=i.XML,e.decodeHTML4=e.decodeHTML5=e.decodeHTML=i.HTML,e.decodeHTML4Strict=e.decodeHTML5Strict=e.decodeHTMLStrict=i.HTMLStrict,e.escape=r.escape},function(t,e,n){function r(t){return Object.keys(t).sort().reduce(function(e,n){return e[t[n]]="&"+n+";",e},{})}function i(t){var e=[],n=[];return Object.keys(t).forEach(function(t){1===t.length?e.push("\\"+t):n.push(t)}),n.unshift("["+e.join("")+"]"),new RegExp(n.join("|"),"g")}function o(t){return"&#x"+t.charCodeAt(0).toString(16).toUpperCase()+";"}function a(t){var e=t.charCodeAt(0),n=t.charCodeAt(1),r=1024*(e-55296)+n-56320+65536;return"&#x"+r.toString(16).toUpperCase()+";"}function s(t,e){function n(e){return t[e]}return function(t){return t.replace(e,n).replace(d,a).replace(p,o)}}function u(t){return t.replace(g,o).replace(d,a).replace(p,o)}var c=r(n(22)),l=i(c);e.XML=s(c,l);var f=r(n(20)),h=i(f);e.HTML=s(f,h);var p=/[^\0-\x7F]/g,d=/[\uD800-\uDBFF][\uDC00-\uDFFF]/g,g=i(c);e.escape=u},function(t,e,n){function r(t){var e=Object.keys(t).join("|"),n=o(t);e+="|#[xX][\\da-fA-F]+|#\\d+";var r=new RegExp("&(?:"+e+");","g");return function(t){return String(t).replace(r,n)}}function i(t,e){return t<e?1:-1}function o(t){return function(e){return"#"===e.charAt(1)?c("X"===e.charAt(2)||"x"===e.charAt(2)?parseInt(e.substr(3),16):parseInt(e.substr(2),10)):t[e.slice(1,-1)]}}var a=n(20),s=n(21),u=n(22),c=n(18),l=r(u),f=r(a),h=function(){function t(t){return";"!==t.substr(-1)&&(t+=";"),l(t)}for(var e=Object.keys(s).sort(i),n=Object.keys(a).sort(i),r=0,u=0;r<n.length;r++)e[u]===n[r]?(n[r]+=";?",u++):n[r]+=";";var c=new RegExp("&(?:"+n.join("|")+"|#[xX][\\da-fA-F]+;?|#\\d+;?)","g"),l=o(a);return function(e){return String(e).replace(c,t)}}();t.exports={XML:l,HTML:h,HTMLStrict:f}},function(t,e){var n=e.getChildren=function(t){return t.children},r=e.getParent=function(t){return t.parent};e.getSiblings=function(t){var e=r(t);return e?n(e):[t]},e.getAttributeValue=function(t,e){return t.attribs&&t.attribs[e]},e.hasAttrib=function(t,e){return!!t.attribs&&hasOwnProperty.call(t.attribs,e)},e.getName=function(t){return t.name}},function(t,e){e.removeElement=function(t){if(t.prev&&(t.prev.next=t.next),t.next&&(t.next.prev=t.prev),t.parent){var e=t.parent.children;e.splice(e.lastIndexOf(t),1)}},e.replaceElement=function(t,e){var n=e.prev=t.prev;n&&(n.next=e);var r=e.next=t.next;r&&(r.prev=e);var i=e.parent=t.parent;if(i){var o=i.children;o[o.lastIndexOf(t)]=e}},e.appendChild=function(t,e){if(e.parent=t,1!==t.children.push(e)){var n=t.children[t.children.length-2];n.next=e,e.prev=n,e.next=null}},e.append=function(t,e){var n=t.parent,r=t.next;if(e.next=r,e.prev=t,t.next=e,e.parent=n,r){if(r.prev=e,n){var i=n.children;i.splice(i.lastIndexOf(r),0,e)}}else n&&n.children.push(e)},e.prepend=function(t,e){var n=t.parent;if(n){var r=n.children;r.splice(r.lastIndexOf(t),0,e)}t.prev&&(t.prev.next=e),e.parent=n,e.prev=t.prev,e.next=t,t.prev=e}},function(t,e,n){function r(t,e,n,r){return Array.isArray(e)||(e=[e]),"number"==typeof r&&isFinite(r)||(r=1/0),i(t,e,n!==!1,r)}function i(t,e,n,r){for(var o,a=[],s=0,u=e.length;s<u&&!(t(e[s])&&(a.push(e[s]),--r<=0))&&(o=e[s].children,!(n&&o&&o.length>0&&(o=i(t,o,n,r),a=a.concat(o),r-=o.length,r<=0)));s++);return a}function o(t,e){for(var n=0,r=e.length;n<r;n++)if(t(e[n]))return e[n];return null}function a(t,e){for(var n=null,r=0,i=e.length;r<i&&!n;r++)c(e[r])&&(t(e[r])?n=e[r]:e[r].children.length>0&&(n=a(t,e[r].children)));return n}function s(t,e){for(var n=0,r=e.length;n<r;n++)if(c(e[n])&&(t(e[n])||e[n].children.length>0&&s(t,e[n].children)))return!0;return!1}function u(t,e){for(var n=[],r=0,i=e.length;r<i;r++)c(e[r])&&(t(e[r])&&n.push(e[r]),e[r].children.length>0&&(n=n.concat(u(t,e[r].children))));return n}var c=n(26).isTag;t.exports={filter:r,find:i,findOneChild:o,findOne:a,existsOne:s,findAll:u}},function(t,e,n){function r(t,e){return"function"==typeof e?function(n){return n.attribs&&e(n.attribs[t])}:function(n){return n.attribs&&n.attribs[t]===e}}function i(t,e){return function(n){return t(n)||e(n)}}var o=n(26),a=e.isTag=o.isTag;e.testElement=function(t,e){for(var n in t)if(t.hasOwnProperty(n)){if("tag_name"===n){if(!a(e)||!t.tag_name(e.name))return!1}else if("tag_type"===n){if(!t.tag_type(e.type))return!1}else if("tag_contains"===n){if(a(e)||!t.tag_contains(e.data))return!1}else if(!e.attribs||!t[n](e.attribs[n]))return!1}else;return!0};var s={tag_name:function(t){return"function"==typeof t?function(e){return a(e)&&t(e.name)}:"*"===t?a:function(e){return a(e)&&e.name===t}},tag_type:function(t){return"function"==typeof t?function(e){return t(e.type)}:function(e){return e.type===t}},tag_contains:function(t){return"function"==typeof t?function(e){return!a(e)&&t(e.data)}:function(e){return!a(e)&&e.data===t}}};e.getElements=function(t,e,n,o){var a=Object.keys(t).map(function(e){var n=t[e];return e in s?s[e](n):r(e,n)});return 0===a.length?[]:this.filter(a.reduce(i),e,n,o)},e.getElementById=function(t,e,n){return Array.isArray(e)||(e=[e]),this.findOne(r("id",t),e,n!==!1)},e.getElementsByTagName=function(t,e,n,r){return this.filter(s.tag_name(t),e,n,r)},e.getElementsByTagType=function(t,e,n,r){return this.filter(s.tag_type(t),e,n,r)}},function(t,e){e.removeSubsets=function(t){for(var e,n,r,i=t.length;--i>-1;){for(e=n=t[i],t[i]=null,r=!0;n;){if(t.indexOf(n)>-1){r=!1,t.splice(i,1);break}n=n.parent}r&&(t[i]=e)}return t};var n={DISCONNECTED:1,PRECEDING:2,FOLLOWING:4,CONTAINS:8,CONTAINED_BY:16},r=e.compareDocumentPosition=function(t,e){var r,i,o,a,s,u,c=[],l=[];if(t===e)return 0;for(r=t;r;)c.unshift(r),r=r.parent;for(r=e;r;)l.unshift(r),r=r.parent;for(u=0;c[u]===l[u];)u++;return 0===u?n.DISCONNECTED:(i=c[u-1],o=i.children,a=c[u],s=l[u],o.indexOf(a)>o.indexOf(s)?i===e?n.FOLLOWING|n.CONTAINED_BY:n.FOLLOWING:i===t?n.PRECEDING|n.CONTAINS:n.PRECEDING)};e.uniqueSort=function(t){var e,i,o=t.length;for(t=t.slice();--o>-1;)e=t[o],i=t.indexOf(e),i>-1&&i<o&&t.splice(o,1);return t.sort(function(t,e){var i=r(t,e);return i&n.PRECEDING?-1:i&n.FOLLOWING?1:0}),t}},function(t,e,n){function r(t){this._cbs=t||{},this.events=[]}t.exports=r;var i=n(15).EVENTS;Object.keys(i).forEach(function(t){if(0===i[t])t="on"+t,r.prototype[t]=function(){this.events.push([t]),this._cbs[t]&&this._cbs[t]()};else if(1===i[t])t="on"+t,r.prototype[t]=function(e){this.events.push([t,e]),this._cbs[t]&&this._cbs[t](e)};else{if(2!==i[t])throw Error("wrong number of arguments");t="on"+t,r.prototype[t]=function(e,n){this.events.push([t,e,n]),this._cbs[t]&&this._cbs[t](e,n)}}}),r.prototype.onreset=function(){this.events=[],this._cbs.onreset&&this._cbs.onreset()},r.prototype.restart=function(){this._cbs.onreset&&this._cbs.onreset();for(var t=0,e=this.events.length;t<e;t++)if(this._cbs[this.events[t][0]]){var n=this.events[t].length;1===n?this._cbs[this.events[t][0]]():2===n?this._cbs[this.events[t][0]](this.events[t][1]):this._cbs[this.events[t][0]](this.events[t][1],this.events[t][2])}}},function(t,e,n){var r=n(15),i=n(68),o=n(71),a=r.DomHandler,s=function(){this.parser=null,this.attributes={},this.attribArr=[],this.dupes=[],a.apply(this,Array.prototype.slice.call(arguments))};t.exports=s,i.inherits(s,a),s.prototype.initialize=function(t){this.parser=t},s.prototype.onerror=function(t){throw t},s.prototype.onattribute=function(t,e){this.attributes[t]?this.dupes.push(t):(this.attributes[t]={value:e},this.attribArr.push(t))},s.prototype.onopentag=function(t,e){a.prototype.onopentag.call(this,t,e);var n=this._tagStack[this._tagStack.length-1];n.open=this.htmlText.slice(this.parser.startIndex+1,this.parser.endIndex),n.openLineCol=this.lineColFunc(this.parser.startIndex),n.openIndex=this.parser.startIndex,n.hasOwnProperty("lineCol")&&delete n.lineCol,n.attribs=this.attributes,o.inputIndices(n.attribs,n.open,n.openIndex),this.attribArr.sort(function(t,e){return n.attribs[t].nameIndex-n.attribs[e].nameIndex}).forEach(function(t){n.attribs[t].nameLineCol=this.lineColFunc(n.attribs[t].nameIndex),n.attribs[t].valueLineCol=this.lineColFunc(n.attribs[t].valueIndex)},this),this.attribArr=[],this.attributes={},n.dupes=this.dupes,this.dupes=[]},s.prototype.onclosetag=function(){var t=this._tagStack[this._tagStack.length-1];t&&!o.isVoidElement(t.name)&&(t.close=this.htmlText.slice(this.parser.startIndex+2,this.parser.endIndex),t.closeIndex=this.parser.startIndex,t.closeLineCol=this.lineColFunc(this.parser.startIndex)),a.prototype.onclosetag.call(this)},s.prototype.onprocessinginstruction=function(t,e){this.parser._updatePosition(2),a.prototype.onprocessinginstruction.call(this,t,e)},s.prototype._addDomElement=function(t){if(!this.parser)throw new Error("stop being a bone head >.<");t.index=this.parser.startIndex,t.lineCol=this.lineColFunc(t.index),a.prototype._addDomElement.call(this,t)}},function(t,e,n){(function(t,r){function i(t,n){var r={seen:[],stylize:a};return arguments.length>=3&&(r.depth=arguments[2]),arguments.length>=4&&(r.colors=arguments[3]),g(n)?r.showHidden=n:n&&e._extend(r,n),w(r.showHidden)&&(r.showHidden=!1),w(r.depth)&&(r.depth=2),w(r.colors)&&(r.colors=!1),w(r.customInspect)&&(r.customInspect=!0),r.colors&&(r.stylize=o),u(r,t,r.depth)}function o(t,e){var n=i.styles[e];return n?"["+i.colors[n][0]+"m"+t+"["+i.colors[n][1]+"m":t}function a(t,e){return t}function s(t){var e={};return t.forEach(function(t,n){e[t]=!0}),e}function u(t,n,r){if(t.customInspect&&n&&L(n.inspect)&&n.inspect!==e.inspect&&(!n.constructor||n.constructor.prototype!==n)){var i=n.inspect(r,t);return b(i)||(i=u(t,i,r)),i}var o=c(t,n);if(o)return o;var a=Object.keys(n),g=s(a);if(t.showHidden&&(a=Object.getOwnPropertyNames(n)),A(n)&&(a.indexOf("message")>=0||a.indexOf("description")>=0))return l(n);if(0===a.length){if(L(n)){var v=n.name?": "+n.name:"";return t.stylize("[Function"+v+"]","special")}if(x(n))return t.stylize(RegExp.prototype.toString.call(n),"regexp");if(S(n))return t.stylize(Date.prototype.toString.call(n),"date");if(A(n))return l(n)}var _="",m=!1,y=["{","}"];if(d(n)&&(m=!0,y=["[","]"]),L(n)){var w=n.name?": "+n.name:"";_=" [Function"+w+"]"}if(x(n)&&(_=" "+RegExp.prototype.toString.call(n)),S(n)&&(_=" "+Date.prototype.toUTCString.call(n)),A(n)&&(_=" "+l(n)),0===a.length&&(!m||0==n.length))return y[0]+_+y[1];if(r<0)return x(n)?t.stylize(RegExp.prototype.toString.call(n),"regexp"):t.stylize("[Object]","special");t.seen.push(n);var E;return E=m?f(t,n,r,g,a):a.map(function(e){return h(t,n,r,g,e,m)}),t.seen.pop(),p(E,_,y)}function c(t,e){if(w(e))return t.stylize("undefined","undefined");if(b(e)){var n="'"+JSON.stringify(e).replace(/^"|"$/g,"").replace(/'/g,"\\'").replace(/\\"/g,'"')+"'";return t.stylize(n,"string")}return m(e)?t.stylize(""+e,"number"):g(e)?t.stylize(""+e,"boolean"):v(e)?t.stylize("null","null"):void 0}function l(t){return"["+Error.prototype.toString.call(t)+"]"}function f(t,e,n,r,i){for(var o=[],a=0,s=e.length;a<s;++a)O(e,String(a))?o.push(h(t,e,n,r,String(a),!0)):o.push("");return i.forEach(function(i){i.match(/^\d+$/)||o.push(h(t,e,n,r,i,!0))}),o}function h(t,e,n,r,i,o){var a,s,c;if(c=Object.getOwnPropertyDescriptor(e,i)||{value:e[i]},c.get?s=c.set?t.stylize("[Getter/Setter]","special"):t.stylize("[Getter]","special"):c.set&&(s=t.stylize("[Setter]","special")),O(r,i)||(a="["+i+"]"),s||(t.seen.indexOf(c.value)<0?(s=v(n)?u(t,c.value,null):u(t,c.value,n-1),s.indexOf("\n")>-1&&(s=o?s.split("\n").map(function(t){return"  "+t}).join("\n").substr(2):"\n"+s.split("\n").map(function(t){return"   "+t}).join("\n"))):s=t.stylize("[Circular]","special")),w(a)){if(o&&i.match(/^\d+$/))return s;a=JSON.stringify(""+i),a.match(/^"([a-zA-Z_][a-zA-Z_0-9]*)"$/)?(a=a.substr(1,a.length-2),a=t.stylize(a,"name")):(a=a.replace(/'/g,"\\'").replace(/\\"/g,'"').replace(/(^"|"$)/g,"'"),a=t.stylize(a,"string"))}return a+": "+s}function p(t,e,n){var r=0,i=t.reduce(function(t,e){return r++,e.indexOf("\n")>=0&&r++,t+e.replace(/\u001b\[\d\d?m/g,"").length+1},0);return i>60?n[0]+(""===e?"":e+"\n ")+" "+t.join(",\n  ")+" "+n[1]:n[0]+e+" "+t.join(", ")+" "+n[1]}function d(t){return Array.isArray(t)}function g(t){return"boolean"==typeof t}function v(t){return null===t}function _(t){return null==t}function m(t){return"number"==typeof t}function b(t){return"string"==typeof t}function y(t){return"symbol"==typeof t}function w(t){return void 0===t}function x(t){return E(t)&&"[object RegExp]"===T(t)}function E(t){return"object"==typeof t&&null!==t}function S(t){return E(t)&&"[object Date]"===T(t)}function A(t){return E(t)&&("[object Error]"===T(t)||t instanceof Error)}function L(t){return"function"==typeof t}function k(t){return null===t||"boolean"==typeof t||"number"==typeof t||"string"==typeof t||"symbol"==typeof t||"undefined"==typeof t}function T(t){return Object.prototype.toString.call(t)}function C(t){return t<10?"0"+t.toString(10):t.toString(10)}function R(){var t=new Date,e=[C(t.getHours()),C(t.getMinutes()),C(t.getSeconds())].join(":");return[t.getDate(),B[t.getMonth()],e].join(" ")}function O(t,e){return Object.prototype.hasOwnProperty.call(t,e)}var D=/%[sdj%]/g;e.format=function(t){if(!b(t)){for(var e=[],n=0;n<arguments.length;n++)e.push(i(arguments[n]));return e.join(" ")}for(var n=1,r=arguments,o=r.length,a=String(t).replace(D,function(t){if("%%"===t)return"%";if(n>=o)return t;switch(t){case"%s":return String(r[n++]);case"%d":return Number(r[n++]);case"%j":try{return JSON.stringify(r[n++])}catch(t){return"[Circular]"}default:return t}}),s=r[n];n<o;s=r[++n])a+=v(s)||!E(s)?" "+s:" "+i(s);return a},e.deprecate=function(n,i){function o(){if(!a){if(r.throwDeprecation)throw new Error(i);r.traceDeprecation?console.trace(i):console.error(i),a=!0}return n.apply(this,arguments)}if(w(t.process))return function(){return e.deprecate(n,i).apply(this,arguments)};if(r.noDeprecation===!0)return n;var a=!1;return o};var q,I={};e.debuglog=function(t){if(w(q)&&(q=r.env.NODE_DEBUG||""),t=t.toUpperCase(),!I[t])if(new RegExp("\\b"+t+"\\b","i").test(q)){var n=r.pid;I[t]=function(){var r=e.format.apply(e,arguments);console.error("%s %d: %s",t,n,r)}}else I[t]=function(){};return I[t]},e.inspect=i,i.colors={bold:[1,22],italic:[3,23],underline:[4,24],inverse:[7,27],white:[37,39],grey:[90,39],black:[30,39],blue:[34,39],cyan:[36,39],green:[32,39],magenta:[35,39],red:[31,39],yellow:[33,39]},i.styles={special:"cyan",number:"yellow",boolean:"yellow",undefined:"grey",null:"bold",string:"green",date:"magenta",regexp:"red"},e.isArray=d,e.isBoolean=g,e.isNull=v,e.isNullOrUndefined=_,e.isNumber=m,e.isString=b,e.isSymbol=y,e.isUndefined=w,e.isRegExp=x,e.isObject=E,e.isDate=S,e.isError=A,e.isFunction=L,e.isPrimitive=k,e.isBuffer=n(69);var B=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];e.log=function(){console.log("%s - %s",R(),e.format.apply(e,arguments))},e.inherits=n(70),e._extend=function(t,e){if(!e||!E(e))return t;for(var n=Object.keys(e),r=n.length;r--;)t[n[r]]=e[n[r]];return t}}).call(e,function(){return this}(),n(34))},function(t,e){t.exports=function(t){return t&&"object"==typeof t&&"function"==typeof t.copy&&"function"==typeof t.fill&&"function"==typeof t.readUInt8}},function(t,e){"function"==typeof Object.create?t.exports=function(t,e){t.super_=e,t.prototype=Object.create(e.prototype,{constructor:{value:t,enumerable:!1,writable:!0,configurable:!0}})}:t.exports=function(t,e){t.super_=e;var n=function(){};n.prototype=e.prototype,t.prototype=new n,t.prototype.constructor=t}},function(t,e,n){var r=n(1),i={apply_rules:n(72),attr_parse:n(73),boolean_attrs:n(74),get_format_test:n(75),is_labeable:n(76),is_void_element:n(77),lang_tag:n(78),match_filter:n(79),relative_line_col:n(80),shred:n(81),tag_utils:n(82)},o={};r.values(i).forEach(function(t){r.mixin(o,t)}),t.exports=o},function(t,e,n){function r(t,e){Array.isArray(t)?t.forEach(function(t){r(t,e)}):t.rule=t.rule||e}var i=n(1);t.exports={applyRules:function(t,e,n){return t?i.flattenDeep(t.map(function(t){var i=t.lint.call(t,e,n);return r(i,t.name),i})):[]}}},function(t,e){var n=/\s*([^ "'>=\^]+)(\s*=\s*((?:"[^"]*")|(?:'[^']*')|(?:\S+)))?/g;t.exports.parseHtmlAttrs=function(t){for(var e=[],r=n.exec(t);r;)e.push({name:r[1],valueRaw:r[3]}),r=n.exec(t);return e},t.exports.inputIndices=function(t,e,r){for(var i=n.exec(e),o=[];i;)o.push(i),i=n.exec(e);Object.keys(t).forEach(function(e){for(var n=t[e],i=0;i<o.length;i++){var a=o[i];if(a[1]&&(a[1]=a[1].trim()),e===a[1]){var s=r+a.index+a[0].indexOf(a[1]);n.nameIndex=s,n.valueIndex=s,n.attributeContext=a[0]}if(a[1]&&a[2]&&a[3]&&e===a[1]&&a[3].indexOf(n.value)>-1){n.valueIndex=s+a[1].length+a[2].indexOf(a[3])+1;break}}})}},function(t,e){var n=["allowfullscreen","async","autofocus","autoplay","checked","compact","controls","declare","default","defaultchecked","defaultmuted","defaultselected","defer","disabled","draggable","enabled","formnovalidate","hidden","indeterminate","inert","ismap","itemscope","loop","multiple","muted","nohref","noresize","noshade","novalidate","nowrap","open","pauseonexit","readonly","required","reversed","scoped","seamless","selected","sortable","spellcheck","translate","truespeed","typemustmatch","visible"];t.exports={isBooleanAttr:function(t){return n.indexOf(t.toLowerCase())>=0}}},function(t,e,n){var r=n(1),i={lowercase:/^[a-z][a-z\-\d]*$/,underscore:/^[a-z][a-z\d]*(_[a-z\d]+)*$/,dash:/^[a-z][a-z\d]*(-[a-z\d]+)*$/,camel:/^[a-zA-Z][a-zA-Z\d]*$/,bem:/^([a-z][a-z\d]*(-[a-z\d]+)*(--[a-z\d]+)*(__[a-z\d]+)*)+$/};t.exports={getFormatTest:function(t){var e=r.isRegExp(t)?t:i[t];return e.test.bind(e)}}},function(t,e,n){var r=n(1),i=["button","input","keygen","meter","output","progress","select","textarea"];t.exports.isLabeable=function(t){return!("tag"!==t.type||!r.includes(i,t.name))&&("input"!==t.name||!t.attribs||!t.attribs.type||"hidden"!==t.attribs.type.value)}},function(t,e){var n=["area","base","br","col","embed","hr","img","input","keygen","link","menuitem","meta","param","source","track","wbr","path","circle","ellipse","line","rect","use","stop","polyline","polygon"];t.exports.isVoidElement=function(t){return n.indexOf(t)!==-1}},function(t,e){function n(t){return 0===t.length||i.indexOf(t)!==-1}function r(t){return 0===t.length||o.indexOf(t)!==-1}var i=["ab","aa","af","sq","am","ar","an","hy","as","ay","az","ba","eu","bn","dz","bh","bi","br","bg","my","be","km","ca","zh","co","hr","cs","da","nl","en","eo","et","fo","fa","fj","fi","fr","fy","gl","gd","gv","ka","de","el","kl","gn","gu","ht","ha","he","iw","hi","hu","is","io","id","in","ia","ie","iu","ik","ga","it","ja","jv","kn","ks","kk","rw","ky","rn","ko","ku","lo","la","lv","li","ln","lt","mk","mg","ms","ml","mt","mi","mr","mo","mn","na","ne","no","oc","or","om","ps","pl","pt","pa","qu","rm","ro","ru","sm","sg","sa","sr","sh","st","tn","sn","ii","sd","si","ss","sk","sl","so","es","su","sw","sv","tl","tg","ta","tt","te","th","bo","ti","to","ts","tr","tk","tw","ug","uk","ur","uz","vi","vo","wa","cy","wo","xh","yi","ji","yo","zu","zh-Hans","zh-Hant"],o=["AF","AL","DZ","AS","AD","AO","AQ","AG","AR","AM","AW","AU","AT","AZ","BS","BH","BD","BB","BY","BE","BZ","BJ","BM","BT","BO","BA","BW","BV","BR","IO","BN","BG","BF","BI","KH","CM","CA","CV","KY","CF","TD","CL","CN","CX","CC","CO","KM","CG","CD","CK","CR","CI","HR","CU","CY","CZ","DK","DJ","DM","DO","EC","EG","SV","GQ","ER","EE","ET","FK","FO","FJ","FI","FR","GF","PF","TF","GA","GM","GE","DE","GH","GI","GR","GL","GD","GP","GU","GT","GN","GW","GY","HT","HM","HN","HK","HU","IS","IN","ID","IR","IQ","IE","IL","IT","JM","JP","JO","KZ","KE","KI","KP","KR","KW","KG","LA","LV","LB","LS","LR","LY","LI","LT","LU","MO","MK","MG","MW","MY","MV","ML","MT","MH","MQ","MR","MU","YT","MX","FM","MD","MC","MN","ME","MS","MA","MZ","MM","NA","NR","NP","NL","AN","NC","NZ","NI","NE","NG","NU","NF","MP","NO","OM","PK","PW","PS","PA","PG","PY","PE","PH","PN","PL","PT","PR","QA","RE","RO","RU","RW","SH","KN","LC","PM","VC","WS","SM","ST","SA","SN","RS","SC","SL","SG","SK","SI","SB","SO","ZA","GS","ES","LK","SD","SR","SJ","SZ","SE","CH","SY","TW","TJ","TZ","TH","TL","TG","TK","TO","TT","TN","TR","TM","TC","TV","UG","UA","AE","GB","US","UM","UY","UZ","VU","VE","VN","VG","VI","WF","EH","YE","ZM","ZW"];t.exports.checkLangTag=function(t){if(!t||0===t.length)return 0;var e=t.lastIndexOf("-"),i="",o="";return e===-1?i=t:(i=t.slice(0,e),o=t.slice(e+1,t.length)),n(i)&&r(o)?0:n(i.toLowerCase())&&r(o.toUpperCase())?2:1}},function(t,e){t.exports.matchFilter=function(t,e){return!e.filter||e.filter.indexOf(t.toLowerCase())>-1}},function(t,e){t.exports.getLineColFunc=function(t,e){var n=0,r=0,i=0;return e&&e[0]&&e[1]&&(r=e[0],i=e[1]),function(e){if(e<n)throw new Error("Index passed to line/column function ("+e+") does not keep with order (last was "+n+")");for(;n<e;)"\n"===t[n]?(i=0,r++):i++,n++;return[r+1,i+1]}}},function(t,e){t.exports.shred=function(t){for(var e=1,n=0,r=[];t;){var i=t.search("[\r\n]")+1;0===i?i=t.length:"\r"===t[i-1]&&"\n"===t[i]&&i++,r[e]={line:t.substr(0,i),index:n,row:e},e++,n+=i,t=t.slice(i)}return r}},function(t,e){t.exports.isSelfClosing=function(t){var e=t.open;return"/"===e[e.length-1]},t.exports.hasNonEmptyAttr=function(t,e,n){var r=t.attribs[e];return r&&(n||r.value&&r.value.length>0)}},function(t,e,n){var r=n(1),i={accessibility:n(84),default:n(85),validate:n(86)};i.none=r.mapValues(i.default,function(){return!1}),t.exports.presets=i,t.exports.flattenOpts=function(t){var e={};return t.forEach(function(t){r.isString(t)&&(t=i[t]),r.assign(e,t)}),e}},function(t,e){t.exports={"fig-req-figcaption":!0,"focusable-tabindex-style":!0,"input-radio-req-name":!0,"input-req-label":!0,"page-title":!0,"table-req-caption":!0,"table-req-header":!0,"tag-name-match":!0}},function(t,e){t.exports={"attr-bans":["align","background","bgcolor","border","frameborder","longdesc","marginwidth","marginheight","scrolling","style","width"],"indent-style":"nonmixed","indent-width":4,"indent-width-cont":!1,"text-escape-spec-char":!0,"tag-bans":["style","b","i"],"tag-close":!0,"tag-name-lowercase":!0,"tag-name-match":!0,"tag-self-close":!1,"doctype-first":!1,"doctype-html5":!1,"attr-name-style":"lowercase","attr-name-ignore-regex":!1,"attr-no-dup":!0,"attr-no-unsafe-chars":!0,"attr-quote-style":"double","attr-req-value":!0,"id-no-dup":!0,"id-class-no-ad":!0,"id-class-style":"underscore","class-no-dup":!0,"class-style":!1,"id-class-ignore-regex":!1,"img-req-alt":!0,"img-req-src":!0,"href-style":!1,csslint:!1,"label-req-for":!0,"line-end-style":"lf","line-max-len":!1,"line-max-len-ignore-regex":!1,"head-req-title":!0,"title-no-dup":!0,"title-max-len":60,"html-req-lang":!1,"lang-style":"case"}},function(t,e){t.exports={"doctype-first":!0,"doctype-html5":!0,"attr-no-dup":!0,"id-no-dup":!0,"img-req-alt":"allownull","img-req-src":!0,"label-req-for":"strict","title-no-dup":!0,"tag-close":!0}},function(t,e,n){function r(){this.rulesMap={},this.subsMap={}}var i=n(1);t.exports=r,r.fromRuleMap=function(t){var e=new r;return i.forOwn(t,function(t){e.addRule(t)}),e},r.prototype.getRule=function(t){return this.rulesMap[t]},r.prototype.getSubscribers=function(t){var e=this.subsMap[t];return e?e:[]},r.prototype.addRule=function(t){var e=t.name;this.rulesMap[e]&&this.removeRule(e),this.subscribeRule(t),this.rulesMap[e]=t},r.prototype.removeRule=function(t){var e=this.getRule(t);e&&this.unsubscribeRule(e),delete this.rulesMap[t]},r.prototype.unsubscribeRule=function(t){t.on&&t.on.forEach(function(e){var n=this.subsMap[e].indexOf(t);this.subsMap[e].splice(n,1)}.bind(this))},r.prototype.subscribeRule=function(t){t.on&&t.on.forEach(function(e){this.subsMap[e]||(this.subsMap[e]=[]),this.subsMap[e].push(t)}.bind(this))},r.prototype.forEach=function(t){i.forOwn(this.rulesMap,function(e){t(e)})}},function(t,e,n){function r(t){var e=!1;return t.rules.forEach(function(t){if("rule"===t.type){if(!(t.name in this.current))throw new Error("option "+t.name+" does not exist.");var n=this.current[t.name];this.current[t.name]="$previous"===t.value?this.previous[t.name]:t.value,this.previous[t.name]=n,e=!0}else"preset"===t.type&&(a.merge(this.current,s.presets[t.name]),e=!0)}.bind(this)),e}function i(t,e){if(!(t&&e&&t.length&&e.length))return"Invalid configuration";if(!f.name.test(t))return"Invalid rule or preset name: "+t;var n="'",r='"';if(e[0]!==n&&e[0]!==r||(e=e.substr(1,e.length-2)),e=e.replace(/\'/g,r),t=t.replace(/_/g,"-"),"preset"===t)return s.presets[e]?{type:"preset",name:e}:"Not a preset: "+e;var i=null;if("$previous"===e)i="$previous";else if("$"===e[0]){var o=e.substr(1);if(!s.presets[o])return"Not a preset: "+o;i=s.presets[o][t]}else try{i=JSON.parse(e)}catch(t){if(!f.name.test(e))return"Value not recognized in inline configuration";i=e}return{type:"rule",name:t,value:i}}var o=n(71),a=n(1),s=n(83),u=0,c=null,l=function(t){this.indexConfigs=[],this.current=t?a.cloneDeep(t):this.current,c=t?a.cloneDeep(t):c,this.previous={}};t.exports=l;var f={open:/[\s]*htmllint[\s]+(.*)/,name:/^[a-zA-Z0-9-_]+$/};l.prototype.reset=function(t){c=t?a.cloneDeep(t):c,this.current=a.cloneDeep(c),u=0},l.prototype.clear=function(){this.indexConfigs=[],this.reset(null)},l.prototype.getOptsAtIndex=function(t){if(0!==t&&t<=u)throw new Error("Cannot get options for index "+t+" when index "+u+" has already been checked");var e=a.compact(this.indexConfigs.slice(u+1,t+1));return u=t,!!e[0]&&r.call(this,e[0])},l.prototype.addConfig=function(t){if(this.indexConfigs[t.end])throw new Error("config exists at index already!");this.indexConfigs[t.end]=t},l.prototype.feedComment=function(t){var e=t.data,n=e.match(f.open);if(n){for(var r=o.parseHtmlAttrs(n[1]),a=r.length,s=[],u=0;u<a;u++){var c=i(r[u].name,r[u].valueRaw);if("string"==typeof c)throw new Error(c);s.push(c)}if(!(s.length<1)){var l={start:t.index,end:t.index+t.data.length+6,rules:s};this.addConfig(l)}}}},function(t,e,n){var r={"attr-bans":n(90),"attr-name-style":n(92),"attr-new-line":n(93),"attr-no-dup":n(94),"attr-no-unsafe-char":n(95),"attr-quote-style":n(96),"attr-req-value":n(97),attr:n(98),class:n(99),"doctype-first":n(100),"doctype-html5":n(101),dom:n(102),"fig-req-figcaption":n(103),"focusable-tabindex-style":n(104),"href-style":n(105),"id-class-no-ad":n(106),"id-no-dup":n(107),"id-style":n(108),"img-req-alt":n(109),"img-req-src":n(110),"indent-style":n(111),"input-radio-req-name":n(112),"input-req-label":n(113),"label-req-for":n(114),lang:n(115),"line-end-style":n(116),"line-max-len":n(117),line:n(118),"page-title":n(119),"spec-char-escape":n(120),"table-req-caption":n(121),"table-req-header":n(122),"tag-bans":n(123),"tag-close":n(124),"tag-name-lowercase":n(125),tag:n(126)};Object.keys(r).forEach(function(e){var n=r[e];t.exports[n.name]=n})},function(t,e,n){var r=n(91);t.exports={name:"attr-bans",on:["tag"]},t.exports.lint=function(t,e){var n=e[this.name];if(!n||!t.attribs)return[];var i=[],o=t.attribs;return n.forEach(function(t){o.hasOwnProperty(t)&&i.push(new r("E001",o[t].nameLineCol,{attribute:t}))}),i}},function(t,e){function n(t,e,n){this.line=e[0],this.column=e[1],this.code=t,this.data=n||{}}t.exports=n},function(t,e,n){var r=n(71),i=n(91);t.exports={name:"attr-name-style",on:["attr"]},t.exports.lint=function(t,e){var n=e[this.name];if(!n)return[];var o=e["attr-name-ignore-regex"];if(o!==!1&&new RegExp(o).test(t.name))return[];var a=r.getFormatTest(n);return a(t.name)?[]:new i("E002",t.nameLineCol,{format:n})}},function(t,e,n){var r=n(91);t.exports={name:"attr-new-line",on:["tag"]},t.exports.lint=function(t,e){if(!(e[this.name]&&t.dupes||0===e[this.name]))return[];var n="+0"===e[this.name],i=Math.floor(e[this.name]),o=0,a=-1,s=Object.keys(t.attribs).length,u=0,c=s>0&&/\s*\w+\s*\n\s*/.test(t.open)?1:0,l=c,f=-1;Object.keys(t.attribs).forEach(function(e){l=c,f!==-1&&f!==t.attribs[e].valueLineCol[0]&&(a<u&&(a=u),0===c&&(o=u),u=0,c++),l===c&&u++,f=t.attribs[e].valueLineCol[0]}),a<u&&(a=u),0===c&&(o=u);var h=t.openLineCol||t.lineCol;return!(o>i||a>Math.max(1,i))||n&&1===s?[]:new r("E037",h,{limit:i})}},function(t,e,n){var r=n(91);t.exports={name:"attr-no-dup",on:["tag"]},t.exports.lint=function(t,e){return e[this.name]&&t.dupes?t.dupes.map(function(e){var n=t.attribs[e];return new r("E003",n.nameLineCol,{attribute:e})}):[]}},function(t,e,n){var r=n(91),i=/[\u0000-\u001f\u007f-\u009f\u00ad\u0600-\u0604\u070f\u17b4\u17b5\u200c-\u200f\u2028-\u202f\u2060-\u206f\ufeff\ufff0-\uffff]/;t.exports={name:"attr-no-unsafe-char",on:["attr"]},t.exports.lint=function(t,e){var n=e[this.name];return n&&i.test(t.value)?new r("E004",t.valueLineCol):[]}},function(t,e,n){var r=n(71),i=n(91);t.exports={name:"attr-quote-style",on:["tag"]};var o={double:/^"/,single:/^'/,quoted:/^['"]/},a=/\s*\/?$/,s={double:"double quoted",single:"single quoted",quoted:"quoted"};t.exports.lint=function(t,e){if(!e[this.name])return[];var n=t.open.slice(t.name.length);n=n.replace(a,"");var u=r.parseHtmlAttrs(n),c=o[e[this.name]]||o.quoted,l=s[e[this.name]]||s.quoted,f=[];
return u.forEach(function(e){var n=e.valueRaw;if(n&&n.length>0&&!c.test(n)){var r={attribute:e.name,format:l},o=t.attribs[e.name];f.push(new i("E005",o.valueLineCol,r))}}),f}},function(t,e,n){var r=n(71),i=n(91);t.exports={name:"attr-req-value",on:["attr"]},t.exports.lint=function(t,e){if(!e[this.name])return[];var n=t.attributeContext;return""===t.value&&(void 0===n||n.indexOf("="))<0&&!r.isBooleanAttr(t.name)||/^[^'"]*=[^'"]*=/.test(n)?new i("E006",t.valueLineCol):[]}},function(t,e,n){var r=n(71);t.exports={name:"attr",on:["tag"]},t.exports.lint=function(t,e){var n=this.subscribers,i=t.attribs,o=[];return Object.keys(i).forEach(function(t){var a=i[t];a.name=t;var s=r.matchFilter.bind(r,t),u=n.filter(s);o=o.concat(r.applyRules(u,a,e))}),o}},function(t,e,n){var r=n(71),i=n(91);t.exports={name:"class",on:["attr"],filter:["class"]},t.exports.lint=function(t,e){var n=e["class-style"]||e["id-class-style"],o=e["class-no-dup"];if(!n&&!o)return[];var a=[],s=t.value,u=e["id-class-ignore-regex"],c=[],l=!1;if(u){var f,h=new RegExp("("+u+")|\\s*$|\\s+","g"),p=0;for(l=[!1];p<s.length&&null!==(f=h.exec(s));)void 0===f[1]?(c.push(s.slice(p,f.index)),p=h.lastIndex,l.push(!1)):l[l.length-1]=!0;l.pop()}else c=s.split(/\s+/);if(n){var d=r.getFormatTest(n);c.map(function(e,r){l[r]||d(e)||a.push(new i("E011",t.valueLineCol,{format:n,class:e}))})}if(o){c=c.sort();for(var g=0;g<c.length-1;g++)c[g+1]===c[g]&&a.push(new i("E041",t.valueLineCol,{classes:s}))}return a}},function(t,e,n){function r(t){return"text"===t.type&&/^[ \t\n\f\r]*$/.test(t.data)}var i=n(91);t.exports={name:"doctype-first",on:["dom"],passedFirst:!1},t.exports.end=function(){this.passedFirst=!1},t.exports.lint=function(t,e){var n=e[this.name];if(!n||this.passedFirst||"comment"===t.type||r(t))return[];if(this.passedFirst=!0,"directive"===t.type&&"!DOCTYPE"===t.name.toUpperCase())return[];if("smart"===n&&("tag"!==t.type||"head"!==t.name.toLowerCase()))return[];var o=t.openLineCol||t.lineCol;return new i("E007",o)}},function(t,e,n){var r=n(91);t.exports={name:"doctype-html5",on:["dom"]},t.exports.lint=function(t,e){if(!e[this.name]||"directive"!==t.type)return[];var n=/^!DOCTYPE[ \t\n\f]+html[ \t\n\f]*$/i,i=/!doctype/i;return i.test(t.name)?t.data&&n.test(t.data)?[]:new r("E008",t.lineCol):[]}},function(t,e,n){var r=n(1),i=n(71);t.exports={name:"dom"},t.exports.lint=function(t,e,n){var o=this.subscribers;n.reset(e);var a=function(t){var e=i.matchFilter.bind(i,t.type);n.getOptsAtIndex(t.index);var r=o.filter(e),s=i.applyRules(r,t,n.current);return t.children&&t.children.length>0&&t.children.forEach(function(t){s=s.concat(a(t))}),s},s=t.length?t.map(a):[];return r.flattenDeep(s)}},function(t,e,n){var r=n(91);t.exports={name:"fig-req-figcaption",on:["tag"],filter:["figure","figcaption"]},t.exports.lint=function(t,e){if(!e[this.name])return[];if("figure"===t.name){for(var n=t.children,i=0;i<n.length;i++)if("figcaption"===n[i].name)return[]}else if("figcaption"===t.name&&t.parent&&"figure"===t.parent.name)return[];return new r("E032",t.openLineCol)}},function(t,e,n){var r=n(91);t.exports={name:"focusable-tabindex-style",on:["tag"],filter:["a","area","button","input","img","select","textarea"],detectedStyle:null},t.exports.end=function(){this.detectedStyle=null},t.exports.lint=function(t,e){if(!e[this.name]||this.isDisabled(t))return[];var n=this.getTabIndexStyle(t);if(null!==this.detectedStyle&&this.detectedStyle!==n){var i=n?"remove the tabindex":"add a positive tabindex";return new r("E026",t.openLineCol,{op:i})}return this.detectedStyle=n,[]},t.exports.isDisabled=function(t){return t.attribs&&t.attribs.hasOwnProperty("disabled")},t.exports.getTabIndexStyle=function(t){var e=t.attribs;return!(!e||!e.hasOwnProperty("tabindex")||"undefined"==typeof e)&&e.tabindex.value>0}},function(t,e,n){var r=n(91);t.exports={name:"href-style",on:["tag"],filter:["a"]},t.exports.lint=function(t,e){var n=e[this.name];return n&&t.attribs&&t.attribs.hasOwnProperty("href")?"absolute"===n==(t.attribs.href.value.search("://")!==-1)?[]:new r("E009",t.openLineCol,{format:n}):[]}},function(t,e,n){var r=n(91);t.exports={name:"id-class-no-ad",on:["attr"],filter:["id","class"]},t.exports.lint=function(t,e){if(!e[this.name])return[];var n=/(^|[^a-zA-Z0-9])ad([^a-zA-Z0-9]|$)/.exec(t.value);return n?new r("E010",t.valueLineCol):[]}},function(t,e,n){var r=n(91);t.exports={name:"id-no-dup",table:{},on:["tag"]},t.exports.end=function(){this.table={}},t.exports.lint=function(t,e){if(!e[this.name])return[];if(!t.attribs.hasOwnProperty("id"))return[];var n=t.attribs.id;return this.table.hasOwnProperty(n.value)?new r("E012",n.valueLineCol,{id:n.value}):(this.table[n.value]=t,[])}},function(t,e,n){var r=n(71),i=n(91);t.exports={name:"id-style",on:["attr"],filter:["id"]},t.exports.lint=function(t,e){var n=e["id-class-style"];if(!n)return[];var o=t.value,a=e["id-class-ignore-regex"];if(a!==!1&&new RegExp(a).test(o))return[];var s=r.getFormatTest(n);return s(o)?[]:new i("E011",t.valueLineCol,{format:n,id:o})}},function(t,e,n){var r=n(71),i=n(91);t.exports={name:"img-req-alt",on:["tag"],filter:["img"]},t.exports.lint=function(t,e){var n=e[this.name];return!n||r.hasNonEmptyAttr(t,"alt","allownull"===n)?[]:new i("E013",t.openLineCol)}},function(t,e,n){var r=n(71),i=n(91);t.exports={name:"img-req-src",on:["tag"],filter:["img"]},t.exports.lint=function(t,e){return!e[this.name]||r.hasNonEmptyAttr(t,"src")?[]:new i("E014",t.openLineCol)}},function(t,e,n){var r=n(91);t.exports={name:"indent-style",on:["line"]},t.exports.end=function(){delete this.current},t.exports.lint=function(t,e){var n=/[^ \t]/.exec(t.line),i=null!==n?n.index:t.line.length,o=t.line.slice(0,i);if(0===o.length)return[];var a=[],s=e["indent-width"];if(s){var u,c=0;for(u=0;u<o.length;u++){var l=o[u];if(" "===l)c++;else{if(c%s!==0)break;c=0}}c%s===0||e["indent-width-cont"]&&"<"!==t.line[o.length]||a.push(new r("E036",[t.row,u-c+1],{width:s}))}var f=e["indent-style"];if(f){var h=/ /.exec(o),p=/\t/.exec(o);this.current||(this.current=h?"spaces":"tabs");var d="spaces"===f||"nonmixed"===f&&"spaces"===this.current,g=d?p:h;g&&a.push(new r("E024",[t.row,g.index+1],{type:d?"Tabs":"Spaces"}))}return a}},function(t,e,n){var r=n(71),i=n(91);t.exports={name:"input-radio-req-name",labels:{},inputsInfo:[],on:["tag"],filter:["input"]},t.exports.lint=function(t,e){if(!e[this.name])return[];var n=t.attribs;return n.type&&"radio"===n.type.value?r.hasNonEmptyAttr(t,"name")?[]:new i("E034",t.openLineCol):[]}},function(t,e,n){var r=n(91);t.exports={name:"input-req-label",labels:{},inputsInfo:[],on:["tag"],filter:["input","label"]},t.exports.end=function(){var t=[];return this.inputsInfo.length>0&&this.inputsInfo.forEach(function(e){this.labels[e.id]||this.labels[e.name]||t.push(new r("E033",e.location,{idValue:e.id,nameValue:e.name}))}.bind(this)),this.labels={},this.inputsInfo=[],t},t.exports.lint=function(t,e){if(!e[this.name])return[];if("label"===t.name)return t.attribs.hasOwnProperty("for")&&(this.labels[t.attribs.for.value]=t),[];if(!t.attribs.hasOwnProperty("type")||"text"!==t.attribs.type.value&&"radio"!==t.attribs.type.value)return[];for(var n=t.attribs.type.value,i=t.parent;null!==i;){if("label"===i.name)return[];i=i.parent}var o=t.attribs.hasOwnProperty("id")&&t.attribs.id?t.attribs.id.value:null,a=t.attribs.hasOwnProperty("name")&&t.attribs.name&&"text"===n?t.attribs.name.value:null;return o||a?(this.inputsInfo.push({id:o,name:a,location:t.openLineCol}),[]):new r("E033",t.openLineCol,{idValue:"null",nameValue:"null"})}},function(t,e,n){var r=n(1),i=n(71),o=n(91);t.exports={name:"label-req-for",filter:["label"],on:["tag"],idmap:null},t.exports.end=function(){this.idmap=null},t.exports.lint=function(t,e){if(!e[this.name])return[];var n="strict"===e[this.name],r=t.attribs.hasOwnProperty("for");if(n&&!r)return new o("E019",t.openLineCol);if(!n&&!r&&!this.hasValidChild(t))return new o("E020",t.openLineCol);if(r){this.idmap||this.buildIdMap(t);var a=t.attribs.for.value,s=this.idmap[a];if(!s)return new o("E021",t.openLineCol,{id:a});if(!i.isLabeable(s))return new o("E022",t.openLineCol,{id:a})}return[]},t.exports.buildIdMap=function(t){for(var e=t;null!==e.parent;)e=e.parent;for(;null!==e.prev;)e=e.prev;for(var n=[];null!==e;)n.push(e),e=e.next;var r={};n.forEach(function t(e){if(e.attribs&&e.attribs.id){var n=e.attribs.id.value;r.hasOwnProperty(n)||(r[n]=e)}e.children&&e.children.forEach(t)}),this.idmap=r},t.exports.hasValidChild=function(t){return r.some(t.children,i.isLabeable)}},function(t,e,n){var r=n(91),i=n(71);t.exports={name:"lang",on:["tag"],filter:["html"]},t.exports.lint=function(t,e){var n=t.attribs;if(n&&n.hasOwnProperty("lang")&&n.lang.value){var o=n.lang.value;if(e["lang-style"]){var a=i.checkLangTag(o);if(1===a)return new r("E038",n.lang.valueLineCol,{lang:o});if("case"===e["lang-style"]&&2===a)return new r("E039",n.lang.valueLineCol,{lang:o})}return[]}return e["html-req-lang"]?new r("E025",t.openLineCol):[]}},function(t,e,n){var r=n(91);t.exports={name:"line-end-style",on:["line"]},t.exports.lint=function(t,e){var n=e[this.name];if(!n)return[];n=n.toLowerCase();var i={cr:/(^|[^\n\r])\r$/,lf:/(^|[^\n\r])\n$/,crlf:/(^|[^\n\r])\r\n$/}[n];if(i.test(t.line))return[];var o=t.line.length,a=[t.row,o];return"\r"===t.line[o-2]&&(a[1]-=1),new r("E015",a,{format:n})}},function(t,e,n){var r=n(91);t.exports={name:"line-max-len",on:["line"]},t.exports.lint=function(t,e){var n,i,o,a=e[this.name],s=e[this.name+"-ignore-regex"];return a?(n=t.line.replace(/(\r\n|\n|\r)$/,""),s&&new RegExp(s,"g").test(n)?[]:(i=n.length,i<=a?[]:(o=[t.row,i],new r("E040",o,{maxlength:a,length:i})))):[]}},function(t,e,n){var r=n(1),i=n(71);t.exports={name:"line"},t.exports.lint=function(t,e,n){t[0]="";var o=this.subscribers;return n.reset(e),r.flattenDeep(t.map(function(t,e){return n.getOptsAtIndex(t.index),0===e?[]:i.applyRules(o,t,n.current)}))}},function(t,e,n){var r=n(91);t.exports={name:"page-title",on:["tag"],filter:["head"]},t.exports.lint=function(t,e){var n=[],i=t.children.filter(function(t){return"tag"===t.type&&"title"===t.name});e["head-req-title"]&&!i.some(function(t){return t.children.length>0})&&n.push(new r("E027",t.openLineCol)),e["title-no-dup"]&&i.length>1&&n.push(new r("E028",i[1].openLineCol,{num:i.length}));var o=e["title-max-len"];return o&&i.map(function(t){var e=t.children.filter(function(t){return"text"===t.type}).map(function(t){return t.data}).join("");e.length>o&&n.push(new r("E029",t.openLineCol,{title:e,maxlength:o}))}),n}},function(t,e,n){function r(t,e){return t.exec(e)||!1}var i=n(71),o=n(91);t.exports={name:"spec-char-escape",on:["dom"],filter:["text","tag"]};var a={improper:/(&[^a-zA-Z0-9#;]*;)/gm,brackets:/[<>]/gm,unescaped:/(&[a-zA-Z0-9#]*[^a-zA-Z0-9#;])/gm};t.exports.lint=function(t,e){if(!e[this.name])return[];var n=[],s=null;if(["text"].indexOf(t.type)>-1&&t.data.length>0&&(s=i.getLineColFunc(t.data,t.openLineCol),[a.improper,a.brackets,a.unescaped].forEach(function(e){for(var i=r(e,t.data);i;){var a=s(i.index);n.push(new o("E023",a,{chars:i[1],part:"text"})),i=r(e,t.data)}})),t.attribs)for(var u=Object.keys(t.attribs),c=0;c<u.length;c++){var l=t.attribs[u[c]];l.valueLineCol[0]--,l.valueLineCol[1]--,s=i.getLineColFunc(l.value,l.valueLineCol),[a.improper,a.brackets,a.unescaped].forEach(function(e){for(var i=r(e,l.value);i;){var a=s(i.index);n.push(new o("E023",a,{chars:i[1],part:"attribute value"})),i=r(e,t.data)}})}return n}},function(t,e,n){var r=n(91);t.exports={name:"table-req-caption",on:["tag"],filter:["table"]},t.exports.lint=function(t,e){if(!e[this.name])return[];for(var n=t.children,i=0;i<n.length;i++)if("caption"===n[i].name)return[];return new r("E031",t.openLineCol)}},function(t,e,n){var r=n(91);t.exports={name:"table-req-header",on:["tag"],filter:["table"]},t.exports.lint=function(t,e){if(!e[this.name])return[];for(var n=t.children,i=0;n[i]&&n[i].name&&(n[i].name.match(/caption/i)||n[i].name.match(/colgroup/i)||n[i].name.match(/tfoot/i));)i+=1;if(n[i]&&n[i].name){if(n[i].name.match(/thead/i))return[];if(n[i].name.match(/tr/i)&&n[i].children[0].name.match(/th/i))return[]}return new r("E035",t.openLineCol)}},function(t,e,n){var r=n(91);t.exports={name:"tag-bans",on:["dom"],filter:["tag","style","script"]},t.exports.lint=function(t,e){var n=e[this.name];return!n||n.indexOf(t.name)<0?[]:new r("E016",t.openLineCol,{tag:t.name})}},function(t,e,n){var r=n(71),i=n(91);t.exports={name:"tag-close",on:["tag"]},t.exports.lint=function(t,e){if(t.close&&t.name.toLowerCase()===t.close.toLowerCase()){if(e["tag-name-match"]&&t.name!==t.close)return new i("E030",t.closeLineCol)}else if(r.isVoidElement(t.name)){var n=r.isSelfClosing(t),o=e["tag-self-close"];if("always"==o&&!n||"never"==o&&n)return new i("E018",t.openLineCol,{expect:o})}else if(e["tag-close"])return new i("E042",t.openLineCol,{tag:t.name.toLowerCase()});return[]}},function(t,e,n){var r=n(91);t.exports={name:"tag-name-lowercase",on:["tag"]};var i=/[A-Z]/;t.exports.lint=function(t,e){return e[this.name]&&i.test(t.name)?new r("E017",t.openLineCol):[]}},function(t,e,n){var r=n(71);t.exports={name:"tag",on:["dom"],filter:["tag"]},t.exports.lint=function(t,e){var n=r.matchFilter.bind(r,t.name),i=this.subscribers.filter(n);return r.applyRules(i,t,e)}},function(t,e,n){var r=n(1),i={E000:"not a valid error code",E001:"the `<%= attribute %>` attribute is banned",E002:"attribute names must match the format: <%= format %>",E003:"duplicate attribute: <%= attribute %>",E004:"attribute values must not include unsafe characters",E005:"the `<%= attribute %>` attribute is not <%= format %>",E006:"attribute values cannot be empty",E007:"<!DOCTYPE> should be the first element seen",E008:"the doctype must conform to the HTML5 standard",E009:"use only <%= format %> links",E010:'ids and classes may not use the word "ad"',E011:"value must match the format: <%= format %>",E012:'the id "<%= id %>" is already in use',E013:"the `alt` property must be set for image tags",E014:"a source must be given for each `img` tag",E015:"line ending does not match format: <%= format %>",E016:"the <%= tag %> tag is banned",E017:"tag names must be lowercase",E018:"void element should <%= expect %> close itself",E019:"all labels should have a `for` attribute",E020:"label does not have a `for` attribute or a labeable child",E021:'an element with the id "<%= id %>" does not exist (should match `for` attribute)',E022:"the linked element is not labeable (id: <%= id %>)",E023:"<%= part %> contains improperly escaped characters: <%= chars %>",E024:"<%= type %> not allowed",E025:"html element should specify the language of the page",E026:"<%= op %> (all focusable elements on a page must either have a positive tabindex or none at all)",E027:"the <head> tag must contain a title",E028:"the <head> tag can only contain one title; <%= num %> given",E029:'title "<%= title %>" exceeds maximum length of <%= maxlength %>',E030:"tag start and end must match",E031:"table must have a caption for accessibility",E032:"figure must have a figcaption, figcaption must be in a figure (for accessibility)",E033:"input with id: <%= idValue %> (or if type is text, name: <%= nameValue %>) is not associated with a label for accessibility",E034:"radio input must have an associated name",E035:"table must have a header for accessibility",E036:"indenting spaces must be used in groups of <%= width %>",E037:"attributes for one tag on the one line should be limited to <%= limit %>",E038:"lang attribute <%= lang %> is not valid",E039:"lang attribute <%= lang %> in not properly capitalized",E040:"line length should not exceed <%= maxlength %> characters (current: <%= length %>)",E041:"duplicate class: <%= classes %>",E042:"tag <<%= tag %>> is not closed"};t.exports.errors={},r.forOwn(i,function(e,n){t.exports.errors[n]={format:e,code:n}}),t.exports.renderMsg=function(t,e){var n=i[t];return r.template(n)(e)},t.exports.renderIssue=function(t){return this.renderMsg(t.code,t.data)}}]);
});
(function __htmllint_cut_end(){})

ace.define("ace/mode/html_worker",["require","exports","module","ace/lib/oop","ace/lib/lang","ace/worker/mirror","ace/lib/htmllint"], function(require, exports, module) {
"use strict";

var oop = require("../lib/oop");
var lang = require("../lib/lang");
var Mirror = require("../worker/mirror").Mirror;
var htmllint = require('../lib/htmllint');

var lintOptions = {
	'attr-bans': [
		'background',
		'bgcolor',
		'frameborder',
		'longdesc',
		'marginwidth',
		'marginheight',
		'scrolling'
	],
	'tag-bans': ['script'],
	'doctype-first': true,
	'line-end-style': false,
	'indent-style': false,
	'indent-width': false,
	'spec-char-escape':true,
	'id-no-dup': true,
	'id-class-style': false,
	'img-req-alt': 'allownull',
	'img-req-src': true
};

htmllint.use([]);

var errorTypes = {
    "expected-doctype-but-got-start-tag": "info",
    "expected-doctype-but-got-chars": "info",
    "non-html-root": "info"
}

var Worker = exports.Worker = function(sender) {
    Mirror.call(this, sender);
    this.setTimeout(400);
    this.context = null;
};

oop.inherits(Worker, Mirror);

(function() {

    this.setOptions = function(options) {
        this.context = options.context;
    };

    this.onUpdate = function() {
        var that = this;
        var value = this.doc.getValue();
        if (!value)
            return;

		htmllint(value, lintOptions)
			.then(function (issues) {
				var resultIssues = issues.map(function (issue) {
					return {
						row: issue.line-1,
						column: issue.column-1,
						text: htmllint.messages.renderIssue(issue),
						type: 'error'
					};
				});

				that.sender.emit('error', resultIssues);
			})
			.catch(function (err) {
				console.error(err);
			});

    };

}).call(Worker.prototype);

});

ace.define("ace/lib/es5-shim",["require","exports","module"], function(require, exports, module) {

function Empty() {}

if (!Function.prototype.bind) {
    Function.prototype.bind = function bind(that) { // .length is 1
        var target = this;
        if (typeof target != "function") {
            throw new TypeError("Function.prototype.bind called on incompatible " + target);
        }
        var args = slice.call(arguments, 1); // for normal call
        var bound = function () {

            if (this instanceof bound) {

                var result = target.apply(
                    this,
                    args.concat(slice.call(arguments))
                );
                if (Object(result) === result) {
                    return result;
                }
                return this;

            } else {
                return target.apply(
                    that,
                    args.concat(slice.call(arguments))
                );

            }

        };
        if(target.prototype) {
            Empty.prototype = target.prototype;
            bound.prototype = new Empty();
            Empty.prototype = null;
        }
        return bound;
    };
}
var call = Function.prototype.call;
var prototypeOfArray = Array.prototype;
var prototypeOfObject = Object.prototype;
var slice = prototypeOfArray.slice;
var _toString = call.bind(prototypeOfObject.toString);
var owns = call.bind(prototypeOfObject.hasOwnProperty);
var defineGetter;
var defineSetter;
var lookupGetter;
var lookupSetter;
var supportsAccessors;
if ((supportsAccessors = owns(prototypeOfObject, "__defineGetter__"))) {
    defineGetter = call.bind(prototypeOfObject.__defineGetter__);
    defineSetter = call.bind(prototypeOfObject.__defineSetter__);
    lookupGetter = call.bind(prototypeOfObject.__lookupGetter__);
    lookupSetter = call.bind(prototypeOfObject.__lookupSetter__);
}
if ([1,2].splice(0).length != 2) {
    if(function() { // test IE < 9 to splice bug - see issue #138
        function makeArray(l) {
            var a = new Array(l+2);
            a[0] = a[1] = 0;
            return a;
        }
        var array = [], lengthBefore;
        
        array.splice.apply(array, makeArray(20));
        array.splice.apply(array, makeArray(26));

        lengthBefore = array.length; //46
        array.splice(5, 0, "XXX"); // add one element

        lengthBefore + 1 == array.length

        if (lengthBefore + 1 == array.length) {
            return true;// has right splice implementation without bugs
        }
    }()) {//IE 6/7
        var array_splice = Array.prototype.splice;
        Array.prototype.splice = function(start, deleteCount) {
            if (!arguments.length) {
                return [];
            } else {
                return array_splice.apply(this, [
                    start === void 0 ? 0 : start,
                    deleteCount === void 0 ? (this.length - start) : deleteCount
                ].concat(slice.call(arguments, 2)))
            }
        };
    } else {//IE8
        Array.prototype.splice = function(pos, removeCount){
            var length = this.length;
            if (pos > 0) {
                if (pos > length)
                    pos = length;
            } else if (pos == void 0) {
                pos = 0;
            } else if (pos < 0) {
                pos = Math.max(length + pos, 0);
            }

            if (!(pos+removeCount < length))
                removeCount = length - pos;

            var removed = this.slice(pos, pos+removeCount);
            var insert = slice.call(arguments, 2);
            var add = insert.length;            
            if (pos === length) {
                if (add) {
                    this.push.apply(this, insert);
                }
            } else {
                var remove = Math.min(removeCount, length - pos);
                var tailOldPos = pos + remove;
                var tailNewPos = tailOldPos + add - remove;
                var tailCount = length - tailOldPos;
                var lengthAfterRemove = length - remove;

                if (tailNewPos < tailOldPos) { // case A
                    for (var i = 0; i < tailCount; ++i) {
                        this[tailNewPos+i] = this[tailOldPos+i];
                    }
                } else if (tailNewPos > tailOldPos) { // case B
                    for (i = tailCount; i--; ) {
                        this[tailNewPos+i] = this[tailOldPos+i];
                    }
                } // else, add == remove (nothing to do)

                if (add && pos === lengthAfterRemove) {
                    this.length = lengthAfterRemove; // truncate array
                    this.push.apply(this, insert);
                } else {
                    this.length = lengthAfterRemove + add; // reserves space
                    for (i = 0; i < add; ++i) {
                        this[pos+i] = insert[i];
                    }
                }
            }
            return removed;
        };
    }
}
if (!Array.isArray) {
    Array.isArray = function isArray(obj) {
        return _toString(obj) == "[object Array]";
    };
}
var boxedString = Object("a"),
    splitString = boxedString[0] != "a" || !(0 in boxedString);

if (!Array.prototype.forEach) {
    Array.prototype.forEach = function forEach(fun /*, thisp*/) {
        var object = toObject(this),
            self = splitString && _toString(this) == "[object String]" ?
                this.split("") :
                object,
            thisp = arguments[1],
            i = -1,
            length = self.length >>> 0;
        if (_toString(fun) != "[object Function]") {
            throw new TypeError(); // TODO message
        }

        while (++i < length) {
            if (i in self) {
                fun.call(thisp, self[i], i, object);
            }
        }
    };
}
if (!Array.prototype.map) {
    Array.prototype.map = function map(fun /*, thisp*/) {
        var object = toObject(this),
            self = splitString && _toString(this) == "[object String]" ?
                this.split("") :
                object,
            length = self.length >>> 0,
            result = Array(length),
            thisp = arguments[1];
        if (_toString(fun) != "[object Function]") {
            throw new TypeError(fun + " is not a function");
        }

        for (var i = 0; i < length; i++) {
            if (i in self)
                result[i] = fun.call(thisp, self[i], i, object);
        }
        return result;
    };
}
if (!Array.prototype.filter) {
    Array.prototype.filter = function filter(fun /*, thisp */) {
        var object = toObject(this),
            self = splitString && _toString(this) == "[object String]" ?
                this.split("") :
                    object,
            length = self.length >>> 0,
            result = [],
            value,
            thisp = arguments[1];
        if (_toString(fun) != "[object Function]") {
            throw new TypeError(fun + " is not a function");
        }

        for (var i = 0; i < length; i++) {
            if (i in self) {
                value = self[i];
                if (fun.call(thisp, value, i, object)) {
                    result.push(value);
                }
            }
        }
        return result;
    };
}
if (!Array.prototype.every) {
    Array.prototype.every = function every(fun /*, thisp */) {
        var object = toObject(this),
            self = splitString && _toString(this) == "[object String]" ?
                this.split("") :
                object,
            length = self.length >>> 0,
            thisp = arguments[1];
        if (_toString(fun) != "[object Function]") {
            throw new TypeError(fun + " is not a function");
        }

        for (var i = 0; i < length; i++) {
            if (i in self && !fun.call(thisp, self[i], i, object)) {
                return false;
            }
        }
        return true;
    };
}
if (!Array.prototype.some) {
    Array.prototype.some = function some(fun /*, thisp */) {
        var object = toObject(this),
            self = splitString && _toString(this) == "[object String]" ?
                this.split("") :
                object,
            length = self.length >>> 0,
            thisp = arguments[1];
        if (_toString(fun) != "[object Function]") {
            throw new TypeError(fun + " is not a function");
        }

        for (var i = 0; i < length; i++) {
            if (i in self && fun.call(thisp, self[i], i, object)) {
                return true;
            }
        }
        return false;
    };
}
if (!Array.prototype.reduce) {
    Array.prototype.reduce = function reduce(fun /*, initial*/) {
        var object = toObject(this),
            self = splitString && _toString(this) == "[object String]" ?
                this.split("") :
                object,
            length = self.length >>> 0;
        if (_toString(fun) != "[object Function]") {
            throw new TypeError(fun + " is not a function");
        }
        if (!length && arguments.length == 1) {
            throw new TypeError("reduce of empty array with no initial value");
        }

        var i = 0;
        var result;
        if (arguments.length >= 2) {
            result = arguments[1];
        } else {
            do {
                if (i in self) {
                    result = self[i++];
                    break;
                }
                if (++i >= length) {
                    throw new TypeError("reduce of empty array with no initial value");
                }
            } while (true);
        }

        for (; i < length; i++) {
            if (i in self) {
                result = fun.call(void 0, result, self[i], i, object);
            }
        }

        return result;
    };
}
if (!Array.prototype.reduceRight) {
    Array.prototype.reduceRight = function reduceRight(fun /*, initial*/) {
        var object = toObject(this),
            self = splitString && _toString(this) == "[object String]" ?
                this.split("") :
                object,
            length = self.length >>> 0;
        if (_toString(fun) != "[object Function]") {
            throw new TypeError(fun + " is not a function");
        }
        if (!length && arguments.length == 1) {
            throw new TypeError("reduceRight of empty array with no initial value");
        }

        var result, i = length - 1;
        if (arguments.length >= 2) {
            result = arguments[1];
        } else {
            do {
                if (i in self) {
                    result = self[i--];
                    break;
                }
                if (--i < 0) {
                    throw new TypeError("reduceRight of empty array with no initial value");
                }
            } while (true);
        }

        do {
            if (i in this) {
                result = fun.call(void 0, result, self[i], i, object);
            }
        } while (i--);

        return result;
    };
}
if (!Array.prototype.indexOf || ([0, 1].indexOf(1, 2) != -1)) {
    Array.prototype.indexOf = function indexOf(sought /*, fromIndex */ ) {
        var self = splitString && _toString(this) == "[object String]" ?
                this.split("") :
                toObject(this),
            length = self.length >>> 0;

        if (!length) {
            return -1;
        }

        var i = 0;
        if (arguments.length > 1) {
            i = toInteger(arguments[1]);
        }
        i = i >= 0 ? i : Math.max(0, length + i);
        for (; i < length; i++) {
            if (i in self && self[i] === sought) {
                return i;
            }
        }
        return -1;
    };
}
if (!Array.prototype.lastIndexOf || ([0, 1].lastIndexOf(0, -3) != -1)) {
    Array.prototype.lastIndexOf = function lastIndexOf(sought /*, fromIndex */) {
        var self = splitString && _toString(this) == "[object String]" ?
                this.split("") :
                toObject(this),
            length = self.length >>> 0;

        if (!length) {
            return -1;
        }
        var i = length - 1;
        if (arguments.length > 1) {
            i = Math.min(i, toInteger(arguments[1]));
        }
        i = i >= 0 ? i : length - Math.abs(i);
        for (; i >= 0; i--) {
            if (i in self && sought === self[i]) {
                return i;
            }
        }
        return -1;
    };
}
if (!Object.getPrototypeOf) {
    Object.getPrototypeOf = function getPrototypeOf(object) {
        return object.__proto__ || (
            object.constructor ?
            object.constructor.prototype :
            prototypeOfObject
        );
    };
}
if (!Object.getOwnPropertyDescriptor) {
    var ERR_NON_OBJECT = "Object.getOwnPropertyDescriptor called on a " +
                         "non-object: ";
    Object.getOwnPropertyDescriptor = function getOwnPropertyDescriptor(object, property) {
        if ((typeof object != "object" && typeof object != "function") || object === null)
            throw new TypeError(ERR_NON_OBJECT + object);
        if (!owns(object, property))
            return;

        var descriptor, getter, setter;
        descriptor =  { enumerable: true, configurable: true };
        if (supportsAccessors) {
            var prototype = object.__proto__;
            object.__proto__ = prototypeOfObject;

            var getter = lookupGetter(object, property);
            var setter = lookupSetter(object, property);
            object.__proto__ = prototype;

            if (getter || setter) {
                if (getter) descriptor.get = getter;
                if (setter) descriptor.set = setter;
                return descriptor;
            }
        }
        descriptor.value = object[property];
        return descriptor;
    };
}
if (!Object.getOwnPropertyNames) {
    Object.getOwnPropertyNames = function getOwnPropertyNames(object) {
        return Object.keys(object);
    };
}
if (!Object.create) {
    var createEmpty;
    if (Object.prototype.__proto__ === null) {
        createEmpty = function () {
            return { "__proto__": null };
        };
    } else {
        createEmpty = function () {
            var empty = {};
            for (var i in empty)
                empty[i] = null;
            empty.constructor =
            empty.hasOwnProperty =
            empty.propertyIsEnumerable =
            empty.isPrototypeOf =
            empty.toLocaleString =
            empty.toString =
            empty.valueOf =
            empty.__proto__ = null;
            return empty;
        }
    }

    Object.create = function create(prototype, properties) {
        var object;
        if (prototype === null) {
            object = createEmpty();
        } else {
            if (typeof prototype != "object")
                throw new TypeError("typeof prototype["+(typeof prototype)+"] != 'object'");
            var Type = function () {};
            Type.prototype = prototype;
            object = new Type();
            object.__proto__ = prototype;
        }
        if (properties !== void 0)
            Object.defineProperties(object, properties);
        return object;
    };
}

function doesDefinePropertyWork(object) {
    try {
        Object.defineProperty(object, "sentinel", {});
        return "sentinel" in object;
    } catch (exception) {
    }
}
if (Object.defineProperty) {
    var definePropertyWorksOnObject = doesDefinePropertyWork({});
    var definePropertyWorksOnDom = typeof document == "undefined" ||
        doesDefinePropertyWork(document.createElement("div"));
    if (!definePropertyWorksOnObject || !definePropertyWorksOnDom) {
        var definePropertyFallback = Object.defineProperty;
    }
}

if (!Object.defineProperty || definePropertyFallback) {
    var ERR_NON_OBJECT_DESCRIPTOR = "Property description must be an object: ";
    var ERR_NON_OBJECT_TARGET = "Object.defineProperty called on non-object: "
    var ERR_ACCESSORS_NOT_SUPPORTED = "getters & setters can not be defined " +
                                      "on this javascript engine";

    Object.defineProperty = function defineProperty(object, property, descriptor) {
        if ((typeof object != "object" && typeof object != "function") || object === null)
            throw new TypeError(ERR_NON_OBJECT_TARGET + object);
        if ((typeof descriptor != "object" && typeof descriptor != "function") || descriptor === null)
            throw new TypeError(ERR_NON_OBJECT_DESCRIPTOR + descriptor);
        if (definePropertyFallback) {
            try {
                return definePropertyFallback.call(Object, object, property, descriptor);
            } catch (exception) {
            }
        }
        if (owns(descriptor, "value")) {

            if (supportsAccessors && (lookupGetter(object, property) ||
                                      lookupSetter(object, property)))
            {
                var prototype = object.__proto__;
                object.__proto__ = prototypeOfObject;
                delete object[property];
                object[property] = descriptor.value;
                object.__proto__ = prototype;
            } else {
                object[property] = descriptor.value;
            }
        } else {
            if (!supportsAccessors)
                throw new TypeError(ERR_ACCESSORS_NOT_SUPPORTED);
            if (owns(descriptor, "get"))
                defineGetter(object, property, descriptor.get);
            if (owns(descriptor, "set"))
                defineSetter(object, property, descriptor.set);
        }

        return object;
    };
}
if (!Object.defineProperties) {
    Object.defineProperties = function defineProperties(object, properties) {
        for (var property in properties) {
            if (owns(properties, property))
                Object.defineProperty(object, property, properties[property]);
        }
        return object;
    };
}
if (!Object.seal) {
    Object.seal = function seal(object) {
        return object;
    };
}
if (!Object.freeze) {
    Object.freeze = function freeze(object) {
        return object;
    };
}
try {
    Object.freeze(function () {});
} catch (exception) {
    Object.freeze = (function freeze(freezeObject) {
        return function freeze(object) {
            if (typeof object == "function") {
                return object;
            } else {
                return freezeObject(object);
            }
        };
    })(Object.freeze);
}
if (!Object.preventExtensions) {
    Object.preventExtensions = function preventExtensions(object) {
        return object;
    };
}
if (!Object.isSealed) {
    Object.isSealed = function isSealed(object) {
        return false;
    };
}
if (!Object.isFrozen) {
    Object.isFrozen = function isFrozen(object) {
        return false;
    };
}
if (!Object.isExtensible) {
    Object.isExtensible = function isExtensible(object) {
        if (Object(object) === object) {
            throw new TypeError(); // TODO message
        }
        var name = '';
        while (owns(object, name)) {
            name += '?';
        }
        object[name] = true;
        var returnValue = owns(object, name);
        delete object[name];
        return returnValue;
    };
}
if (!Object.keys) {
    var hasDontEnumBug = true,
        dontEnums = [
            "toString",
            "toLocaleString",
            "valueOf",
            "hasOwnProperty",
            "isPrototypeOf",
            "propertyIsEnumerable",
            "constructor"
        ],
        dontEnumsLength = dontEnums.length;

    for (var key in {"toString": null}) {
        hasDontEnumBug = false;
    }

    Object.keys = function keys(object) {

        if (
            (typeof object != "object" && typeof object != "function") ||
            object === null
        ) {
            throw new TypeError("Object.keys called on a non-object");
        }

        var keys = [];
        for (var name in object) {
            if (owns(object, name)) {
                keys.push(name);
            }
        }

        if (hasDontEnumBug) {
            for (var i = 0, ii = dontEnumsLength; i < ii; i++) {
                var dontEnum = dontEnums[i];
                if (owns(object, dontEnum)) {
                    keys.push(dontEnum);
                }
            }
        }
        return keys;
    };

}
if (!Date.now) {
    Date.now = function now() {
        return new Date().getTime();
    };
}
var ws = "\x09\x0A\x0B\x0C\x0D\x20\xA0\u1680\u180E\u2000\u2001\u2002\u2003" +
    "\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u202F\u205F\u3000\u2028" +
    "\u2029\uFEFF";
if (!String.prototype.trim || ws.trim()) {
    ws = "[" + ws + "]";
    var trimBeginRegexp = new RegExp("^" + ws + ws + "*"),
        trimEndRegexp = new RegExp(ws + ws + "*$");
    String.prototype.trim = function trim() {
        return String(this).replace(trimBeginRegexp, "").replace(trimEndRegexp, "");
    };
}

function toInteger(n) {
    n = +n;
    if (n !== n) { // isNaN
        n = 0;
    } else if (n !== 0 && n !== (1/0) && n !== -(1/0)) {
        n = (n > 0 || -1) * Math.floor(Math.abs(n));
    }
    return n;
}

function isPrimitive(input) {
    var type = typeof input;
    return (
        input === null ||
        type === "undefined" ||
        type === "boolean" ||
        type === "number" ||
        type === "string"
    );
}

function toPrimitive(input) {
    var val, valueOf, toString;
    if (isPrimitive(input)) {
        return input;
    }
    valueOf = input.valueOf;
    if (typeof valueOf === "function") {
        val = valueOf.call(input);
        if (isPrimitive(val)) {
            return val;
        }
    }
    toString = input.toString;
    if (typeof toString === "function") {
        val = toString.call(input);
        if (isPrimitive(val)) {
            return val;
        }
    }
    throw new TypeError();
}
var toObject = function (o) {
    if (o == null) { // this matches both null and undefined
        throw new TypeError("can't convert "+o+" to object");
    }
    return Object(o);
};

});
