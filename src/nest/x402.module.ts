import { DynamicModule, Module, ModuleMetadata, Provider } from '@nestjs/common';
import { X402ClientService } from './x402-client.service';
import { X402ClientController } from './x402-client.controller';
import { X402_WALLET_PORT, type IntermezzoWalletPort } from './wallet-port';
import {
  X402_SESSION_TOKEN_EXTRACTOR,
  type SessionTokenExtractor,
} from './options';

export interface X402ModuleAsyncOptions extends Pick<ModuleMetadata, 'imports'> {
  /**
   * Providers to inject into `useFactory`. Typically `[WalletService, VaultService]`.
   */
  inject?: any[];
  /**
   * Factory that returns an {@link IntermezzoWalletPort} implementation.
   * The returned port wires the SDK to your existing wallet/vault services.
   */
  useFactory: (...args: any[]) => IntermezzoWalletPort | Promise<IntermezzoWalletPort>;
  /**
   * Optional. Pulls the session token off the request before it's passed to
   * your wallet port. Default: `req.vault_token ?? req.sessionToken ?? ''`.
   *
   * Override if your auth layer puts the token somewhere else, e.g.
   * `(req) => req.user?.vaultToken`.
   */
  extractSessionToken?: SessionTokenExtractor;
}

/**
 * NestJS module that exposes:
 *  - `X402ClientService` — `fetch(userId, sessionToken, url, options?)`
 *  - `POST wallet/x402/fetch` — HTTP endpoint wrapping the service
 *
 * @example
 * ```ts
 * import { X402Module } from 'intermezzo-x402-avm/nest';
 *
 * @Module({
 *   imports: [
 *     WalletModule, VaultModule,
 *     X402Module.forRootAsync({
 *       imports: [WalletModule, VaultModule],
 *       inject: [WalletService, VaultService],
 *       useFactory: (wallet, vault) => ({
 *         getUserAddress: async (id, t) => (await wallet.getUserInfo(id, t)).public_address,
 *         signAsUser: async (id, data, t) => {
 *           const raw = await vault.signAsUser(id, data, t);
 *           const sig = Buffer.from(raw.toString().split(':')[2], 'base64');
 *           return new Uint8Array(sig);
 *         },
 *       }),
 *       // optional — defaults to req.vault_token ?? req.sessionToken ?? ''
 *       extractSessionToken: (req) => req.vault_token,
 *     }),
 *   ],
 * })
 * export class AppModule {}
 * ```
 */
@Module({})
export class X402Module {
  static forRootAsync(options: X402ModuleAsyncOptions): DynamicModule {
    const portProvider: Provider = {
      provide: X402_WALLET_PORT,
      useFactory: options.useFactory,
      inject: options.inject ?? [],
    };

    const providers: Provider[] = [portProvider, X402ClientService];

    if (options.extractSessionToken) {
      providers.push({
        provide: X402_SESSION_TOKEN_EXTRACTOR,
        useValue: options.extractSessionToken,
      });
    }

    return {
      module: X402Module,
      imports: options.imports ?? [],
      providers,
      controllers: [X402ClientController],
      exports: [X402ClientService],
    };
  }
}
