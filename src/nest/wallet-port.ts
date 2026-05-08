/**
 * Describes the wallet operations the X402 client needs from your custody
 * system. Implement this interface against your existing wallet/vault service
 * and provide it via {@link X402Module.forRootAsync}.
 *
 * The `sessionToken` parameter is whatever your auth layer puts on the
 * request — for Intermezzo it's the Vault `vault_token`. The SDK is agnostic
 * about its meaning; it just passes it through to your implementation.
 */
export interface IntermezzoWalletPort {
  /** Resolve a custodial user_id to its Algorand public address. */
  getUserAddress(userId: string, sessionToken: string): Promise<string>;

  /**
   * Sign arbitrary bytes with the user's key and return a 64-byte Ed25519
   * signature. The bytes already include Algorand's "TX" domain separator —
   * sign them directly.
   */
  signAsUser(userId: string, data: Uint8Array, sessionToken: string): Promise<Uint8Array>;
}

/** Injection token for the wallet port. */
export const X402_WALLET_PORT = Symbol('X402_WALLET_PORT');
