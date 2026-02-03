const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const txtDir = path.join(__dirname, 'txt');

// 더 많은 위키문헌 페이지들
const moreNovels = [
  // 김동인 작품
  { url: 'https://ko.wikisource.org/wiki/%EB%B0%B0%EB%94%B0%EB%9D%BC%EA%B8%B0', name: '배따라기-김동인' },
  { url: 'https://ko.wikisource.org/wiki/%EA%B4%91%ED%99%94%EC%82%AC', name: '광화사-김동인' },

  // 이효석 작품
  { url: 'https://ko.wikisource.org/wiki/%EB%B6%84%EB%85%80_(%EC%9D%B4%ED%9A%A8%EC%84%9D)', name: '분녀-이효석' },

  // 나도향 작품
  { url: 'https://ko.wikisource.org/wiki/%EB%AC%BC%EB%A0%88%EB%B0%A9%EC%95%84', name: '물레방아-나도향' },
  { url: 'https://ko.wikisource.org/wiki/%EB%B2%99%EC%96%B4%EB%A6%AC_%EC%82%BC%EB%A3%A1%EC%9D%B4', name: '벙어리삼룡이-나도향' },

  // 이광수 작품
  { url: 'https://ko.wikisource.org/wiki/%EB%AC%B4%EC%A0%95_(%EC%86%8C%EC%84%A4)', name: '무정-이광수' },

  // 염상섭 작품
  { url: 'https://ko.wikisource.org/wiki/%ED%91%9C%EB%B3%B8%EC%8B%A4%EC%9D%98_%EC%B2%AD%EA%B0%9C%EA%B5%AC%EB%A6%AC', name: '표본실의청개구리-염상섭' },

  // 현진건 작품
  { url: 'https://ko.wikisource.org/wiki/B%EC%82%AC%EA%B0%90%EA%B3%BC_%EB%9F%AC%EB%B8%8C%EB%A0%88%ED%84%B0', name: 'B사감과러브레터-현진건' },
  { url: 'https://ko.wikisource.org/wiki/%EA%B3%A0%ED%96%A5', name: '고향-현진건' },
  { url: 'https://ko.wikisource.org/wiki/%EC%88%A0_%EA%B6%8C%ED%95%98%EB%8A%94_%EC%82%AC%ED%9A%8C', name: '술권하는사회-현진건' },

  // 채만식 작품
  { url: 'https://ko.wikisource.org/wiki/%EC%B9%98%EC%88%99_(%EC%86%8C%EC%84%A4)', name: '치숙-채만식' },

  // 최서해 작품
  { url: 'https://ko.wikisource.org/wiki/%ED%83%88%EC%B6%9C%EA%B8%B0', name: '탈출기-최서해' },

  // 고전소설
  { url: 'https://ko.wikisource.org/wiki/%EC%A0%84%EC%9A%B0%EC%B9%98%EC%A0%84', name: '전우치전-작자미상' },
  { url: 'https://ko.wikisource.org/wiki/%EC%9E%A5%EB%81%BC%EC%A0%84', name: '장끼전-작자미상' },
  { url: 'https://ko.wikisource.org/wiki/%EC%9D%B4%EC%B6%98%ED%92%8D%EC%A0%84', name: '이춘풍전-작자미상' },
  { url: 'https://ko.wikisource.org/wiki/%EB%B0%95%EC%94%A8%EC%A0%84', name: '박씨전-작자미상' },
  { url: 'https://ko.wikisource.org/wiki/%EC%82%AC%EC%94%A8%EB%82%A8%EC%A0%95%EA%B8%B0', name: '사씨남정기-김만중' },

  // 외국 소설 번역
  { url: 'https://ko.wikisource.org/wiki/%EC%95%88%EB%82%98_%EC%B9%B4%EB%A0%88%EB%8B%88%EB%82%98', name: '안나카레니나-톨스토이' },
  { url: 'https://ko.wikisource.org/wiki/%EC%A3%84%EC%99%80_%EB%B2%8C', name: '죄와벌-도스토예프스키' },
];

async function scrapeWikisource(browser, novel) {
  const page = await browser.newPage();
  try {
    // 이미 존재하면 스킵
    const filePath = path.join(txtDir, `${novel.name}.txt`);
    if (fs.existsSync(filePath)) {
      console.log(`Skipped (exists): ${novel.name}`);
      return true;
    }

    console.log(`Scraping: ${novel.name}`);
    await page.goto(novel.url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    const content = await page.evaluate(() => {
      const article = document.querySelector('.mw-parser-output');
      if (!article) return null;

      const toRemove = article.querySelectorAll('.toc, .mw-editsection, .navbox, .catlinks, script, style, .reference, .noprint');
      toRemove.forEach(el => el.remove());

      return article.innerText;
    });

    if (content && content.length > 500) {
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`  Saved: ${novel.name} (${content.length} chars)`);
      return true;
    } else {
      console.log(`  Skipped: ${novel.name} (too short or empty)`);
      return false;
    }
  } catch (err) {
    console.log(`  Error: ${novel.name} - ${err.message}`);
    return false;
  } finally {
    await page.close();
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true });

  console.log('=== 추가 소설 수집 ===');
  for (const novel of moreNovels) {
    await scrapeWikisource(browser, novel);
    await new Promise(r => setTimeout(r, 1000));
  }

  await browser.close();

  const files = fs.readdirSync(txtDir);
  console.log(`\n=== 완료: 총 ${files.length}개 파일 ===`);
  files.sort().forEach(f => {
    const stats = fs.statSync(path.join(txtDir, f));
    console.log(`  - ${f} (${Math.round(stats.size/1024)}KB)`);
  });
}

main().catch(console.error);
