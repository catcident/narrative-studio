/**
 * 그림 형제 동화 크롤링 (childstories.org)
 * 실행: node scraper_childstories.js
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const outputDir = path.join(__dirname, 'txt');

// childstories.org 한국어 그림 형제 동화
const stories = [
  { url: 'https://www.childstories.org/ko/little-red-riding-hood-1832.html', title: '빨간모자-그림형제' },
  { url: 'https://www.childstories.org/ko/rapunzel-1831.html', title: '라푼첼-그림형제' },
  { url: 'https://www.childstories.org/ko/marys-child-1824.html', title: '성모마리아의아이-그림형제' },
  { url: 'https://www.childstories.org/ko/the-frog-prince-1821.html', title: '개구리왕자-그림형제' },
  { url: 'https://www.childstories.org/ko/cat-and-mouse-in-partnership-1822.html', title: '고양이와쥐-그림형제' },
  { url: 'https://www.childstories.org/ko/the-wolf-and-the-seven-young-kids-1823.html', title: '늑대와일곱마리염소-그림형제' },
  { url: 'https://www.childstories.org/ko/faithful-john-1825.html', title: '충신요하네스-그림형제' },
  { url: 'https://www.childstories.org/ko/the-good-bargain-1826.html', title: '괜찮은거래-그림형제' },
  { url: 'https://www.childstories.org/ko/the-wonderful-musician-1827.html', title: '떠돌이악사-그림형제' },
  { url: 'https://www.childstories.org/ko/the-twelve-brothers-1828.html', title: '열두형제-그림형제' },
  { url: 'https://www.childstories.org/ko/the-pack-of-ragamuffins-1829.html', title: '불량배들-그림형제' },
  { url: 'https://www.childstories.org/ko/brother-and-sister-1830.html', title: '남매-그림형제' },
  { url: 'https://www.childstories.org/ko/the-three-spinsters-1833.html', title: '세명의물레잣는여자-그림형제' },
  { url: 'https://www.childstories.org/ko/hansel-and-gretel-1834.html', title: '헨젤과그레텔-그림형제' },
  { url: 'https://www.childstories.org/ko/the-bremen-town-musicians-1835.html', title: '브레멘음악대-그림형제' },
  { url: 'https://www.childstories.org/ko/the-golden-key-1836.html', title: '황금열쇠-그림형제' },
  { url: 'https://www.childstories.org/ko/the-rose-1837.html', title: '장미-그림형제' },
  { url: 'https://www.childstories.org/ko/snow-white-76.html', title: '백설공주-그림형제' },
  { url: 'https://www.childstories.org/ko/cinderella-21.html', title: '신데렐라-그림형제' },
  { url: 'https://www.childstories.org/ko/sleeping-beauty-53.html', title: '잠자는숲속의공주-그림형제' },
  { url: 'https://www.childstories.org/ko/rumpelstiltskin-55.html', title: '룸펠슈틸츠킨-그림형제' },
  { url: 'https://www.childstories.org/ko/the-brave-little-tailor-20.html', title: '용감한꼬마재봉사-그림형제' },
  { url: 'https://www.childstories.org/ko/tom-thumb-37.html', title: '엄지공주-그림형제' },
  { url: 'https://www.childstories.org/ko/the-golden-goose-64.html', title: '금거위-그림형제' },
  { url: 'https://www.childstories.org/ko/the-elves-and-the-shoemaker-39.html', title: '요정과구두장이-그림형제' },
];

async function scrapeStory(page, url, title) {
  try {
    console.log(`크롤링: ${title}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    await page.waitForTimeout(2000);

    const content = await page.evaluate(() => {
      // 본문 찾기
      const article = document.querySelector('article') ||
                      document.querySelector('.story') ||
                      document.querySelector('.content') ||
                      document.querySelector('main');

      if (article) {
        // 불필요한 요소 제거
        const removes = article.querySelectorAll('nav, .navigation, .ads, script, style, .share, .social, header, footer, .related, .sidebar');
        removes.forEach(el => el.remove());

        return article.innerText;
      }

      // fallback: 모든 p 태그
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
