'use strict';

const {
    requireCredential,
    requireAccountId,
    requireSymbol,
    requirePayloadType
} = require('./validation');
const { LIMITS } = require('./config');

/**
 * Subscribe to spot (bid/ask) prices for one symbol on one account.
 *
 * Bound to a `connect` instance (see ./session), which supplies
 * `protocol` and `sendGuaranteedCommand`.
 *
 * NOTE: `symblolName` is the field name defined in the upstream
 * `OpenApiMessages.proto` (ProtoOASubscribeForSpotsReq), misspelling included.
 * Renaming it on the wire would silently stop the server honouring the
 * subscription, so the upstream spelling is preserved deliberately.
 *
 * The public parameter is the correctly spelled `symbol`. The old misspelled
 * `symblolName` input is still accepted so existing copies of this sample do
 * not break; prefer `symbol` in new code.
 *
 * @this {{protocol: object, sendGuaranteedCommand: Function}}
 * @param {object} params
 * @param {number|string} params.accountId
 * @param {string} params.accessToken
 * @param {string} [params.symbol] correctly spelled symbol
 * @param {string} [params.symblolName] deprecated alias for `symbol`
 * @returns {Promise<object>} resolves with the subscription response
 * @throws {ValidationError} if a parameter is missing or malformed
 */
const subscribeForSpots = function (params = {}) {
    const accountId = requireAccountId(params.accountId);
    const accessToken = requireCredential(params.accessToken, 'accessToken', LIMITS.accessToken);
    const symbol = requireSymbol(params.symbol ?? params.symblolName);

    return this.sendGuaranteedCommand(
        requirePayloadType(this.protocol, 'ProtoOASubscribeForSpotsReq'),
        {
            accountId,
            accessToken,
            symblolName: symbol
        }
    );
};

module.exports = subscribeForSpots;
