import { Inject, Injectable, Logger } from '@nestjs/common';
import { x402Client, wrapFetchWithPayment, x402HTTPClient } from '@x402/fetch';
import {
  ALGORAND_MAINNET_CAIP2,
  ALGORAND_TESTNET_CAIP2,
  ExactAvmScheme,
} from '@x402/avm';
import { createDelegatedAvmSigner } from '../signer';
import { X402_WALLET_PORT, type IntermezzoWalletPort } from './wallet-port';

export interface X402FetchOptions {
  /** HTTP method. Defaults to `'GET'`. */
  method?: string;
  /** Extra request headers to send (merged onto the x402 client's defaults). */
  headers?: Record<string, string>;
  /**
   * Request body. If a string, sent as-is. If a plain object, JSON-stringified
   * and `Content-Type: application/json` is set automatically.
   */
  body?: string | Record<string, unknown>;
}

export interface X402FetchResult {
  /** HTTP status of the final response (after payment retry, if any). */
  status: number;
  /** Parsed JSON body, or text if not JSON. */
  body: unknown;
  /** Address used to pay. */
  payer?: string;
  /** Decoded `Payment-Response` header from the resource server. */
  paymentResponse?: unknown;
}

@Injectable()
export class X402ClientService {
  private readonly logger = new Logger(X402ClientService.name);

  constructor(
    @Inject(X402_WALLET_PORT) private readonly wallet: IntermezzoWalletPort,
  ) {}

  /**
   * Fetch an x402-protected URL on behalf of `userId`. If the server returns
   * 402, this signs the payment via your custody backend and retries.
   *
   * Registers the AVM `exact` scheme on **both** Algorand TestNet and MainNet
   * so the same client works against either network — the scheme registered
   * for the response's `network` is the one that gets used.
   *
   * @param userId        - Custodial user id known to your wallet port
   * @param sessionToken  - Whatever your auth layer uses (e.g. Vault token)
   * @param url           - URL to fetch
   * @param options       - Optional method / headers / body for non-GET resources
   */
  async fetch(
    userId: string,
    sessionToken: string,
    url: string,
    options: X402FetchOptions = {},
  ): Promise<X402FetchResult> {
    const address = await this.wallet.getUserAddress(userId, sessionToken);
    const signer = createDelegatedAvmSigner(address, (data) =>
      this.wallet.signAsUser(userId, data, sessionToken),
    );

    const client = new x402Client();
    client.register(ALGORAND_TESTNET_CAIP2, new ExactAvmScheme(signer));
    client.register(ALGORAND_MAINNET_CAIP2, new ExactAvmScheme(signer));

    const fetchWithPayment = wrapFetchWithPayment(globalThis.fetch, client);

    const init: RequestInit = { method: options.method ?? 'GET' };
    const headers: Record<string, string> = { ...(options.headers ?? {}) };
    if (options.body !== undefined) {
      if (typeof options.body === 'string') {
        init.body = options.body;
      } else {
        init.body = JSON.stringify(options.body);
        headers['Content-Type'] = headers['Content-Type'] ?? 'application/json';
      }
    }
    if (Object.keys(headers).length > 0) init.headers = headers;

    const response = await fetchWithPayment(url, init);

    const text = await response.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // not JSON, leave as text
    }

    let paymentResponse: unknown;
    try {
      paymentResponse = new x402HTTPClient(client).getPaymentSettleResponse((n) =>
        response.headers.get(n),
      );
    } catch (e) {
      this.logger.warn(`Failed to parse settle response header: ${(e as Error).message}`);
    }

    return { status: response.status, body, payer: address, paymentResponse };
  }
}
