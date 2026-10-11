const { randomBytes, scrypt, timingSafeEqual } = require('node:crypto');
const derive = require('node:util').promisify(scrypt);

function roomPassword(value = '') {
  if (typeof value !== 'string' || value.length > 64) throw new Error('パスワードは64文字以内で入力してください');
  return value;
}
async function hashRoomPassword(value) {
  const password = roomPassword(value);
  if (!password) return null;
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${(await derive(password, salt, 32)).toString('hex')}`;
}
async function verifyRoomPassword(hash, value) {
  const password = roomPassword(value);
  if (!hash) return true;
  const [salt, expected] = hash.split(':');
  return timingSafeEqual(Buffer.from(expected, 'hex'), await derive(password, salt, 32));
}
module.exports = { hashRoomPassword, verifyRoomPassword };
