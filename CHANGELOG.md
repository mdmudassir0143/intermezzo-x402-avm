# Changelog

## 0.1.1

### Fixed

- **TypeScript subpath imports now resolve under classic `node` moduleResolution.**
  Without `typesVersions`, consumers using the NestJS default `"moduleResolution": "node"`
  hit `Cannot find module 'intermezzo-x402-avm/express'` when importing the
  sub-export. Added `typesVersions` mapping so types resolve under classic and
  `bundler`/`node16` resolution alike.

### Added

- `X402ClientService.fetch()` now accepts `method`, `headers`, and `body` options
  for non-GET resources. Backward compatible — calls without the 4th arg still
  work as plain GET.
- The Nest service now registers **both** Algorand TestNet and MainNet schemes
  by default (was TestNet-only). Brings parity with `buildX402Middleware`,
  which already auto-registered both.
- `extractSessionToken` option on `X402Module.forRootAsync` for auth flows that
  put the session token somewhere other than `req.vault_token`/`req.sessionToken`.
- Strong types for `routes` config in `buildX402Middleware`. Exported
  `PaymentOption`, `RouteConfig`, `RoutesConfig` from the `/express` sub-export.

### Changed

- `peerDependencies` ranges now upper-bounded
  (`@x402/* >=2 <3`, `@algorandfoundation/algokit-utils >=10.0.0-alpha.42 <11`)
  so consumers don't get warnings on unrelated major bumps.
- `package.json` now includes `repository`, `homepage`, `bugs` metadata.

## 0.1.0

Initial release.

- `createDelegatedAvmSigner(address, sign)` — `ClientAvmSigner` factory backed
  by any Ed25519 sign callback (Vault, KMS, HSM, MPC, …).
- `buildX402Middleware(options)` Express middleware (`/express` sub-export).
- `X402Module.forRootAsync(...)` NestJS DynamicModule (`/nest` sub-export)
  exposing `X402ClientService` + `POST wallet/x402/fetch`.
