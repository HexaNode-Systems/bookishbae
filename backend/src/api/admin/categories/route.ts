import { createHandler } from '@/lib/api/handler';
import { getCategories, saveCategory } from '@/lib/author-commerce';
import { categorySchema } from '@/lib/validation/schemas';
export const GET = createHandler({ auth: 'admin' }, async () => ({ categories: await getCategories() }));
export const POST = createHandler({ auth: 'admin', body: categorySchema, rateLimit: { name: 'adminWrite', by: 'user' } }, async ({ body }) => ({ ok: true, category: await saveCategory(undefined, body) }));
