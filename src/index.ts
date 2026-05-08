/**
 * @intermezzo/x402-avm — core entry
 *
 * The signer factory works in any environment (Node, browser, edge runtime).
 * For Express middleware, import from `@intermezzo/x402-avm/express`.
 * For NestJS module, import from `@intermezzo/x402-avm/nest`.
 */

export { createDelegatedAvmSigner } from './signer';
export type { SignBytes } from './signer';

// Re-export common AVM constants so consumers don't need a direct @x402/avm dep
// just to spell out "TestNet USDC".
export {
  ALGORAND_MAINNET_CAIP2,
  ALGORAND_TESTNET_CAIP2,
  USDC_MAINNET_ASA_ID,
  USDC_TESTNET_ASA_ID,
  USDC_DECIMALS,
} from '@x402/avm';
