import { ApiError, forbidden, notFound, unauthenticated } from '@/lib/api/errors';
import { readSamplePdf } from '@/lib/sample-pdf';
import { createHandler } from '@/lib/api/handler';
import { downloadFilename, presignDownload } from '@/lib/cloudinary';
import {
  claimDownload,
  getOrderById,
  getProductByIdOrSlug,
  recordDownloadAudit,
  releaseDownload,
} from '@/lib/db/repository';
import { verifyDownloadToken } from '@/lib/download-token';
import { downloadRequestSchema } from '@/lib/validation/schemas';

export const POST = createHandler(
  {
    auth: 'public',
    body: downloadRequestSchema,
    rateLimit: [
      { name: 'download', by: 'user-or-ip' },
      { name: 'downloadHourly', by: 'user-or-ip' },
    ],
  },
  async ({ body, user, ipHash, userAgent, log }) => {
    // 1. Look up product
    const product = await getProductByIdOrSlug(body.productId, false);
    if (!product) {
      throw notFound('Book not found.');
    }

    // 2. Sample download flow (Public: anyone can download free opening samples)
    if (body.kind === 'sample') {
      const filename = downloadFilename(product.title, 'sample');
      let bytes: Uint8Array;
      try {
        bytes = await readSamplePdf(product);
      } catch (error) {
        log.error('Sample PDF delivery failed', { productId: product.id, error });
        await recordDownloadAudit({
          userId: user?.id ?? null, productId: product.id, kind: 'sample',
          objectKey: product.sample_pdf_key || '', ipHash, userAgent,
          succeeded: false, refusalReason: 'sample_unavailable',
        });
        if (error instanceof ApiError) throw error;
        throw new ApiError('upstream_error', 'Sample storage is unavailable. Please try again shortly.');
      }

      await recordDownloadAudit({
        userId: user?.id ?? null,
        productId: product.id,
        kind: 'sample',
        objectKey: product.sample_pdf_key!,
        ipHash,
        userAgent,
        succeeded: true,
      });

      log.info('Sample PDF downloaded', { productId: product.id, slug: product.slug });
      return new Response(Buffer.from(bytes), {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Content-Length': String(bytes.length),
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }

    // 3. Full E-book download flow (Strict: entitlement verification required)
    let claimTarget = user?.id;
    let orderIdToClaim: string | undefined = undefined;

    if (!claimTarget && (body.token || body.orderId)) {
      if (body.token) {
        const decoded = verifyDownloadToken(body.token);
        if (decoded && (!decoded.productId || decoded.productId === product.id)) {
          const verifiedOrder = await getOrderById(decoded.orderId);
          if (verifiedOrder && verifiedOrder.status === 'paid') {
            claimTarget = verifiedOrder.email || verifiedOrder.id;
            orderIdToClaim = verifiedOrder.id;
          }
        }
      } else if (body.orderId) {
        const verifiedOrder = await getOrderById(body.orderId);
        if (verifiedOrder && verifiedOrder.status === 'paid') {
          claimTarget = verifiedOrder.email || verifiedOrder.id;
          orderIdToClaim = verifiedOrder.id;
        }
      }
    }

    if (!claimTarget) {
      log.warn('Anonymous user attempted full e-book download without valid auth or token', { productId: product.id });
      throw unauthenticated('Sign in with the email address you purchased with to download.');
    }

    const claim = await claimDownload(claimTarget, product.id, orderIdToClaim);

    if (!claim.allowed) {
      await recordDownloadAudit({
        userId: user?.id ?? null,
        orderId: claim.orderId ?? null,
        orderItemId: claim.orderItemId ?? null,
        productId: product.id,
        kind: 'full',
        objectKey: product.main_pdf_key || `books/${product.slug}.pdf`,
        ipHash,
        userAgent,
        succeeded: false,
        refusalReason: claim.reason,
      });

      log.warn('Download refused', {
        claimTarget,
        productId: product.id,
        reason: claim.reason,
      });

      if (claim.reason === 'download_limit_reached') {
        throw forbidden('Download limit reached. Please contact support to request additional downloads.');
      }
      if (claim.reason === 'order_refunded') {
        throw forbidden('This order has been refunded. Download access is revoked.');
      }
      throw forbidden('You have not purchased this e-book.');
    }

    // 4. Presign Cloudinary authenticated download URL
    const filename = downloadFilename(product.title);
    const key = product.main_pdf_key || `books/${product.slug}.pdf`;

    try {
      const presigned = await presignDownload({
        key,
        filename,
      });

      await recordDownloadAudit({
        userId: user?.id ?? null,
        orderId: claim.orderId,
        orderItemId: claim.orderItemId,
        productId: product.id,
        kind: 'full',
        objectKey: key,
        ipHash,
        userAgent,
        succeeded: true,
      });

      log.info('Full e-book download granted', {
        claimTarget,
        productId: product.id,
        orderItemId: claim.orderItemId,
        downloadsUsed: claim.downloadsUsed,
      });

      return {
        url: presigned.url,
        expiresIn: presigned.expiresIn,
        filename,
        downloadsUsed: claim.downloadsUsed,
        downloadLimit: claim.downloadLimit,
      };
    } catch (presignError) {
      // If presigning fails, release the consumed slot back!
      if (claim.orderItemId) {
        await releaseDownload(claim.orderItemId);
      }

      await recordDownloadAudit({
        userId: user?.id ?? null,
        orderId: claim.orderId,
        orderItemId: claim.orderItemId,
        productId: product.id,
        kind: 'full',
        objectKey: key,
        ipHash,
        userAgent,
        succeeded: false,
        refusalReason: 'presign_failed',
      });

      log.error('Failed to generate presigned download URL', presignError);
      throw forbidden('Could not generate download link. Please try again shortly.');
    }
  },
);
