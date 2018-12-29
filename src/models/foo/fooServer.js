'use strict';

/**
 * A sample protocol implementation, used for demo purposes only
 * @module
 */

/**
 * Used to fill in defaults for the response.  A user may set up a response
 * with not all fields filled in, and we use this function to fill in the rest
 * @param {Object} response - The response returned by the stub
 * @returns {Object} - The response we will send back
 */
function postProcess (response) {
    return {
        data: response.data || 'foo'
    };
}

/**
 * Used to get consistent logging look & feel
 * @param {number} port - The port for the imposter
 * @param {string} [name] - The name of the imposter
 * @returns {string}
 */
function scopeFor (port, name) {
    const util = require('util');
    let scope = util.format('foo:%s', port);

    if (name) {
        scope += ' ' + name;
    }
    return scope;
}

/**
 * Spins up a server listening on a socket
 * @param {object} baseLogger - the base logger
 * @param {Object} options - the JSON request body for the imposter create request
 * @param {boolean} recordRequests - The --mock command line parameter
 * @param {boolean} debug - The --debug command line parameter
 * @returns {Object} The protocol server implementation
 */
function createServer (baseLogger, options, recordRequests, debug) {
    // This is an async operation, so we use a deferred
    const Q = require('q'),
        net = require('net'),
        deferred = Q.defer(),
        // an array to record all requests for mock verification
        requests = [],
        // set up a logger with the correct log prefix
        logger = require('../../util/scopedLogger').create(baseLogger, scopeFor(options.port)),
        // create the protocol-specific proxy (here we're reusing tcp's proxy)
        proxy = require('../tcp/tcpProxy').create(logger, 'utf8'),
        // create the response resolver, which contains the strategies for resolving is, proxy, and inject stubs
        // the postProcess parameter is used to fill in defaults for the response that were not passed by the user
        resolver = require('../responseResolver').create(proxy, postProcess),
        // create the repository which matches the appropriate stub to respond with
        stubs = require('../stubRepository').create(resolver, debug, 'utf8'),
        // and create the actual server using node.js's net module
        server = net.createServer();
    // track the number of requests even if recordRequests = false
    let numRequests = 0;

    // we need to respond to new connections
    server.on('connection', socket => {
        socket.on('data', data => {
            // This will be the request API interface used by stubs, etc.
            const helpers = require('../../util/helpers'),
                request = {
                    requestFrom: helpers.socketName(socket),
                    data: data.toString('utf8')
                };

            // remember the request for mock verification, unless told not to
            numRequests += 1;
            if (recordRequests) {
                const recordedRequest = helpers.clone(request);
                recordedRequest.timestamp = new Date().toJSON();
                requests.push(recordedRequest);
            }

            // let's resolve any stubs (don't worry - there are defaults if no stubs are defined)
            return stubs.resolve(request, logger).then(stubResponse => {
                const buffer = new Buffer(stubResponse.data, 'utf8');

                // This writes the response
                socket.write(buffer);
            });
        });
    });

    // Bind the socket to a port (the || 0 bit auto-selects a port if one isn't provided)
    server.listen(options.port || 0, () => {
        // Some basic bookkeeping...
        const actualPort = server.address().port,
            metadata = {};

        if (options.name) {
            metadata.name = options.name;
        }

        if (options.port !== actualPort) {
            logger.changeScope(scopeFor(actualPort));
        }

        logger.info('Open for business...');

        // This resolves the promise, allowing execution to continue after we're listening on a socket
        // The object we resolve with defines the core imposter API expected in imposter.js
        deferred.resolve({
            numberOfRequests: () => numRequests,
            requests,
            addStub: stubs.addStub,
            stubs: stubs.stubs,
            state: {},
            metadata,
            port: actualPort,
            close: () => {
                server.close();
                logger.info('Ciao for now');
            }
        });
    });

    return deferred.promise;
}

/**
 * Creates the core protocol interface - all protocols must implement
 * @param {object} logger - the base logger
 * @param {boolean} recordRequests - represents the command line --mock parameter
 * @param {boolean} debug - represents the command line --debug parameter
 * @returns {Object} The server factory
 */
function initialize (logger, recordRequests, debug) {
    return {
        // The name of the protocol, used in JSON representation of imposters
        name: 'foo',

        // The creation method, called in imposter.js.  The request JSON object gets passed in
        create: request => createServer(logger, request, recordRequests, debug),

        testRequest: { data: '' },
        testProxyResponse: { data: '' }
    };
}

// This will be called in mountebank.js when you register the protocol there
module.exports = { initialize };
