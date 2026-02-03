/**
 * 그림 형제 동화 크롤링 (grimmstories.com)
 * 실행: node scraper_grimm.js
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const outputDir = path.join(__dirname, 'txt');

async function getAllStoryLinks(page) {
  console.log('동화 목록 가져오는 중...');
  await page.goto('https://www.grimmstories.com/ko/grimm_donghwa/list', { waitUntil: 'domcontentloaded', timeout: 30000 });

  const links = await page.evaluate(() => {
    const anchors = document.querySelectorAll('a[href*="/ko/grimm_donghwa/"]');
    const results = [];

    anchors.forEach(a => {
      const href = a.getAttribute('href');
      const title = a.innerText.trim();

      // 목록 페이지나 인덱스가 아닌 실제 동화 링크만
      if (href && title &&
          !href.includes('/list') &&
          !href.includes('/index') &&
          !href.includes('/favorites') &&
          !href.includes('/search') &&
          title.length > 1) {
        const fullUrl = href.startsWith('http') ? href : 'https://www.grimmstories.com' + href;
        results.push({ url: fullUrl, title });
      }
    });

    // 중복 제거
    const seen = new Set();
    return results.filter(item => {
      if (seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    });
  });

  console.log(`${links.length}개 동화 링크 발견`);
  return links;
}

async function scrapeStory(page, url, title) {
  try {
    console.log(`크롤링: ${title}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    const content = await page.evaluate(() => {
      // 본문 찾기
      const article = document.querySelector('article') ||
                      document.querySelector('.story-content') ||
                      document.querySelector('.content') ||
                      document.querySelector('main');

      if (!article) return null;

      // 불필요한 요소 제거
      const removes = article.querySelectorAll('nav, .navigation, .ads, script, style, .share, .social, header, footer');
      removes.forEach(el => el.remove());

      return article.innerText;
    });

    // 한글이 포함되어 있는지 확인
    const hasKorean = content && /[가-힣]/.test(content);

    if (content && content.length > 500 && hasKorean) {
      // 파일명 생성
      const safeTitle = title.replace(/[<>:"/\\|?*,]/g, '').replace(/\s+/g, '');
      const filePath = path.join(outputDir, `${safeTitle}-그림형제.txt`);
      fs.writeFileSync(filePath, content.trim(), 'utf-8');
      console.log(`  ✓ ${content.length}자`);
      return true;
    } else {
      console.log(`  ✗ 내용 부족 (${content?.length || 0}자)`);
      return false;
    }
  } catch (err) {
    console.log(`  ✗ 에러: ${err.message}`);
    return false;
  }
}

async function main() {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // 먼저 동화 목록 가져오기
  const stories = await getAllStoryLinks(page);

  let success = 0;
  let fail = 0;
  let skip = 0;

  for (const story of stories) {
    const safeTitle = story.title.replace(/[<>:"/\\|?*,]/g, '').replace(/\s+/g, '');
    const filePath = path.join(outputDir, `${safeTitle}-그림형제.txt`);

    if (fs.existsSync(filePath)) {
      skip++;
      continue;
    }

    const result = await scrapeStory(page, story.url, story.title);
    if (result) success++;
    else fail++;

    await page.waitForTimeout(500);
  }

  await browser.close();

  console.log(`\n완료: 성공 ${success}, 실패 ${fail}, 스킵 ${skip}`);

  const files = fs.readdirSync(outputDir).filter(f => f.endsWith('.txt'));
  console.log(`총 ${files.length}개 파일`);
}

main().catch(console.error);
