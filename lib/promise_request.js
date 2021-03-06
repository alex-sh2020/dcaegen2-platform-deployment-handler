/*
Copyright(c) 2017-2018 AT&T Intellectual Property. All rights reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.

You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing,
software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR
CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and limitations under the License.
*/

 /* Promise-based HTTP request client */

 "use strict";

/*
 * Make an HTTP request using a string for the body
 * of the request.
 * Return a promise for result in the form
 * {status: <http status code>, body: <response body>}
 */

const http = require('http');
const https = require('https');
const url = require('url');
const querystring = require('querystring');
const logger = require('./logging').getLogger();

exports.doRequest = function(mainReq, options, body, targetEntity) {

	/* Defense:  for now, some callers don't provide mainReq */
	mainReq = mainReq || {};

    var opInfo = {"startTime":new Date(), "targetEntity": targetEntity};

    return new Promise(function(resolve, reject) {

        var reqBody = null;
        if (options.json) {
            reqBody = JSON.stringify(options.json);
            options.headers = options.headers || {};
            options.headers['Content-Type'] = 'application/json';
        }
        else if (body) {
            reqBody = body;
        }

        if (options.uri) {
            var parsed = url.parse(options.uri);
            options.protocol = parsed.protocol;
            options.hostname = parsed.hostname;
            options.port = parsed.port;
            options.path = parsed.path;
            opInfo.targetService = options.method + " " + options.uri;
            if (options.qs) {
                const qry = ('?' + querystring.stringify(options.qs));
                options.path += qry;
                opInfo.targetService += qry;
            }
        }

        try {
            var req = (options.protocol === 'https:' ? https.request(options) : http.request(options));
        }
        catch (e) {
            opInfo.respCode = 500;
            opInfo.complete = false;
            logger.metrics(mainReq, opInfo,  (e.message || "") + " " + (e.stack || "").replace(/\n/g, " "));

            reject(e);
        }

        // Reject promise if there's an error
        req.on('error',  function(error) {
            opInfo.respCode = error.status || 500;
            opInfo.complete = false;
            logger.metrics(mainReq, opInfo, error.message);

            reject(error);
        });

        // Capture the response
        req.on('response', function(resp) {

            // Collect the body of the response
            var rbody = '';
            resp.on('data', function(d) {
                rbody += d;
            });

            // resolve or reject when finished
            resp.on('end', function() {

                var result = {
                    status : resp.statusCode,
                    body : rbody
                };

                // Add a JSON version of the body if appropriate
                if (rbody.length) {
                    try {
                        var jbody = JSON.parse(rbody);
                        result.json = jbody;
                    }
                    catch (pe) {
                        // Do nothing, no json property added to the result object
                    }
                }

                opInfo.respCode = resp.statusCode || 500;
                const metrics_text = "res: " + result.body
                    + ((reqBody && " req: " + ((typeof(reqBody) !== 'string' && typeof(reqBody)) || reqBody)) || "");
                if (resp.statusCode > 199 && resp.statusCode < 300) {
                    // HTTP status code indicates success - resolve the promise
                    opInfo.complete = true;
                    logger.metrics(mainReq, opInfo, metrics_text);

                    resolve(result);
                } else {
                    // Reject the promise
                    opInfo.complete = false;
                    logger.metrics(mainReq, opInfo, metrics_text);

                    reject(result);
                }
            });
        });

        if (reqBody) {
            req.write(reqBody, 'utf8');
        }
        req.end();
    });
};
