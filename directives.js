define([
  'angular',
],
function (angular) {
  'use strict';

  var module = angular.module('grafana.directives');

  module.directive('metricQueryEditorMonasca', function() {
    return {controller: 'MonascaQueryCtrl', templateUrl: 'app/plugins/datasource/monasca/partials/query.editor.html'};
  });

  module.directive('metricQueryOptionsMonasca', function() {
    return {templateUrl: 'app/plugins/datasource/monasca/partials/query.options.html'};
  });

});
