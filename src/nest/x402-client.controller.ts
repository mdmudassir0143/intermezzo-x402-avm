import { Body, Controller, Post, Req } from '@nestjs/common';
import { X402ClientService, type X402FetchResult } from './x402-client.service';

interface X402FetchBody {
  user_id: string;
  url: string;
}

/**
 * Controller mounted at `wallet/x402`. Combined with your app's global prefix
 * (e.g. `/v1`) the route is typically `POST /v1/wallet/x402/fetch`.
 *
 * The session token passed to your {@link IntermezzoWalletPort} is read from
 * `req.vault_token` first, then `req.sessionToken`. Set this in your auth
 * guard / middleware. For Intermezzo, the existing `AuthGuard` already
 * populates `req.vault_token`.
 */
@Controller('wallet/x402')
export class X402ClientController {
  constructor(private readonly service: X402ClientService) {}

  @Post('fetch')
  async fetch(
    @Req() req: any,
    @Body() body: X402FetchBody,
  ): Promise<X402FetchResult> {
    const sessionToken: string = req.vault_token ?? req.sessionToken ?? '';
    return this.service.fetch(body.user_id, sessionToken, body.url);
  }
}
