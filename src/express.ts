/**
 * Express adapter + paymentMiddleware factory for x402 protected routes.
 *
 * Mirrors @x402/hono's paymentMiddleware but for Express / Connect-style
 * frameworks (NestJS over Express, Fastify-with-express-compat, raw Express).
 *
 * @example
 * ```ts
 * import express from 'express';
 * import { buildX402Middleware } from '@intermezzo/x402-avm/express';
 * import { ALGORAND_TESTNET_CAIP2, USDC_TESTNET_ASA_ID } from '@intermezzo/x402-avm';
 *
 * const app = express();
 * const x402 = buildX402Middleware({
 *   facilitatorUrl: 'https://facilitator.goplausible.xyz',
 *   routes: {
 *     'GET /weather': {
 *       accepts: [{
 *         scheme: 'exact',
 *         price: '$0.01',
 *         network: ALGORAND_TESTNET_CAIP2,
 *         payTo: process.env.PAY_TO!,
 *         extra: { asset: USDC_TESTNET_ASA_ID },
 *       }],
 *     },
 *   },
 * });
 *
 * app.get('/weather', x402, (_req, res) => {
 *   res.json({ report: { weather: 'sunny', temperature: 70 } });
 * });
 * ```
 */
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { ALGORAND_MAINNET_CAIP2, ALGORAND_TESTNET_CAIP2 } from '@x402/avm';

// `@x402/core/server` and `@x402/avm/exact/server` are package-export subpaths.
// Classic TypeScript moduleResolution doesn't honor these, so we use require()
// at runtime and rely on Node's resolver. Type info is intentionally loose
// here — we re-establish strong types at the public API surface.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const coreServer = require('@x402/core/server');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const avmExactServer = require('@x402/avm/exact/server');

/**
 * Framework-agnostic HTTP adapter the x402 core expects. The Express
 * implementation lives below as a private class.
 */
interface HTTPAdapter {
  getHeader(name: string): string | undefined;
  getMethod(): string;
  getPath(): string;
  getUrl(): string;
  getAcceptHeader(): string;
  getUserAgent(): string;
  getQueryParams?(): Record<string, string | string[]>;
  getQueryParam?(name: string): string | string[] | undefined;
  getBody?(): unknown;
}

class ExpressAdapter implements HTTPAdapter {
  constructor(private readonly req: Request) {}
  getHeader(name: string): string | undefined {
    const v = this.req.get(name);
    return v ?? undefined;
  }
  getMethod(): string {
    return this.req.method;
  }
  getPath(): string {
    return this.req.path;
  }
  getUrl(): string {
    return `${this.req.protocol}://${this.req.get('host')}${this.req.originalUrl}`;
  }
  getAcceptHeader(): string {
    return this.req.get('accept') ?? '';
  }
  getUserAgent(): string {
    return this.req.get('user-agent') ?? '';
  }
  getQueryParams(): Record<string, string | string[]> {
    return this.req.query as Record<string, string | string[]>;
  }
  getQueryParam(name: string): string | string[] | undefined {
    return this.req.query[name] as string | string[] | undefined;
  }
  getBody(): unknown {
    return (this.req as any).body;
  }
}

/** A scheme registration mapping a CAIP-2 network to a server-side scheme impl. */
export interface SchemeRegistration {
  network: string;
  /** Implements `@x402/core/types`'s `SchemeNetworkServer`. */
  server: unknown;
}

/**
 * One way the resource server will accept payment for a route.
 *
 * @example
 * ```ts
 * {
 *   scheme: 'exact',
 *   price: '$0.01',
 *   network: ALGORAND_TESTNET_CAIP2,
 *   payTo: 'SDFY...3HJPDU',
 *   extra: { asset: USDC_TESTNET_ASA_ID },
 * }
 * ```
 */
export interface PaymentOption {
  /** Payment scheme name, e.g. `'exact'`. */
  scheme: string;
  /** Address that will receive the payment. */
  payTo: string;
  /** Either a USD-denominated string (`'$0.01'`) or atomic-units descriptor. */
  price: string | { amount: string; asset?: string };
  /** CAIP-2 network identifier. */
  network: string;
  /** Optional payment timeout in seconds. */
  maxTimeoutSeconds?: number;
  /** Scheme-specific extras. For AVM exact, set `{ asset: <ASA-id> }`. */
  extra?: Record<string, unknown>;
}

/** Route-level payment configuration. */
export interface RouteConfig {
  /** One or more payment options the server will accept. */
  accepts: PaymentOption | PaymentOption[];
  /** Human-readable description shown in the 402 response. */
  description?: string;
  /** Optional override for the resource URL embedded in the 402 payload. */
  resource?: string;
  /** MIME type for the protected resource. */
  mimeType?: string;
  /** Custom HTML to serve to browsers (via Accept: text/html). */
  customPaywallHtml?: string;
  /** x402 protocol extensions, e.g. `{ bazaar: {...} }`. */
  extensions?: Record<string, unknown>;
}

