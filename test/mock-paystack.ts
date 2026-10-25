/**
 * Minimal stand-in for the Paystack API, used by the test suite.
 * It enforces the same things the real API needs from us (Bearer secret key, JSON content type,
 * amounts in kobo) and lets tests decide how a checkout ends via POST /__test/complete/:reference.
 */
import { createServer, IncomingMessage, Server } from 'node:http';

export const MOCK_SECRET = 'sk_test_mock_secret';

interface Tx {
  id: number;
  reference: string;
  amount: number;
  currency: string;
  email: string;
  status: string;
  channel: string;
  gateway_response: string;
  paid_at: string | null;
  metadata: unknown;
  authorization: Record<string, unknown> | null;
  callback_url?: string;
}

export interface MockPaystack {
  server: Server;
  url: string;
  requests: { method: string; path: string; contentType?: string; body: Record<string, unknown> }[];
  txs: Map<string, Tx>;
  refunds: { transaction: unknown }[];
  close(): Promise<void>;
}

const body = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
  });

const card = (email: string, code = 'AUTH_mock_visa_4081') => ({
  authorization_code: code,
  bin: '408408',
  last4: '4081',
  exp_month: '12',
  exp_year: String(new Date().getFullYear() + 3),
  channel: 'card',
  card_type: 'visa ',
  bank: 'TEST BANK',
  country_code: 'NG',
  brand: 'visa',
  reusable: true,
  signature: `SIG_${email}`,
  account_name: null,
});

