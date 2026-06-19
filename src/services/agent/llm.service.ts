import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, any>;
  execute: (args: any) => Promise<string>;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

interface RunOptions {
  system: string;
  userMessage: string;
  history?: ChatTurn[];
  tools?: AgentTool[];
  model?: string;
  /** Maximo de iteraciones del loop de tools */
  maxIterations?: number;
}

/**
 * Cliente LLM con loop de tool-calling (function calling). Reemplaza los nodos
 * `@n8n/n8n-nodes-langchain.agent` + sus tools. Usa exclusivamente OpenAI.
 */
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly openai: OpenAI;
  private readonly defaultModel: string;

  constructor(private readonly configService: ConfigService) {
    this.openai = new OpenAI({
      apiKey: this.configService.get<string>('OPENAI_API_KEY') || 'not-configured',
    });
    this.defaultModel = this.configService.get<string>('OPENAI_CHAT_MODEL') || 'gpt-5-mini';
  }

  /** Completion simple (sin tools), util para el clasificador. */
  async complete(system: string, user: string, model?: string): Promise<string> {
    const res = await this.openai.chat.completions.create({
      model: model || this.configService.get<string>('OPENAI_CLASSIFIER_MODEL') || this.defaultModel,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    });
    return res.choices?.[0]?.message?.content?.trim() || '';
  }

  /** Ejecuta un agente con su system prompt, historial y tools opcionales. */
  async runAgent(options: RunOptions): Promise<string> {
    const client = this.openai;
    const model = options.model || this.defaultModel;
    const maxIterations = options.maxIterations ?? 6;

    const tools = options.tools || [];
    const toolMap = new Map(tools.map((t) => [t.name, t]));
    const toolDefs: OpenAI.Chat.Completions.ChatCompletionTool[] = tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: options.system },
    ];
    for (const turn of options.history || []) {
      messages.push({ role: turn.role, content: turn.content });
    }
    messages.push({ role: 'user', content: options.userMessage });

    for (let i = 0; i < maxIterations; i++) {
      const res = await client.chat.completions.create({
        model,
        messages,
        ...(toolDefs.length > 0 ? { tools: toolDefs, tool_choice: 'auto' } : {}),
      });

      const choice = res.choices?.[0]?.message;
      if (!choice) break;

      const toolCalls = choice.tool_calls || [];
      if (toolCalls.length === 0) {
        return (choice.content || '').trim();
      }

      // Registrar la respuesta del asistente con sus tool_calls
      messages.push({
        role: 'assistant',
        content: choice.content || '',
        tool_calls: toolCalls,
      } as any);

      // Ejecutar cada tool y agregar el resultado
      for (const call of toolCalls) {
        const fn = (call as any).function;
        const tool = toolMap.get(fn?.name);
        let result = '';
        if (!tool) {
          result = `Tool ${fn?.name} no disponible`;
        } else {
          try {
            const args = fn.arguments ? JSON.parse(fn.arguments) : {};
            result = await tool.execute(args);
          } catch (err: any) {
            this.logger.error(`Error ejecutando tool ${fn?.name}: ${err?.message || err}`);
            result = `Error ejecutando ${fn?.name}: ${err?.message || err}`;
          }
        }
        messages.push({ role: 'tool', tool_call_id: (call as any).id, content: result });
      }
    }

    // Respuesta final en lenguaje natural, sin más tool calls
    const final = await client.chat.completions.create({
      model,
      messages: [
        ...messages,
        {
          role: 'system',
          content:
            'Responde al estudiante en lenguaje natural, breve y cálido. No menciones herramientas, funciones, JSON, UUIDs, IDs técnicos, invocaciones ni procesos internos.',
        },
      ],
      ...(toolDefs.length > 0 ? { tools: toolDefs, tool_choice: 'none' } : {}),
    });
    return (final.choices?.[0]?.message?.content || '').trim();
  }
}
