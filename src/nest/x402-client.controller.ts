import { Body, Controller, Inject, Optional, Post, Req } from '@nestjs/common';
import { X402ClientService, type X402FetchResult } from './x402-client.service';
import { X402_SESSION_TOKEN_EXTRACTOR, type SessionTokenExtractor } from './options';

interface X402FetchBody {
  user_id: string;
  url: string;
  /** Optional HTTP method — defaults to GET. */
  method?: string;
  /** Optional extra request headers. */
  headers?: Record<string, string>;
  /** Optional request body — string or JSON-serializable object. */
  body?: string | Record<string, unknown>;
}

const defaultExtractor: SessionTokenExtractor = (req) =>
  (req?.vault_token as string) ?? (req?.sessionToken as string) ?? '';

/**
 * Controller mounted at `wallet/x402`. Combined with your app's global prefix
 * (e.g. `/v1`) the route is typically `POST /v1/wallet/x402/fetch`.
 *
 * The session token passed to your {@link IntermezzoWalletPort} is read by
 * the configured extractor. Default: `req.vault_token` then `req.sessionToken`.
 * Override via `X402Module.forRootAsync({ extractSessionToken })`.
 */
@Controller('wallet/x402')
export class X402ClientController {
  private readonly extractor: SessionTokenExtractor;

  constructor(
    private readonly service: X402ClientService,
    @Optional() @Inject(X402_SESSION_TOKEN_EXTRACTOR)
    extractor?: SessionTokenExtractor,
  ) {
    this.extractor = extractor ?? defaultExtractor;
  }

  @Post('fetch')
  async fetch(
    @Req() req: any,
    @Body() body: X402FetchBody,
  ): Promise<X402FetchResult> {
    const sessionToken = this.extractor(req);
    return this.service.fetch(body.user_id, sessionToken, body.url, {
      method: body.method,
      headers: body.headers,
      body: body.body,
    });
  }
}
