// Shared by every source and saved-question preparation. A sequel cannot be
// renamed to its first work: discard it. Edition/serialization metadata can be
// removed while retaining the source title as an alias for masking.
const BOOK_KINDS = new Set(['novel', 'short-story', 'literary-work', 'manga', 'poem', 'nonfiction', 'play']);
const NUMBER = '[0-9一二三四五六七八九十百千壱弐参]+';
const EDITION = '(?:(?:4K|HD|デジタル)\\s*)?(?:リマスター(?:版)?|オリジナル版|通常版|限定版|新装版|改訂(?:増補)?版|増補版|完全版|愛蔵版|文庫版|新訳版|新版|復刻版|電子書籍版|電子版|デジタル版|remaster(?:ed)?(?:\\s+edition)?|(?:original|standard|deluxe|definitive)\\s+edition)';
const EDITION_SUFFIX = new RegExp(`(?:\\s*[-–—:：]\\s*)?\\s*(?:[([【]\\s*)?${EDITION}\\s*[)\\]】]?$`, 'iu');
const EDITION_LABEL = new RegExp(`^[【\\[]\\s*${EDITION}\\s*[】\\]]\\s*`, 'iu');
const VOLUME_SUFFIX = new RegExp(`\\s*(?:[([]\\s*)?(?:第\\s*)?${NUMBER}\\s*(?:巻|話|集)\\s*[)\\]]?$`, 'u');
const SERIAL_EDITION = /\s*(?:[([]\s*)?(?:分冊版|単話版|単行本版)\s*[)\]]?$/u;
const MANGA_NUMBER = /\s*(?:\([0-9]+\)|\[[0-9]+\]|\s+[0-9]+)$/u;

function playableTitle(value, kind) {
  if (typeof value !== 'string') return null;
  let title = value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  // Labels and volume/edition suffixes can be stacked in either order.
  for (let i = 0; i < 8; i++) {
    const previous = title;
    title = title.replace(EDITION_LABEL, '').replace(EDITION_SUFFIX, '').trim();
    if (BOOK_KINDS.has(kind)) title = title.replace(VOLUME_SUFFIX, '').replace(SERIAL_EDITION, '').trim();
    if (kind === 'manga') title = title.replace(MANGA_NUMBER, '').trim();
    if (title === previous) break;
  }
  if (!title) return null;
  // A numeric work name/year is not a sequel number. Numbers inside a phrase,
  // such as 秒速5センチメートル, are also retained. Suffix/segment numbers are
  // deliberately conservative: no inference that a numbered sequel is part 1.
  if (!/^[0-9]+$/u.test(title) && /[^0-9][0-9]{1,3}(?=$|[\s:：・–—-]|\)$)/u.test(title)) return null;
  if (/[^A-Za-z0-9](?:[IVXLCDM]{2,8}|[IVX])(?=$|[^A-Za-z0-9])/u.test(title)) return null;
  if (new RegExp(`\\S\\s+${NUMBER}(?=$|[\\s:：・–—-])`, 'u').test(title)) return null;
  if (new RegExp(`(?:第\\s*${NUMBER}\\s*(?:部|章|篇|編|話)|(?:PART|VOL(?:UME)?)[.\\s]*[0-9IVXLCDM]+)(?=$|[^A-Za-z0-9])`, 'iu').test(title)) return null;
  if (/(?:前|中|後|完結|戦前|戦後)(?:編|篇)(?=$|[\s:：・–—)\]-])|(?:^|\s)続々?(?:[\s・:：–—-])/u.test(title)) return null;
  return title;
}

function requirePlayableTitle(value, kind) {
  const title = playableTitle(value, kind);
  if (!title) throw new Error('番号付きの続編・部編区分を含む題名は出題対象外です');
  return title;
}

module.exports = { playableTitle, requirePlayableTitle };
