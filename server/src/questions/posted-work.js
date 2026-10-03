// Public, author-written introduction of the exact posted work. Related works
// in the site's hydration data must never supply its title, synopsis or reach.
function postedWork(html, url, { text, metadata }) {
  const source = new URL(url);
  const id = source.hostname === 'kakuyomu.jp' && source.pathname.match(/^\/works\/(\d+)$/u)?.[1];
  if (!id) return null;
  const meta = metadata(html);
  if (meta['og:url'] !== `https://kakuyomu.jp/works/${id}`) return null;
  const script = html.match(/<script\b[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/iu);
  if (!script) return null;
  let data;
  try { data = JSON.parse(script[1]).props.pageProps.__APOLLO_STATE__; } catch { return null; }
  const work = data?.[`Work:${id}`];
  const author = data?.[work?.author?.__ref];
  const heading = text(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/iu)?.[1]);
  const compact = value => text(value).replace(/\s+/gu, '');
  if (work?.__typename !== 'Work' || work.id !== id || typeof work.title !== 'string' || heading !== text(work.title) ||
      typeof work.introduction !== 'string' || !compact(html).includes(compact(work.introduction)) ||
      author?.__typename !== 'UserAccount' || typeof author.activityName !== 'string' ||
      typeof author.isOfficialUser !== 'boolean' || typeof work.hasPublication !== 'boolean' ||
      work.fanFictionSource !== null || work.isSexual !== false) return null;
  const reach = { type: 'posted-work', platform: 'kakuyomu', official: author.isOfficialUser,
    published: work.hasPublication, reads: work.totalReadCount, followers: work.totalFollowers,
    reviewPoints: work.totalReviewPoint, adaptations: work.publicMediaFranchisedWorks?.totalCount };
  if (!['reads','followers','reviewPoints','adaptations'].every(key => Number.isSafeInteger(reach[key]) && reach[key] >= 0)) return null;
  return { name: text(work.title), description: work.introduction, author: author.activityName,
    workType: 'Book', genre: '小説', reach };
}

module.exports = { postedWork };
