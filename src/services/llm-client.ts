/**
 * LLM 클라이언트
 * OpenRouter API를 사용하여 저렴한 모델로 온톨로지 추출
 */

import OpenAI from 'openai';

export interface LLMConfig {
  apiKey: string;
  baseURL?: string;
  model?: string;
}

// 저렴한 모델 옵션들 (OpenRouter 기준)
export const CHEAP_MODELS = {
  // Google Gemini (가장 저렴)
  'gemini-2.0-flash-lite': 'google/gemini-2.0-flash-lite-001',
  'gemini-flash': 'google/gemini-2.0-flash-001',

  // OpenAI 저렴 모델
  'gpt-4o-mini': 'openai/gpt-4o-mini',

  // Anthropic 저렴 모델
  'claude-haiku': 'anthropic/claude-3-haiku',

  // 로컬/오픈소스
  'llama-8b': 'meta-llama/llama-3.1-8b-instruct',
  'mistral-7b': 'mistralai/mistral-7b-instruct',
} as const;

export type ModelKey = keyof typeof CHEAP_MODELS;

export class LLMClient {
  private client: OpenAI;
  private model: string;

  constructor(config: LLMConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL || 'https://openrouter.ai/api/v1',
    });

    // 기본: Gemini 2.0 Flash Lite (가장 저렴)
    this.model = config.model || CHEAP_MODELS['gemini-2.0-flash-lite'];
  }

  /**
   * 모델 변경
   */
  setModel(modelKey: ModelKey): void {
    this.model = CHEAP_MODELS[modelKey];
  }

  /**
   * 텍스트 생성 (JSON 모드)
   */
  async generateJSON<T>(
    systemPrompt: string,
    userPrompt: string,
    options?: {
      temperature?: number;
      maxTokens?: number;
    }
  ): Promise<T> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: options?.temperature ?? 0.3,
      max_tokens: options?.maxTokens ?? 4096,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('Empty response from LLM');
    }

    try {
      return JSON.parse(content) as T;
    } catch (e) {
      // JSON 파싱 실패 시 재시도 로직
      console.warn('JSON parse failed, attempting to extract JSON from response');
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]) as T;
      }
      throw new Error(`Failed to parse JSON: ${content.substring(0, 200)}`);
    }
  }

  /**
   * 일반 텍스트 생성
   */
  async generate(
    systemPrompt: string,
    userPrompt: string,
    options?: {
      temperature?: number;
      maxTokens?: number;
    }
  ): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? 2048,
    });

    return response.choices[0]?.message?.content || '';
  }

  /**
   * 현재 모델 정보
   */
  getModelInfo(): string {
    return this.model;
  }
}

/**
 * 환경변수에서 LLM 클라이언트 생성
 */
export function createLLMClient(): LLMClient {
  const apiKey = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error(
      'API key not found. Set OPENROUTER_API_KEY or OPENAI_API_KEY environment variable.'
    );
  }

  // OpenRouter 사용 여부 판단
  const isOpenRouter = !!process.env.OPENROUTER_API_KEY;

  return new LLMClient({
    apiKey,
    baseURL: isOpenRouter ? 'https://openrouter.ai/api/v1' : undefined,
    model: process.env.LLM_MODEL || (isOpenRouter ? CHEAP_MODELS['gemini-2.0-flash-lite'] : 'gpt-4o-mini'),
  });
}
