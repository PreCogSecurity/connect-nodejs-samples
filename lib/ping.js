'use strict';

const { requireInterval, requirePayloadType } = require('./validation');

/**
 * Start the keep-alive ping loop.
 *
 * Bound to a `connect` instance (see ./session), which supplies `protocol` and
 * `sendGuaranteedCommand`.
 *
 * The timer handle is stored on `this.pingInterval` (matching the original
 * sample's contract) and also returned, so the session can clear it on
 * shutdown. That matters: an uncleared interval keeps the Node event loop
 * alive, which is why the original sample hung after the socket dropped.
 *
 * @this {{protocol: object, sendGuaranteedCommand: Function}}
 * @param {number} interval milliseconds between pings
 * @returns {NodeJS.Timeout}
 * @throws {ValidationError} if the interval is not a sane positive integer
 */
const ping = function (interval) {
    const milliseconds = requireInterval(interval);
    const payloadType = requirePayloadType(this.protocol, 'ProtoPingReq');

    const send = () => {
        // sendGuaranteedCommand resolves when the server answers. Swallow the
        // rejection: a missed pong must not become an unhandled rejection that
        // takes the whole process down. Connection loss is surfaced through
        // the transport's onEnd handler instead.
        const pending = this.sendGuaranteedCommand(payloadType, { timestamp: Date.now() });
        if (pending && typeof pending.catch === 'function') {
            pending.catch(() => {});
        }
    };

    this.pingInterval = setInterval(send, milliseconds);
    return this.pingInterval;
};

module.exports = ping;
