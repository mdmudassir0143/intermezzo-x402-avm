/**
 * Function that pulls the auth/session token off the incoming request.
 * Used by the bundled controller; the same token is then passed verbatim to
 * your {@link IntermezzoWalletPort} methods.
 */
export type SessionTokenExtractor = (req: any) => string;

/** Injection token for the optional session-token extractor. */
export const X402_SESSION_TOKEN_EXTRACTOR = Symbol('X402_SESSION_TOKEN_EXTRACTOR');
