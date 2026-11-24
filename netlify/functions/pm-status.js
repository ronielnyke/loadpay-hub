const { proxy } = require('./lib/proxy');

exports.handler = proxy('pmStatus');
