/**
 * Admin Controller
 * Handles integration health checks, store metrics, and system settings.
 */

import * as integrationsRoute from '../api/admin/integrations/status/route';
import * as statsRoute from '../api/admin/stats/route';
import * as settingsRoute from '../api/admin/settings/route';

export const AdminController = {
  getIntegrationsStatus: integrationsRoute.GET,
  getDashboardStats: statsRoute.GET,
  getSettings: settingsRoute.GET,
  updateSettings: settingsRoute.PATCH,
};
