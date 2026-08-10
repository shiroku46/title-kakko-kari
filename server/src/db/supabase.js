const https = require('node:https');
const { createClient } = require('@supabase/supabase-js');

const rawSupabaseUrl = process.env.SUPABASE_URL?.trim();
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!rawSupabaseUrl || !serviceRoleKey) {
  throw new Error('.env に SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY を設定してください');
}

let supabaseBaseUrl;
try {
  supabaseBaseUrl = new URL(rawSupabaseUrl);
} catch {
  throw new Error('SUPABASE_URL の設定が不正です');
}

if (
  supabaseBaseUrl.protocol !== 'https:' ||
  supabaseBaseUrl.username ||
  supabaseBaseUrl.password
) {
  throw new Error('SUPABASE_URL は認証情報を含まない HTTPS URL である必要があります');
}

const supabaseOrigin = supabaseBaseUrl.origin;

function wrapSupabaseNetworkError(error) {
  const wrapped = new Error('Supabase network request failed', { cause: error });
  wrapped.name = 'SupabaseNetworkError';
  if (error && typeof error === 'object' && typeof error.code === 'string') {
    wrapped.code = error.code;
  }
  return wrapped;
}

async function supabaseFetch(input, init) {
  const request = new Request(input, init);
  const target = new URL(request.url);

  if (target.protocol !== 'https:' || target.origin !== supabaseOrigin) {
    throw new Error('Supabase request target is outside the configured HTTPS origin');
  }

  const body = request.body ? Buffer.from(await request.arrayBuffer()) : undefined;

  return new Promise((resolve, reject) => {
    const outgoing = https.request(
      target,
      {
        method: request.method,
        headers: Object.fromEntries(request.headers.entries()),
        family: 4,
        signal: request.signal
      },
      (incoming) => {
        const chunks = [];

        incoming.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        incoming.on('error', (error) => reject(wrapSupabaseNetworkError(error)));
        incoming.on('end', () => {
          const headers = new Headers();
          for (let index = 0; index < incoming.rawHeaders.length; index += 2) {
            headers.append(incoming.rawHeaders[index], incoming.rawHeaders[index + 1]);
          }

          const status = incoming.statusCode ?? 500;
          if (status >= 300 && status < 400 && headers.has('location')) {
            reject(new Error('Supabase request returned an unexpected redirect'));
            return;
          }

          resolve(
            new Response(Buffer.concat(chunks), {
              status,
              statusText: incoming.statusMessage || '',
              headers
            })
          );
        });
      }
    );

    outgoing.on('error', (error) => reject(wrapSupabaseNetworkError(error)));
    if (body) {
      outgoing.end(body);
    } else {
      outgoing.end();
    }
  });
}

// service_role キーを使用（RLS をバイパスしてサーバーから直接操作できる）
// Supabase 通信だけを IPv4 に固定し、一般 fetch / Socket.IO のネットワーク挙動は変更しない。
const supabase = createClient(rawSupabaseUrl, serviceRoleKey, {
  global: {
    fetch: supabaseFetch
  }
});

module.exports = supabase;