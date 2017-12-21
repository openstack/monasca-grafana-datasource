define([
  'angular',
  'lodash',
  'moment',
  'app/plugins/sdk',
  'app/core/utils/datemath',
  'app/core/utils/kbn',
  './query_ctrl',
],
function (angular, _, moment, sdk, dateMath, kbn) {
  'use strict';

  var self;

  function MonascaDatasource(instanceSettings, $q, backendSrv, templateSrv) {
    this.url = instanceSettings.url;
    this.name = instanceSettings.name;

    if (instanceSettings.jsonData) {
      this.token = instanceSettings.jsonData.token;
      this.keystoneAuth = instanceSettings.jsonData.keystoneAuth;
    } else {
      this.token = null;
      this.keystoneAuth = null;
    }

    this.q = $q;
    this.backendSrv = backendSrv;
    this.templateSrv = templateSrv;

    self = this;
  }

  MonascaDatasource.prototype.query = function(options) {
    var datasource = this;
    var from =  this.translateTime(options.range.from);
    var to =  this.translateTime(options.range.to);

    var targets_list = [];
    for (var i = 0; i < options.targets.length; i++) {
      var target = options.targets[i];
      if (target.error || target.hide || !target.metric) {
        continue;
      }
      var query = this.buildDataQuery(options.targets[i], from, to);
      query = self.templateSrv.replace(query, options.scopedVars);
      var query_list = this.expandTemplatedQueries(query);
      // Pre query aliasing
      // Used when querying with group_by, where some dimensions are not returned
      query_list = query_list.map(datasource.autoAlias);
      targets_list.push(query_list);
    }

    var targets_promise = self.q.all(targets_list).then(function(results) {
      return _.flatten(results);
    });

    var promises = self.q.resolve(targets_promise).then(function(targets) {
      return targets.map(function (target) {
        target = datasource.convertPeriod(target);
        return datasource._limitedMonascaRequest(target, {}, true).then(datasource.convertDataPoints).catch(function(err) {throw err;});
      });
    }).catch(function(err) {throw err;});

    return self.q.resolve(promises).then(function(promises) {
      return self.q.all(promises).then(function(results) {
        var sorted_results = results.map(function (results) {
          return results.sort(function (a, b) {
            return a.target.localeCompare(b.target);
          });
        });
        return { data: _.flatten(sorted_results).filter(function(result) { return !_.isEmpty(result);}) };
      });
    });
  };

  MonascaDatasource.prototype.metricsQuery = function(params) {
    return this._limitedMonascaRequest('/v2.0/metrics', params, true).catch(function(err) {throw err;});
  };

  MonascaDatasource.prototype.namesQuery = function() {
    var datasource = this;
    return this._limitedMonascaRequest('/v2.0/metrics/names', {}, false).then(function(data) {
      return datasource.convertDataList(data, 'name');
    }).catch(function(err) {throw err;});
  };

  MonascaDatasource.prototype.dimensionNamesQuery = function(params) {
    var datasource = this;
    return this._limitedMonascaRequest('/v2.0/metrics/dimensions/names', params, false).then(function(data) {
      return datasource.convertDataList(data, 'dimension_name');
    }).catch(function(err) {throw err;});
  };

  MonascaDatasource.prototype.dimensionValuesQuery = function(params) {
    var datasource = this;
    return this._limitedMonascaRequest('/v2.0/metrics/dimensions/names/values', params, false).then(function(data) {
      return datasource.convertDataList(data, 'dimension_value');
    }).catch(function(err) {throw err;});
  };

  MonascaDatasource.prototype.convertDataList = function(data, key) {
    var values = data.data.elements.map(function(element) {
      return element[key];
    });
    return values;
  };

  MonascaDatasource.prototype.buildDataQuery = function(options, from, to) {
    var params = {};
    params.name = options.metric;

    params.start_time = from;
    if (to) {
      params.end_time = to;
    }
    if (options.dimensions) {
      var dimensions = [];
      var group_by = [];
      for (var i = 0; i < options.dimensions.length; i++) {
        var key = options.dimensions[i].key;
        var value = options.dimensions[i].value;
        if (value == '$all' || value =='*') {
          group_by.push(key);
        }
        else {
          dimensions.push(key + ':' + value);
        }
      }
      var dimensions_string = dimensions.join(',');
      var group_by_string = group_by.join(',');
      if (dimensions_string){
        params.dimensions = dimensions;
      }
      if (group_by_string){
        params.group_by = group_by;
      }
    }
    if (options.group) {
      params.group_by = '*';
    }
    else {
      params.merge_metrics = 'true';
    }
    if (options.alias) {
      params.alias = options.alias;
    }
    var path;
    if (options.aggregator && options.aggregator != 'none') {
      params.statistics = options.aggregator;
      params.period = options.period;
      path = '/v2.0/metrics/statistics?';
    }
    else {
      path = '/v2.0/metrics/measurements?';
    }
    path += Object.keys(params).map(function(key) {
      return key + '=' + params[key];
    }).join('&');
    return path;
  };

  MonascaDatasource.prototype.expandTemplatedQueries = function(query) {
    var templated_vars = query.match(/{[^}]*}/g);
    if (!templated_vars) {
      return [query];
    }

    var expandedQueries = [];
    var to_replace = templated_vars[0];
    var var_options = to_replace.substring(1, to_replace.length - 1);
    var_options = var_options.split(',');
    for (var i = 0; i < var_options.length; i++) {
      var new_query = query.split(to_replace).join(var_options[i]);
      expandedQueries = expandedQueries.concat(this.expandTemplatedQueries(new_query));
    }
    return expandedQueries;
  };

  MonascaDatasource.prototype.autoAlias = function(query, dimensions, return_target) {
    function keysSortedByLengthDesc(obj) {
      var keys = [];
      for (var key in obj) {
        keys.push(key);
      }
      function byLength(a, b) {return b.length - a.length;}
      return keys.sort(byLength);
    }

    if (typeof(dimensions) !== "object") {
      var dimensions_string = query.match(/dimensions=([^&]*)/);
      if (dimensions_string) {
        var dimensions_list = dimensions_string[1].split(',');
        dimensions = {};
        for (var j = 0; j < dimensions_list.length; j++) {
          var dim = dimensions_list[j].split(':');
          dimensions[dim[0]] = dim[1];
        }
      }
    }

    var target = null;
    var alias_string = query.match(/alias=[^&]*/);
    if (alias_string) {
      var alias = alias_string[0];
      var keys = keysSortedByLengthDesc(dimensions);
      for (var k in keys) {
        alias = alias.replace(new RegExp("@"+keys[k], 'g'), dimensions[keys[k]]);
      }
      query = query.replace(alias_string[0], alias);
      target = alias.match(/alias=(.*)/)[1];
    }
    if (return_target === true) {
      return target;
    }
    return query;
  };

  MonascaDatasource.prototype.convertDataPoints = function(data) {
    var url = data.config.url;
    var results = [];

    for (var i = 0; i < data.data.elements.length; i++)
    {
      var element = data.data.elements[i];
      var target = element.name;

      // Post query aliasing
      // Used when querying with group_by flag where dimensions are not specified in initial query
      var alias = self.autoAlias(data.config.url, element.dimensions, true);
      if (alias) {
        target = alias;
      }

      var raw_datapoints;
      var aggregator = 'value';
      if ('measurements' in element) {
        raw_datapoints = element.measurements;
      }
      else {
        raw_datapoints = element.statistics;
        if (element.columns.indexOf(aggregator) < 0) {
          aggregator = url.match(/statistics=[^&]*/);
          aggregator = aggregator[0].substring('statistics='.length);
        }
      }
      var datapoints = [];
      var timeCol = element.columns.indexOf('timestamp');
      var dataCol = element.columns.indexOf(aggregator);
      var metaCol = element.columns.indexOf('value_meta');
      for (var j = 0; j < raw_datapoints.length; j++) {
        var datapoint = raw_datapoints[j];
        var time = new Date(datapoint[timeCol]);
        var point = datapoint[dataCol];
        var newpoint = [point, time.getTime()];
        if (metaCol >= 0) {
          newpoint.push(datapoint[metaCol]);
        }
        datapoints.push(newpoint);
      }
      var convertedData = { 'target': target, 'datapoints': datapoints };
      results.push(convertedData);
    }
    return results;
  };

  // For use with specified or api enforced limits.
  // Pages through data until all data is retrieved.
  MonascaDatasource.prototype._limitedMonascaRequest = function(path, params, aggregate) {
    var datasource = this;
    var deferred = self.q.defer();
    var data = null;
    var element_list = [];

    function aggregateResults() {
      var elements = {};
      for (var i = 0; i < element_list.length; i++) {
        var element = element_list[i];
        if (element.id in elements){
          if (element.measurements){
            elements[element.id].measurements = elements[element.id].measurements.concat(element.measurements);
          }
          if (element.statistics){
            elements[element.id].measurements = elements[element.id].statistics.concat(element.statistics);
          }
        }
        else{
          elements[element.id] = element;
        }
      }
      data.data.elements = Object.keys(elements).map(function(key) {
        return elements[key];
      });
    }

    function requestAll(multi_page){
      datasource._monascaRequest(path, params)
        .then(function(d) {
          data = d;
          element_list = element_list.concat(d.data.elements);
          if(d.data.links) {
            for (var i = 0; i < d.data.links.length; i++) {
              if (d.data.links[i].rel == 'next'){
                var next = decodeURIComponent(d.data.links[i].href);
                var offset = next.match(/offset=([^&]*)/);
                params.offset = offset[1];
                requestAll(true);
                return;
              }
            }
          }
          if (multi_page){
            if (aggregate){
              aggregateResults();
            }
            else {
              data.data.elements = element_list;
            }
          }
          deferred.resolve(data);
        }).catch(function(err) {deferred.reject(err);});
    }

    requestAll(false);
    return deferred.promise;
  };

  MonascaDatasource.prototype._monascaRequest = function(path, params) {
    var headers = {
      'Content-Type': 'application/json',
      'X-Auth-Token': this.token
    };

    var options = {
      method: 'GET',
      url:    this.url + path,
      params: params,
      headers: headers,
      withCredentials: true,
    };

    return this.backendSrv.datasourceRequest(options).catch(function(err) {
      if (err.status !== 0 || err.status >= 300) {
        var monasca_response;
        if (err.data) {
          if (err.data.message){
            monasca_response = err.data.message;
          } else{
            var err_name = Object.keys(err.data)[0];
            monasca_response = err.data[err_name].message;
          }
        }
        if (monasca_response) {
          throw { message: 'Monasca Error Response: ' + monasca_response };
        } else {
          throw { message: 'Monasca Error Status: ' + err.status };
        }
      }
    });
  };

  // Called by grafana to retrieve possible query template options
  MonascaDatasource.prototype.metricFindQuery = function(query) {
    return this.dimensionValuesQuery({'dimension_name': query}).then(function(data) {
      return _.map(data, function(value) {
        return {text: value};
      });
    });
  };

  // Called by grafana to retrieve data for dispalying annotations
  MonascaDatasource.prototype.annotationQuery = function(options) {
    var dimensions = [];
    if (options.annotation.dimensions) {
        options.annotation.dimensions.split(',').forEach(function(x){
        var dim = x.split('=');
        dimensions.push({'key': dim[0], 'value': dim[1]});
      });
      }
    options.targets = [{ 'metric': options.annotation.metric, 'dimensions': dimensions}];
    return this.query(options).then(function(result) {
      var list = [];
      for (var i = 0; i < result.data.length; i++) {
        var target = result.data[i];
        for (var y = 0; y < target.datapoints.length; y++) {
          var datapoint = target.datapoints[y];
          if (!datapoint[0] && !options.annotation.shownull) { continue; }
          var event = {
            annotation: options.annotation,
            time: datapoint[1],
            title: target.target
          };
          if (datapoint.length > 2 && options.annotation.showmeta){ // value_meta exists
            event.text = datapoint[2].detail;
          }
          list.push(event);
        }
      }
      return list;
    });
  };

  MonascaDatasource.prototype.listTemplates = function() {
    var template_list = [];
    for (var i = 0; i < self.templateSrv.variables.length; i++) {
      template_list.push('$'+self.templateSrv.variables[i].name);
    }
    return template_list;
  };

  // Called by grafana to test the datasource
  MonascaDatasource.prototype.testDatasource = function() {
    return this.namesQuery().then(function () {
      return { status: 'success', message: 'Data source is working', title: 'Success' };
    });
  };

  MonascaDatasource.prototype.translateTime = function(date) {
    if (date === 'now') {
      return null;
    }
    return moment.utc(dateMath.parse(date).valueOf()).toISOString();
  };

  MonascaDatasource.prototype.convertPeriod = function(target) {
    var regex = target.match(/period=[^&]*/);
    if (regex) {
      var period = regex[0].substring('period='.length);
      var matches = period.match(kbn.interval_regex);
      if (matches) {
        period = kbn.interval_to_seconds(period);
        target = target.replace(regex, 'period='+period);
      }
    }
    return target;
  };

  MonascaDatasource.prototype.isInt = function(str) {
    var n = ~~Number(str);
    return String(n) === str && n >= 0;
  };

  return MonascaDatasource;
});
