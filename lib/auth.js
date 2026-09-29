'use strict';

const {
    requireCredential,
    requirePayloadType,
    credentialLimits
} = require('./validation');

/**
 * Authenticate against the Connect Open API.
 *
 * Bound to a `connect` instance (see ./session), which supplies
 * `protocol` and `sendGuaranteedCommand`.
 *
 * @this {{protocol: object, sendGuaranteedCommand: Function}}
 * @param {{clientId: string, clientSecret: string}} params
 * @returns {Promise<object>} resolves with the server's auth response
 * @throws {ValidationError} if a parameter is missing or malformed
 */
const auth = function (params = {}) {
    const clientId = requireCredential(params.clientId, 'clientId', credentialLimits.clientId);
    const clientSecret = requireCredential(
        params.clientSecret,
        'clientSecret',
        credentialLimits.clientSecret
    );

    return this.sendGuaranteedCommand(requirePayloadType(this.protocol, 'ProtoOAAuthReq'), {
        clientId,
        clientSecret
    });
};

module.exports = auth;
