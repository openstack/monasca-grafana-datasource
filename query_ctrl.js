define([
  'angular',
  'lodash',
  'app/plugins/sdk'
],
function (angular, _, sdk) {
  'use strict';

  var MonascaQueryCtrl = (function(_super) {

    var self;
    var metricList = null;
    var dimensionList = { 'keys' : [], 'values' : {} };
    var currentDimension = null;

    function MonascaQueryCtrl($scope, $injector, templateSrv, $q, uiSegmentSrv) {
      _super.call(this, $scope, $injector);
      this.q = $q;
      this.uiSegmentSrv = uiSegmentSrv;
      this.templateSrv = templateSrv;

      if (!this.target.aggregator) {
        this.target.aggregator = 'avg';
      }
      if (!this.target.period) {
        this.target.period = '300';
      }
      if (!this.target.dimensions) {
        this.target.dimensions = [];
      }

      this.validateTarget();
      if (this.target.metric) {
        this.resetDimensionList();
      }

      self = this;
    }

    MonascaQueryCtrl.prototype = Object.create(_super.prototype);
    MonascaQueryCtrl.prototype.constructor = MonascaQueryCtrl;

    MonascaQueryCtrl.templateUrl = 'partials/query.editor.html';

    MonascaQueryCtrl.prototype.targetBlur = function() {
      this.validateTarget();
      if (!_.isEqual(this.oldTarget, this.target) && _.isEmpty(this.target.error)) {
        this.oldTarget = angular.copy(this.target);
        this.refresh();
      }
    };

    MonascaQueryCtrl.prototype.validateTarget = function() {
      this.target.error = "";
      if (!this.target.metric) {
        this.target.error = "No metric specified";
      }
      if (this.target.aggregator != 'none' && !this.target.period) {
        this.target.error = "You must supply a period when using an aggregator";
      }
      for (var i = 0; i < this.target.dimensions.length; i++) {
        if (!this.target.dimensions[i].key) {
          this.target.error = "One or more dimensions is missing a key";
          break;
        }
        if (!this.target.dimensions[i].value){
          this.target.error = "One or more dimensions is missing a value";
          break;
        }
      }
      if (this.target.error) {
        console.log(this.target.error);
      }
    };

    //////////////////////////////
    // METRIC
    //////////////////////////////

    MonascaQueryCtrl.prototype.suggestMetrics = function(query, callback) {
      if (!metricList) {
        self.datasource.namesQuery().then(function(metrics) {
          metricList = metrics;
          callback(metrics);
        });
      }
      else {
        return metricList;
      }
    };

    MonascaQueryCtrl.prototype.onMetricChange = function() {
      this.resetDimensionList();
      this.targetBlur();
    };

    //////////////////////////////
    // ALIAS
    //////////////////////////////

    MonascaQueryCtrl.prototype.suggestAlias = function(query, callback) {
      var upToLastTag = query.substr(0, query.lastIndexOf('@'));
      var suggestions = self.datasource.listTemplates();
      var dimensions = self.suggestDimensionKeys(query, callback);
      for (var i = 0; i < dimensions.length; i++) {
        suggestions.push(upToLastTag+"@"+dimensions[i]);
      }
      return suggestions;
    };

    //////////////////////////////
    // DIMENSIONS
    //////////////////////////////

    MonascaQueryCtrl.prototype.resetDimensionList = function() {
      dimensionList = { 'keys' : [], 'values' : {} };
    };

    MonascaQueryCtrl.prototype.suggestDimensionKeys = function(query, callback) {
      if (dimensionList.keys.length === 0 && self.target.metric) {
        self.datasource.dimensionNamesQuery({'metric_name' : self.target.metric}).then(function(dimensions) {
          dimensionList.keys = dimensions;
          callback(dimensions);
        });
      }
      else {
        return dimensionList.keys;
      }
    };

    MonascaQueryCtrl.prototype.suggestDimensionValues = function(query, callback) {
      var values = ['$all'];
      var returnValues = true;
      values = values.concat(self.datasource.listTemplates());
      if (currentDimension.key) {
        if (!(currentDimension.key in dimensionList.values)) {
          returnValues = false;
          self.datasource.dimensionValuesQuery({'metric_name' : self.target.metric, 'dimension_name': currentDimension.key})
              .then(function(dimensionValues) {
            dimensionList.values[currentDimension.key] = dimensionValues;
            values = values.concat(dimensionValues);
            callback(values);
          });
        }
        else {
          values = values.concat(dimensionList.values[currentDimension.key]);
        }
      }
      if (returnValues) {
        return values;
      }
    };

    MonascaQueryCtrl.prototype.editDimension = function(index) {
      currentDimension = this.target.dimensions[index];
    };

    MonascaQueryCtrl.prototype.addDimension = function() {
      this.target.dimensions.push({});
    };

    MonascaQueryCtrl.prototype.removeDimension = function(index) {
      this.target.dimensions.splice(index, 1);
      this.targetBlur();
    };

    //////////////////////////////

    return MonascaQueryCtrl;

  })(sdk.QueryCtrl);

  return MonascaQueryCtrl;
});
