const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const txtDir = path.join(__dirname, 'txt');
if (!fs.existsSync(txtDir)) {
  fs.mkdirSync(txtDir, { recursive: true });
}

// 위키문헌 소설 목록
const wikisourceNovels = [
  { url: 'https://ko.wikisource.org/wiki/%EC%9A%B4%EC%88%98_%EC%A2%8B%EC%9D%80_%EB%82%A0', name: '운수좋은날-현진건' },
  { url: 'https://ko.wikisource.org/wiki/%EB%82%A0%EA%B0%9C_(%EC%9D%B4%EC%83%81)', name: '날개-이상' },
  { url: 'https://ko.wikisource.org/wiki/%EB%A9%94%EB%B0%80%EA%BD%83_%ED%95%84_%EB%AC%B4%EB%A0%B5', name: '메밀꽃필무렵-이효석' },
  { url: 'https://ko.wikisource.org/wiki/%EB%8F%99%EB%B0%B1%EA%BD%83_(%EA%B9%80%EC%9C%A0%EC%A0%95)', name: '동백꽃-김유정' },
  { url: 'https://ko.wikisource.org/wiki/%EB%B4%84%EB%B4%84', name: '봄봄-김유정' },
  { url: 'https://ko.wikisource.org/wiki/%EC%86%8C%EB%82%98%EA%B8%B0_(%ED%99%A9%EC%88%9C%EC%9B%90)', name: '소나기-황순원' },
  { url: 'https://ko.wikisource.org/wiki/%EA%B4%91%EC%9E%A5_(%EC%B5%9C%EC%9D%B8%ED%9B%88)', name: '광장-최인훈' },
  { url: 'https://ko.wikisource.org/wiki/%EC%82%AC%EB%9E%91%EC%86%90%EB%8B%98%EA%B3%BC_%EC%96%B4%EB%A8%B8%EB%8B%88', name: '사랑손님과어머니-주요섭' },
  { url: 'https://ko.wikisource.org/wiki/%EB%B9%88%EC%B2%98', name: '빈처-현진건' },
  { url: 'https://ko.wikisource.org/wiki/%EB%A0%88%EB%94%94%EB%A9%94%EC%9D%B4%EB%93%9C_%EC%9D%B8%EC%83%9D', name: '레디메이드인생-채만식' },
  { url: 'https://ko.wikisource.org/wiki/%ED%83%9C%ED%8F%89%EC%B2%9C%ED%95%98_(%EB%B0%95%ED%83%9C%EC%9B%90)', name: '태평천하-채만식' },
  { url: 'https://ko.wikisource.org/wiki/%EB%82%98%EB%AC%B4%EB%93%A4_%EB%B9%84%ED%83%88%EC%97%90_%EC%84%9C%EB%8B%A4', name: '나무들비탈에서다-황순원' },
  { url: 'https://ko.wikisource.org/wiki/%EA%B0%90%EC%9E%90_(%EA%B9%80%EB%8F%99%EC%9D%B8)', name: '감자-김동인' },
  { url: 'https://ko.wikisource.org/wiki/%EB%B0%B0%EB%94%B0%EB%9D%BC%EA%B8%B0_%EA%BD%83', name: '배따라기-김동인' },
  { url: 'https://ko.wikisource.org/wiki/%EA%B4%91%EC%97%BC%EC%86%8C%EB%82%98%ED%83%80', name: '광염소나타-김동인' },
];

// 고전소설 목록
const classicNovels = [
  { url: 'https://ko.wikisource.org/wiki/%EC%B6%98%ED%96%A5%EC%A0%84', name: '춘향전-작자미상' },
  { url: 'https://ko.wikisource.org/wiki/%ED%99%8D%EA%B8%B8%EB%8F%99%EC%A0%84', name: '홍길동전-허균' },
  { url: 'https://ko.wikisource.org/wiki/%EC%8B%AC%EC%B2%AD%EC%A0%84', name: '심청전-작자미상' },
  { url: 'https://ko.wikisource.org/wiki/%ED%86%A0%EB%81%BC%EC%A0%84', name: '토끼전-작자미상' },
  { url: 'https://ko.wikisource.org/wiki/%EA%B5%AC%EC%9A%B4%EB%AA%BD', name: '구운몽-김만중' },
  { url: 'https://ko.wikisource.org/wiki/%ED%9D%A5%EB%B6%80%EC%A0%84', name: '흥부전-작자미상' },
  { url: 'https://ko.wikisource.org/wiki/%EC%9E%A5%ED%99%94%ED%99%8D%EB%A0%A8%EC%A0%84', name: '장화홍련전-작자미상' },
];

// 외국소설 번역본 (퍼블릭 도메인)
const foreignNovels = [
  { url: 'https://ko.wikisource.org/wiki/%EB%B3%80%EC%8B%A0_(%EC%86%8C%EC%84%A4)', name: '변신-카프카' },
  { url: 'https://ko.wikisource.org/wiki/%ED%81%AC%EB%A6%AC%EC%8A%A4%EB%A7%88%EC%8A%A4_%EC%BA%90%EB%9F%B4', name: '크리스마스캐롤-디킨스' },
];

async function scrapeWikisource(browser, novel) {
  const page = await browser.newPage();
  try {
    console.log(`Scraping: ${novel.name}`);
    await page.goto(novel.url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // 본문 텍스트 추출
    const content = await page.evaluate(() => {
      const article = document.querySelector('.mw-parser-output');
      if (!article) return null;

      // 불필요한 요소 제거
      const toRemove = article.querySelectorAll('.toc, .mw-editsection, .navbox, .catlinks, script, style, .reference');
      toRemove.forEach(el => el.remove());

      return article.innerText;
    });

    if (content && content.length > 500) {
      const filePath = path.join(txtDir, `${novel.name}.txt`);
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

  console.log('=== 한국 근현대 단편소설 ===');
  for (const novel of wikisourceNovels) {
    await scrapeWikisource(browser, novel);
    await new Promise(r => setTimeout(r, 1000)); // 1초 대기
  }

  console.log('\n=== 한국 고전소설 ===');
  for (const novel of classicNovels) {
    await scrapeWikisource(browser, novel);
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log('\n=== 외국 소설 번역본 ===');
  for (const novel of foreignNovels) {
    await scrapeWikisource(browser, novel);
    await new Promise(r => setTimeout(r, 1000));
  }

  await browser.close();

  // 결과 확인
  const files = fs.readdirSync(txtDir);
  console.log(`\n=== 완료: ${files.length}개 파일 저장 ===`);
  files.forEach(f => console.log(`  - ${f}`));
}

main().catch(console.error);
