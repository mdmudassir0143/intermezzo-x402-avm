import type { ClientAvmSigner } from '@x402/avm';
import { decodeTransaction, encodeSignedTransaction } from '@algorandfoundation/algokit-utils/transact';

const TX_PREFIX = new TextEncoder().encode('TX');

/**
 * Sign arbitrary bytes with an Ed25519 key and return the 64-byte signature.
 *
 * The bytes passed in already include Algorand's "TX" domain separator —
 * implementations should sign these bytes directly (no further hashing or
 * prefixing).
 */
export type SignBytes = (data: Uint8Array) => Promise<Uint8Array>;

/**
 * Create an x402 AVM client signer that delegates the actual signing to a
 * callback. Use this when the private key lives outside the application
 * process — Vault, KMS, HSM, MPC, browser extension, etc.
 *
 * @param address - The Algorand public address (32-byte checksum form).
 * @param sign    - Callback that signs bytes via your custody backend.
 *
 * @example
 * ```ts
 * import { createDelegatedAvmSigner } from '@intermezzo/x402-avm';
 * import { x402Client, wrapFetchWithPayment } from '@x402/fetch';
 * import { ALGORAND_TESTNET_CAIP2, ExactAvmScheme } from '@x402/avm';
 *
 * const signer = createDelegatedAvmSigner(userAddress, async (bytes) => {
 *   // Hand `bytes` to Vault transit / KMS / HSM and return the 64-byte sig
 *   return await myVault.signEd25519(userKeyName, bytes);
 * });
 *
 * const client = new x402Client();
 * client.register(ALGORAND_TESTNET_CAIP2, new ExactAvmScheme(signer));
 *
 * const fetchPaid = wrapFetchWithPayment(globalThis.fetch, client);
 * const response = await fetchPaid('https://api.example.com/protected');
 * ```
 */
export function createDelegatedAvmSigner(address: string, sign: SignBytes): ClientAvmSigner {
  return {
    address,
    async signTransactions(
      txns: Uint8Array[],
      indexesToSign?: number[],
    ): Promise<(Uint8Array | null)[]> {
      const indexes = indexesToSign ?? txns.map((_, i) => i);
      const result: (Uint8Array | null)[] = txns.map(() => null);

      for (const i of indexes) {
        const raw = txns[i];
        const toSign = new Uint8Array(TX_PREFIX.length + raw.length);
        toSign.set(TX_PREFIX, 0);
        toSign.set(raw, TX_PREFIX.length);

        const sig = await sign(toSign);
        if (sig.length !== 64) {
          throw new Error(`Expected 64-byte Ed25519 signature, got ${sig.length} bytes`);
        }

        const txn = decodeTransaction(raw);
        result[i] = encodeSignedTransaction({ txn, sig });
      }
      return result;
    },
  };
}
