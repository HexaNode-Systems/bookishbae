import { createHandler } from '@/lib/api/handler';
import { presignUpload, validateUpload } from '@/lib/cloudinary';
import { badRequest } from '@/lib/api/errors';
import { uploadPresignSchema } from '@/lib/validation/schemas';

export const POST = createHandler(
  {
    auth: 'admin',
    body: uploadPresignSchema,
    rateLimit: { name: 'adminUpload', by: 'user' },
  },
  async ({ body, log }) => {
    const error = validateUpload(body.purpose, body.contentType, body.contentLength);
    if (error) {
      throw badRequest(error.message);
    }

    const presigned = await presignUpload({
      purpose: body.purpose,
      productId: body.productId,
      contentType: body.contentType,
      contentLength: body.contentLength,
    });

    log.info('Generated presigned upload parameters', {
      purpose: body.purpose,
      productId: body.productId,
      key: presigned.key,
    });

    return {
      uploadUrl: presigned.url,
      key: presigned.key,
      bucket: presigned.bucket,
      expiresIn: presigned.expiresIn,
      fields: presigned.fields,
    };
  },
);
