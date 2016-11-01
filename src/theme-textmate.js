define("ace/theme/textmate",["require","exports","module","ace/requirejs/text!ace/theme/textmate.css","ace/lib/dom"], function(require, exports, module) {
"use strict";

exports.isDark = false;
exports.cssClass = "ace-tm";
exports.cssText = require("../requirejs/text!./textmate.css");

var dom = require("../lib/dom");
dom.importCssString(exports.cssText, exports.cssClass);
});
