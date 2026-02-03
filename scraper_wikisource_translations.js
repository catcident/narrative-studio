/**
 * 위키문헌 번역 소설 크롤링
 * 실행: node scraper_wikisource_translations.js
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const outputDir = path.join(__dirname, 'txt');

// 위키문헌 번역 소설 목록 (번역: 네임스페이스)
const novels = [
  // 장편 소설
  { url: 'https://ko.wikisource.org/wiki/번역:로빈슨_크루소', title: '로빈슨크루소-대니얼디포' },
  { url: 'https://ko.wikisource.org/wiki/번역:톰_소여의_모험', title: '톰소여의모험-마크트웨인' },
  { url: 'https://ko.wikisource.org/wiki/번역:빨간머리_앤', title: '빨간머리앤-루시모드몽고메리' },
  { url: 'https://ko.wikisource.org/wiki/번역:소공녀', title: '소공녀-프랜시스호지슨버넷' },
  { url: 'https://ko.wikisource.org/wiki/번역:소공자', title: '소공자-프랜시스호지슨버넷' },
  { url: 'https://ko.wikisource.org/wiki/번역:비밀의_화원', title: '비밀의화원-프랜시스호지슨버넷' },
  { url: 'https://ko.wikisource.org/wiki/번역:오즈의_마법사', title: '오즈의마법사-라이먼프랭크바움' },
  { url: 'https://ko.wikisource.org/wiki/번역:피터와_웬디', title: '피터팬-제임스매튜배리' },
  { url: 'https://ko.wikisource.org/wiki/번역:하이디', title: '하이디-요한나스피리' },
  { url: 'https://ko.wikisource.org/wiki/번역:폴리아나', title: '폴리아나-엘리너포터' },
  { url: 'https://ko.wikisource.org/wiki/번역:지킬과_하이드', title: '지킬박사와하이드-스티븐슨' },
  { url: 'https://ko.wikisource.org/wiki/번역:보물섬', title: '보물섬-스티븐슨' },
  { url: 'https://ko.wikisource.org/wiki/번역:아르센_루팡', title: '아르센루팡-모리스르블랑' },
  { url: 'https://ko.wikisource.org/wiki/번역:물의_아이들', title: '물의아이들-찰스킹슬리' },
  { url: 'https://ko.wikisource.org/wiki/번역:전쟁과_평화', title: '전쟁과평화-톨스토이' },
  { url: 'https://ko.wikisource.org/wiki/번역:허클베리_핀의_모험', title: '허클베리핀의모험-마크트웨인' },
  { url: 'https://ko.wikisource.org/wiki/번역:80일간의_세계일주', title: '80일간의세계일주-쥘베른' },
  { url: 'https://ko.wikisource.org/wiki/번역:해저_2만리', title: '해저2만리-쥘베른' },
  { url: 'https://ko.wikisource.org/wiki/번역:15소년_표류기', title: '15소년표류기-쥘베른' },
  { url: 'https://ko.wikisource.org/wiki/번역:크리스마스_캐럴', title: '크리스마스캐럴-찰스디킨스' },
  { url: 'https://ko.wikisource.org/wiki/번역:올리버_트위스트', title: '올리버트위스트-찰스디킨스' },
  { url: 'https://ko.wikisource.org/wiki/번역:두_도시_이야기', title: '두도시이야기-찰스디킨스' },
  { url: 'https://ko.wikisource.org/wiki/번역:위대한_유산', title: '위대한유산-찰스디킨스' },
  { url: 'https://ko.wikisource.org/wiki/번역:프랑켄슈타인', title: '프랑켄슈타인-메리셸리' },
  { url: 'https://ko.wikisource.org/wiki/번역:드라큘라', title: '드라큘라-브램스토커' },
  { url: 'https://ko.wikisource.org/wiki/번역:오만과_편견', title: '오만과편견-제인오스틴' },
  { url: 'https://ko.wikisource.org/wiki/번역:분별과_감성', title: '분별과감성-제인오스틴' },
  { url: 'https://ko.wikisource.org/wiki/번역:제인_에어', title: '제인에어-샬럿브론테' },
  { url: 'https://ko.wikisource.org/wiki/번역:폭풍의_언덕', title: '폭풍의언덕-에밀리브론테' },
  { url: 'https://ko.wikisource.org/wiki/번역:모비딕', title: '모비딕-허먼멜빌' },
  { url: 'https://ko.wikisource.org/wiki/번역:주홍_글씨', title: '주홍글씨-너대니얼호손' },
];

async function scrapeWithSubpages(browser, baseUrl, title) {
  const page = await browser.newPage();
  let fullContent = '';

  console.log(`\n크롤링: ${title}`);
  console.log(`  URL: ${baseUrl}`);

  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // 1. 메인 페이지 내용 확인
    const mainContent = await page.evaluate(() => {
      const contentDiv = document.querySelector('.mw-parser-output');
      if (!contentDiv) return '';

      const removes = contentDiv.querySelectorAll('.toc, .navbox, .mw-editsection, script, style, .metadata, .noprint, .catlinks');
      removes.forEach(el => el.remove());

      return contentDiv.innerText;
    });

    // 한글 확인
    const hasKorean = mainContent && /[가-힣]/.test(mainContent);

    if (mainContent.length > 5000 && hasKorean) {
      fullContent = mainContent;
      console.log(`  메인 페이지: ${mainContent.length}자`);
    } else {
      // 2. 하위 페이지 시도 (/1, /2, ... 또는 /제1장, /제2장, ...)
      console.log(`  하위 페이지 탐색 중...`);

      // 숫자 형태 시도
      for (let i = 1; i <= 100; i++) {
        const subUrl = `${baseUrl}/${i}`;
        try {
          const response = await page.goto(subUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
          if (response.status() === 404) break;

          const pageTitle = await page.title();
          if (pageTitle.includes('존재하지 않') || pageTitle.includes('찾을 수 없')) break;

          const content = await page.evaluate(() => {
            const contentDiv = document.querySelector('.mw-parser-output');
            if (!contentDiv) return '';

            const removes = contentDiv.querySelectorAll('.toc, .navbox, .mw-editsection, script, style, .metadata, .noprint');
            removes.forEach(el => el.remove());

            return contentDiv.innerText;
          });

          if (content && content.length > 50 && /[가-힣]/.test(content)) {
            fullContent += `\n\n=== ${i} ===\n\n${content}`;
            if (i % 10 === 0) process.stdout.write(`${i}...`);
          } else {
            break;
          }
        } catch (err) {
          break;
        }
        await page.waitForTimeout(300);
      }

      if (fullContent.length < 5000) {
        // 장 형태 시도
        for (let i = 1; i <= 50; i++) {
          const subUrl = `${baseUrl}/제${i}장`;
          try {
            const response = await page.goto(subUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
            if (response.status() === 404) break;

            const content = await page.evaluate(() => {
              const contentDiv = document.querySelector('.mw-parser-output');
              if (!contentDiv) return '';
              return contentDiv.innerText;
            });

            if (content && content.length > 50 && /[가-힣]/.test(content)) {
              fullContent += `\n\n=== 제${i}장 ===\n\n${content}`;
            } else {
              break;
            }
          } catch (err) {
            break;
          }
          await page.waitForTimeout(300);
        }
      }

      console.log(`\n  하위 페이지에서 ${fullContent.length}자 수집`);
    }
  } catch (err) {
    console.log(`  에러: ${err.message}`);
  }

  await page.close();

  // 최종 한글 확인
  const finalHasKorean = fullContent && /[가-힣]/.test(fullContent);

  if (fullContent.length > 2000 && finalHasKorean) {
    const safeTitle = title.replace(/[<>:"/\\|?*]/g, '');
    const filePath = path.join(outputDir, `${safeTitle}.txt`);
    fs.writeFileSync(filePath, fullContent.trim(), 'utf-8');
    console.log(`  ✓ 저장 완료: ${safeTitle}.txt (${fullContent.length}자)`);
    return true;
  }

  console.log(`  ✗ 내용 부족 또는 한글 없음`);
  return false;
}

async function main() {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const browser = await chromium.launch({ headless: true });

  let success = 0;
  let fail = 0;
  let skip = 0;

  for (const novel of novels) {
    const safeTitle = novel.title.replace(/[<>:"/\\|?*]/g, '');
    const filePath = path.join(outputDir, `${safeTitle}.txt`);

    if (fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath);
      if (stats.size > 2000) {
        console.log(`\n스킵 (이미 존재): ${novel.title}`);
        skip++;
        continue;
      }
    }

    const result = await scrapeWithSubpages(browser, novel.url, novel.title);
    if (result) success++;
    else fail++;

    await new Promise(r => setTimeout(r, 1000));
  }

  await browser.close();

  console.log('\n========================================');
  console.log(`완료: 성공 ${success}, 실패 ${fail}, 스킵 ${skip}`);
  console.log('========================================\n');

  const files = fs.readdirSync(outputDir).filter(f => f.endsWith('.txt'));
  console.log(`총 ${files.length}개 파일`);
}

main().catch(console.error);
