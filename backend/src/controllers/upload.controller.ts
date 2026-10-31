/**
 * Upload Controller
 * Handles book cover presigned parameters and upload fallback.
 */

import * as presignRoute from '../api/admin/uploads/presign/route';
import * as uploadRoute from '../api/admin/uploads/route';

export const UploadController = {
  presignCoverUpload: presignRoute.POST,
  uploadCoverMultipart: uploadRoute.POST,
};
