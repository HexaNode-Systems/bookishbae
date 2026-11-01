/**
 * BookishBae Standalone Backend HTTP Server.
 *
 * Runs on Node.js native HTTP server with Web API Request/Response compatibility.
 * Provides full REST API routing for products, orders, checkout, webhooks,
 * downloads, and admin operations.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { NextRequest } from 'next/server';

import {
  AdminController,
  CheckoutController,
  ContactController,
  CouponController,
  DownloadController,
  NewsletterController,
  OrderController,
  ProductController,
  UploadController,
  WebhookController,
} from './controllers';
import * as publicCategories from './api/categories/route';
import * as adminCategories from './api/admin/categories/route';
import * as adminCategory from './api/admin/categories/[id]/route';
import * as adminCoupons from './api/admin/coupons/route';
import * as adminCoupon from './api/admin/coupons/[id]/route';
import * as authMe from './api/auth/me/route';
import * as adminProfile from './api/admin/profile/route';
import { closeDatabase } from './lib/db/postgres';
import { env } from './config/env';
import { logger } from './middleware/logger';

const PORT = Number(process.env.PORT || process.env.BACKEND_PORT || 5000);
const MAX_REQUEST_BODY_BYTES = 52 * 1024 * 1024; // 50 MB e-book PDF plus multipart overhead

class PayloadTooLargeError extends Error {}

// Helper to convert Node.js IncomingMessage to Web NextRequest
async function toWebRequest(req: IncomingMessage, urlStr: string): Promise<NextRequest> {
  const declaredLength = Number(req.headers['content-length'] || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BODY_BYTES) {
    throw new PayloadTooLargeError();
  }
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    totalBytes += buffer.length;
    if (totalBytes > MAX_REQUEST_BODY_BYTES) {
      throw new PayloadTooLargeError();
    }
    chunks.push(buffer);
  }
  const bodyBuffer = chunks.length ? Buffer.concat(chunks) : null;

  const headers = new Headers();
  for (const [key, val] of Object.entries(req.headers)) {
    if (val !== undefined) {
      if (Array.isArray(val)) {
        val.forEach((v) => headers.append(key, v));
      } else {
        headers.set(key, val);
      }
    }
  }

  const method = req.method || 'GET';
  const hasBody = method !== 'GET' && method !== 'HEAD' && bodyBuffer !== null;

  return new NextRequest(urlStr, {
    method,
    headers,
    body: hasBody ? bodyBuffer : undefined,
  });
}

// Helper to send Web Response through Node.js ServerResponse
async function sendWebResponse(webRes: Response, res: ServerResponse): Promise<void> {
  res.statusCode = webRes.status;
  res.statusMessage = webRes.statusText;

  webRes.headers.forEach((value, name) => {
    res.setHeader(name, value);
  });

  const arrayBuffer = await webRes.arrayBuffer();
  res.end(Buffer.from(arrayBuffer));
}

export const server = createServer(async (req, res) => {
  let pathname = '/';
  const method = (req.method || 'GET').toUpperCase();

  try {
    // Route parsing must not trust Host or forwarded-protocol headers. They
    // are supplied by the caller unless a trusted proxy explicitly replaces
    // them, and this server only needs a stable internal origin.
    const parsed = new URL(req.url || '/', 'http://backend.internal');
    pathname = parsed.pathname;
    const rawUrl = parsed.toString();
    const webReq = await toWebRequest(req, rawUrl);

    // Health check
    if (pathname === '/health' || pathname === '/api/health') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ status: 'ok', service: 'bookishbae-backend' }));
      return;
    }

    if (pathname === '/api/categories' && method === 'GET') return await sendWebResponse(await publicCategories.GET(webReq), res);
    const managed = pathname.match(/^\/api\/admin\/(categories|coupons)(?:\/([^/]+))?$/);
    if (managed) {
      const collection = managed[1] === 'categories' ? adminCategories : adminCoupons;
      const detail = managed[1] === 'categories' ? adminCategory : adminCoupon;
      if (!managed[2] && method === 'GET') return await sendWebResponse(await collection.GET(webReq), res);
      if (!managed[2] && method === 'POST') return await sendWebResponse(await collection.POST(webReq), res);
      const context = { params: { id: managed[2]! } };
      if (managed[2] && method === 'PATCH') return await sendWebResponse(await detail.PATCH(webReq, context), res);
      if (managed[2] && method === 'DELETE') return await sendWebResponse(await detail.DELETE(webReq, context), res);
    }

    // --- Products ---
    if (pathname === '/api/auth/me' && method === 'GET') return await sendWebResponse(await authMe.GET(webReq), res);
    if (pathname === '/api/admin/profile' && method === 'PATCH') return await sendWebResponse(await adminProfile.PATCH(webReq), res);
    if (pathname === '/api/products') {
      if (method === 'GET') {
        const out = await ProductController.getPublicProducts(webReq);
        return await sendWebResponse(out, res);
      }
    }

    const productSlugMatch = pathname.match(/^\/api\/products\/([^/]+)$/);
    if (productSlugMatch) {
      const slug = productSlugMatch[1]!;
      if (method === 'GET') {
        const out = await ProductController.getProductBySlug(webReq, {
          params: { slug },
        });
        return await sendWebResponse(out, res);
      }
    }

    // --- Checkout ---
    if (pathname === '/api/checkout') {
      if (method === 'GET') return await sendWebResponse(await CheckoutController.getConfiguration(webReq), res);
      if (method === 'POST') {
        const out = await CheckoutController.createOrder(webReq);
        return await sendWebResponse(out, res);
      }
    }

    if (pathname === '/api/checkout/verify') {
      if (method === 'POST') {
        const out = await CheckoutController.verifyPayment(webReq);
        return await sendWebResponse(out, res);
      }
    }

    // --- Webhooks ---
    if (pathname === '/api/webhooks/cashfree') {
      if (method === 'POST') {
        const out = await WebhookController.handleCashfree(webReq);
        return await sendWebResponse(out, res);
      }
    }

    if (pathname === '/api/webhooks/razorpay') {
      if (method === 'POST') {
        const out = await WebhookController.handleRazorpay(webReq);
        return await sendWebResponse(out, res);
      }
    }

    // --- Downloads ---
    if (pathname === '/api/download') {
      if (method === 'POST') {
        const out = await DownloadController.claimDownload(webReq);
        return await sendWebResponse(out, res);
      }
    }

    // --- Coupons ---
    if (pathname === '/api/coupons/validate') {
      if (method === 'POST') {
        const out = await CouponController.validateCoupon(webReq);
        return await sendWebResponse(out, res);
      }
    }

    // --- Newsletter & Contact ---
    if (pathname === '/api/newsletter') {
      if (method === 'POST') {
        const out = await NewsletterController.subscribe(webReq);
        return await sendWebResponse(out, res);
      }
    }

    if (pathname === '/api/contact') {
      if (method === 'POST') {
        const out = await ContactController.submitMessage(webReq);
        return await sendWebResponse(out, res);
      }
    }

    // --- Admin Products ---
    if (pathname === '/api/admin/products') {
      if (method === 'GET') {
        const out = await ProductController.getAdminProducts(webReq);
        return await sendWebResponse(out, res);
      }
      if (method === 'POST') {
        const out = await ProductController.createAdminProduct(webReq);
        return await sendWebResponse(out, res);
      }
    }

    const adminProductMatch = pathname.match(/^\/api\/admin\/products\/([^/]+)$/);
    if (adminProductMatch) {
      const id = adminProductMatch[1]!;
      if (method === 'GET') {
        const out = await ProductController.getAdminProductById(webReq, {
          params: { id },
        });
        return await sendWebResponse(out, res);
      }
      if (method === 'PATCH') {
        const out = await ProductController.updateAdminProduct(webReq, {
          params: { id },
        });
        return await sendWebResponse(out, res);
      }
      if (method === 'DELETE') {
        const out = await ProductController.deleteAdminProduct(webReq, {
          params: { id },
        });
        return await sendWebResponse(out, res);
      }
    }

    // --- Admin Orders ---
    if (pathname === '/api/admin/orders') {
      if (method === 'GET') {
        const out = await OrderController.getOrders(webReq);
        return await sendWebResponse(out, res);
      }
    }

    if (pathname === '/api/admin/orders/downloads') {
      if (method === 'PATCH') {
        const out = await OrderController.overrideDownloads(webReq);
        return await sendWebResponse(out, res);
      }
    }

    if (pathname === '/api/admin/orders/refund') {
      if (method === 'POST') {
        const out = await OrderController.refundOrder(webReq);
        return await sendWebResponse(out, res);
      }
    }

    if (pathname === '/api/admin/orders/resend') {
      if (method === 'POST') {
        const out = await OrderController.resendDeliveryEmail(webReq);
        return await sendWebResponse(out, res);
      }
    }

    const adminOrderMatch = pathname.match(/^\/api\/admin\/orders\/([^/]+)$/);
    if (adminOrderMatch) {
      const id = adminOrderMatch[1]!;
      if (method === 'GET') {
        const out = await OrderController.getOrderById(webReq, {
          params: { id },
        });
        return await sendWebResponse(out, res);
      }
    }

    // --- Admin Uploads ---
    if (pathname === '/api/admin/uploads/presign') {
      if (method === 'POST') {
        const out = await UploadController.presignCoverUpload(webReq);
        return await sendWebResponse(out, res);
      }
    }

    if (pathname === '/api/admin/uploads') {
      if (method === 'POST') {
        const out = await UploadController.uploadCoverMultipart(webReq);
        return await sendWebResponse(out, res);
      }
    }

    // --- Admin Settings, Stats, Integrations ---
    if (pathname === '/api/admin/integrations/status') {
      if (method === 'GET') {
        const out = await AdminController.getIntegrationsStatus(webReq);
        return await sendWebResponse(out, res);
      }
    }

    if (pathname === '/api/admin/stats') {
      if (method === 'GET') {
        const out = await AdminController.getDashboardStats(webReq);
        return await sendWebResponse(out, res);
      }
    }

    if (pathname === '/api/admin/settings') {
      if (method === 'GET') {
        const out = await AdminController.getSettings(webReq);
        return await sendWebResponse(out, res);
      }
      if (method === 'PATCH') {
        const out = await AdminController.updateSettings(webReq);
        return await sendWebResponse(out, res);
      }
    }

    // Route Not Found
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/problem+json');
    res.end(
      JSON.stringify({
        type: 'https://bookishbae.in/errors/not-found',
        title: 'Not Found',
        status: 404,
        detail: `No handler for ${method} ${pathname}`,
      }),
    );
  } catch (err: unknown) {
    if (err instanceof PayloadTooLargeError) {
      res.statusCode = 413;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Connection', 'close');
      res.end(JSON.stringify({
        error: {
          code: 'payload_too_large',
          message: 'Request body exceeds the 52 MB server limit.',
        },
      }));
      return;
    }
    logger.error('Unhandled server exception', {
      error: 'Unexpected request failure',
      path: pathname,
    });
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        error: {
          code: 'internal_error',
          message: 'An unexpected server error occurred.',
        },
      }),
    );
  }
});

// Bound slow or oversized HTTP requests before they can hold server resources.
server.headersTimeout = 10_000;
server.requestTimeout = 30_000;
server.keepAliveTimeout = 5_000;
server.maxHeadersCount = 100;

if (require.main === module || process.env.NODE_ENV !== 'test') {
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    const deadline = setTimeout(() => process.exit(1), 15000);
    deadline.unref();
    server.close(() => {
      void closeDatabase().then(() => { clearTimeout(deadline); process.exitCode = 0; })
        .catch(() => { clearTimeout(deadline); process.exitCode = 1; });
    });
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  server.listen(PORT, '0.0.0.0', () => {
    logger.info(`BookishBae Backend Server running on port ${PORT} (0.0.0.0)`);
  });
}
