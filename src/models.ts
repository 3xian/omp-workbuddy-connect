import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ProviderModelConfig } from "@oh-my-pi/pi-coding-agent";

const PRODUCT_CONFIG_ENV = "WORKBUDDYAI_PRODUCT_CONFIG";
const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } as const;
const COMPAT = {
  supportsDeveloperRole: false,
  supportsReasoningEffort: true,
  maxTokensField: "max_tokens" as const,
};
const EFFORTS = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;
type Effort = (typeof EFFORTS)[number];
export type ModelScope = "free" | "all";

export interface ProductModel {
  id: string;
  name: string;
  credits?: string;
  contextWindow: number;
  maxTokens: number;
  supportsImages: boolean;
  supportsReasoning: boolean;
  supportedEfforts?: Effort[];
  canDisableThinking?: boolean;
}

export interface ModelDiagnostic {
  index: number;
  id?: string;
  code: "invalid-structure" | "missing-id" | "invalid-context-window" | "invalid-max-tokens" | "duplicate-id";
  message: string;
}

export interface ProductConfig {
  source: "cache" | "builtin";
  models: ProductModel[];
  diagnostics: ModelDiagnostic[];
}

// Gateway evidence: larger requests to this model enter a reasoning loop.
export const FLASH_MAX_TOKENS = 16_384;

const BUILTIN_MODELS: ProductModel[] = [
  {
    id: "deepseek-v4.1-flash",
    name: "Deepseek-V4.1-Flash",
    contextWindow: 1_000_000,
    maxTokens: 128_000,
    supportsImages: true,
    supportsReasoning: true,
    supportedEfforts: ["low", "medium", "high", "xhigh", "max"],
    canDisableThinking: false,
  },
  {
    id: "hy4-preview-f",
    name: "Hy4 preview",
    contextWindow: 1_000_000,
    maxTokens: 64_000,
    supportsImages: true,
    supportsReasoning: true,
    supportedEfforts: ["high"],
    canDisableThinking: false,
  },
  {
    id: "hy3",
    name: "Hy3",
    contextWindow: 192_000,
    maxTokens: 64_000,
    supportsImages: true,
    supportsReasoning: true,
    supportedEfforts: ["low", "high"],
    canDisableThinking: false,
  },
];

