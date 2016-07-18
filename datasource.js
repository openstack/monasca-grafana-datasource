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
      // Missing target.period indicates a new unfilled query
      if (target.error || target.hide || !target.period) {
        continue;
      }
      var query = this.buildDataQuery(options.targets[i], from, to);
      query = self.templateSrv.replace(query, options.scopedVars);
      var query_list
      if (options.group){
        query_list = this.expandTemplatedQueries(query);
      }
      else {
        query_list = this.expandQueries(query);
      }
      targets_list.push(query_list);
    }

    var targets_promise = self.q.all(targets_list).then(function(results) {
      return _.flatten(results);
    });

    var promises = self.q.resolve(targets_promise).then(function(targets) {
      return targets.map(function (target) {
        target = datasource.convertPeriod(target);
          return datasource._limitedMonascaRequest(target, {}).then(datasource.convertDataPoints).catch(function(err) {throw err});
      });
    }).catch(function(err) {throw err});

    return self.q.resolve(promises).then(function(promises) {
      return self.q.all(promises).then(function(results) {
        var sorted_results = results.map(function (results) {
          return results.sort(function (a, b) {
            return a.target.localeCompare(b.target);
          });
        });
        return { data: _.flatten(sorted_results).filter(function(result) { return !_.isEmpty(result)}) };
      });
    });
  };

  MonascaDatasource.prototype.namesQuery = function() {
    return this._limitedMonascaRequest('/v2.0/metrics/names', {}).catch(function(err) {throw err});
  };

  MonascaDatasource.prototype.convertNamesList = function(data) {
    var metrics = [];
    data = data.data.elements;
    for (var i = 0; i < data.length; i++) {
      metrics.push(data[i].name);
    }
    return metrics;
  };

  MonascaDatasource.prototype.metricsQuery = function(params) {
    return this._limitedMonascaRequest('/v2.0/metrics', params).catch(function(err) {throw err});
  };

  MonascaDatasource.prototype.buildDimensionList = function(data) {
    var keys = [];
    var values = {};
    data = data.data.elements;
    for (var i = 0; i < data.length; i++) {
      var dim_set = data[i].dimensions;
      for (var key in dim_set) {
        if (keys.indexOf(key) == -1) {
          keys.push(key);
          values[key] = [];
        }
        var value = dim_set[key];
        if (values[key].indexOf(value) == -1) {
          values[key].push(value);
        }
      }
    }
    return {'keys' : keys, 'values' : values};
  };

  MonascaDatasource.prototype.buildMetricList = function(data) {
    data = data.data.elements;
    return data;
  };

  MonascaDatasource.prototype.buildDataQuery = function(options, from, to) {
    var params = {};
    params.name = options.metric;
    if (options.group) {
      params.group_by = '*';
    }
    else {
      params.merge_metrics = 'true';
    }
    params.start_time = from;
    if (to) {
      params.end_time = to;
    }
    if (options.dimensions) {
      var dimensions = '';
      for (var i = 0; i < options.dimensions.length; i++) {
        var key = options.dimensions[i].key;
        var value = options.dimensions[i].value;
        if (options.group && value == '$all') {
          continue;
        }
        if (dimensions) {
          dimensions += ',';
        }
        dimensions += key;
        dimensions += ':';
        dimensions += value;
      }
      params.dimensions = dimensions;
    }
    if (options.alias) {
      params.alias = options.alias;
    }
    var path;
    if (options.aggregator != 'none') {
      params.statistics = options.aggregator;
      params.period = options.period;
      path = '/v2.0/metrics/statistics';
    }
    else {
      path = '/v2.0/metrics/measurements';
    }
    var first = true;
    Object.keys(params).forEach(function (key) {
      if (first) {
        path += '?';
        first = false;
      }
      else {
        path += '&';
      }
      path += key;
      path += '=';
      path += params[key];
    });
    return path;
  };

  MonascaDatasource.prototype.expandQueries = function(query) {
    var datasource = this;
    return this.expandAllQueries(query).then(function(partial_query_list) {
      var query_list = [];
      for (var i = 0; i < partial_query_list.length; i++) {
        query_list = query_list.concat(datasource.expandTemplatedQueries(partial_query_list[i]));
      }
      query_list = datasource.autoAlias(query_list);
      return query_list;
    });
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
      var new_query = query.replace(new RegExp(to_replace, 'g'), var_options[i]);
      expandedQueries = expandedQueries.concat(this.expandTemplatedQueries(new_query));
    }
    return expandedQueries;
  };

  MonascaDatasource.prototype.expandAllQueries = function(query) {
    if (query.indexOf("$all") > -1) {
      var metric_name = query.match(/name=([^&]*)/)[1];
      var start_time = query.match(/start_time=([^&]*)/)[1];

      // Find all matching subqueries
      var dimregex = /(?:dimensions=|,)([^,]*):\$all/g;
      var matches, neededDimensions = [];
      while (matches = dimregex.exec(query)) {
        neededDimensions.push(matches[1]);
      }

      var metricQueryParams = {'name' : metric_name, 'start_time': start_time};
      var queriesPromise = this.metricsQuery(metricQueryParams).then(function(data) {
        var expandedQueries = [];
        var metrics = data.data.elements;
        var matchingMetrics = {}; // object ensures uniqueness of dimension sets
        for (var i = 0; i < metrics.length; i++) {
          var dimensions = metrics[i].dimensions;
          var set = {};
          var skip = false;
          for (var j = 0; j < neededDimensions.length; j++) {
            var key = neededDimensions[j];
            if (!(key in dimensions)) {
              skip = true;
              break;
            }
            set[key] = dimensions[key];
          }
          if (!skip) {
            matchingMetrics[JSON.stringify(set)] = set;
          }
        }
        Object.keys(matchingMetrics).forEach(function (set) {
          var new_query = query;
          var match = matchingMetrics[set];
          Object.keys(match).forEach(function (key) {
            var to_replace = key+":\\$all";
            var replacement = key+":"+match[key];
            new_query = new_query.replace(new RegExp(to_replace, 'g'), replacement);
          });
          expandedQueries.push(new_query);
        });
        return expandedQueries;
      });

      return queriesPromise;
    }
    else {
      return self.q.resolve([query]);
    }
  };

  // Alias based on dimensions in query
  // Used when querying with merge flag, where no dimension info is returned.
  MonascaDatasource.prototype.autoAlias = function(query_list) {
    function keysSortedByLengthDesc(obj) {
      var keys = [];
      for (var key in obj) {
        keys.push(key)
      }
      function byLength(a, b) {return b.length - a.length}
      return keys.sort(byLength)
    };

    for (var i = 0; i < query_list.length; i++) {
      var query = query_list[i];
      var alias = query.match(/alias=[^&@]*@([^&]*)/);
      var dimensions = query.match(/dimensions=([^&]*)/);
      if (alias && dimensions[1]) {
        var dimensions_list = dimensions[1].split(',');
        var dimensions_dict = {};
        for (var j = 0; j < dimensions_list.length; j++) {
          var dim = dimensions_list[j].split(':');
          dimensions_dict[dim[0]] = dim[1];
        }
        var keys = keysSortedByLengthDesc(dimensions_dict);
        for (var k in keys) {
          query = query.replace(new RegExp("@"+keys[k], 'g'), dimensions_dict[keys[k]]);
        }
        query_list[i] = query;
      }
    }
    return query_list;
  };

  MonascaDatasource.prototype.convertDataPoints = function(data) {
    function keysSortedByLengthDesc(obj) {
      var keys = [];
      for (var key in obj) {
        keys.push(key)
      }
      function byLength(a, b) {return b.length - a.length}
      return keys.sort(byLength)
    };

    var url = data.config.url;
    var results = [];

    for (var i = 0; i < data.data.elements.length; i++)
    {
      var element = data.data.elements[i];

      var target = element.name;
      var alias = data.config.url.match(/alias=([^&]*)/);
      // Alias based on returned dimensions
      // Used when querying with group_by flag where dimensions are not specified in initial query
      if (alias) {
        alias = alias[1];
        var keys = keysSortedByLengthDesc(element.dimensions);
        for (var k in keys)
        {
          alias = alias.replace(new RegExp("@"+keys[k], 'g'), element.dimensions[keys[k]])
        }
        target = alias
      }

      var raw_datapoints;
      var aggregator;
      if ('measurements' in element) {
        raw_datapoints = element.measurements;
        aggregator = 'value';
      }
      else {
        raw_datapoints = element.statistics;
        aggregator = url.match(/statistics=[^&]*/);
        aggregator = aggregator[0].substring('statistics='.length);
      }
      var datapoints = [];
      var timeCol = element.columns.indexOf('timestamp');
      var dataCol = element.columns.indexOf(aggregator);
      for (var j = 0; j < raw_datapoints.length; j++) {
        var datapoint = raw_datapoints[j];
        var time = new Date(datapoint[timeCol]);
        var point = datapoint[dataCol];
        datapoints.push([point, time.getTime()]);
      }
      var convertedData = { 'target': target, 'datapoints': datapoints };
      results.push(convertedData)
    }
    return results;
  };

  // For use with specified or api enforced limits.
  // Pages through data until all data is retrieved.
  MonascaDatasource.prototype._limitedMonascaRequest = function(path, params) {
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

    // Handle incosistent element.id from merging here.  Remove when this bug is fixed.
    function flattenResults() {
      var elements = [];
      for (var i = 0; i < element_list.length; i++) {
        var element = element_list[i];
        if (element.measurements){
          elements.push(element.measurements);
        }
        if (element.statistics){
          elements.push(element.statistics);
        }
      }
      if (data.data.elements[0].measurements){
        data.data.elements[0].measurements = _.flatten(elements, true)
      }
      if (data.data.elements[0].statistics){
        data.data.elements[0].statistics = _.flatten(elements, true)
      }
    }

    function requestAll(multi_page){
      datasource._monascaRequest(path, params)
        .then(function(d) {
          data = d
          element_list = element_list.concat(d.data.elements);
          if(d.data.links) {
            for (var i = 0; i < d.data.links.length; i++) {
              if (d.data.links[i].rel == 'next'){
                var next = decodeURIComponent(d.data.links[i].href)
                var offset = next.match(/offset=([^&]*)/);
                params.offset = offset[1];
                requestAll(true);
                return;
              }
            }
          }
          // Handle incosistent element.id from merging here.  Remove when this bug is fixed.
          var query = d.data.links[0].href
          if (multi_page){
            if (query.indexOf('merge_metrics') > -1) {
              flattenResults();
            }
            else {
              aggregateResults();
            }
          }
          deferred.resolve(data);
        }).catch(function(err) {deferred.reject(err)});
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
        var monasca_response
        if (err.data) {
          if (err.data.message){
            monasca_response = err.data.message;
          } else{
            var err_name = Object.keys(err.data)[0]
            monasca_response = err.data[err_name].message
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

  MonascaDatasource.prototype.metricFindQuery = function(query) {
    return this.metricsQuery({}).then(function(data) {
      var values = [];
      data = data.data.elements;
      for (var i = 0; i < data.length; i++) {
        var dim_set = data[i].dimensions;
        if (query in dim_set) {
          var value = dim_set[query];
          if (values.indexOf(value) == -1) {
            values.push(value);
          }
        }
      }
      return _.map(values, function(value) {
        return {text: value};
      });
    });
  };

  MonascaDatasource.prototype.listTemplates = function() {
    var template_list = [];
    for (var i = 0; i < self.templateSrv.variables.length; i++) {
      template_list.push('$'+self.templateSrv.variables[i].name);
    }
    return template_list;
  };

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