/** Map of `"VERB /path"` patterns to route configs. */
export type RoutesConfig = Record<string, RouteConfig>;

export interface BuildX402MiddlewareOptions {
  /**
   * URL of the x402 facilitator. The facilitator verifies and settles
   * payments on chain.
   *
   * @example "https://facilitator.goplausible.xyz"
   */
  facilitatorUrl: string;
  /** Map of `"VERB /path"` → route config. */
  routes: RoutesConfig;
  /**
   * Optional scheme registrations. By default, the AVM `exact` scheme is
   * registered for both Algorand TestNet and MainNet — which is what most
   * users want. Override only if you need additional schemes/networks.
   */
  schemes?: SchemeRegistration[];
  /**
   * Logger for verification/settlement failures. Defaults to `console.warn`.
   * Pass a no-op `() => {}` to silence, or wire up your own logger.
   */
  onWarn?: (message: string) => void;
}

/**
 * Build an Express request handler that enforces x402 payment for the
 * configured routes. Mount it in front of your route handlers.
 *
 * The middleware is lazy: it begins fetching the facilitator's `/supported`
 * list at construction time, but the first request will await initialization
 * before processing.
 */
export function buildX402Middleware(opts: BuildX402MiddlewareOptions): RequestHandler {
  const onWarn = opts.onWarn ?? ((m: string) => console.warn(`[x402] ${m}`));

  const facilitatorClient = new coreServer.HTTPFacilitatorClient({ url: opts.facilitatorUrl });
  const server = new coreServer.x402ResourceServer(facilitatorClient);

  const schemes =
    opts.schemes ??
    ([
      { network: ALGORAND_TESTNET_CAIP2, server: new avmExactServer.ExactAvmScheme() },
      { network: ALGORAND_MAINNET_CAIP2, server: new avmExactServer.ExactAvmScheme() },
    ] satisfies SchemeRegistration[]);

  for (const { network, server: schemeServer } of schemes) {
    server.register(network, schemeServer);
  }

  const httpServer = new coreServer.x402HTTPResourceServer(server, opts.routes);
  let initPromise: Promise<void> | null = httpServer.initialize().catch((e: unknown) => {
    onWarn(`facilitator initialize failed: ${(e as Error).message}`);
    initPromise = null;
    throw e;
  });
  let isInitialized = false;

  return async function x402PaymentMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const adapter = new ExpressAdapter(req);
    const context = {
      adapter,
      path: req.path,
      method: req.method,
      paymentHeader: req.get('payment-signature') || req.get('x-payment'),
    };

    if (!httpServer.requiresPayment(context)) {
      return next();
    }

    if (!isInitialized) {
      try {
        if (!initPromise) initPromise = httpServer.initialize();
        await initPromise;
        isInitialized = true;
      } catch (e) {
        return next(e as Error);
      }
    }

    let result: any;
    try {
      result = await httpServer.processHTTPRequest(context);
    } catch (e) {
      return next(e as Error);
    }

    if (result.type === 'no-payment-required') {
      return next();
    }

    if (result.type === 'payment-error') {
      const r = result.response;
      onWarn(`payment-error status=${r.status}`);
      Object.entries(r.headers).forEach(([k, v]) => res.setHeader(k, String(v)));
      res.status(r.status);
      if (r.isHtml) {
        res.type('html').send(String(r.body ?? ''));
      } else {
        res.json(r.body || {});
      }
      return;
    }

    // payment-verified — buffer the handler's response, then settle and add
    // the Payment-Response header before sending.
    const { paymentPayload, paymentRequirements, declaredExtensions } = result;
    const originalSend = res.send.bind(res);
    let captured = false;

    res.send = ((body: any) => {
      if (captured) return res;
      captured = true;

      (async () => {
        const responseBody = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
        const responseHeaders: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.getHeaders())) {
          responseHeaders[k] = String(v);
        }

        try {
          const settleResult = await httpServer.processSettlement(
            paymentPayload,
            paymentRequirements,
            declaredExtensions,
            { request: context, responseBody, responseHeaders },
          );
          if (settleResult.success) {
            Object.entries(settleResult.headers).forEach(([k, v]) =>
              res.setHeader(k, String(v)),
            );
            originalSend(body);
          } else {
            const r = settleResult.response;
            onWarn(`settlement failed: ${settleResult.errorReason ?? 'unknown'}`);
            Object.entries(r.headers).forEach(([k, v]) => res.setHeader(k, String(v)));
            res.status(r.status);
            originalSend(r.isHtml ? String(r.body ?? '') : JSON.stringify(r.body ?? {}));
          }
        } catch (e) {
          onWarn(`settlement error: ${(e as Error).message}`);
          originalSend(body);
        }
      })();
      return res;
    }) as any;

    next();
  };
}
