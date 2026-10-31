/**
 * Contact Controller
 * Handles visitor messages and email forwarding to author.
 */

import * as contactRoute from '../api/contact/route';

export const ContactController = {
  submitMessage: contactRoute.POST,
};
