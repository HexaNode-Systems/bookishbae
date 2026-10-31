import { badRequest, ApiError } from '@/lib/api/errors';
import { createHandler } from '@/lib/api/handler';
import {
  buildKey,
  publicUrl,
  putObject,
  ruleFor,
  validateUpload,
  PUBLIC_BUCKET,
  type UploadPurpose,
} from '@/lib/cloudinary';

export const POST = createHandler(
  {
    auth: 'admin',
    csrf: false,
    rawBody: true,
    rateLimit: { name: 'adminUpload', by: 'user' },
  },
  async ({ request, log }) => {
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch (formErr) {
      log.error('Failed to parse multipart form data', { formErr });
      throw badRequest('Multipart form data required for file upload.');
    }

    const file = formData.get('file');
    const purpose = (formData.get('purpose') as UploadPurpose) || 'cover';
    const productId = (formData.get('productId') as string) || crypto.randomUUID();
    if (!['cover', 'main_pdf', 'sample_pdf', 'author_photo', 'avatar'].includes(purpose)) {
      throw badRequest('Unsupported upload purpose.');
    }

    if (!file || typeof file === 'string') {
      throw badRequest('File is missing.');
    }

    const blob = file as File;
    let contentType = blob.type;
    const contentLength = blob.size;

    // Normalize PDF contentType if missing or generic on Windows/certain browsers
    const isPdfFilename = blob.name?.toLowerCase().endsWith('.pdf');
    if (purpose === 'main_pdf' || purpose === 'sample_pdf' || isPdfFilename) {
      if (!contentType || contentType === 'application/octet-stream' || contentType === 'application/x-pdf') {
        contentType = 'application/pdf';
      }
    }

    // Normalize image contentType if missing
    if (purpose === 'cover' || purpose === 'author_photo' || purpose === 'avatar') {
      if (!contentType && blob.name?.toLowerCase().endsWith('.png')) contentType = 'image/png';
      if (!contentType && (blob.name?.toLowerCase().endsWith('.jpg') || blob.name?.toLowerCase().endsWith('.jpeg'))) contentType = 'image/jpeg';
      if (!contentType && blob.name?.toLowerCase().endsWith('.webp')) contentType = 'image/webp';
    }

    const validationErr = validateUpload(purpose, contentType, contentLength);
    if (validationErr) {
      throw badRequest(validationErr.message);
    }

    const rule = ruleFor(purpose);
    const buffer = Buffer.from(await blob.arrayBuffer());
    if ((purpose === 'main_pdf' || purpose === 'sample_pdf') && buffer.subarray(0, 5).toString() !== '%PDF-') {
      throw badRequest('The uploaded file is not a PDF document.');
    }
    const key = buildKey(purpose, productId, contentType);

    let uploaded: Awaited<ReturnType<typeof putObject>>;
    try {
      uploaded = await putObject({
        key,
        body: buffer,
        contentType,
        bucket: rule.bucket,
      });
    } catch (uploadErr: any) {
      log.error('Storage putObject failed', { purpose, key, error: uploadErr?.message || uploadErr });
      throw new ApiError(
        'upstream_error',
        `Storage upload failed: ${uploadErr?.message || 'Failed to upload file to storage.'}`,
        { status: 502 },
      );
    }

    const isPublic = rule.bucket === PUBLIC_BUCKET;
    const url = isPublic ? uploaded.url || publicUrl(uploaded.key) : undefined;

    log.info('File uploaded safely', { purpose, key, size: contentLength });

    return {
      ok: true,
      key: uploaded.key,
      url,
      size: contentLength,
    };
  },
);
