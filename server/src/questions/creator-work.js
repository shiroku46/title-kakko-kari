// Provider-specific identity checks for public creator works. These adapt the
// page's own data, never a search hint or another work's recommendation card.
function container(html, predicate, { attributes } = {}) {
  for (const opening of html.matchAll(/<(div|section|article)\b([^>]*)>/giu)) {
    if (!predicate(attributes(opening[2]))) continue;
    const start = opening.index + opening[0].length;
    const tags = new RegExp(`<\\/?${opening[1]}\\b[^>]*>`, 'giu');
    tags.lastIndex = start;
    let depth = 1, closing;
    while ((closing = tags.exec(html))) {
      depth += closing[0].startsWith('</') ? -1 : 1;
      if (!depth) break;
    }
    if (closing && closing.index - start <= 40000) return html.slice(start, closing.index);
  }
  return '';
}

const ORIGINAL_COMIC = /一次創作|自創作|創作(?:漫画|マンガ|コミック|BL|百合)|オリジナル.{0,12}(?:漫画|マンガ|コミック)/iu;
function creatorWork(html, url, helpers) {
  const { text, attributes, metadata, introductionMarkup } = helpers;
  const source = new URL(url), meta = metadata(html);
  if (meta['og:url'] !== url) return null;
  if (source.hostname === 'booth.pm' && /^\/ja\/items\/\d+$/u.test(source.pathname)) {
    const id = source.pathname.split('/').at(-1);
    const identity = [...html.matchAll(/<div\b([^>]*)>/giu)].map(m => attributes(m[1]))
      .filter(a => a['data-tracking'] === 'detail_item' && a['data-product-id'] === id);
    if (identity.length !== 1 || identity[0]['data-product-category'] !== '56') return null;
    const name = text(identity[0]['data-product-name']);
    const headings = [...html.matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/giu)].map(m => text(m[1]));
    if (!name || !headings.includes(name)) return null;
    const description = container(html, a => /\bjs-market-item-detail-description\b/u.test(a.class || ''), helpers);
    const introduction = text(description);
    if (!ORIGINAL_COMIC.test(introduction) || /二次創作|ファン(?:フィクション|作品)|商業(?:出版|漫画雑誌)|R[-－]?18|成人向け/iu.test(introduction)) return null;
    for (const script of [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/giu)].slice(0,100)) {
      if (attributes(script[1]).type !== 'application/ld+json') continue;
      let product;
      try { product = JSON.parse(script[2]); } catch { continue; }
      const brand = product?.brand;
      if (product?.['@type'] !== 'Product' || product.url !== url || text(product.name) !== name ||
          typeof product.description !== 'string' || !introduction.replace(/\s+/gu,'').includes(text(product.description).replace(/\s+/gu,'')) ||
          typeof brand?.url !== 'string' || !brand.name) continue;
      let shop;
      try { shop = new URL(brand.url); } catch { continue; }
      if (shop.protocol !== 'https:' || shop.hostname !== `${identity[0]['data-product-brand']}.booth.pm` ||
          !text(html).includes(text(brand.name))) continue;
      const original = introduction.split(/\n|(?<=[。!?！？])/u).find(s => ORIGINAL_COMIC.test(s))?.trim();
      return { name, workType: 'Book', genre: '漫画', author: text(brand.name),
        description: introduction, aggregateRating: product.aggregateRating, method: 'creator-work',
        reach: { type: 'creator-work', platform: 'booth', creator: text(brand.name), excerpt: original } };
    }
    return null;
  }
  if (source.hostname === 'motion-gallery.net' && /^\/projects\/[\w-]+$/u.test(source.pathname)) {
    const heading = text(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/iu)?.[1]);
    const quoted = [...heading.matchAll(/[『「]([^』」]+)[』」]/gu)];
    // A single named film must also be identified as that film in the project
    // body. A quoted venue/event/project name does not pass this check.
    if (quoted.length !== 1) return null;
    const name = quoted[0][1];
    const body = container(html, a => a.id === 'project-description', helpers);
    const own = introductionMarkup(body);
    if (!own || ![...text(own).matchAll(/映画\s*[『「]([^』」]+)[』」]/gu)].some(m => m[1] === name)) return null;
    return { name, workType: 'Movie', method: 'creator-work', markup: own };
  }
  return null;
}

module.exports = { creatorWork, container, ORIGINAL_COMIC };