function productConfigPath(): string {
  const override = process.env[PRODUCT_CONFIG_ENV]?.trim();
  if (override) return override;
  return join(homedir(), ".workbuddy-ai", "cache", "acc-product-config-v3.json");
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

export function creditsAreFree(credits: string | undefined): boolean {
  if (credits === undefined) return false;
  return /^x?0(?:\.0+)?$/u.test(credits.trim());
}

function parseEfforts(value: unknown): Effort[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const declared = new Set(value.filter((effort): effort is Effort =>
    typeof effort === "string" && (EFFORTS as readonly string[]).includes(effort)
  ));
  const efforts = EFFORTS.filter((effort) => declared.has(effort));
  return efforts.length > 0 ? [...efforts] : undefined;
}

function parseProductModel(
  value: unknown,
  index: number,
): { model?: ProductModel; diagnostics: ModelDiagnostic[] } {
  const row = asRecord(value);
  if (!row) {
    return {
      diagnostics: [{ index, code: "invalid-structure", message: `models[${index}] must be an object` }],
    };
  }

  const id = typeof row.id === "string" ? row.id.trim() : "";
  if (id === "") {
    return {
      diagnostics: [{ index, code: "missing-id", message: `models[${index}] has no usable id` }],
    };
  }

  const contextWindow = positiveInteger(row.maxInputTokens) ?? positiveInteger(row.maxAllowedSize);
  const maxTokens = positiveInteger(row.maxOutputTokens);
  const diagnostics: ModelDiagnostic[] = [];
  if (contextWindow === undefined) {
    diagnostics.push({ index, id, code: "invalid-context-window", message: `${id} has no positive integer input budget` });
  }
  if (maxTokens === undefined) {
    diagnostics.push({ index, id, code: "invalid-max-tokens", message: `${id} has no positive integer output budget` });
  }
  if (contextWindow === undefined || maxTokens === undefined) return { diagnostics };

  const reasoning = asRecord(row.reasoning);
  const supportedEfforts = parseEfforts(reasoning?.supportedEfforts);
  const canDisableThinking = typeof reasoning?.canDisableThinking === "boolean"
    ? reasoning.canDisableThinking
    : undefined;
  return {
    model: {
      id,
      name: typeof row.name === "string" && row.name.trim() !== "" ? row.name.trim() : id,
      ...(typeof row.credits === "string" && row.credits.trim() !== "" ? { credits: row.credits.trim() } : {}),
      contextWindow,
      maxTokens,
      supportsImages: row.supportsImages === true && row.disabledMultimodal !== true,
      supportsReasoning: row.supportsReasoning === true,
      ...(supportedEfforts ? { supportedEfforts } : {}),
      ...(canDisableThinking === undefined ? {} : { canDisableThinking }),
    },
    diagnostics: [],
  };
}

export function parseProductConfig(text: string): ProductConfig | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  const document = asRecord(parsed);
  if (!document || !Array.isArray(document.models)) return undefined;

  const models: ProductModel[] = [];
  const diagnostics: ModelDiagnostic[] = [];
  const ids = new Set<string>();
  for (const [index, value] of document.models.entries()) {
    const result = parseProductModel(value, index);
    diagnostics.push(...result.diagnostics);
    if (!result.model) continue;
    if (ids.has(result.model.id)) {
      diagnostics.push({
        index,
        id: result.model.id,
        code: "duplicate-id",
        message: `${result.model.id} is duplicated in the product catalog`,
      });
      continue;
    }
    ids.add(result.model.id);
    models.push(result.model);
  }
  return { source: "cache", models, diagnostics };
}

export function loadProductConfig(path = productConfigPath()): ProductConfig {
  try {
    const parsed = parseProductConfig(readFileSync(path, "utf8"));
    if (parsed?.models.length) return parsed;
    if (parsed) return { source: "builtin", models: BUILTIN_MODELS, diagnostics: parsed.diagnostics };
  } catch { /* missing/unreadable cache → builtin */ }
  return { source: "builtin", models: BUILTIN_MODELS, diagnostics: [] };
}

export function freeModelIds(config: ProductConfig): readonly string[] {
  if (config.source !== "cache") return [];
  return config.models.filter((model) => creditsAreFree(model.credits)).map((model) => model.id);
}

export function clampModelMaxTokens(modelId: string, maxTokens: number): number {
  return modelId === "deepseek-v4.1-flash" ? Math.min(maxTokens, FLASH_MAX_TOKENS) : maxTokens;
}

export function buildOmpModels(config: ProductConfig, scope: ModelScope): ProviderModelConfig[] {
  const free = new Set(freeModelIds(config));
  return config.models
    .filter((model) => scope === "all" || free.has(model.id))
    .map((model): ProviderModelConfig => {
      const hasCanonicalThinking = model.supportsReasoning
        && model.supportedEfforts !== undefined
        && model.canDisableThinking !== undefined;
      return {
        id: model.id,
        name: `${model.name} · ${model.credits ?? "x?"}`,
        reasoning: model.supportsReasoning,
        ...(hasCanonicalThinking
          ? {
              thinking: {
                mode: "effort",
                efforts: model.supportedEfforts! as NonNullable<ProviderModelConfig["thinking"]>["efforts"],
                requiresEffort: !model.canDisableThinking,
              },
            }
          : {}),
        input: model.supportsImages ? ["text", "image"] : ["text"],
        cost: ZERO_COST,
        contextWindow: model.contextWindow,
        maxTokens: clampModelMaxTokens(model.id, model.maxTokens),
        compat: {
          ...COMPAT,
          ...(model.supportsImages ? { stripImageInput: false } : {}),
        },
      };
    });
}
