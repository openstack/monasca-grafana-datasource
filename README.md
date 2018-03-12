Team and repository tags
========================

[![Team and repository tags](https://governance.openstack.org/tc/badges/monasca-grafana-datasource.svg)](https://governance.openstack.org/tc/reference/tags/index.html)

<!-- Change things from this point on -->

## Monasca Datasource - A datasource for use with the OpenStack Monasca api.

For more information on Monasca see the [Monasca documentation](https://wiki.openstack.org/wiki/Monasca)

## Authentication Options

### Horizon Session

The [Monasca Horizon plugin](https://github.com/openstack/monasca-ui) offers
Horizon integration for Monasca. Among other things this plugin proxies the
Monasca metrics API, using the Horizon session for authentication (as opposed
to a Keystone token). This proxied API can be used to let this plugin access
the Monasca API with the privileges of the user logged in to Horizon.

Note that this is entirely separate from Grafana's user management.

Setting this up requires the following steps:

1. Install and configure the `monasca-ui` Horizon plugin. Specifically you will
   need to set `GRAFANA_URL` to `/grafana` and point `GRAFANA_LINKS` to your
   dashboards which can either be JSON dashboards you point to or in-database
   dashboards. In the former case set the links' `raw` attribute to `True` and
   their `path` attribute to the dashboard's path or full URL. In the
   latter case, set the links' `raw` attribute to `False` (or omit it entirely)
   and set their `path` attributes to the database dashboards' names.

2. Enable `mod_proxy` and `mod_proxy_http` in Apache:

   ```
   a2enmod proxy proxy_http
   ```

3. Configure the VHost hosting your Horizon instance with a proxy path that
   points at your Grafana instance (the example assumes you are running Horizon
   on Apache - adapt as required for other web servers):

   ```
   ProxyPass "/grafana" "http://my.grafana.server:3000"
   ProxyPassReverse "/grafana" "http://my.grafana.server:3000"

   ```

4. Configure Grafana's `[server/root_url]` setting to point at your dashboard
   node's `/grafana` path:

   ```
   [server]
   root_url = %(protocol)s://%(domain)s/grafana
   ```

5. Configure the plugin as follows:

   * Http settings:
     * Url: `http://my.dashboard.server/monitoring/proxy` (substitute your
       dashboard's actual host name for `my.dashboard.server` here)
     * Access: direct
   * Authentication
     * Auth: Horizon

Steps (2) and (3) are neccessary to ensure both Grafana and Horizon are on the
same Host/Port from the browser's perspective. Otherwise the browser's XSS
protection mechanisms will omit the Horizon session cookie from any requests
triggered by the `monasca-grafana-datasource` plugin.

### Keystone Authentication

When combined with Grafana Keystone authentication this datasource supports using login credentials to authenticate queries.

### Keystone Token

Without the Grafana Keystone auth, this datasource can be used by inserting a keystone token into the datasource.  To get a keystone token download the python-openstackclient, source credentials and run `openstack token issue`.
