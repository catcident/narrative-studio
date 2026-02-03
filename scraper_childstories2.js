/**
 * 그림 형제 동화 크롤링 (childstories.org) - 전체 목록
 * 실행: node scraper_childstories2.js
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const outputDir = path.join(__dirname, 'txt');

// childstories.org 정확한 URL로 업데이트
const stories = [
  { url: 'https://www.childstories.org/ko/the-frog-king-1821.html', title: '개구리왕자-그림형제' },
  { url: 'https://www.childstories.org/ko/cat-and-mouse-in-partnership-1822.html', title: '고양이와쥐-그림형제' },
  { url: 'https://www.childstories.org/ko/marys-child-1824.html', title: '성모마리아의아이-그림형제' },
  { url: 'https://www.childstories.org/ko/the-story-of-the-youth-who-went-forth-to-learn-what-fear-was-1825.html', title: '소름을배우러-그림형제' },
  { url: 'https://www.childstories.org/ko/the-wolf-and-the-seven-young-goats-1827.html', title: '늑대와일곱마리염소-그림형제' },
  { url: 'https://www.childstories.org/ko/trusty-john-1828.html', title: '충신요하네스-그림형제' },
  { url: 'https://www.childstories.org/ko/the-good-bargain-1829.html', title: '괜찮은거래-그림형제' },
  { url: 'https://www.childstories.org/ko/the-wonderful-musician-1830.html', title: '떠돌이악사-그림형제' },
  { url: 'https://www.childstories.org/ko/rapunzel-1831.html', title: '라푼첼-그림형제' },
  { url: 'https://www.childstories.org/ko/little-red-riding-hood-1832.html', title: '빨간모자-그림형제' },
  { url: 'https://www.childstories.org/ko/the-bremen-town-musicians-1833.html', title: '브레멘음악대-그림형제' },
  { url: 'https://www.childstories.org/ko/sleeping-beauty-1834.html', title: '장미공주-그림형제' },
  { url: 'https://www.childstories.org/ko/the-golden-key-1835.html', title: '황금열쇠-그림형제' },
  { url: 'https://www.childstories.org/ko/the-rose-1836.html', title: '장미-그림형제' },
  { url: 'https://www.childstories.org/ko/the-aged-mother-1837.html', title: '늙은엄마-그림형제' },
  // 추가 유명 동화들
  { url: 'https://www.childstories.org/ko/snow-white-1840.html', title: '백설공주-그림형제' },
  { url: 'https://www.childstories.org/ko/hansel-and-gretel-1843.html', title: '헨젤과그레텔-그림형제' },
  { url: 'https://www.childstories.org/ko/cinderella-1860.html', title: '신데렐라-그림형제' },
  { url: 'https://www.childstories.org/ko/rumpelstiltskin-1870.html', title: '룸펠슈틸츠킨-그림형제' },
];

async function scrapeStory(page, url, title) {
  try {
    console.log(`크롤링: ${title}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    const content = await page.evaluate(() => {
      const article = document.querySelector('article') ||
                      document.querySelector('.story') ||
                      document.querySelector('.content') ||
                      document.querySelector('main');

      if (article) {
        const removes = article.querySelectorAll('nav, .navigation, .ads, script, style, .share, .social, header, footer, .related, .sidebar');
        removes.forEach(el => el.remove());
        return article.innerText;
      }

      const paragraphs = document.querySelectorAll('p');
      let allText = '';
      paragraphs.forEach(p => {
        const text = p.innerText.trim();
        if (text.length > 20 && /[가-힣]/.test(text)) {
          allText += text + '\n\n';
        }
      });
      return allText;
    });

    const hasKorean = content && /[가-힣]/.test(content);

    if (content && content.length > 500 && hasKorean) {
      const safeTitle = title.replace(/[<>:"/\\|?*,]/g, '');
      const filePath = path.join(outputDir, `${safeTitle}.txt`);
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

  let success = 0;
  let fail = 0;
  let skip = 0;

  for (const story of stories) {
    const safeTitle = story.title.replace(/[<>:"/\\|?*,]/g, '');
    const filePath = path.join(outputDir, `${safeTitle}.txt`);

    if (fs.existsSync(filePath)) {
      console.log(`스킵: ${story.title}`);
      skip++;
      continue;
    }

    const result = await scrapeStory(page, story.url, story.title);
    if (result) success++;
    else fail++;

    await page.waitForTimeout(800);
  }

  await browser.close();

  console.log(`\n완료: 성공 ${success}, 실패 ${fail}, 스킵 ${skip}`);

  const files = fs.readdirSync(outputDir).filter(f => f.endsWith('.txt'));
  console.log(`총 ${files.length}개 파일`);
}

main().catch(console.error);
