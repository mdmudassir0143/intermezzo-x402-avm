# @intermezzo/x402-avm

Add **x402 payment protocol** support to an existing [Intermezzo](https://github.com/algorandfoundation/intermezzo) deployment. Lets a custodial user pay for an HTTP resource without ever taking the user's private key out of Vault — the SDK delegates signing to your existing `VaultService.signAsUser`.

## What you'll get when you're done

- `POST /v1/wallet/x402/fetch` `{ user_id, url }` — the custodial user pays an x402-protected URL and gets the JSON back. Authenticated with the same `Bearer <access_token>` as the rest of your wallet API.
- `X402ClientService.fetch(userId, sessionToken, url)` — same thing as a NestJS service you can call from your own code.
- `buildX402Middleware(...)` — Express middleware so your own server can _accept_ x402 payments on routes you protect.

---

## Prerequisites

A working Intermezzo install with these in place:

- `WalletService.getUserInfo(user_id, vault_token)` returning `{ public_address, ... }`
- `VaultService.signAsUser(user_id, data, vault_token)` returning a Vault `Buffer` (signature comes back as `vault:v1:<base64>`)
- An `AuthGuard` that puts `vault_token` on the request after sign-in

## Step 1 — Install (inside the intermezzo repo)

```bash
yarn add @intermezzo/x402-avm \
         @x402/core @x402/avm @x402/fetch \
         @algorandfoundation/algokit-utils@10.0.0-alpha.42
```

The four `@x402/*` and `algokit-utils` packages are **peer dependencies**.

---

## Step 2 — Wire `X402Module` into your `AppModule`

Open `src/app.module.ts` and add the dynamic module. The factory is the only Intermezzo-specific glue: it tells the SDK how to ask your existing services for the user's address and how to sign bytes via Vault.

```ts
// src/app.module.ts
import { Module } from '@nestjs/common';
import { X402Module } from '@intermezzo/x402-avm/nest';
import { WalletModule } from './wallet/wallet.module';
import { WalletService } from './wallet/wallet.service';
import { VaultModule } from './vault/vault.module';
import { VaultService } from './vault/vault.service';
// ... your other imports

@Module({
  imports: [
    // ... your existing modules

    X402Module.forRootAsync({
      imports: [WalletModule, VaultModule],
      inject: [WalletService, VaultService],
      useFactory: (wallet: WalletService, vault: VaultService) => ({
        getUserAddress: async (userId, vaultToken) =>
          (await wallet.getUserInfo(userId, vaultToken)).public_address,

        signAsUser: async (userId, data, vaultToken) => {
          const raw = await vault.signAsUser(userId, data, vaultToken);
          // Vault returns "vault:v1:<base64-sig>" — strip the prefix.
          const sigBase64 = raw.toString().split(':')[2];
          return new Uint8Array(Buffer.from(sigBase64, 'base64'));
        },
      }),
    }),
  ],
})
export class AppModule {}
```

**One required change in `WalletModule`** — make `WalletService` injectable from outside the module:

```ts
// src/wallet/wallet.module.ts
@Module({
  imports: [HttpModule, VaultModule, ChainModule, ConfigModule],
  controllers: [Wallet],
  providers: [WalletService],
  exports: [WalletService],   // ← add this
})
export class WalletModule {}
```

That's all the wiring. After restart you should see in the boot logs:

```
RouterExplorer  Mapped {/v1/wallet/x402/fetch, POST} route
```

---

## Step 3 — Make sure the payer + recipient are opted into the asset

x402 settlement on Algorand is an ASA transfer. Both ends of the transfer must be opted into the asset (e.g. TestNet USDC, ASA `10458941`). If they're not, the facilitator will reject with `must optin, asset 10458941 missing from <address>`.

---

## Step 4 — Test the client flow

With everything wired up:

```bash
# 1. Get an access token (existing Intermezzo flow)
TOKEN=$(curl -sX POST http://localhost:3000/v1/auth/login-approle \
  -H 'Content-Type: application/json' \
  -d '{"role_id":"...","secret_id":"..."}' | jq -r .access_token)

# 2. Pay an x402-protected URL with the custodial user's wallet
curl -X POST http://localhost:3000/v1/wallet/x402/fetch \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"user_id":"alice","url":"https://x402.goplausible.xyz/examples/weather"}'
```

A successful response:

```json
{
  "status": 200,
  "body": { "report": { "weather": "sunny", ... } },
  "payer": "C7M237UKIRW56SFS2PTNQYRFMKLZPMGIGFCUBI57YZIAQBJBMJ2PLMEUBU",
  "paymentResponse": {
    "success": true,
    "payer": "C7M2...",
    "transaction": "FQAZH474MH2HKM66NO3RVM3RGC4SAQD5P6U74IPMUR2SDNBCFNEA",
    "network": "algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI="
  }
}
```

If `status` is 402 with no `paymentResponse`, settlement failed — check the pawn container logs for the decoded `PAYMENT-REQUIRED` error string.

---

## Step 5 — (Optional) Protect your own routes with x402

If you want your Intermezzo deployment to also _serve_ paid resources, register the Express middleware in `main.ts` against routes that bypass the global `/v1` prefix.

```ts
// src/main.ts (after SwaggerModule.setup, before app.listen)
import { ConfigService } from '@nestjs/config';
import { buildX402Middleware } from 'intermezzo-x402-avm/express';
import { ALGORAND_TESTNET_CAIP2, USDC_TESTNET_ASA_ID } from 'intermezzo-x402-avm';

const config = app.get(ConfigService);
const payTo = config.get<string>('X402_PAY_TO');
if (payTo) {
  const x402 = buildX402Middleware({
    facilitatorUrl: config.get<string>('X402_FACILITATOR_URL') ?? 'https://facilitator.goplausible.xyz',
    routes: {
      'GET /weather': {
        accepts: [{
          scheme: 'exact',
          price: '$0.01',
          network: ALGORAND_TESTNET_CAIP2,
          payTo,                                         // typically the manager address
          extra: { asset: USDC_TESTNET_ASA_ID },
        }],
        description: 'Access to protected weather API. Pay $0.01 USDC.',
      },
    },
  });
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.get('/weather', x402, (_req: any, res: any) => {
    res.json({ report: { weather: 'sunny', temperature: 70, timestamp: new Date().toISOString() } });
  });
}
```

Add to `.env`:

```
X402_PAY_TO=<your manager address from vault:development:init>
X402_FACILITATOR_URL=https://facilitator.goplausible.xyz
```

> **Important:** Docker Compose only re-reads `env_file` on container _recreate_, not _restart_. After editing `.env` run `docker compose up -d --force-recreate pawn`, not just `docker compose restart pawn`.

Unpaid `GET /weather` returns `402 Payment Required` with x402-shaped headers; paid requests get your handler's body plus a `Payment-Response` header. The middleware auto-registers both Algorand TestNet and MainNet schemes — pass a `schemes` option to override.

---

## API surface

### `@intermezzo/x402-avm` (core)

| Export | What it is |
|---|---|
| `createDelegatedAvmSigner(address, sign)` | Build a `ClientAvmSigner` from a sign callback. The callback gets bytes already prefixed with `"TX"` and must return a 64-byte Ed25519 signature. |
| `ALGORAND_TESTNET_CAIP2`, `ALGORAND_MAINNET_CAIP2` | Network identifiers (re-exported from `@x402/avm`). |
| `USDC_TESTNET_ASA_ID`, `USDC_MAINNET_ASA_ID` | USDC asset IDs (re-exported). |

### `@intermezzo/x402-avm/express`

| Export | What it is |
|---|---|
| `buildX402Middleware(options)` | Returns an Express `RequestHandler` that gates routes per the `routes` config. Mount in front of your handler. |

### `@intermezzo/x402-avm/nest`

| Export | What it is |
|---|---|
| `X402Module.forRootAsync({ imports, inject, useFactory })` | Dynamic module. Factory must return an `IntermezzoWalletPort`. |
| `X402ClientService` | Inject this in your own controllers if you don't want the bundled HTTP endpoint. |
| `IntermezzoWalletPort` | The interface your factory returns: `getUserAddress` + `signAsUser`. |
| `X402_WALLET_PORT` | Injection token (advanced). |

---

## How session tokens flow

The bundled controller reads `req.vault_token` (Intermezzo convention) first, falling back to `req.sessionToken`. That same value is passed verbatim to your `IntermezzoWalletPort` methods — the SDK never inspects it.

If your auth layer puts the token somewhere else, pass `extractSessionToken` to `forRootAsync`:

```ts
X402Module.forRootAsync({
  imports: [...],
  inject: [...],
  useFactory: (...) => ({ getUserAddress, signAsUser }),
  extractSessionToken: (req) => req.user?.vaultToken,   // ← your custom path
});
```

## Non-GET resources

`X402ClientService.fetch` and `POST /v1/wallet/x402/fetch` both accept optional `method`, `headers`, and `body`:

```bash
curl -X POST http://localhost:3000/v1/wallet/x402/fetch \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
        "user_id": "alice",
        "url": "https://api.example.com/protected",
        "method": "POST",
        "headers": { "X-Trace-Id": "abc" },
        "body": { "prompt": "hello" }
      }'
```

Plain objects in `body` are JSON-stringified automatically; pass a string to send any other content type.

---

## License

MIT
