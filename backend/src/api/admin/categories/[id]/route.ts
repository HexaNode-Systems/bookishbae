import { createHandler } from '@/lib/api/handler';
import { saveCategory, deleteCategory } from '@/lib/author-commerce';
import { categorySchema } from '@/lib/validation/schemas';
import { uuidSchema } from '@/lib/validation/common';
export const PATCH = createHandler({ auth: 'admin', body: categorySchema, rateLimit: { name: 'adminWrite', by: 'user' } }, async ({ body, params }) => ({ ok: true, category: await saveCategory(uuidSchema.parse(params?.id), body) }));
export const DELETE = createHandler({ auth: 'admin', rateLimit: { name: 'adminWrite', by: 'user' } }, async ({ params }) => { await deleteCategory(uuidSchema.parse(params?.id)); return { ok: true }; });
