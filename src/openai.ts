/**
 * OpenAI API Integration
 * Wrapper for OpenAI Vision API calls
 */

import { OpenAIResponse } from './types';
import { OPENAI_API_URL } from './constants';

export class OpenAIClient {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * Call OpenAI Chat Completion API with vision
   */
  async createChatCompletion(params: {
    model: string;
    messages: Array<{
      role: string;
      content: Array<{ type: string; text?: string; image_url?: { url: string } }>;
    }>;
    max_tokens: number;
  }): Promise<OpenAIResponse> {
    const response = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(params),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`OpenAI API Error: ${error.error?.message || 'Unknown error'}`);
    }

    return (await response.json()) as OpenAIResponse;
  }

  /**
   * Transcribe PDF page with vision API
   */
  async transcribeImage(
    imageDataUrl: string,
    prompt: string,
    model: string
  ): Promise<string> {
    if (!this.apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    try {
      const response = await this.createChatCompletion({
        model: model,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: prompt,
              },
              {
                type: 'image_url',
                image_url: {
                  url: imageDataUrl,
                },
              },
            ],
          },
        ],
        max_tokens: 4096,
      });

      return response.choices[0]?.message?.content || 'No transcription returned';
    } catch (error) {
      console.error('OpenAI API error:', error);
      throw new Error(`OpenAI API Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Check if image contains diagram
   */
  async checkForDiagrams(imageDataUrl: string, model: string): Promise<boolean> {
    if (!this.apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    try {
      const response = await this.createChatCompletion({
        model: model,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: "Does this image contain a diagram, chart, drawing, or visual representation? Answer only with 'yes' or 'no'.",
              },
              {
                type: 'image_url',
                image_url: {
                  url: imageDataUrl,
                },
              },
            ],
          },
        ],
        max_tokens: 10,
      });

      const answer = response.choices[0]?.message?.content.toLowerCase() || '';
      return answer.includes('yes');
    } catch (error) {
      console.error('Error checking for diagrams:', error);
      return false;
    }
  }
}