export function startMockPaystack(port: number): Promise<MockPaystack> {
  const txs = new Map<string, Tx>();
  const requests: MockPaystack['requests'] = [];
  const refunds: MockPaystack['refunds'] = [];
  let nextId = 1000;

  const server = createServer(async (req, res) => {
    const raw = await body(req);
    const json = raw ? JSON.parse(raw) : {};
    const url = new URL(req.url ?? '/', 'http://x');
    requests.push({ method: req.method!, path: url.pathname, contentType: req.headers['content-type'], body: json });
    const send = (status: number, payload: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    };

    // A stand-in for Paystack's hosted checkout page, so the redirect flow can be clicked through locally.
    const checkout = url.pathname.match(/^\/__checkout\/([^/]+)(?:\/(pay|decline|cancel))?$/);
    if (checkout) {
      const tx = txs.get(decodeURIComponent(checkout[1]));
      if (!tx) return send(404, { status: false, message: 'Unknown transaction' });
      const back = (q: string) => {
        res.writeHead(302, { location: `${tx.callback_url ?? '/'}${(tx.callback_url ?? '').includes('?') ? '&' : '?'}${q}` });
        res.end();
      };
      if (checkout[2] === 'pay' || checkout[2] === 'decline') {
        tx.status = checkout[2] === 'pay' ? 'success' : 'failed';
        tx.paid_at = new Date().toISOString();
        tx.gateway_response = checkout[2] === 'pay' ? 'Approved' : 'Declined by test bank';
        tx.authorization = card(tx.email);
        return back(`trxref=${tx.reference}&reference=${tx.reference}`);
      }
      if (checkout[2] === 'cancel') {
        tx.status = 'abandoned';
        return back(`cancelled=1&reference=${tx.reference}`);
      }
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(`<!doctype html><meta name="viewport" content="width=device-width"><title>Mock Paystack checkout</title>
<body style="font-family:system-ui;max-width:420px;margin:40px auto;padding:16px">
<p style="color:#0ba4db;font-weight:700">MOCK PAYSTACK (test only)</p>
<h2>Pay NGN ${(tx.amount / 100).toLocaleString()}</h2><p>${tx.email}</p>
<p><a id="pay" href="/__checkout/${tx.reference}/pay" style="display:block;background:#09a5db;color:#fff;padding:12px;text-align:center;border-radius:6px;text-decoration:none">Pay with test card 4084 0840 8408 4081</a></p>
<p><a id="decline" href="/__checkout/${tx.reference}/decline">Simulate a declined card</a> · <a id="cancel" href="/__checkout/${tx.reference}/cancel">Cancel</a></p></body>`);
    }

    if (url.pathname.startsWith('/__test/complete/')) {
      const tx = txs.get(decodeURIComponent(url.pathname.split('/').pop()!));
      if (!tx) return send(404, { status: false, message: 'no tx' });
      tx.status = json.status ?? 'success';
      if (json.amount) tx.amount = json.amount;
      tx.paid_at = new Date().toISOString();
      tx.gateway_response = tx.status === 'success' ? 'Approved' : 'Declined';
      tx.authorization = card(tx.email);
      return send(200, { status: true });
    }

    if (req.headers.authorization !== `Bearer ${MOCK_SECRET}`) return send(401, { status: false, message: 'Invalid key' });
    if (req.method === 'POST' && !String(req.headers['content-type']).includes('application/json')) {
      return send(400, { status: false, message: 'Content-Type must be application/json' });
    }

    if (req.method === 'POST' && url.pathname === '/transaction/initialize') {
      if (!json.email || !Number.isInteger(json.amount)) return send(400, { status: false, message: 'Invalid' });
      if (txs.has(json.reference)) return send(400, { status: false, message: 'Duplicate Transaction Reference' });
      txs.set(json.reference, {
        id: nextId++,
        reference: json.reference,
        amount: json.amount,
        currency: json.currency,
        email: json.email,
        status: 'ongoing',
        channel: 'card',
        gateway_response: '',
        paid_at: null,
        metadata: json.metadata,
        authorization: null,
        callback_url: json.callback_url,
      });
      return send(200, {
        status: true,
        message: 'Authorization URL created',
        data: { authorization_url: `http://localhost:${port}/__checkout/${json.reference}`, access_code: `ac_${json.reference}`, reference: json.reference },
      });
    }

    if (req.method === 'GET' && url.pathname.startsWith('/transaction/verify/')) {
      const tx = txs.get(decodeURIComponent(url.pathname.split('/').pop()!));
      if (!tx) return send(400, { status: false, message: 'Transaction reference not found' });
      return send(200, {
        status: true,
        message: 'Verification successful',
        data: { ...tx, fees: 7500, customer: { id: 1, email: tx.email, customer_code: `CUS_${tx.email}` } },
      });
    }

    if (req.method === 'POST' && url.pathname === '/transaction/charge_authorization') {
      const declined = String(json.authorization_code).includes('decline');
      const tx: Tx = {
        id: nextId++,
        reference: json.reference,
        amount: json.amount,
        currency: json.currency,
        email: json.email,
        status: declined ? 'failed' : 'success',
        channel: 'card',
        gateway_response: declined ? 'Declined' : 'Approved',
        paid_at: new Date().toISOString(),
        metadata: json.metadata,
        authorization: card(json.email, json.authorization_code),
      };
      txs.set(tx.reference, tx);
      return send(200, { status: true, message: 'Charge attempted', data: { ...tx, fees: 7500, customer: { id: 1, email: tx.email, customer_code: `CUS_${tx.email}` } } });
    }

    if (req.method === 'POST' && url.pathname === '/refund') {
      refunds.push({ transaction: json.transaction });
      return send(200, { status: true, message: 'Refund has been queued for processing', data: { id: nextId++, status: 'pending', amount: 0, currency: 'NGN', transaction: json.transaction } });
    }

    send(404, { status: false, message: `Mock has no ${req.method} ${url.pathname}` });
  });

  return new Promise((resolve) =>
    server.listen(port, () =>
      resolve({
        server,
        url: `http://localhost:${port}`,
        requests,
        txs,
        refunds,
        close: () => new Promise((r) => server.close(() => r())),
      }),
    ),
  );
}

/** Run standalone for local development without Paystack keys:
 *    npm run mock:paystack
 *  then start the API with PAYSTACK_BASE_URL=http://localhost:4545 PAYSTACK_SECRET_KEY=sk_test_mock_secret */
if (require.main === module) {
  const port = Number(process.env.MOCK_PAYSTACK_PORT ?? 4545);
  startMockPaystack(port).then(() => console.log(`Mock Paystack on http://localhost:${port} (secret key: ${MOCK_SECRET})`));
}
