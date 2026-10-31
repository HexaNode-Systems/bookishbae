import { createHandler } from '@/lib/api/handler';
import { getCategories } from '@/lib/author-commerce';
export const GET = createHandler({ auth: 'public' }, async () => ({ categories: await getCategories() }));
