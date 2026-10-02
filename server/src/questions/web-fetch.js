const dns = require('node:dns/promises');
const https = require('node:https');
const net = require('node:net');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execute = promisify(execFile);
const MAX_BYTES = 2 * 1024 * 1024;
const AGENT = 'TitleKakkoKariQuestionGenerator/1.0';

function publicAddress(address) {
  if (net.isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0)) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113) || (a === 192 && b === 88 && c === 99));
  }
  if (net.isIP(address) === 6) {
    // Only global unicast, excluding documentation, transition and mapped ranges.
    const value = address.toLowerCase();
    return /^[23][0-9a-f]{3}:/u.test(value) &&
      !(value.startsWith('2001:') && parseInt(value.split(':')[1] || '0',16) < 0x200) &&
      !/^2001:db8:|^2002:|^3fff:/u.test(value);
  }
  return false;
}

function publicUrl(value) {
  const url = new URL(value);
  const host = url.hostname.replace(/^\[|\]$/gu, '').toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
    !host.includes('.') || net.isIP(host) ||
    /(?:^|\.)(?:localhost|local|internal|test|invalid|example|onion)$/u.test(host)) {
    throw new Error('公開HTTPSサイトのURLを確認できません');
  }
  url.hash = '';
  return url;
}

async function resolvePublic(value, lookup = dns.lookup) {
  const url = publicUrl(value);
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((item) => !publicAddress(item.address))) {
    throw new Error('非公開ネットワークへの資料取得はできません');
  }
  return { url, address: addresses.find((item) => item.family === 4) || addresses[0] };
}

async function requestPage(url, address, signal) {
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
  if (proxy) {
    const marker = '\n__TITLE_WEB_RESPONSE__:';
    const destination = address.family === 6 ? `[${address.address}]` : address.address;
    const { stdout } = await execute('curl', [
      '--silent', '--show-error', '--compressed', '--max-time', '15', '--proto', '=https',
      '--max-redirs', '0', '--max-filesize', String(MAX_BYTES), '--user-agent', AGENT,
      '--connect-to', `${url.hostname}:443:${destination}:443`,
      '--write-out', `${marker}%{http_code}\n%header{location}\n%header{content-type}\n%header{retry-after}\n%header{x-robots-tag}`,
      url.href,
    ], { encoding: 'buffer', maxBuffer: MAX_BYTES + 4096, signal });
    const index = stdout.lastIndexOf(Buffer.from(marker));
    if (index < 0) throw new Error('Web資料の応答を確認できません');
    const [status, location, type, retry, robots] = stdout.subarray(index + marker.length).toString('utf8').split('\n');
    const headers = new Headers();
    for (const [key, val] of [['location', location], ['content-type', type], ['retry-after', retry], ['x-robots-tag', robots]]) {
      if (val) headers.set(key, val.trim());
    }
    return new Response(stdout.subarray(0, index), { status: Number(status), headers });
  }
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      agent: false, signal, headers: { 'User-Agent': AGENT, Accept: 'text/html,application/rss+xml' },
      // Pin the validated address; do not resolve again between validation and use.
      lookup: (_host, options, callback) => callback(null, options.all ? [address] : address.address, address.family),
    }, (response) => {
      const parts = [];
      let size = 0;
      response.on('data', (part) => {
        size += part.length;
        if (size > MAX_BYTES) request.destroy(new Error('Web資料が大きすぎます'));
        else parts.push(part);
      });
      response.on('error', reject);
      response.on('end', () => {
        try { resolve(new Response([204,205,304].includes(response.statusCode) ? null : Buffer.concat(parts), {
          status: response.statusCode, headers: response.headers,
        })); } catch (error) { reject(error); }
      });
    });
    request.on('error', reject);
  });
}

function createPublicFetch({ lookup = dns.lookup, requestImpl = requestPage } = {}) {
  return async (value, options = {}) => {
    const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000);
    let destination = value;
    for (let redirect = 0; redirect <= 3; redirect++) {
      signal.throwIfAborted();
      const { url, address } = await resolvePublic(destination, lookup);
      const response = await requestImpl(url, address, signal);
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location || redirect === 3) throw new Error('Web資料の転送先を確認できません');
        destination = new URL(location, url).href;
        continue;
      }
      const robots = response.headers.get('x-robots-tag') || '';
      if (/nosnippet|noarchive|noai|none|max-snippet\s*:\s*0/iu.test(robots)) throw new Error('資料サイトが本文の再利用を制限しています');
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > MAX_BYTES) throw new Error('Web資料が大きすぎます');
      const charset = response.headers.get('content-type')?.match(/charset=["']?([^\s;"']+)/iu)?.[1] || 'utf-8';
      let html;
      try { html = new TextDecoder(charset).decode(buffer); }
      catch { throw new Error('Web資料の文字コードを確認できません'); }
      const result = new Response(html, { status: response.status, headers: response.headers });
      Object.defineProperty(result, 'url', { value: url.href });
      return result;
    }
  };
}

module.exports = { createPublicFetch, publicUrl, publicAddress, resolvePublic, MAX_BYTES };
