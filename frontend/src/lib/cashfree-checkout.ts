let loading: Promise<NonNullable<Window['Cashfree']>> | null = null;

export function loadCashfreeSdk(): Promise<NonNullable<Window['Cashfree']>> {
  if (window.Cashfree) return Promise.resolve(window.Cashfree);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://sdk.cashfree.com/js/v3/cashfree.js';
    script.async = true;
    const timer = setTimeout(() => fail(), 20_000);
    function fail() { clearTimeout(timer); script.remove(); reject(new Error('Cashfree checkout could not load. Check your connection or content blocker and retry.')); }
    script.onerror = fail;
    script.onload = () => { clearTimeout(timer); if (window.Cashfree) resolve(window.Cashfree); else fail(); };
    document.body.appendChild(script);
  });
  loading.catch(() => { loading = null; });
  return loading;
}
