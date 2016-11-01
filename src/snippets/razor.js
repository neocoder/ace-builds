define("ace/requirejs/text!ace/snippets/razor.snippets",[],"snippet if\n(${1} == ${2}) {\n	${3}\n}");

define("ace/snippets/razor",["require","exports","module","ace/requirejs/text!ace/snippets/razor.snippets"], function(require, exports, module) {
"use strict";

exports.snippetText = require("../requirejs/text!./razor.snippets");
exports.scope = "razor";

});
