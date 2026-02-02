#!/usr/bin/env node
/**
 * CLI 도구: 소설 텍스트에서 온톨로지 추출
 *
 * 사용법:
 *   npx tsx src/cli/extract.ts <input-file> [options]
 *
 * 예제:
 *   npx tsx src/cli/extract.ts novel.txt --title "나의 소설" --output ontology.json
 */

import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import { HyperGraph } from '../models/hypergraph.js';
import { ExtractionService } from '../services/extraction-service.js';
import { createLLMClient } from '../services/llm-client.js';

interface CLIOptions {
  input: string;
  output?: string;
  title?: string;
  chapter?: number;
}

function parseArgs(): CLIOptions {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
소설 온톨로지 추출 CLI

사용법:
  npx tsx src/cli/extract.ts <input-file> [options]

옵션:
  --title, -t     작품 제목 (기본: 파일명)
  --output, -o    출력 파일 경로 (기본: <input>.ontology.json)
  --chapter, -c   챕터 번호 (기본: 1)
  --help, -h      도움말 표시

환경변수:
  OPENROUTER_API_KEY    OpenRouter API 키
  OPENAI_API_KEY        OpenAI API 키 (OpenRouter 없을 시)
  LLM_MODEL             사용할 모델 (선택)

예제:
  npx tsx src/cli/extract.ts chapter1.txt --title "마법사의 여정" --chapter 1
`);
    process.exit(0);
  }

  const options: CLIOptions = {
    input: args[0],
  };

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--title':
      case '-t':
        options.title = args[++i];
        break;
      case '--output':
      case '-o':
        options.output = args[++i];
        break;
      case '--chapter':
      case '-c':
        options.chapter = parseInt(args[++i], 10);
        break;
    }
  }

  return options;
}

async function main() {
  const options = parseArgs();

  // 입력 파일 읽기
  console.log(`\n📖 파일 읽는 중: ${options.input}`);
  const text = await fs.readFile(options.input, 'utf-8');
  console.log(`   ${text.length.toLocaleString()} 자`);

  // 제목 결정
  const title = options.title || path.basename(options.input, path.extname(options.input));

  // 그래프 및 추출 서비스 생성
  console.log(`\n🔧 온톨로지 추출 중: "${title}"`);
  const graph = new HyperGraph(title);

  try {
    const llm = createLLMClient();
    console.log(`   모델: ${llm.getModelInfo()}`);

    const extractor = new ExtractionService(graph, llm);

    // 추출 실행
    const result = await extractor.extractAndRegister(text, {
      title,
      chapter: options.chapter || 1,
    });

    console.log(`\n✅ 추출 완료`);
    console.log(`   - 엔티티: ${result.entities.length}개`);
    console.log(`   - 관계: ${result.edges.length}개`);

    // 엔티티 요약
    const ontology = graph.toJSON();
    console.log('\n📊 엔티티 분포:');
    for (const [category, count] of Object.entries(ontology.stats.entitiesByCategory)) {
      console.log(`   - ${category}: ${count}`);
    }

    // 출력 파일 저장
    const outputPath = options.output || `${options.input}.ontology.json`;
    await fs.writeFile(outputPath, JSON.stringify(ontology, null, 2), 'utf-8');
    console.log(`\n💾 저장됨: ${outputPath}`);

    // 주요 캐릭터 출력
    const characters = graph.getEntitiesByCategory('character');
    if (characters.length > 0) {
      console.log('\n👥 등장인물:');
      for (const char of characters.slice(0, 10)) {
        const edges = graph.getEdgesForEntity(char.id);
        console.log(`   - ${char.name}${char.aliases?.length ? ` (${char.aliases.join(', ')})` : ''}`);
        console.log(`     관계: ${edges.length}개`);
      }
    }

  } catch (error: any) {
    if (error.message?.includes('API key')) {
      console.error('\n❌ API 키가 설정되지 않았습니다.');
      console.error('   OPENROUTER_API_KEY 또는 OPENAI_API_KEY 환경변수를 설정하세요.');
      process.exit(1);
    }
    throw error;
  }
}

main().catch(console.error);
