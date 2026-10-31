/**
 * Download Controller
 * Handles token claims and signed Cloudinary e-book download generation.
 */

import * as downloadRoute from '../api/download/route';

export const DownloadController = {
  claimDownload: downloadRoute.POST,
};
