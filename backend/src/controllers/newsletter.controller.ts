/**
 * Newsletter Controller
 * Handles visitor newsletter subscriptions and Brevo contact synchronisation.
 */

import * as newsletterRoute from '../api/newsletter/route';

export const NewsletterController = {
  subscribe: newsletterRoute.POST,
};
