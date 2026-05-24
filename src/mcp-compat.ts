import * as vscode from "vscode";
import { fetchWithRetry } from "./api";
import {
  BASE_URL,
  EXTENSION_VERSION,
  MODELS_STATE_KEY,
  PROVIDER_DISPLAY_NAME,
  SECRET_STORAGE_KEY,
} from "./constants";
import { isNormalizedNvidiaModel } from "./model-catalog";

/**
 * Image-analysis client that uses a cached NVIDIA NIM vision-capable model.
 */
export class OcGoMcpClient {
  constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly modelStorage?: vscode.Memento,
  ) {}

  private async getApiKey(): Promise<string> {
    return (await this.secrets.get(SECRET_STORAGE_KEY)) ?? "";
  }

  private getVisionModelId(): string {
    const cachedModels = this.modelStorage?.get<unknown>(MODELS_STATE_KEY);
    const visionModel = Array.isArray(cachedModels)
      ? cachedModels.find((model) => isNormalizedNvidiaModel(model) && model.supportsVision)
      : undefined;

    if (!visionModel || !isNormalizedNvidiaModel(visionModel)) {
      throw new Error(
        `No NVIDIA NIM vision model is available. Run "${PROVIDER_DISPLAY_NAME}: Refresh Models" after setting your API key.`,
      );
    }

    return visionModel.id;
  }

  async analyzeImage(
    imageData: string,
    prompt: string,
    signal?: AbortSignal,
    apiKeyOverride?: string,
  ): Promise<string> {
    const apiKey = apiKeyOverride?.trim() || (await this.getApiKey());
    if (!apiKey) {
      throw new Error(`${PROVIDER_DISPLAY_NAME} API key not found`);
    }
    const model = this.getVisionModelId();
    const ua = `nvidia-nim-provider/${EXTENSION_VERSION} VSCode/${vscode.version}`;

    const response = await fetchWithRetry(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "User-Agent": ua,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: imageData } },
            ],
          },
        ],
        max_tokens: 2000,
      }),
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Vision API error: ${response.status} ${errorText}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    return data.choices?.[0]?.message?.content ?? "Failed to analyze image";
  }
}
