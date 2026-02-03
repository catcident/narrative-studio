/**
 * 그림 형제 동화 크롤링 (grimmstories.com) - 대기 추가
 * 실행: node scraper_grimm2.js
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const outputDir = path.join(__dirname, 'txt');

// 수동으로 유명한 동화 URL 목록
const stories = [
  { url: 'https://www.grimmstories.com/ko/grimm_donghwa/baekseolgongju', title: '백설공주' },
  { url: 'https://www.grimmstories.com/ko/grimm_donghwa/rapunzel', title: '라푼첼' },
  { url: 'https://www.grimmstories.com/ko/grimm_donghwa/ppalgan_moja', title: '빨간모자' },
  { url: 'https://www.grimmstories.com/ko/grimm_donghwa/bremen_eumakdae', title: '브레멘음악대' },
  { url: 'https://www.grimmstories.com/ko/grimm_donghwa/henseulgwa_geuretel', title: '헨젤과그레텔' },
  { url: 'https://www.grimmstories.com/ko/grimm_donghwa/sinderella', title: '신데렐라' },
  { url: 'https://www.grimmstories.com/ko/grimm_donghwa/jamjaneun_gongjunim', title: '잠자는숲속의공주' },
  { url: 'https://www.grimmstories.com/ko/grimm_donghwa/gaeguri_wang', title: '개구리왕자' },
  { url: 'https://www.grimmstories.com/ko/grimm_donghwa/neukdaewa_ilgop_mari_saekki_yeomso', title: '늑대와일곱마리새끼염소' },
  { url: 'https://www.grimmstories.com/ko/grimm_donghwa/rumpelstiltskin', title: '룸펠슈틸츠킨' },
  { url: 'https://www.grimmstories.com/ko/grimm_donghwa/noginne', title: '노인과바다' },
];

async function scrapeStory(page, url, title) {
  try {
    console.log(`크롤링: ${title}`);
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });

    // 자바스크립트 로딩 대기
    await page.waitForTimeout(3000);

    const content = await page.evaluate(() => {
      // 다양한 셀렉터 시도
      const selectors = [
        '.story-text',
        '.fairytale-text',
        '.tale-content',
        '#story-content',
        'article .content',
        '.main-content p',
        'main p',
        '.story p'
      ];

      for (const selector of selectors) {
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
          let text = '';
          elements.forEach(el => text += el.innerText + '\n');
          if (text.length > 100) return text;
        }
      }

      // 그냥 모든 p 태그
      const paragraphs = document.querySelectorAll('p');
      let allText = '';
      paragraphs.forEach(p => {
        if (p.innerText.length > 20) {
          allText += p.innerText + '\n\n';
        }
      });

      return allText;
    });

    const hasKorean = content && /[가-힣]/.test(content);

    if (content && content.length > 500 && hasKorean) {
      const safeTitle = title.replace(/[<>:"/\\|?*,]/g, '').replace(/\s+/g, '');
      const filePath = path.join(outputDir, `${safeTitle}-그림형제.txt`);
      fs.writeFileSync(filePath, content.trim(), 'utf-8');
      console.log(`  ✓ ${content.length}자`);
      return true;
    } else {
      console.log(`  ✗ 내용 부족 (${content?.length || 0}자)`);

      // 디버깅: 페이지 HTML 일부 출력
      const html = await page.content();
      console.log(`  페이지 길이: ${html.length}자`);
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

  for (const story of stories) {
    const result = await scrapeStory(page, story.url, story.title);
    if (result) success++;
    else fail++;

    await page.waitForTimeout(1000);
  }

  await browser.close();

  console.log(`\n완료: 성공 ${success}, 실패 ${fail}`);
}

main().catch(console.error);
