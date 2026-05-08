import { Inject, Injectable, Logger } from '@nestjs/common';
import { x402Client, wrapFetchWithPayment, x402HTTPClient } from '@x402/fetch';
import { ALGORAND_TESTNET_CAIP2, ExactAvmScheme } from '@x402/avm';
import { createDelegatedAvmSigner } from '../signer';
import { X402_WALLET_PORT, type IntermezzoWalletPort } from './wallet-port';

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
   * Currently registers the AVM `exact` scheme on Algorand TestNet. If you
   * need MainNet or additional schemes, instantiate {@link x402Client}
   * yourself using {@link createDelegatedAvmSigner} from the core entry.
   */
  async fetch(userId: string, sessionToken: string, url: string): Promise<X402FetchResult> {
    const address = await this.wallet.getUserAddress(userId, sessionToken);
    const signer = createDelegatedAvmSigner(address, (data) =>
      this.wallet.signAsUser(userId, data, sessionToken),
    );

    const client = new x402Client();
    client.register(ALGORAND_TESTNET_CAIP2, new ExactAvmScheme(signer));

    const fetchWithPayment = wrapFetchWithPayment(globalThis.fetch, client);
    const response = await fetchWithPayment(url, { method: 'GET' });

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
