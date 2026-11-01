import { createHandler } from '../../../lib/api/handler';
export const GET = createHandler({ auth: 'user' }, async ({ user, profile, role }) => ({ user, profile, isAdmin: role === 'admin' }));
