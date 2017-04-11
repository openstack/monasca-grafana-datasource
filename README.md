Team and repository tags
========================

[![Team and repository tags](https://governance.openstack.org/badges/monasca-grafana-datasource.svg)](https://governance.openstack.org/reference/tags/index.html)

<!-- Change things from this point on -->

## Monasca Datasource - A datasource for use with the OpenStack Monasca api.

For more information on Monasca see the [Monasca documentation](https://wiki.openstack.org/wiki/Monasca)

When combined with Grafana Keystone authentication this datasource supports using login credentials to authenticate queries.

Without the Grafana Keystone auth, this datasource can be used by inserting a keystone token into the datasource.  To get a keystone token download the python-openstackclient, source credentials and run `openstack token issue`.
