import { DynamicModule, Module, ModuleMetadata, Provider } from '@nestjs/common';
import { X402ClientService } from './x402-client.service';
import { X402ClientController } from './x402-client.controller';
import { X402_WALLET_PORT, type IntermezzoWalletPort } from './wallet-port';

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
}

/**
 * NestJS module that exposes:
 *  - `X402ClientService` — `fetch(userId, sessionToken, url)`
 *  - `POST wallet/x402/fetch` — HTTP endpoint wrapping the service
 *
 * @example
 * ```ts
 * import { X402Module } from '@intermezzo/x402-avm/nest';
 *
 * @Module({
 *   imports: [
 *     WalletModule, VaultModule,
 *     X402Module.forRootAsync({
 *       imports: [WalletModule, VaultModule],
 *       inject: [WalletService, VaultService],
 *       useFactory: (wallet, vault) => ({
 *         getUserAddress: async (id, t) => (await wallet.getUserInfo(id, t)).public_address,
 *         signAsUser: (id, data, t) => vault.signAsUser(id, data, t),
 *       }),
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

    return {
      module: X402Module,
      imports: options.imports ?? [],
      providers: [portProvider, X402ClientService],
      controllers: [X402ClientController],
      exports: [X402ClientService],
    };
  }
}
