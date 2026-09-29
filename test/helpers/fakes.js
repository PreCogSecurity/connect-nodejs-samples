'use strict';

/**
 * Test doubles for the `connect-js-api` surface this sample uses.
 *
 * Keeping these here rather than in each spec means the fakes stay small and
 * identical, and the specs stay focused on behaviour.
 */

const PAYLOAD_TYPES = {
    ProtoOAAuthReq: 4001,
    ProtoOASubscribeForSpotsReq: 4002,
    ProtoOASubscribeForSpotsRes: 4003,
    ProtoPingReq: 4004,
    ProtoPingRes: 4005,
    ProtoOASpotEvent: 4006
};

/**
 * @param {object} [options]
 * @param {boolean} [options.withoutProtocol] simulate an unloaded protocol
 */
const createFakeConnect = (options = {}) => {
    const sent = [];
    const listeners = new Map();
    let nextResponse = () => Promise.resolve({ ok: true });

    const connect = {
        sent,
        listeners,
        started: false,
        pingInterval: undefined,
        onConnect: null,
        onEnd: null,
        onError: null,

        protocol: options.withoutProtocol
            ? { getPayloadTypeByName: () => undefined }
            : {
                getPayloadTypeByName: (name) =>
                    Object.prototype.hasOwnProperty.call(PAYLOAD_TYPES, name)
                        ? PAYLOAD_TYPES[name]
                        : undefined
            },

        sendGuaranteedCommand(payloadType, params) {
            sent.push({ payloadType, params });
            return nextResponse();
        },

        on(event, handler) {
            listeners.set(event, handler);
            return this;
        },

        start() {
            connect.started = true;
        },

        /** Make every subsequent command reject, to exercise error handling. */
        rejectWith(error) {
            nextResponse = () => Promise.reject(error);
        },

        /** Make every subsequent command resolve. */
        resolveWith(value) {
            nextResponse = () => Promise.resolve(value);
        },

        /** Deliver an event as the library would. */
        emit(event, payload) {
            const handler = listeners.get(event);
            if (!handler) {
                throw new Error(`No handler registered for event ${event}`);
            }
            return handler(payload);
        },

        commandsFor(payloadType) {
            return sent.filter((entry) => entry.payloadType === payloadType);
        }
    };

    return connect;
};

const createMemoryStream = () => {
    const lines = [];
    return {
        lines,
        write(line) {
            lines.push(line);
            return true;
        },
        get records() {
            return lines.map((line) => JSON.parse(line));
        }
    };
};

const VALID_CONFIG = Object.freeze({
    clientId: 'client-id-abc123',
    clientSecret: 'client-secret-xyz789',
    accessToken: 'access-token-000111',
    accountId: 62002,
    host: 'sandbox-tradeapi.spotware.com',
    port: 5032,
    symbol: 'EURUSD',
    pingIntervalMs: 1000,
    logLevel: 'info',
    envFilePath: null
});

module.exports = { createFakeConnect, createMemoryStream, VALID_CONFIG, PAYLOAD_TYPES };
