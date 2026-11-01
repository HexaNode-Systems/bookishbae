/** Test-only PostgreSQL engine. Applies the real migrations, never developer env files. */
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { after } from 'node:test';
import { getPool, closeDatabase } from '../src/lib/db/postgres';
import { BOOKS } from '../src/lib/books';
export const ADMIN_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
export const CUSTOMER_ID = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
export let engine: PGlite;
export async function installDatabaseFixture(cleanup = true) {
  engine = new PGlite();
  const base = new URL('../supabase/', import.meta.url);
  await engine.exec(await readFile(new URL('tests/_local_supabase_shim.sql', base), 'utf8'));
  for (const name of (await readdir(new URL('migrations/', base))).sort()) await engine.exec(await readFile(new URL(`migrations/${name}`, base), 'utf8'));
  // A FIFO connection gate models PostgreSQL's serialized transactions for this
  // single-connection embedded engine. Separate-server contention has its own suite.
  let queue = Promise.resolve();
  async function acquire() {
    const previous = queue;
    let release!: () => void;
    queue = new Promise<void>(resolve => { release = resolve; });
    await previous;
    return release;
  }
  const query = async (text: string, values: unknown[] = []) => {
    const result = await engine.query(text, values);
    return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
  };
  const pool = getPool();
  pool.query = (async (text: string, values: unknown[] = []) => {
    const release = await acquire();
    try { return await query(text, values); } finally { release(); }
  }) as typeof pool.query;
  pool.connect = (async () => {
    const release = await acquire();
    return { query, release };
  }) as typeof pool.connect;
  await engine.query('INSERT INTO auth.users(id,email) VALUES($1,$2),($3,$4)', [ADMIN_ID, 'admin@bookishbae.com', CUSTOMER_ID, 'buyer@example.com']);
  await engine.query("UPDATE public.profiles SET role='admin' WHERE id=$1", [ADMIN_ID]);
  for (const [index, book] of BOOKS.entries()) {
    const digit = String(index + 1);
    const id = `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-a${digit.repeat(3)}-${digit.repeat(12)}`;
    await engine.query(`INSERT INTO public.products(id,slug,title,subtitle,description,excerpt,price_paise,cover_key,sample_pdf_key,main_pdf_key,status,page_count,sample_preview)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'published',$11,$12::jsonb)`, [id,book.slug,book.title,book.subtitle,book.description,book.excerpt,book.pricePaise,book.coverImage,`samples/${book.slug}-sample.pdf`,`books/${book.slug}.pdf`,book.pageCount,JSON.stringify(book.sampleText)]);
  }
  await engine.exec(`INSERT INTO public.coupons(id,code,discount_type,discount_value) VALUES('10000000-0000-0000-0000-000000000001','launch50','percent',50),('10000000-0000-0000-0000-000000000002','read100','flat',10000);`);
  if (cleanup) after(async () => { await closeDatabase(); await engine.close(); });
}
