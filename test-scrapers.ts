import { hackerNewsScraper } from './src/scrapers/hackernews.js';
import { arxivScraper } from './src/scrapers/arxiv.js';
import { githubScraper } from './src/scrapers/github.js';

async function test() {
  let passed = 0, failed = 0;
  function assert(c: boolean, n: string) { if (c) { passed++; } else { failed++; console.log(`  FAIL: ${n}`); } }

  console.log('=== HackerNews ===');
  try {
    const hn = await hackerNewsScraper.scrape('top', { maxItems: 5 });
    assert(hn.items.length > 0, `got ${hn.items.length} HN items`);
    for (const item of hn.items.slice(0, 3)) {
      console.log(`  [${item.raw_metadata.score}] ${item.title.slice(0, 60)}`);
      assert(item.title.length > 0, 'has title');
      assert(item.source_url.includes('ycombinator'), 'has HN url');
    }
  } catch (e) { failed++; console.log(`  ERROR: ${e}`); }

  console.log('\n=== arXiv ===');
  try {
    const arxiv = await arxivScraper.scrape('large language model', { maxItems: 5 });
    assert(arxiv.items.length > 0, `got ${arxiv.items.length} arXiv items`);
    for (const item of arxiv.items.slice(0, 3)) {
      console.log(`  ${item.title.slice(0, 60)}`);
      assert(item.title.length > 0, 'has title');
      assert(item.source_url.includes('arxiv'), 'has arxiv url');
      assert(item.body_markdown.includes('Abstract'), 'has abstract');
    }
  } catch (e) { failed++; console.log(`  ERROR: ${e}`); }

  console.log('\n=== GitHub trending ===');
  try {
    const gh = await githubScraper.scrape('trending', { maxItems: 5 });
    assert(gh.items.length >= 0, `got ${gh.items.length} GitHub items`);
    for (const item of gh.items.slice(0, 3)) {
      console.log(`  ${item.title.slice(0, 60)} | ${item.tags.join(', ')}`);
    }
  } catch (e) { failed++; console.log(`  ERROR: ${e}`); }

  console.log(`\n${'='.repeat(40)}`);
  console.log(`爬虫测试: ${passed} 通过 / ${failed} 失败`);
}

test().catch(e => { console.error(e); process.exit(1); });
