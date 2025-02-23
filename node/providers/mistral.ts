import { streamText, type FinishReason } from "ai";
import * as ToolManager from "../tools/toolManager.ts";
import type {
  Provider,
  ProviderMessage,
  StopReason,
  Usage,
} from "./provider-types.ts";
import * as ai from "@ai-sdk/mistral";
import type { Nvim } from "nvim-node";
import type { Result } from "../utils/result.ts";
import * as InlineEdit from "../inline-edit/inline-edit-tool.ts";
import * as ReplaceSelection from "../inline-edit/replace-selection-tool.ts";

type TextMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

export class MistralProvider implements Provider {
  provider: ai.MistralProvider;
  model: string;

  constructor(private nvim: Nvim) {
    const apiKey = process.env.MISTRAL_API_KEY;
    if (!apiKey) {
      throw new Error("MISTRAL_API_KEY key not found in environment");
    }

    // const baseURL = process.env.MISTRAL_BASE_URL ?? "https://api.mistral.ai/v1"
    this.provider = ai.createMistral({
      baseURL: "https://api.mistral.ai/v1",
      apiKey: apiKey,
    });
    this.nvim = nvim;
    this.model = "codestral-latest";
  }

  setModel(model: string): void {
    this.model = model;
  }

  async sendMessage(
    messages: Array<ProviderMessage>,
    onText: (text: string) => void,
    _onError: (error: Error) => void,
  ): Promise<{
    toolRequests: Result<ToolManager.ToolRequest, { rawRequest: unknown }>[];
    stopReason: StopReason;
    usage: Usage;
  }> {
    const textMessages = providerMessageToTextMessage(messages);

    const stream = streamText({
      model: this.provider(this.model),
      messages: textMessages,
    });
    for await (const textPart of stream.textStream) {
      onText(textPart);
    }
    const { promptTokens, completionTokens } = await stream.usage;
    const usage: Usage = {
      inputTokens: promptTokens,
      outputTokens: completionTokens,
    };
    const finishReasson = await stream.finishReason;
    const stopReason = mapFinishReasonToStopReason(finishReasson);

    return {
      toolRequests: [],
      stopReason,
      usage,
    };
  }

  //TODO: token usage is returned after the text generation
  async countTokens(_: Array<ProviderMessage>): Promise<number> {
    this.nvim.logger?.debug("Mistral countTokens not implemented");
    return Promise.resolve(0);
  }

  //TODO: its for debugging so decide later
  async createStreamParameters(_: Array<ProviderMessage>): Promise<unknown> {
    this.nvim.logger?.debug("Mistral createStreamParameters not implemented");
    return Promise.resolve({
      not_implemented: "Mistral createStreamParameters not implemented",
    });
  }
  abort() {
    //TODO: implement abort
    this.nvim.logger?.debug("Mistral abort not implemented");
  }
  async inlineEdit(_: Array<ProviderMessage>): Promise<{
    inlineEdit: Result<
      InlineEdit.InlineEditToolRequest,
      { rawRequest: unknown }
    >;
    stopReason: StopReason;
    usage: Usage;
  }> {
    return Promise.reject(new Error("Mistral inlineEdit not implemented"));
  }

  async replaceSelection(_: Array<ProviderMessage>): Promise<{
    replaceSelection: Result<
      ReplaceSelection.ReplaceSelectionToolRequest,
      { rawRequest: unknown }
    >;
    stopReason: StopReason;
    usage: Usage;
  }> {
    return Promise.reject(
      new Error("Mistral replaceSelection not implemented"),
    );
  }
}

// export type StopReason =
//   | "end_turn"
//   | "tool_use"
//   | "max_tokens"
//   | "content"
//   | "stop_sequence";

// Can be one of the following:
// - `stop`: model generated stop sequence
// - `length`: model generated maximum number of tokens
// - `content-filter`: content filter violation stopped the model
// - `tool-calls`: model triggered tool calls
// - `error`: model stopped because of an error
// - `other`: model stopped for other reasons
// */
// type FinishReason = LanguageModelV1FinishReason;
//

function mapFinishReasonToStopReason(finishReason: FinishReason): StopReason {
  switch (finishReason) {
    case "stop":
      return "end_turn";
    case "length":
      return "max_tokens";
    case "content-filter":
      return "content";
    case "tool-calls":
      return "tool_use";
    //TODO: add all SotpReasons?
    case "error":
      return "end_turn";
    case "other":
      return "end_turn";
    case "unknown":
      return "end_turn";
    default:
      //we should not trust the finish reason to match typescript types
      return "end_turn";
  }
}

function providerMessageToTextMessage(
  messages: Array<ProviderMessage>,
): TextMessage[] {
  const textMessages: TextMessage[] = [];
  for (const m of messages) {
    if (typeof m.content === "string") {
      //map all messages (tools)
      textMessages.push(m as TextMessage);
    } else {
      for (const m2 of m.content) {
        if (m2.type === "text") {
          textMessages.push({ role: m.role, content: m2.text });
        }
      }
    }
  }
  return textMessages;
}
