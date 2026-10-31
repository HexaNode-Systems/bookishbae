-- Run only against a disposable database after migrations 0001 through 0007.
begin;
do $$
declare
 category_id uuid := gen_random_uuid(); book_id uuid := gen_random_uuid(); other_id uuid := gen_random_uuid();
 coupon jsonb; checked jsonb; checkout jsonb; paid jsonb; oid uuid; cid uuid;
 preview jsonb := '[{"heading":"Author chapter","paragraphs":["The author’s first paragraph.","The second paragraph."]}]';
begin
 assert not has_function_privilege('anon','public.create_checkout_order(uuid,text,text,text,uuid,jsonb,text,text)','execute'), 'Anonymous callers must not invoke checkout RPC directly';
 assert not has_function_privilege('authenticated','public.save_coupon(uuid,jsonb)','execute'), 'Coupon writes belong to authenticated admin APIs';
 insert into public.categories(id,slug,name) values(category_id,'verification-genre','An author genre');
 insert into public.products(id,slug,title,category_id,price_paise,discount_price_paise,cover_key,main_pdf_key,status,sample_preview)
 values(book_id,'verification-edition','Author edition',category_id,20000,10000,'covers/test.png','books/test.pdf','published',preview);
 insert into public.products(id,slug,title,price_paise,cover_key,main_pdf_key,status)
 values(other_id,'verification-other','Other edition',10000,'covers/other.png','books/other.pdf','published');
 assert (select sample_preview = preview from public.products where id = book_id), 'Author preview must persist exactly';
 update public.categories set name='Renamed author genre' where id=category_id;
 assert (select c.name='Renamed author genre' from public.products p join public.categories c on c.id=p.category_id where p.id=book_id), 'Renaming must retain the category relationship';
 begin delete from public.categories where id=category_id; raise exception 'Used category deletion succeeded'; exception when foreign_key_violation then null; end;

 coupon := public.save_coupon(null,jsonb_build_object('code','AUTHOR50','discountType','percent','discountValue',50,'maxDiscountPaise',2000,'usageLimit',1,'productIds',jsonb_build_array(book_id),'isActive',true));
 cid := (coupon->>'id')::uuid;
 checked := public.validate_coupon('author50',10000,book_id,'reader@example.com');
 assert (checked->>'valid')::boolean and (checked->>'discount_paise')::integer=2000, 'Percentage must respect the maximum discount';
 assert not (public.validate_coupon('author50',10000,other_id)->>'valid')::boolean, 'Coupon must reject an ineligible book';
 checkout := public.create_checkout_order(book_id,'reader@example.com','Reader','author50');
 oid := (checkout->'order'->>'id')::uuid;
 assert (checkout->'order'->>'total_paise')::integer=8000, 'Pricing uses the discounted database price and server coupon cap';
 assert (select times_used=0 from public.coupons where id=cid), 'Pending order must not count as redeemed';
 assert not exists(select 1 from public.coupon_redemptions where order_id=oid), 'No redemption before payment';
 assert public.validate_coupon('author50',10000,book_id,'other@example.com')->>'reason'='exhausted', 'Pending reservation prevents concurrent oversubscription';
 update public.orders set status='failed' where id=oid;
 assert (public.validate_coupon('author50',10000,book_id)->>'valid')::boolean, 'Failed checkout releases its reservation';
 checkout := public.create_checkout_order(book_id,'reader@example.com','Reader','author50');
 oid := (checkout->'order'->>'id')::uuid;
 paid := public.mark_order_paid(oid);
 assert (paid->>'ok')::boolean, 'Verified order can transition to paid';
 perform public.mark_order_paid(oid);
 assert (select times_used=1 from public.coupons where id=cid), 'Duplicate confirmation must not increment uses twice';
 assert (select count(*)=1 from public.coupon_redemptions where order_id=oid), 'One redemption per completed order';
 begin perform public.delete_coupon(cid); raise exception 'Coupon history deletion succeeded'; exception when foreign_key_violation then null; end;

 coupon := public.save_coupon(null,jsonb_build_object('code','FIXED25','discountType','flat','discountValue',2500,'usageLimitPerUser',1,'productIds','[]'::jsonb,'isActive',true));
 cid := (coupon->>'id')::uuid;
 assert (public.validate_coupon('fixed25',10000,other_id,'a@example.com')->>'discount_paise')::integer=2500, 'Fixed coupon uses paise and applies to all books';
 checkout := public.create_checkout_order(other_id,'a@example.com','Reader','fixed25');
 perform public.mark_order_paid((checkout->'order'->>'id')::uuid);
 assert public.validate_coupon('fixed25',10000,other_id,'a@example.com')->>'reason'='already_used', 'Per-customer usage is enforced';
 assert (public.validate_coupon('fixed25',10000,other_id,'b@example.com')->>'valid')::boolean, 'Another eligible customer may use the coupon';
 update public.coupons set is_active=false where id=cid;
 assert not (public.validate_coupon('fixed25',10000,book_id)->>'valid')::boolean, 'Disabled coupon must fail';
 update public.coupons set is_active=true,starts_at=now()-interval '2 days',expires_at=now()-interval '1 day' where id=cid;
 assert public.validate_coupon('fixed25',10000,book_id)->>'reason'='expired', 'Expired coupon must fail';
 update public.coupons set expires_at=null,starts_at=now()+interval '1 day' where id=cid;
 assert public.validate_coupon('fixed25',10000,book_id)->>'reason'='not_started', 'Future coupon must fail';
 coupon := public.save_coupon(null,jsonb_build_object('code','MULTIBOOK','discountType','percent','discountValue',10,'productIds',jsonb_build_array(book_id,other_id),'isActive',true));
 cid := (coupon->>'id')::uuid;
 assert (select count(*)=2 from public.coupon_products where coupon_id=cid), 'Multiple book scope persists';
 assert (public.validate_coupon('multibook',10000,book_id)->>'valid')::boolean and (public.validate_coupon('multibook',10000,other_id)->>'valid')::boolean, 'Both selected books are eligible';
 update public.coupons set min_order_paise=15000 where id=cid;
 assert public.validate_coupon('multibook',10000,book_id)->>'reason'='below_minimum', 'Minimum order must be enforced';
 perform public.delete_coupon(cid);
 assert not exists(select 1 from public.coupons where id=cid), 'Unused coupon can be deleted';
 begin perform public.create_checkout_order(book_id,'test@example.com','Reader','not-a-coupon'); raise exception 'Invalid coupon checkout succeeded'; exception when invalid_parameter_value then null; end;
end;
$$;
rollback;
