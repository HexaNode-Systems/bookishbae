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
    rawBody: true,
    rateLimit: { name: 'adminUpload', by: 'user' },
  },
  async ({ request, user, log }) => {
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch (formErr) {
      log.error('Failed to parse multipart form data', { formErr });
      throw badRequest('Multipart form data required for file upload.');
    }

    const file = formData.get('file');
    const purpose = (formData.get('purpose') as UploadPurpose) || 'cover';
    const productId = purpose === 'avatar' ? user!.id : (formData.get('productId') as string) || crypto.randomUUID();
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
      if (!contentType || contentType === 'application/octet-stream') {
        if (blob.name?.toLowerCase().endsWith('.png')) contentType = 'image/png';
        if (blob.name?.toLowerCase().endsWith('.jpg') || blob.name?.toLowerCase().endsWith('.jpeg')) contentType = 'image/jpeg';
        if (blob.name?.toLowerCase().endsWith('.webp')) contentType = 'image/webp';
        if (blob.name?.toLowerCase().endsWith('.avif')) contentType = 'image/avif';
      }
    }

    const validationErr = validateUpload(purpose, contentType, contentLength);
    if (validationErr) {
      throw badRequest(validationErr.message);
    }

    const rule = ruleFor(purpose);
    const buffer = Buffer.from(await blob.arrayBuffer());
    if (purpose === 'avatar') {
      const matches = contentType === 'image/jpeg' ? buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
        : contentType === 'image/png' ? buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : contentType === 'image/webp' ? buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP'
        : buffer.subarray(4, 8).toString() === 'ftyp' && /avif|avis/.test(buffer.subarray(8, 32).toString());
      if (!matches) throw badRequest('The uploaded photo does not match its image format.');
    }
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
      log.error('Storage putObject failed', { purpose });
      throw new ApiError(
        'upstream_error',
        'The file could not be uploaded. Please try again shortly.',
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
