define([
  './datasource',
  './query_ctrl'
],
function(MonascaDatasource, MonascaQueryCtrl) {
  'use strict';

  var MonascaConfigCtrl = function() {};
  MonascaConfigCtrl.templateUrl = "partials/config.html";

  var MonascaQueryOptionsCtrl = function() {};
  MonascaQueryOptionsCtrl.templateUrl = "partials/query.options.html";

  var MonascaAnnotationsQueryCtrl = function() {};
  MonascaAnnotationsQueryCtrl.templateUrl = "partials/annotations.editor.html";

  return {
    'Datasource': MonascaDatasource,
    'QueryCtrl': MonascaQueryCtrl,
    'ConfigCtrl': MonascaConfigCtrl,
    'QueryOptionsCtrl': MonascaQueryOptionsCtrl,
    'AnnotationsQueryCtrl': MonascaAnnotationsQueryCtrl
  };
});
