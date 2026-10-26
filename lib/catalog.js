/**
 * GENERATED FILE - DO NOT EDIT.
 *
 * Source:      catalog/model-catalog.yaml
 * Regenerate:  python scripts/build-catalog.py
 * Verify:      python scripts/build-catalog.py --check
 *
 * The YAML is the source of truth (prices, effort vocabularies, channels,
 * evidence date); this module is the dependency-free projection the runtime and
 * the tests import. Keys are sorted, the indentation is two spaces and the line
 * endings are LF, so regenerating it on another machine changes nothing.
 *
 * Exports: CATALOG (whole document), MODELS (frozen model list),
 * findModel(provider, id) - lookup by canonical id, channel-qualified id or
 * OpenRouter id.
 */

export const CATALOG = {
  "aaVersion": "v4.3.2",
  "calendar": [
    {
      "date": "2026-10-23",
      "description": "Kimi K3.1 Pro 发布（AA 55，TB4.0 67%，2/10）",
      "models": [
        "kimi-k3.1-pro"
      ],
      "type": "release"
    },
    {
      "date": "2026-11-01",
      "description": "DeepSeek Search/Fetch 对 server 端工具调用开始计费：¥5 / 1000 次成功请求（此前免费）",
      "models": [
        "deepseek-flash",
        "deepseek-v4-pro"
      ],
      "type": "billing_start"
    },
    {
      "date": "2026-12-01",
      "description": "Gemini 4 Argon GA 促销结束：2/10/0.10 → 4/20/0.20 USD per 1M；Batch 1/5 → 2/10",
      "models": [
        "gemini-4-argon"
      ],
      "type": "price_increase"
    },
    {
      "date": "2027-01-01",
      "description": "Gemini 3.8 Flash 促销结束：0.825/4.125/0.0825 → 1.50/7.50/0.15 USD per 1M",
      "models": [
        "gemini-3.8-flash"
      ],
      "type": "price_increase"
    }
  ],
  "channels": {
    "aliyun-bailian": {
      "billingMode": "token",
      "confidence": "medium",
      "currency": "unknown",
      "kind": "official",
      "machineReadablePricing": false,
      "notes": "阿里云百炼（DashScope，国内区域）。币种按模型而异、无法在渠道级单一断言 → currency unknown：qwen3.8-flash 0.113/0.382 USD（华北2北京价，YAML 模型项）、qwen3.8-max-prime 4/12 USD（OpenRouter 挂牌，百炼人民币价未核实）、minimax-m3.1-flash CN¥1/4/0.1（alternatePriceList）。人民币价目以百炼控制台为准",
      "priceBasis": "official",
      "priceMultiplier": 1.0,
      "provider": "alibaba"
    },
    "aliyun-bailian-singapore": {
      "billingMode": "token",
      "confidence": "medium",
      "currency": "USD",
      "kind": "regionalOfficial",
      "machineReadablePricing": false,
      "notes": "百炼新加坡区域（regionalOfficial），USD。唯一证据是 qwen3.8-flash 的 alternatePriceList：0.15/0.47、缓存读 0.016；其余模型在该区域的价目未核实",
      "priceBasis": "official",
      "priceMultiplier": 1.0,
      "provider": "alibaba",
      "region": "SG"
    },
    "anthropic-official": {
      "billingMode": "token",
      "confidence": "high",
      "currency": "USD",
      "kind": "official",
      "machineReadablePricing": false,
      "notes": "api.anthropic.com 直连，USD。claude-opus-5-5 4/20（1M 上下文无长上下文档溢价，US-only inference +10%）、claude-sonnet-5-5 2/10（缓存读 0.05x）、claude-haiku-5-5 0.1/0.5；缓存写 1.25x",
      "priceBasis": "official",
      "priceMultiplier": 1.0,
      "provider": "anthropic"
    },
    "deepseek-account": {
      "billingMode": "subscription",
      "confidence": "low",
      "currency": "CNY",
      "kind": "accountPool",
      "machineReadablePricing": false,
      "notes": "本机 DSH 侧的多账号池（账号池轮换）。单价/额度以各账号后台为准，未公开 → priceUnknown。可作为路由输入的只有：账号可用性、剩余并发、429 率、延迟分布",
      "priceBasis": "unknown",
      "priceMultiplier": "unknown",
      "priceUnknown": true,
      "provider": "deepseek"
    },
    "deepseek-official": {
      "billingMode": "token",
      "confidence": "high",
      "currency": "CNY",
      "kind": "official",
      "machineReadablePricing": false,
      "notes": "api.deepseek.com 直连；按 token 计费，峰谷价差 2x；每个账号独立并发配额",
      "priceBasis": "official",
      "priceMultiplier": 1.0,
      "provider": "deepseek"
    },
    "google-official": {
      "billingMode": "token",
      "confidence": "high",
      "currency": "USD",
      "kind": "official",
      "machineReadablePricing": false,
      "notes": "generativelanguage.googleapis.com 直连，USD。gemini-4-argon 2/10（2026-12-01 起 4/20）、gemini-3.8-flash 0.825/4.125（2027-01-01 促销结束 1.5/7.5）；仅隐式缓存、无创建费；flash 另有按 token-hour 计的缓存存储费。涨价日见 calendar",
      "priceBasis": "official",
      "priceMultiplier": 1.0,
      "provider": "google"
    },
    "minimax-official": {
      "billingMode": "token",
      "confidence": "medium",
      "currency": "USD",
      "kind": "official",
      "machineReadablePricing": false,
      "notes": "MiniMax 官方渠道，本表 USD 价与 OpenRouter 挂牌一致：minimax-m3.1-flash 0.15/0.6；百炼侧人民币价见该模型 alternatePriceList（CNY 1/4/0.1，RPM 200 · TPM 10,000,000）。官方独立价目页未核实",
      "priceBasis": "official_like",
      "priceMultiplier": 1.0,
      "provider": "minimax"
    },
    "moonshot-official": {
      "billingMode": "token",
      "confidence": "high",
      "currency": "USD",
      "kind": "official",
      "machineReadablePricing": false,
      "notes": "Moonshot 官方平台，本表按国际站 platform.kimi.ai 的 USD 挂牌记录：kimi-k3.1-pro 2/10（比 K3 全线低 33%）。国内站 platform.kimi.com 的人民币价与额度未核实 → 不推断",
      "priceBasis": "official",
      "priceMultiplier": 1.0,
      "provider": "moonshot"
    },
    "openai-official": {
      "billingMode": "token",
      "confidence": "high",
      "currency": "USD",
      "kind": "official",
      "machineReadablePricing": false,
      "notes": "api.openai.com 直连，USD。本表四档：gpt-6-astra 10/50、gpt-6.1-sol 2/10、gpt-6-sol 2/10、gpt-6-luna 0.1/0.5。函数工具必须走 Responses API（chat_completions + tools 会 400）；长对话整单按最高上下文档计价；astra 缓存写 12.5 / 读 1",
      "priceBasis": "official",
      "priceMultiplier": 1.0,
      "provider": "openai"
    },
    "openrouter": {
      "api": "https://openrouter.ai/api/v1/models",
      "billingMode": "token",
      "confidence": "high",
      "currency": "USD",
      "kind": "aggregator",
      "machineReadablePricing": true,
      "notes": "唯一可机器读取的全景价目源；含 context_length / pricing / supported_parameters / expiration_date",
      "priceBasis": "official_like",
      "priceMultiplier": 1.0
    },
    "qiyue": {
      "billingMode": "unknown",
      "confidence": "low",
      "currency": "unknown",
      "kind": "relay",
      "notes": "第三方中转。行业通行三种模式：官方价 x 倍率 / 按次数-额度包 / 包月。本环境无法访问其公开定价页 → 全部 unknown，禁止填数",
      "priceBasis": "unknown",
      "priceMultiplier": "unknown",
      "priceUnknown": true
    },
    "qy": {
      "billingMode": "unknown",
      "confidence": "low",
      "currency": "unknown",
      "kind": "relay",
      "notes": "同上（qy 中转）",
      "priceBasis": "unknown",
      "priceMultiplier": "unknown",
      "priceUnknown": true
    },
    "sub2": {
      "billingMode": "unknown",
      "confidence": "low",
      "currency": "unknown",
      "kind": "relay",
      "notes": "同上（sub2 中转）",
      "priceBasis": "unknown",
      "priceMultiplier": "unknown",
      "priceUnknown": true
    },
    "xai-official": {
      "billingMode": "token",
      "confidence": "high",
      "currency": "USD",
      "kind": "official",
      "machineReadablePricing": false,
      "notes": "api.x.ai 直连，USD。grok-4.7 2/6；prompt >=200K 时整单按 4/12 计费；US 区域端点 +10%；无 Batch API",
      "priceBasis": "official",
      "priceMultiplier": 1.0,
      "provider": "xai"
    },
    "zhipu-official": {
      "billingMode": "token",
      "confidence": "medium",
      "currency": "USD",
      "kind": "official",
      "machineReadablePricing": false,
      "notes": "智谱官方渠道。本表 USD 价取自 OpenRouter 挂牌：glm-5.3-prime 2.8/8.8、glm-5.3-flashx 0.37/1.25；百炼侧同系列 GLM-5 为 CN¥6/¥22/¥1.5，GLM-5.3 的中文渠道价未核实",
      "priceBasis": "official_like",
      "priceMultiplier": 1.0,
      "provider": "zhipu"
    }
  },
  "evidenceDate": "2026-10-26",
  "evidenceTool": "web_fetch / OpenRouter models API / PyYAML 6.0.3 校验",
  "fxRate": {
    "base": "CNY",
    "note": "由 OpenRouter 对 DeepSeek 的挂牌价反推，仅用于 usdApprox 参考",
    "quote": "USD",
    "rate": 7.0
  },
  "generatedAt": "2026-10-26T12:30:00+08:00",
  "modelCount": 19,
  "models": [
    {
      "caps": {
        "anthropicApi": true,
        "fim": true,
        "fimNote": "FIM 仅非思考模式可用",
        "parallelTools": true,
        "prefixCompletion": true,
        "responsesApi": true,
        "structuredOutput": true,
        "tools": true,
        "vision": true
      },
      "channels": {
        "accountPool": [
          {
            "billingMode": "subscription",
            "channel": "deepseek-account",
            "modelId": "deepseek-flash",
            "priceUnknown": true,
            "qualifiedId": "deepseek-account/deepseek-flash"
          }
        ],
        "official": {
          "channel": "deepseek-official",
          "modelId": "deepseek-flash",
          "qualifiedId": "deepseek-official/deepseek-flash"
        },
        "openrouterId": "deepseek/deepseek-v4.1-flash-1017",
        "openrouterPriceUsd": {
          "cacheRead": 0.006,
          "input": 0.3,
          "output": 1.2
        },
        "relay": [
          {
            "availability": "unknown",
            "billingMode": "unknown",
            "channel": "qiyue",
            "priceUnknown": true,
            "qualifiedId": "qiyue/deepseek-flash"
          },
          {
            "availability": "unknown",
            "billingMode": "unknown",
            "channel": "qy",
            "priceUnknown": true,
            "qualifiedId": "qy/deepseek-flash"
          },
          {
            "availability": "unknown",
            "billingMode": "unknown",
            "channel": "sub2",
            "priceUnknown": true,
            "qualifiedId": "sub2/deepseek-flash"
          }
        ]
      },
      "contextWindow": 1000000,
      "deprecatedAt": null,
      "display": "DeepSeek-V4.1-Flash-1017",
      "effort": {
        "aliases": {
          "medium": "high",
          "minimal": "low",
          "ultra": "max",
          "xhigh": "high"
        },
        "alwaysReasoning": false,
        "default": "high",
        "disable": "supported",
        "disableParam": "thinking.type=disabled 或 reasoning_effort=none",
        "notes": "词表只有 3 个实档 + 别名塌缩：medium/xhigh 实际等于 high，minimal 等于 low（发这两个值会「看起来生效实则同档」）",
        "param": "reasoning_effort",
        "reasoningBilling": "included_in_output",
        "reasoningPassthrough": "required_with_tools",
        "vocab": [
          "none",
          "low",
          "high",
          "max"
        ]
      },
      "id": "deepseek-flash",
      "input": [
        "text",
        "image"
      ],
      "maxOutput": 393216,
      "output": [
        "text"
      ],
      "perf": {
        "confidence": "medium",
        "speedTps": 169.1,
        "ttftMs": null,
        "verbosityMTokensPerIndexRun": 210
      },
      "pricing": {
        "cacheRead": 0.04,
        "cacheWrite": null,
        "currency": "CNY",
        "effectiveFrom": "2026-10-17",
        "input": 2,
        "longContext": [],
        "output": 8,
        "peakOffpeak": {
          "excludes": [
            "法定节假日全天",
            "周六周日全天"
          ],
          "offpeakMultiplier": 0.5,
          "offpeakRates": {
            "cacheRead": 0.02,
            "input": 1,
            "output": 4
          },
          "peakMultiplier": 1.0,
          "peakWindows": [
            "Mon-Fri 09:00-12:00",
            "Mon-Fri 14:00-18:00"
          ],
          "tz": "Asia/Shanghai"
        },
        "perCall": [
          {
            "currency": "CNY",
            "effectiveFrom": "2026-11-01",
            "name": "search",
            "notes": "server 端工具调用的 Search/Fetch；2026-11-01 00:00 (Asia/Shanghai) 起计费，此前免费",
            "price": 5,
            "statusBefore": "free",
            "unit": "per_1000_calls"
          },
          {
            "currency": "CNY",
            "effectiveFrom": "2026-11-01",
            "name": "web_fetch",
            "price": 5,
            "statusBefore": "free",
            "unit": "per_1000_calls"
          }
        ],
        "unit": "per_1m_tokens",
        "usdApprox": {
          "confidence": "medium",
          "note": "OpenRouter 对 deepseek-v4.1-flash-1017 挂 0.3/1.2/0.006（=高峰价），据此折算",
          "offpeak": {
            "cacheRead": 0.003,
            "input": 0.14,
            "output": 0.57
          },
          "peak": {
            "cacheRead": 0.006,
            "input": 0.29,
            "output": 1.14
          }
        }
      },
      "provider": "deepseek",
      "quality": {
        "aaCostPerTaskUsd": 0.26,
        "aaIndex": 45,
        "aaVariant": "max",
        "aaVersion": "v4.3.2",
        "confidence": "medium",
        "otherBenchmarks": {
          "agentsLastExam": 35.4,
          "automationBench": 60.5,
          "deepSWEv1_1": 77.0,
          "hleNoTools": 42.6,
          "nl2Repo": 68.2
        },
        "swebenchVerified": null,
        "terminalBench4": 42.3
      },
      "quirks": [
        "带 tools 的请求：历史轮 reasoning_content 必须完整回传，否则 400",
        "思考模式忽略 temperature / presence_penalty / frequency_penalty（不报错但不生效）",
        "flash 的 top_p 仅在思考模式生效且有效区间 0.95-1.0（<0.95 按 0.95 处理），非思考恒 1.0",
        "旧 id deepseek-v4-flash / deepseek-v4-flash-vision-exp 仍可调用，但已被静默路由到 V4.1-Flash 并按 Flash 计费",
        "reasoning_effort=max 时 max_tokens 默认 128K；思考模式默认 64K；非思考默认 8K"
      ],
      "releasedAt": "2026-10-17",
      "retirementAt": null,
      "sources": [
        {
          "checkedAt": "2026-10-26",
          "confidence": "high",
          "url": "https://api-docs.deepseek.com/zh-cn/quick_start/pricing"
        },
        {
          "checkedAt": "2026-10-26",
          "confidence": "high",
          "url": "https://api-docs.deepseek.com/zh-cn/guides/thinking_mode/"
        },
        {
          "checkedAt": "2026-10-26",
          "confidence": "high",
          "url": "https://api-docs.deepseek.com/api/create-chat-completion"
        },
        {
          "checkedAt": "2026-10-26",
          "confidence": "high",
          "url": "https://openrouter.ai/api/v1/models"
        },
        {
          "checkedAt": "2026-10-26",
          "confidence": "medium",
          "url": "https://artificialanalysis.ai/models/deepseek-v4-1-flash-1017"
        }
      ]
    },
    {
      "caps": {
        "anthropicApi": true,
        "fim": true,
        "fimNote": "FIM 仅非思考模式可用",
        "parallelTools": true,
        "prefixCompletion": true,
        "responsesApi": true,
        "structuredOutput": true,
        "tools": true,
        "vision": false
      },
      "channels": {
        "accountPool": [],
        "official": {
          "channel": "deepseek-official",
          "modelId": "deepseek-v4-pro",
          "qualifiedId": "deepseek-official/deepseek-v4-pro"
        },
        "openrouterId": null,
        "openrouterPriceUsd": null,
        "relay": [
          {
            "availability": "unknown",
            "billingMode": "unknown",
            "channel": "qiyue",
            "priceUnknown": true,
            "qualifiedId": "qiyue/deepseek-v4-pro"
          },
          {
            "availability": "unknown",
            "billingMode": "unknown",
            "channel": "qy",
            "priceUnknown": true,
            "qualifiedId": "qy/deepseek-v4-pro"
          },
          {
            "availability": "unknown",
            "billingMode": "unknown",
            "channel": "sub2",
            "priceUnknown": true,
            "qualifiedId": "sub2/deepseek-v4-pro"
          }
        ]
      },
      "contextWindow": 1000000,
      "deprecatedAt": null,
      "display": "DeepSeek-V4-Pro-0813",
      "effort": {
        "aliases": {
          "medium": "high",
          "minimal": "low",
          "ultra": "max",
          "xhigh": "high"
        },
        "alwaysReasoning": false,
        "default": "high",
        "disable": "supported",
        "notes": "与 flash 同词表；思考模式下 top_p 被忽略（带 tools 固定 0.95，否则 1.0）",
        "param": "reasoning_effort",
        "reasoningBilling": "included_in_output",
        "reasoningPassthrough": "required_with_tools",
        "vocab": [
          "none",
          "low",
          "high",
          "max"
        ]
      },
      "id": "deepseek-v4-pro",
      "input": [
        "text"
      ],
      "maxOutput": 393216,
      "output": [
        "text"
      ],
      "perf": {
        "confidence": "low",
        "speedTps": null,
        "ttftMs": null,
        "verbosityMTokensPerIndexRun": null
      },
      "pricing": {
        "cacheRead": 0.3,
        "cacheWrite": null,
        "currency": "CNY",
        "effectiveFrom": "2026-08-17",
        "input": 9.0,
        "longContext": [],
        "output": 27.0,
        "peakOffpeak": {
          "excludes": [
            "法定节假日全天",
            "周六周日全天"
          ],
          "offpeakMultiplier": 0.5,
          "offpeakRates": {
            "cacheRead": 0.15,
            "input": 4.5,
            "output": 13.5
          },
          "peakMultiplier": 1.0,
          "peakWindows": [
            "Mon-Fri 09:00-12:00",
            "Mon-Fri 14:00-18:00"
          ],
          "tz": "Asia/Shanghai"
        },
        "perCall": [],
        "unit": "per_1m_tokens",
        "usdApprox": {
          "confidence": "medium",
          "offpeak": {
            "cacheRead": 0.021,
            "input": 0.64,
            "output": 1.93
          },
          "peak": {
            "cacheRead": 0.043,
            "input": 1.29,
            "output": 3.86
          }
        }
      },
      "provider": "deepseek",
      "quality": {
        "aaIndex": null,
        "aaVersion": "v4.3.2",
        "confidence": "medium",
        "otherBenchmarks": {
          "deepSWE": 62.7,
          "hleNoTools": 42.7,
          "hleWithTools": 60.0,
          "nl2Repo": 61.5,
          "tb2_1": 87.9,
          "toolathlonVerified": 74.1
        },
        "swebenchVerified": null,
        "terminalBench4": null
      },
      "quirks": [
        "官方口径冲突：英文稿曾称 2026-09-14 起 V4-Pro 请求整体路由到 V4.1-Flash 且按 Flash 计费；中文 updates 与现行 pricing 页仍单列 Pro 及 Pro 价 → 以 pricing 页为准，并在运行期用响应 model 字段探测实际模型",
        "不支持图像输入（只有 flash 支持）",
        "并发上限 500（flash 为 2500）"
      ],
      "releasedAt": "2026-08-13",
      "retirementAt": null,
      "sources": [
        {
          "checkedAt": "2026-10-26",
          "confidence": "high",
          "url": "https://api-docs.deepseek.com/zh-cn/quick_start/pricing"
        },
        {
          "checkedAt": "2026-10-26",
          "confidence": "high",
          "url": "https://api-docs.deepseek.com/zh-cn/updates"
        },
        {
          "checkedAt": "2026-10-26",
          "confidence": "high",
          "url": "https://api-docs.deepseek.com/api/create-chat-completion"
        }
      ]
    },
    {
      "caps": {
        "anthropicApi": false,
        "fim": false,
        "parallelTools": true,
        "prefixCompletion": true,
        "responsesApi": true,
        "structuredOutput": true,
        "tools": true,
        "vision": true
      },
      "channels": {
        "accountPool": [],
        "official": {
          "channel": "openai-official",
          "modelId": "gpt-6-astra",
          "qualifiedId": "openai-official/gpt-6-astra"
        },
        "openrouterId": "openai/gpt-6-astra",
        "openrouterPriceUsd": {
          "cacheRead": 1,
          "cacheWrite": 12.5,
          "input": 10,
          "output": 50
        },
        "relay": [
          {
            "availability": "unknown",
            "billingMode": "unknown",
            "channel": "qiyue",
            "priceUnknown": true,
            "qualifiedId": "qiyue/gpt-6-astra"
          },
          {
            "availability": "unknown",
            "billingMode": "unknown",
            "channel": "qy",
            "priceUnknown": true,
            "qualifiedId": "qy/gpt-6-astra"
          },
          {
            "availability": "unknown",
            "billingMode": "unknown",
            "channel": "sub2",
            "priceUnknown": true,
            "qualifiedId": "sub2/gpt-6-astra"
          }
        ]
      },
      "contextWindow": 1050000,
      "deprecatedAt": null,
      "display": "GPT-6 Astra",
      "effort": {
        "aliases": {},
        "alwaysReasoning": true,
        "default": "low",
        "disable": "never",
        "notes": "官方未收 none/minimal；显式传 reasoning_effort=none 返回 400。默认档按 API 文档为 low（与 UI 默认可能不同）",
        "param": "reasoning.effort",
        "reasoningBilling": "included_in_output",
        "reasoningPassthrough": "optional",
        "vocab": [
          "low",
          "medium",
          "high",
          "xhigh",
          "max"
        ]
      },
      "id": "gpt-6-astra",
      "input": [
        "text",
        "image"
      ],
      "maxOutput": 128000,
      "output": [
        "text"
      ],
      "perf": {
        "confidence": "medium",
        "speedTps": 66.4,
        "ttftMs": null,
        "verbosityMTokensPerIndexRun": 60
      },
      "pricing": {
        "cacheRead": 1,
        "cacheWrite": 12.5,
        "cacheWriteTtl": "5m",
        "currency": "USD",
        "effectiveFrom": "2026-09-04",
        "input": 10,
        "longContext": [
          {
            "cacheRead": 2,
            "cacheWrite": 25,
            "input": 20,
            "mode": "whole_request",
            "output": 75,
            "thresholdTokens": 272000
          }
        ],
        "output": 50,
        "peakOffpeak": null,
        "perCall": [],
        "unit": "per_1m_tokens"
      },
      "provider": "openai",
      "quality": {
        "aaCostPerTaskUsd": 3.26,
        "aaIndex": 53,
        "aaVariant": "max",
        "aaVersion": "v4.3.2",
        "confidence": "medium",
        "swebenchVerified": null,
        "terminalBench4": null
      },
      "quirks": [
        "函数工具必须走 Responses API；在 chat_completions 里带 tools 返回 400",
        "长上下文阶梯是「整单计价」而非超额计价：输入 >272K 时全部 token 按 20/75 计",
        "knowledge cutoff 2026-04-30"
      ],
      "releasedAt": "2026-09-04",
      "retirementAt": null,
      "sources": [
        {
          "checkedAt": "2026-10-26",
          "confidence": "high",
          "url": "https://docs.timbal.ai/models/openai"
        },
        {
          "checkedAt": "2026-10-26",
          "confidence": "high",
          "url": "https://openrouter.ai/api/v1/models"
        },
        {
          "checkedAt": "2026-10-26",
          "confidence": "medium",
          "url": "https://artificialanalysis.ai/models/gpt-6-astra"
        }
      ]
    },
    {
      "caps": {
        "anthropicApi": false,
        "fim": false,
        "parallelTools": true,
        "prefixCompletion": true,
        "responsesApi": true,
        "structuredOutput": true,
        "tools": true,
        "vision": true
      },
      "channels": {
        "accountPool": [],
        "official": {
          "channel": "openai-official",
          "modelId": "gpt-6.1-sol",
          "qualifiedId": "openai-official/gpt-6.1-sol"
        },
        "openrouterId": "openai/gpt-6.1-sol",
        "openrouterPriceUsd": {
          "cacheRead": 0.1,
          "cacheWrite": 2.5,
          "input": 2,
          "output": 10
        },
        "relay": [
          {
            "availability": "unknown",
            "billingMode": "unknown",
            "channel": "qiyue",
            "priceUnknown": true,
            "qualifiedId": "qiyue/gpt-6.1-sol"
          },
          {
            "availability": "unknown",
            "billingMode": "unknown",
            "channel": "qy",
            "priceUnknown": true,
            "qualifiedId": "qy/gpt-6.1-sol"
          },
          {
            "availability": "unknown",
            "billingMode": "unknown",
            "channel": "sub2",
            "priceUnknown": true,
            "qualifiedId": "sub2/gpt-6.1-sol"
          }
        ]
      },
      "contextWindow": 1050000,
      "deprecatedAt": null,
      "display": "GPT-6.1 Sol",
      "effort": {
        "aliases": {},
        "alwaysReasoning": true,
        "default": "medium",
        "disable": "never",
        "notes": "none 与 minimal 均不支持（400）；复杂编码/计算机使用/专业工作定位",
        "param": "reasoning.effort",
        "reasoningBilling": "included_in_output",
        "reasoningPassthrough": "optional",
        "vocab": [
          "low",
          "medium",
          "high",
          "xhigh",
          "max"
        ]
      },
      "id": "gpt-6.1-sol",
      "input": [
        "text",
        "image"
      ],
      "maxOutput": 128000,
      "output": [
        "text"
      ],
      "perf": {
        "confidence": "medium",
        "speedTps": 58.8,
        "ttftMs": null,
        "verbosityMTokensPerIndexRun": 67
      },
      "pricing": {
        "cacheRead": 0.1,
        "cacheWrite": 2.5,
        "cacheWriteTtl": "5m",
        "currency": "USD",
        "effectiveFrom": "2026-09-29",
        "input": 2,
        "longContext": [
          {
            "cacheRead": 0.2,
            "cacheWrite": 5,
            "input": 4,
            "mode": "whole_request",
            "output": 15,
            "thresholdTokens": 272000
          }
        ],
        "output": 10,
        "peakOffpeak": null,
        "perCall": [],
        "unit": "per_1m_tokens"
      },
      "provider": "openai",
      "quality": {
        "aaCostPerTaskUsd": 0.72,
        "aaIndex": 52,
        "aaVariant": "max",
        "aaVersion": "v4.3.2",
        "confidence": "medium",
        "swebenchVerified": null,
        "terminalBench4": null
      },
      "quirks": [
        "函数工具必须走 Responses API（chat_completions + tools → 400）",
        "与 gpt-6.1-sol-pro 同价同上下文，pro 为同族变体",
        "长上下文整单计价（>272K → 4/15）"
      ],
      "releasedAt": "2026-09-29",
      "retirementAt": null,
      "sources": [
        {
          "checkedAt": "2026-10-26",
          "confidence": "high",
          "url": "https://docs.timbal.ai/models/openai"
        },
        {
          "checkedAt": "2026-10-26",
          "confidence": "high",
          "url": "https://openrouter.ai/api/v1/models"
        },
        {
          "checkedAt": "2026-10-26",
          "confidence": "medium",
          "url": "https://artificialanalysis.ai/models/gpt-6.1-sol"
        }
      ]
    },
    {
      "caps": {
        "anthropicApi": false,
        "fim": false,
        "parallelTools": true,
        "prefixCompletion": true,
        "responsesApi": true,
        "structuredOutput": true,
        "tools": true,
        "vision": true
      },
      "channels": {
        "accountPool": [],
        "official": {
          "channel": "openai-official",
          "modelId": "gpt-6-sol",
          "qualifiedId": "openai-official/gpt-6-sol"
        },
        "openrouterId": "openai/gpt-6-sol",
        "openrouterPriceUsd": {
          "cacheRead": 0.2,
          "cacheWrite": 2.5,
          "input": 2,
          "output": 10
        },
        "relay": [
          {
            "availability": "unknown",
            "billingMode": "unknown",
            "channel": "qiyue",
            "priceUnknown": true,
            "qualifiedId": "qiyue/gpt-6-sol"
          },
          {
            "availability": "unknown",
            "billingMode": "unknown",
            "channel": "qy",
            "priceUnknown": true,
            "qualifiedId": "qy/gpt-6-sol"
          },
          {
            "availability": "unknown",
            "billingMode": "unknown",
            "channel": "sub2",
            "priceUnknown": true,
            "qualifiedId": "sub2/gpt-6-sol"
          }
        ]
      },
      "contextWindow": 1050000,
      "deprecatedAt": null,
      "display": "GPT-6 Sol",
      "effort": {
        "aliases": {},
        "alwaysReasoning": false,
        "default": "medium",
        "disable": "supported",
        "notes": "6.1 的前代；仍支持 none（可关思考），这是它与 6.1-sol 的关键差异",
        "param": "reasoning.effort",
        "reasoningBilling": "included_in_output",
        "reasoningPassthrough": "optional",
        "vocab": [
          "none",
          "low",
          "medium",
          "high",
          "xhigh",
          "max"
        ]
      },
      "id": "gpt-6-sol",
      "input": [
        "text",
        "image"
      ],
      "maxOutput": 128000,
      "output": [
        "text"
      ],
      "perf": {
        "confidence": "low",
        "speedTps": null,
        "ttftMs": null,
        "verbosityMTokensPerIndexRun": null
      },
      "pricing": {
        "cacheRead": 0.2,
        "cacheWrite": 2.5,
        "cacheWriteTtl": "5m",
        "currency": "USD",
        "effectiveFrom": "2026-09-22",
        "input": 2,
        "longContext": [
          {
            "cacheRead": 0.4,
            "cacheWrite": 5,
            "input": 4,
            "mode": "whole_request",
            "output": 15,
            "thresholdTokens": 272000
          }
        ],
        "output": 10,
        "peakOffpeak": null,
        "perCall": [],
        "unit": "per_1m_tokens"
      },
      "provider": "openai",
      "quality": {
        "aaIndex": null,
        "aaVersion": "v4.3.2",
        "confidence": "low",
        "swebenchVerified": null,
        "terminalBench4": null
      },
      "quirks": [
        "knowledge cutoff 2026-04-20",
        "缓存读比 6.1-sol 贵一倍（0.20 vs 0.10），长会话成本更高"
      ],
      "releasedAt": "2026-09-22",
      "retirementAt": null,
      "sources": [
        {
          "checkedAt": "2026-10-26",
          "confidence": "high",
          "url": "https://docs.timbal.ai/models/openai"
        },
        {
          "checkedAt": "2026-10-26",
          "confidence": "high",
          "url": "https://openrouter.ai/api/v1/models"
        }
      ]
    },
    {
      "caps": {
        "anthropicApi": false,
        "fim": false,
        "parallelTools": true,
        "prefixCompletion": true,
        "responsesApi": true,
        "structuredOutput": true,
        "tools": true,
        "vision": true
      },
      "channels": {
        "accountPool": [],
        "official": {
          "channel": "openai-official",
          "modelId": "gpt-6-luna",
          "qualifiedId": "openai-official/gpt-6-luna"
        },
        "openrouterId": "openai/gpt-6-luna",
        "openrouterPriceUsd": {
          "cacheRead": 0.01,
          "cacheWrite": 0.125,
          "input": 0.1,
          "output": 0.5
        },
        "relay": [
          {
            "availability": "unknown",
            "billingMode": "unknown",
            "channel": "qiyue",
            "priceUnknown": true,
            "qualifiedId": "qiyue/gpt-6-luna"
          },
          {
            "availability": "unknown",
            "billingMode": "unknown",
            "channel": "qy",
            "priceUnknown": true,
            "qualifiedId": "qy/gpt-6-luna"
          },
          {
            "availability": "unknown",
            "billingMode": "unknown",
            "channel": "sub2",
            "priceUnknown": true,
            "qualifiedId": "sub2/gpt-6-luna"
          }
        ]
      },
      "contextWindow": 1050000,
      "deprecatedAt": null,
      "display": "GPT-6 Luna",
      "effort": {
        "aliases": {},
        "alwaysReasoning": false,
        "default": "medium",
        "disable": "supported",
        "notes": "低价高并发档；支持 none 关思考",
        "param": "reasoning.effort",
        "reasoningBilling": "included_in_output",
        "reasoningPassthrough": "optional",
        "vocab": [
          "none",
          "low",
          "medium",
          "high",
          "xhigh",
          "max"
        ]
      },
      "id": "gpt-6-luna",
      "input": [
        "text",
        "image"
      ],
      "maxOutput": 128000,
      "output": [
        "text"
      ],
      "perf": {
        "confidence": "low",
        "speedTps": null,
        "ttftMs": null,
        "verbosityMTokensPerIndexRun": null
      },
      "pricing": {
        "cacheRead": 0.01,
        "cacheWrite": 0.125,
        "cacheWriteTtl": "5m",
        "currency": "USD",
        "effectiveFrom": "2026-09-22",
        "input": 0.1,
        "longContext": [
          {
            "cacheRead": 0.02,
            "cacheWrite": 0.25,
            "input": 0.2,
            "mode": "whole_request",
            "output": 0.75,
            "thresholdTokens": 272000
          }
        ],
        "output": 0.5,
        "peakOffpeak": null,
        "perCall": [],
        "unit": "per_1m_tokens"
      },
      "provider": "openai",
      "quality": {
        "aaIndex": null,
        "aaVersion": "v4.3.2",
        "confidence": "low",
        "swebenchVerified": null,
        "terminalBench4": null
      },
      "quirks": [
        "knowledge cutoff 2026-05-18",
        "函数工具必须走 Responses API"
      ],
      "releasedAt": "2026-09-22",
      "retirementAt": null,
      "sources": [
        {
          "checkedAt": "2026-10-26",
          "confidence": "high",
          "url": "https://docs.timbal.ai/models/openai"
        },
        {
          "checkedAt": "2026-10-26",
          "confidence": "high",
          "url": "https://openrouter.ai/api/v1/models"
        }
      ]
    },
    {
      "caps": {
        "anthropicApi": true,
        "fim": false,
        "parallelTools": true,
        "prefixCompletion": false,
        "responsesApi": false,
        "structuredOutput": false,
        "tools": true,
        "vision": true
      },
      "channels": {
        "accountPool": [],
        "official": {
          "channel": "anthropic-official",
          "modelId": "claude-opus-5-5",
          "qualifiedId": "anthropic-official/claude-opus-5-5"
        },
        "openrouterId": "anthropic/claude-opus-5.5",
        "openrouterPriceUsd": {
          "cacheRead": 0.2,
          "cacheWrite": 5,
          "input": 4,
          "output": 20
        },
        "relay": [
          {
            "availability": "unknown",
            "billingMode": "unknown",
            "channel": "qiyue",
            "priceUnknown": true,
            "qualifiedId": "qiyue/claude-opus-5-5"
          },
          {
            "availability": "unknown",
            "billingMode": "unknown",
            "channel": "qy",
            "priceUnknown": true,
            "qualifiedId": "qy/claude-opus-5-5"
          },
          {
            "availability": "unknown",
            "billingMode": "unknown",
            "channel": "sub2",
            "priceUnknown": true,
            "qualifiedId": "sub2/claude-opus-5-5"
          }
        ]
      },
      "contextWindow": 1000000,
      "deprecatedAt": null,
      "display": "Claude Opus 5.5",
      "effort": {
        "aliases": {},
        "alwaysReasoning": true,
        "default": "medium",
        "disable": "never",
        "notes": "Opus 5.5 在所有 effort 档强制开思考（含 API），无法关闭；thinking_tokens 是 output_tokens 的子集，按 output 价计费",
        "param": "output_config.effort",
        "reasoningBilling": "included_in_output",
        "reasoningPassthrough": "optional",
        "vocab": [
          "low",
          "medium",
          "high",
          "xhigh",
          "max"
        ]
      },
      "id": "claude-opus-5-5",
      "input": [
        "text",
        "image"
      ],
      "maxOutput": 128000,
      "output": [
        "text"
      ],
      "perf": {
        "confidence": "medium",
        "speedTps": 96.2,
        "ttftMs": null,
        "verbosityMTokensPerIndexRun": 260
      },
      "pricing": {
        "batch": {
          "input": 2,
          "output": 10
        },
        "cacheRead": 0.2,
        "cacheWrite": 5,
        "cacheWrite1h": 8,
        "cacheWriteTtl": "5m",
        "currency": "USD",
        "effectiveFrom": "2026-09-22",
        "fastMode": {
          "cacheRead": 0.4,
          "cacheWrite": 10,
          "cacheWrite1h": 16,
          "input": 8,
          "output": 40,
          "status": "research_preview"
        },
        "input": 4,
        "longContext": [],
        "notes": "1M 上下文按标准价（无长上下文溢价）；US-only inference 加 10%",
        "output": 20,
        "peakOffpeak": null,
        "perCall": [],
        "unit": "per_1m_tokens"
      },
      "provider": "anthropic",
      "quality": {
        "aaCostPerTaskUsd": 5.98,
        "aaIndex": 58,
        "aaVariant": "max with fallback",
        "aaVersion": "v4.3.2",
        "confidence": "medium",
        "swebenchVerified": null,
        "terminalBench4": null
      },
      "quirks": [
        "tool_choice=any/tool 返回 400（不支持强制工具选择）",
        "fast mode 需 extra_body {speed: fast} + header anthropic-beta: fast-mode-2026-02-01",
        "流中断（无 message_delta）仍收 prompt 侧费用，output 不计费",
        "aaIndex 58 为全球第一；verbosity 260M 输出 token（最啰嗦之一）→ 长任务成本高"
      ],
      "releasedAt": "2026-09-22",
      "retirementAt": null,
      "sources": [
        {
          "checkedAt": "2026-10-26",
          "confidence": "high",
          "url": "https://docs.timbal.ai/models/anthropic"
        },
        {
          "checkedAt": "2026-10-26",
          "confidence": "high",
          "url": "https://support.claude.com/en/articles/8664678-change-the-model-effort-and-thinking-settings"
        },
        {
          "checkedAt": "2026-10-26",
          "confidence": "medium",
          "url": "https://artificialanalysis.ai/models/claude-opus-5-5"
        }
      ]
    },
    {
      "caps": {
        "anthropicApi": true,
        "fim": false,
        "parallelTools": true,
        "prefixCompletion": false,
        "responsesApi": false,
        "structuredOutput": false,
        "tools": true,
        "vision": true
      },
      "channels": {
        "accountPool": [],
        "official": {
          "channel": "anthropic-official",
          "modelId": "claude-sonnet-5-5",
          "qualifiedId": "anthropic-official/claude-sonnet-5-5"
        },
        "openrouterId": "anthropic/claude-sonnet-5.5",
        "openrouterPriceUsd": {
          "cacheRead": 0.1,
          "cacheWrite": 2.5,
          "input": 2,
          "output": 10
        },
        "relay": [
          {
            "availability": "unknown",
            "billingMode": "unknown",
            "channel": "qiyue",
            "priceUnknown": true,
            "qualifiedId": "qiyue/claude-sonnet-5-5"
          },
          {
            "availability": "unknown",
            "billingMode": "unknown",
            "channel": "qy",
            "priceUnknown": true,
            "qualifiedId": "qy/claude-sonnet-5-5"
          },
          {
            "availability": "unknown",
            "billingMode": "unknown",
            "channel": "sub2",
            "priceUnknown": true,
            "qualifiedId": "sub2/claude-sonnet-5-5"
          }
        ]
      },
      "contextWindow": 1000000,
      "deprecatedAt": null,
      "display": "Claude Sonnet 5.5",
      "effort": {
        "aliases": {},
        "alwaysReasoning": true,
        "default": "medium",
        "disable": "never",
        "notes": "thinking=disabled 直接 400；要省 upfront 思考用 between_tools 设置（只在工具调用之间思考）",
        "param": "output_config.effort",
        "reasoningBilling": "included_in_output",
        "reasoningPassthrough": "optional",
        "vocab": [
          "low",
          "medium",
          "high",
          "xhigh",
          "max"
        ]
      },
      "id": "claude-sonnet-5-5",
      "input": [
        "text",
        "image"
      ],
      "maxOutput": 128000,
      "output": [
        "text"
      ],
      "perf": {
        "confidence": "low",
        "speedTps": null,
        "ttftMs": null,
        "verbosityMTokensPerIndexRun": null
      },
      "pricing": {
        "batch": {
          "input": 1,
          "output": 5
        },
        "cacheRead": 0.1,
        "cacheWrite": 2.5,
        "cacheWrite1h": 4,
        "cacheWriteTtl": "5m",
        "currency": "USD",
        "effectiveFrom": "2026-09-28",
        "input": 2,
        "longContext": [],
        "notes": "缓存读 0.05x；与 GPT-6.1 Sol 同价（2/10）",
        "output": 10,
        "peakOffpeak": null,
        "perCall": [],
        "unit": "per_1m_tokens"
      },
      "provider": "anthropic",
      "quality": {
        "aaIndex": 56,
        "aaVersion": "v4.3.2",
        "confidence": "medium",
        "swebenchVerified": null,
        "terminalBench4": null
      },
      "quirks": [
        "thinking=disabled → 400；需改用 between_tools",
        "AA 56 分 @ 2/10，是本表里 $/分的第二优（仅次于 DeepSeek）"
      ],
      "releasedAt": "2026-09-28",
      "retirementAt": null,
      "sources": [
        {
          "checkedAt": "2026-10-26",
          "confidence": "high",
          "url": "https://docs.timbal.ai/models/anthropic"
        },
        {
          "checkedAt": "2026-10-26",
          "confidence": "high",
          "url": "https://support.claude.com/en/articles/8664678-change-the-model-effort-and-thinking-settings"
        },
        {
          "checkedAt": "2026-10-26",
          "confidence": "high",
          "url": "https://openrouter.ai/api/v1/models"
        }
      ]
    },
    {
      "caps": {
        "anthropicApi": true,
        "fim": false,
        "parallelTools": true,
        "prefixCompletion": false,
        "responsesApi": false,
        "structuredOutput": false,
        "tools": true,
        "vision": true
      },
      "channels": {
        "accountPool": [],
        "official": {
          "channel": "anthropic-official",
          "modelId": "claude-haiku-5-5",
          "qualifiedId": "anthropic-official/claude-haiku-5-5"
        },
        "openrouterId": "anthropic/claude-haiku-5.5",
        "openrouterPriceUsd": {
          "cacheRead": 0.01,
          "cacheWrite": 0.125,
          "input": 0.1,
          "output": 0.5
        },
        "relay": [
          {
            "availability": "unknown",
            "billingMode": "unknown",
            "channel": "qiyue",
            "priceUnknown": true,
            "qualifiedId": "qiyue/claude-haiku-5-5"
          },
          {
            "availability": "unknown",
            "billingMode": "unknown",
            "channel": "qy",
            "priceUnknown": true,
            "qualifiedId": "qy/claude-haiku-5-5"
          },
          {
            "availability": "unknown",
            "billingMode": "unknown",
            "channel": "sub2",
            "priceUnknown": true,
            "qualifiedId": "sub2/claude-haiku-5-5"
          }
        ]
      },
      "contextWindow": 1000000,
      "deprecatedAt": null,
      "display": "Claude Haiku 5.5",
      "effort": {
        "aliases": {},
        "alwaysReasoning": false,
        "default": "unknown",
        "disable": "levelGated",
        "notes": "可在 effort <= high 时关思考；在 xhigh/max 下请求关思考会报错。默认档官方未在可抓取页面写明 → unknown",
        "param": "output_config.effort",
        "reasoningBilling": "included_in_output",
        "reasoningPassthrough": "optional",
        "vocab": [
          "low",
          "medium",
          "high",
          "xhigh",
          "max"
        ]
      },
      "id": "claude-haiku-5-5",
      "input": [
        "text",
        "image"
      ],
      "maxOutput": 128000,
      "output": [
        "text"
      ],
      "perf": {
        "confidence": "low",
        "speedTps": null,
        "ttftMs": null,
        "verbosityMTokensPerIndexRun": null
      },
      "pricing": {
        "batch": {
          "input": 0.05,
          "output": 0.25
        },
        "cacheRead": 0.01,
        "cacheWrite": 0.125,
        "cacheWrite1h": 0.2,
        "cacheWriteTtl": "5m",
        "currency": "USD",
        "effectiveFrom": "2026-10-07",
        "input": 0.1,
        "longContext": [
          {
            "cacheRead": null,
            "input": null,
            "mode": "whole_request",
            "notes": "官方称 >100,000 prompt tokens 整单按长上下文更高价；阈值 = input+cache_read+cache_creation 之和，恰好 100,000 仍按低价。具体数字未抓到 → unknown",
            "output": null,
            "priceUnknown": true,
            "thresholdTokens": 100000
          }
        ],
        "output": 0.5,
        "peakOffpeak": null,
        "perCall": [],
        "unit": "per_1m_tokens"
      },
      "provider": "anthropic",
      "quality": {
        "aaIndex": null,
        "aaVersion": "v4.3.2",
        "confidence": "low",
        "swebenchVerified": null,
        "terminalBench4": null
      },
      "quirks": [
        "唯一带长上下文阶梯的 Claude 5.x（>100K 整单涨价，数字 unknown）",
        "本表最便宜的 Anthropic 档（0.10/0.50），适合分类/摘要类路由"
      ],
      "releasedAt": "2026-10-07",
      "retirementAt": null,
      "sources": [
        {
          "checkedAt": "2026-10-26",
          "confidence": "high",
          "url": "https://docs.timbal.ai/models/anthropic"
        },
        {
          "checkedAt": "2026-10-26",
          "confidence": "high",
          "url": "https://support.claude.com/en/articles/8664678-change-the-model-effort-and-thinking-settings"
        },
        {
          "checkedAt": "2026-10-26",
          "confidence": "high",
          "url": "https://openrouter.ai/api/v1/models"
        }
      ]
    },
    {
      "caps": {
        "anthropicApi": false,
        "audio": true,
        "fim": false,
        "parallelTools": true,
        "pdf": true,
        "prefixCompletion": false,
        "responsesApi": false,
        "structuredOutput": true,
        "tools": true,
        "video": true,
        "vision": true
      },
      "channels": {
        "accountPool": [],
        "official": {
          "channel": "google-official",
          "modelId": "gemini-4-argon",
          "qualifiedId": "google-official/gemini-4-argon"
        },
        "openrouterId": "google/gemini-4-argon",
        "openrouterPriceUsd": {
          "cacheRead": 0.1,
          "cacheWrite": 0.1875,
          "input": 2,
          "output": 10
        },
        "relay": [
          {
            "availability": "unknown",
            "billingMode": "unknown",
            "channel": "qiyue",
            "priceUnknown": true,
            "qualifiedId": "qiyue/gemini-4-argon"
          },
          {
            "availability": "unknown",
            "billingMode": "unknown",
            "channel": "qy",
            "priceUnknown": true,
            "qualifiedId": "qy/gemini-4-argon"
          },
          {
            "availability": "unknown",
            "billingMode": "unknown",
            "channel": "sub2",
            "priceUnknown": true,
            "qualifiedId": "sub2/gemini-4-argon"
          }
        ]
      },
      "contextWindow": 1048576,
      "deprecatedAt": null,
      "display": "Gemini 4 Argon",
      "effort": {
        "aliases": {},
        "alwaysReasoning": "unknown",
        "default": "medium",
        "disable": "unknown",
        "notes": "level 形式（低/中/高），官方文档未提供可抓取的关闭方式；minimal 在 3.8-flash 上被拒，4-argon 是否接受 unknown",
        "param": "thinking_level",
        "reasoningBilling": "included_in_output",
        "reasoningPassthrough": "optional",
        "vocab": [
          "low",
          "medium",
          "high"
        ]
      },
      "id": "gemini-4-argon",
      "input": [
        "text",
        "image",
        "audio",
        "video",
        "pdf"
      ],
      "maxOutput": 65536,
      "output": [
        "text"
      ],
      "perf": {
        "confidence": "medium",
        "speedTps": 80.8,
        "ttftMs": null,
        "verbosityMTokensPerIndexRun": 110
      },
      "pricing": {
        "batch": {
          "cacheRead": 0.05,
          "input": 1,
          "output": 5
        },
        "cacheRead": 0.1,
        "cacheWrite": null,
        "currency": "USD",
        "effectiveFrom": "2026-10-13",
        "input": 2,
        "longContext": [],
        "next": {
          "cacheRead": 0.2,
          "effectiveFrom": "2026-12-01",
          "input": 4,
          "notes": "GA 促销价结束，价格翻倍；Batch/Flex 与 Priority 同比上调",
          "output": 20
        },
        "notes": "仅隐式缓存，无显式缓存创建/存储费；无免费 API 层",
        "output": 10,
        "peakOffpeak": null,
        "perCall": [
          {
            "currency": "USD",
            "effectiveFrom": "2026-10-13",
            "freeTierPerMonth": 5000,
            "name": "search_grounding",
            "price": 14,
            "unit": "per_1000_calls"
          }
        ],
        "priority": {
          "multiplier": 1.8
        },
        "unit": "per_1m_tokens"
      },
      "provider": "google",
      "quality": {
        "aaCostPerTaskUsd": 1.99,
        "aaIndex": 53,
        "aaVariant": "high",
        "aaVersion": "v4.3.2",
        "confidence": "medium",
        "swebenchVerified": null,
        "terminalBench4": null
      },
      "quirks": [
        "2026-12-01 涨价：2/10 → 4/20（pricing.next），成本引擎必须按日期切换",
        "忽略 temperature / top_p",
        "原生长解码需后台执行/续传协议；第三方 chat 路由未必实现",
        "上下文/输出口径冲突：官方写 1,048,576 / 65,536；OpenRouter 的 top_provider.max_completion_tokens=943,718（疑为异步模式上限）"
      ],
      "releasedAt": "2026-10-13",
      "retirementAt": null,
      "sources": [
        {
          "checkedAt": "2026-10-26",
          "confidence": "high",
          "url": "https://docs.timbal.ai/models/google"
        },
        {
          "checkedAt": "2026-10-26",
          "confidence": "high",
          "url": "https://openrouter.ai/api/v1/models"
        }
      ]
    },
    {
      "caps": {
        "anthropicApi": false,
        "audio": true,
        "fim": false,
        "parallelTools": true,
        "pdf": true,
        "prefixCompletion": false,
        "responsesApi": false,
        "structuredOutput": true,
        "tools": true,
        "video": true,
        "vision": true
      },
      "channels": {
        "accountPool": [],
        "official": {
          "channel": "google-official",
          "modelId": "gemini-3.8-flash",
          "qualifiedId": "google-official/gemini-3.8-flash"
        },
        "openrouterId": "google/gemini-3.8-flash",
        "openrouterPriceUsd": {
          "cacheRead": 0.0825,
          "input": 0.825,
          "output": 4.125
        },
        "relay": [
          {
            "availability": "unknown",
            "billingMode": "unknown",
            "channel": "qiyue",
            "priceUnknown": true,
            "qualifiedId": "qiyue/gemini-3.8-flash"
          },
          {
            "availability": "unknown",
            "billingMode": "unknown",
            "channel": "qy",
            "priceUnknown": true,
            "qualifiedId": "qy/gemini-3.8-flash"
          },
          {
            "availability": "unknown",
            "billingMode": "unknown",
            "channel": "sub2",
            "priceUnknown": true,
            "qualifiedId": "sub2/gemini-3.8-flash"
          }
        ]
      },
      "contextWindow": 1048576,
      "deprecatedAt": null,
      "display": "Gemini 3.8 Flash",
      "effort": {
        "aliases": {},
        "alwaysReasoning": "unknown",
        "default": "medium",
        "disable": "unknown",
        "notes": "minimal 被拒（400）；level 只有 low/medium/high",
        "param": "thinking_level",
        "reasoningBilling": "included_in_output",
        "reasoningPassthrough": "optional",
        "vocab": [
          "low",
          "medium",
          "high"
        ]
      },
      "id": "gemini-3.8-flash",
      "input": [
        "text",
        "image",
        "audio",
        "video",
        "pdf"
      ],
      "maxOutput": 65536,
      "output": [
        "text"
      ],
      "perf": {
        "confidence": "medium",
        "speedTps": 136.9,
        "ttftMs": null,
        "verbosityMTokensPerIndexRun": 170
      },
      "pricing": {
        "batch": {
          "cacheRead": 0.0375,
          "input": 0.375,
          "output": 1.875
        },
        "cacheRead": 0.0825,
        "cacheStoragePerMTokenHour": 1,
        "cacheWrite": null,
        "currency": "USD",
        "effectiveFrom": "2026-09-02",
        "input": 0.825,
        "longContext": [],
        "next": {
          "cacheRead": 0.15,
          "effectiveFrom": "2027-01-01",
          "input": 1.5,
          "notes": "促销结束，回到 post-promotion 价",
          "output": 7.5
        },
        "notes": "缓存按 token-hour 计存储费（唯一在本表里有显式存储费的 Gemini 档）",
        "output": 4.125,
        "peakOffpeak": null,
        "perCall": [],
        "unit": "per_1m_tokens"
      },
      "provider": "google",
      "quality": {
        "aaCostPerTaskUsd": 1.24,
        "aaIndex": 52,
        "aaVariant": "high",
        "aaVersion": "v4.3.2",
        "confidence": "medium",
        "swebenchVerified": null,
        "terminalBench4": null
      },
      "quirks": [
        "2027-01-01 促销结束：0.825/4.125 → 1.50/7.50（pricing.next）",
        "minimal thinking level 被拒",
        "被 Google 路由的上代 gemini-3.5-flash 会 redirect 到 3.6-flash（弃用前兆，目录需监控）"
      ],
      "releasedAt": "2026-09-02",
      "retirementAt": null,
      "sources": [
        {
          "checkedAt": "2026-10-26",
          "confidence": "high",
          "url": "https://docs.timbal.ai/models/google"
        },
        {
          "checkedAt": "2026-10-26",
          "confidence": "high",
          "url": "https://openrouter.ai/api/v1/models"
        },
        {
          "checkedAt": "2026-10-26",
          "confidence": "medium",
          "url": "https://artificialanalysis.ai/models/gemini-3-8-flash"
        }
      ]
    },
    {
      "caps": {
        "anthropicApi": false,
        "fim": false,
        "parallelTools": true,
        "prefixCompletion": false,
        "responsesApi": true,
        "structuredOutput": true,
        "tools": true,
        "vision": true
      },
      "channels": {
        "accountPool": [],
        "official": {
          "channel": "xai-official",
          "modelId": "grok-4.7",
          "qualifiedId": "xai-official/grok-4.7"
        },
        "openrouterId": "x-ai/grok-4.7",
        "openrouterPriceUsd": {
          "cacheRead": 0.5,
          "input": 2,
          "output": 6
        },
        "relay": [
          {
            "availability": "unknown",
            "billingMode": "unknown",
            "channel": "qiyue",
            "priceUnknown": true,
            "qualifiedId": "qiyue/grok-4.7"
          },
          {
            "availability": "unknown",
            "billingMode": "unknown",
            "channel": "qy",
            "priceUnknown": true,
            "qualifiedId": "qy/grok-4.7"
          },
          {
            "availability": "unknown",
            "billingMode": "unknown",
            "channel": "sub2",
            "priceUnknown": true,
            "qualifiedId": "sub2/grok-4.7"
          }
        ]
      },
      "contextWindow": 500000,
      "deprecatedAt": null,
      "display": "Grok 4.7",
      "effort": {
        "aliases": {},
        "alwaysReasoning": "unknown",
        "default": "high",
        "disable": "unknown",
        "notes": "Responses API 恒返回加密 reasoning，工具循环内必须保留并回传；Chat Completions 与 Responses 都支持",
        "param": "reasoning.effort",
        "reasoningBilling": "included_in_output",
        "reasoningPassthrough": "encrypted_required",
        "vocab": [
          "low",
          "medium",
          "high",
          "xhigh"
        ]
      },
      "id": "grok-4.7",
      "input": [
        "text",
        "image"
      ],
      "maxOutput": 450000,
      "output": [
        "text"
      ],
      "perf": {
        "confidence": "low",
        "speedTps": null,
        "ttftMs": null,
        "verbosityMTokensPerIndexRun": null
      },
      "pricing": {
        "cacheRead": 0.5,
        "cacheWrite": null,
        "currency": "USD",
        "effectiveFrom": "2026-09-21",
        "input": 2,
        "longContext": [
          {
            "cacheRead": 1,
            "input": 4,
            "mode": "whole_request",
            "output": 12,
            "thresholdTokens": 200000
          }
        ],
        "output": 6,
        "peakOffpeak": null,
        "perCall": [
          {
            "currency": "USD",
            "effectiveFrom": "2026-09-21",
            "name": "web_search",
            "price": 5,
            "unit": "per_1000_calls"
          },
          {
            "currency": "USD",
            "effectiveFrom": "2026-09-21",
            "name": "x_search_posts",
            "price": 5,
            "unit": "per_1000_calls"
          }
        ],
        "unit": "per_1m_tokens"
      },
      "provider": "xai",
      "quality": {
        "aaIndex": null,
        "aaVersion": "v4.3.2",
        "confidence": "low",
        "swebenchVerified": null,
        "terminalBench4": null
      },
      "quirks": [
        ">=200K prompt 整单按 4/12 计费",
        "无 Batch API",
        "Grok 4.7 Fast 只在 Cursor / Grok Build 提供，不在公开 API",
        "US 区域端点 +10%",
        "maxOutput 口径：官方称无独立输出上限，OpenRouter 记 450,000"
      ],
      "releasedAt": "2026-09-21",
      "retirementAt": null,
      "sources": [
        {
          "checkedAt": "2026-10-26",
          "confidence": "high",
          "url": "https://docs.timbal.ai/models/xai"
        },
        {
          "checkedAt": "2026-10-26",
          "confidence": "high",
          "url": "https://openrouter.ai/api/v1/models"
        }
      ]
    },
    {
      "caps": {
        "anthropicApi": false,
        "fim": false,
        "parallelTools": true,
        "prefixCompletion": false,
        "responsesApi": false,
        "structuredOutput": true,
        "tools": true,
        "vision": true
      },
      "channels": {
        "accountPool": [],
        "official": {
          "channel": null,
          "modelId": null,
          "qualifiedId": null
        },
        "openrouterId": "meta/muse-wonder",
        "openrouterPriceUsd": {
          "cacheRead": 0.2,
          "input": 4,
          "output": 20
        },
        "relay": [
          {
            "availability": "unknown",
            "billingMode": "unknown",
            "channel": "qiyue",
            "priceUnknown": true,
            "qualifiedId": "qiyue/muse-wonder"
          },
          {
            "availability": "unknown",
            "billingMode": "unknown",
            "channel": "qy",
            "priceUnknown": true,
            "qualifiedId": "qy/muse-wonder"
          },
          {
            "availability": "unknown",
            "billingMode": "unknown",
            "channel": "sub2",
            "priceUnknown": true,
            "qualifiedId": "sub2/muse-wonder"
          }
        ]
      },
      "contextWindow": 1048576,
      "deprecatedAt": null,
      "display": "Muse Wonder",
      "effort": {
        "aliases": {},
        "alwaysReasoning": "unknown",
        "default": "unknown",
        "disable": "unknown",
        "notes": "OpenRouter supported_parameters 含 reasoning_effort，但具体档位词表未核实 → vocab 留空，下游需 capability-probe",
        "param": "reasoning_effort",
        "reasoningBilling": "included_in_output",
        "reasoningPassthrough": "optional",
        "vocab": []
      },
      "id": "muse-wonder",
      "input": [
        "text",
        "image"
      ],
      "maxOutput": 943718,
      "output": [
        "text"
      ],
      "perf": {
        "confidence": "low",
        "speedTps": null,
        "ttftMs": null,
        "verbosityMTokensPerIndexRun": null
      },
      "pricing": {
        "cacheRead": 0.2,
        "cacheWrite": null,
        "currency": "USD",
        "effectiveFrom": "2026-10-12",
        "input": 4,
        "longContext": [],
        "notes": "价格取自 OpenRouter 挂牌；Meta 官方价目页未核实",
        "output": 20,
        "peakOffpeak": null,
        "perCall": [],
        "unit": "per_1m_tokens"
      },
      "provider": "meta",
      "quality": {
        "aaIndex": 56,
        "aaVariant": "full",
        "aaVersion": "v4.3.2",
        "confidence": "low",
        "swebenchVerified": null,
        "terminalBench4": null
      },
      "quirks": [
        "AA 称 Muse Wonder Full 56 分（第 3），口径为元宝/Meta 自报 + AA 复测，置信度低",
        "无官方直连渠道证据（仅 OpenRouter / 中转）"
      ],
      "releasedAt": "2026-10-12",
      "retirementAt": null,
      "sources": [
        {
          "checkedAt": "2026-10-26",
          "confidence": "high",
          "url": "https://openrouter.ai/api/v1/models"
        },
        {
          "checkedAt": "2026-10-26",
          "confidence": "low",
          "url": "https://artificialanalysis.ai/models/muse-wonder"
        }
      ]
    },
    {
      "caps": {
        "anthropicApi": false,
        "fim": false,
        "parallelTools": true,
        "prefixCompletion": false,
        "responsesApi": false,
        "structuredOutput": true,
        "tools": true,
        "vision": true
      },
      "channels": {
        "accountPool": [],
        "official": {
          "channel": "moonshot-official",
          "modelId": "kimi-k3.1-pro",
          "qualifiedId": "moonshot-official/kimi-k3.1-pro"
        },
        "openrouterId": "moonshotai/kimi-k3.1-pro",
        "openrouterPriceUsd": {
          "cacheRead": 0.2,
          "input": 2,
          "output": 10
        },
        "relay": [
          {
            "availability": "unknown",
            "billingMode": "unknown",
            "channel": "qiyue",
            "priceUnknown": true,
            "qualifiedId": "qiyue/kimi-k3.1-pro"
          },
          {
            "availability": "unknown",
            "billingMode": "unknown",
            "channel": "qy",
            "priceUnknown": true,
            "qualifiedId": "qy/kimi-k3.1-pro"
          },
          {
            "availability": "unknown",
            "billingMode": "unknown",
            "channel": "sub2",
            "priceUnknown": true,
            "qualifiedId": "sub2/kimi-k3.1-pro"
          }
        ]
      },
      "contextWindow": 1048576,
      "deprecatedAt": null,
      "display": "Kimi K3.1 Pro",
      "effort": {
        "aliases": {},
        "alwaysReasoning": true,
        "default": "max",
        "disable": "never",
        "notes": "始终推理、不可关；不传 reasoning_effort 时默认 max（最贵）→ router 必须显式传档",
        "param": "reasoning_effort",
        "reasoningBilling": "included_in_output",
        "reasoningPassthrough": "optional",
        "vocab": [
          "low",
          "high",
          "max"
        ]
      },
      "id": "kimi-k3.1-pro",
      "input": [
        "text",
        "image"
      ],
      "maxOutput": 943718,
      "output": [
        "text"
      ],
      "perf": {
        "confidence": "medium",
        "speedTps": 57.5,
        "ttftMs": null,
        "verbosityMTokensPerIndexRun": 150
      },
      "pricing": {
        "cacheRead": 0.2,
        "cacheWrite": null,
        "currency": "USD",
        "effectiveFrom": "2026-10-23",
        "input": 2,
        "longContext": [],
        "notes": "比 Kimi K3 三项全线低 33%；平台域名分国际 platform.kimi.ai 与国内 platform.kimi.com",
        "output": 10,
        "peakOffpeak": null,
        "perCall": [],
        "unit": "per_1m_tokens"
      },
      "provider": "moonshot",
      "quality": {
        "aaCostPerTaskUsd": 2.11,
        "aaIndex": 55,
        "aaVariant": "default(max)",
        "aaVersion": "v4.3.2",
        "confidence": "medium",
        "otherBenchmarks": {
          "aaOmniscience": 30,
          "automationBenchAA": 73,
          "gdpvalElo": 1846,
          "hle": 52,
          "sciCode": 61
        },
        "swebenchVerified": null,
        "terminalBench4": 67.0
      },
      "quirks": [
        "默认档 = max（最贵档），与 DeepSeek/OpenAI 的「不传 = 中间档」相反",
        "从 K2.x 迁移：移除 thinking 配置，改用顶层 reasoning_effort",
        "权重尚未开放（官方称很快）；开放后将成为最强开放权重模型",
        "Terminal-Bench 4.0 = 67%（高于 Opus 5.5 的 64%），agentic 编码是它的强项"
      ],
      "releasedAt": "2026-10-23",
      "retirementAt": null,
      "sources": [
        {
          "checkedAt": "2026-10-26",
          "confidence": "high",
          "url": "https://platform.kimi.ai/docs/guide/use-reasoning-effort.md"
        },
        {
          "checkedAt": "2026-10-26",
          "confidence": "high",
          "url": "https://artificialanalysis.ai/articles/kimi-k3-1-pro-launch-benchmarks"
        },
        {
          "checkedAt": "2026-10-26",
          "confidence": "medium",
          "url": "https://artificialanalysis.ai/models/kimi-k3-1-pro"
        },
        {
          "checkedAt": "2026-10-26",
          "confidence": "high",
          "url": "https://openrouter.ai/api/v1/models"
        }
      ]
    },
    {
      "caps": {
        "anthropicApi": false,
        "fim": false,
        "parallelTools": false,
        "prefixCompletion": false,
        "responsesApi": false,
        "structuredOutput": true,
        "tools": true,
        "video": true,
        "vision": true
      },
      "channels": {
        "accountPool": [],
        "official": {
          "channel": "minimax-official",
          "modelId": "minimax-m3.1-flash",
          "qualifiedId": "minimax-official/minimax-m3.1-flash"
        },
        "openrouterId": "minimax/minimax-m3.1-flash",
        "openrouterPriceUsd": {
          "cacheRead": 0.015,
          "input": 0.15,
          "output": 0.6
        },
        "relay": [
          {
            "availability": "unknown",
            "billingMode": "unknown",
            "channel": "qiyue",
            "priceUnknown": true,
            "qualifiedId": "qiyue/minimax-m3.1-flash"
          },
          {
            "availability": "unknown",
            "billingMode": "unknown",
            "channel": "qy",
            "priceUnknown": true,
            "qualifiedId": "qy/minimax-m3.1-flash"
          },
          {
            "availability": "unknown",
            "billingMode": "unknown",
            "channel": "sub2",
            "priceUnknown": true,
            "qualifiedId": "sub2/minimax-m3.1-flash"
          }
        ]
      },
      "contextWindow": 1048576,
      "deprecatedAt": null,
      "display": "MiniMax M3.1 Flash",
      "effort": {
        "aliases": {},
        "alwaysReasoning": true,
        "default": "always_on",
        "disable": "never",
        "notes": "深度思考始终开启，无档位可调（router 侧只能按「开/关思考」都不行，只能整体选/不选）",
        "param": null,
        "reasoningBilling": "included_in_output",
        "reasoningPassthrough": "optional",
        "vocab": []
      },
      "id": "minimax-m3.1-flash",
      "input": [
        "text",
        "image",
        "video"
      ],
      "maxOutput": 524288,
      "output": [
        "text"
      ],
      "perf": {
        "confidence": "low",
        "speedTps": null,
        "ttftMs": null,
        "verbosityMTokensPerIndexRun": null
      },
      "pricing": {
        "alternatePriceList": [
          {
            "cacheRead": 0.1,
            "channel": "aliyun-bailian",
            "currency": "CNY",
            "input": 1,
            "output": 4
          }
        ],
        "cacheRead": 0.015,
        "cacheWrite": null,
        "currency": "USD",
        "effectiveFrom": "2026-10-19",
        "input": 0.15,
        "longContext": [],
        "notes": "百炼人民币价 ¥1/¥4/¥0.1；RPM 200 · TPM 10,000,000",
        "output": 0.6,
        "peakOffpeak": null,
        "perCall": [],
        "unit": "per_1m_tokens"
      },
      "provider": "minimax",
      "quality": {
        "aaIndex": null,
        "aaVersion": "v4.3.2",
        "confidence": "low",
        "swebenchVerified": null,
        "terminalBench4": null
      },
      "quirks": [
        "不支持 stop 参数（传了不截断，且可能仍返回 finish_reason=stop）",
        "parallel_tool_calls 不生效；tool_choice 仅支持 auto",
        "无 effort 档位可用，无法做「同模型降档省钱」"
      ],
      "releasedAt": "2026-10-19",
      "retirementAt": null,
      "sources": [
        {
          "checkedAt": "2026-10-26",
          "confidence": "high",
          "url": "https://openrouter.ai/api/v1/models"
        },
        {
          "checkedAt": "2026-10-26",
          "confidence": "medium",
          "url": "https://help.aliyun.com/zh/model-studio/"
        }
      ]
    },
    {
      "caps": {
        "anthropicApi": false,
        "fim": false,
        "parallelTools": true,
        "prefixCompletion": true,
        "responsesApi": false,
        "structuredOutput": true,
        "tools": true,
        "vision": false
      },
      "channels": {
        "accountPool": [],
        "official": {
          "channel": "aliyun-bailian",
          "modelId": "qwen3.8-max-prime",
          "qualifiedId": "aliyun-bailian/qwen3.8-max-prime"
        },
        "openrouterId": "qwen/qwen3.8-max-prime",
        "openrouterPriceUsd": {
          "cacheRead": 0.5,
          "input": 4,
          "output": 12
        },
        "relay": [
          {
            "availability": "unknown",
            "billingMode": "unknown",
            "channel": "qiyue",
            "priceUnknown": true,
            "qualifiedId": "qiyue/qwen3.8-max-prime"
          },
          {
            "availability": "unknown",
            "billingMode": "unknown",
            "channel": "qy",
            "priceUnknown": true,
            "qualifiedId": "qy/qwen3.8-max-prime"
          },
          {
            "availability": "unknown",
            "billingMode": "unknown",
            "channel": "sub2",
            "priceUnknown": true,
            "qualifiedId": "sub2/qwen3.8-max-prime"
          }
        ]
      },
      "contextWindow": 1000000,
      "deprecatedAt": null,
      "display": "Qwen3.8-Max-Prime",
      "effort": {
        "aliases": {},
        "alwaysReasoning": "unknown",
        "default": "unknown",
        "disable": "unknown",
        "notes": "Qwen3.8 系用 enable_thinking 开关 + token 预算（flash 的 CoT 上限 262,144）；max-prime 的具体预算区间未核实",
        "param": "enable_thinking + thinking_budget",
        "reasoningBilling": "included_in_output",
        "reasoningPassthrough": "optional",
        "vocab": []
      },
      "id": "qwen3.8-max-prime",
      "input": [
        "text"
      ],
      "maxOutput": 131072,
      "output": [
        "text"
      ],
      "perf": {
        "confidence": "low",
        "speedTps": null,
        "ttftMs": null,
        "verbosityMTokensPerIndexRun": null
      },
      "pricing": {
        "cacheRead": 0.5,
        "cacheWrite": null,
        "currency": "USD",
        "effectiveFrom": "2026-09-23",
        "input": 4,
        "longContext": [],
        "notes": "OpenRouter 挂牌；百炼人民币价未核实（同系列 qwen3.8-max-0902 为 2/6）",
        "output": 12,
        "peakOffpeak": null,
        "perCall": [],
        "unit": "per_1m_tokens"
      },
      "provider": "alibaba",
      "quality": {
        "aaIndex": null,
        "aaVersion": "v4.3.2",
        "confidence": "low",
        "swebenchVerified": null,
        "terminalBench4": null
      },
      "quirks": [
        "同系列三档价格跨度大：max-prime 4/12、max-0902 2/6、flash 0.113/0.382 → 路由时应优先试低价档",
        "Qwen 4 尚未 GA（仅 CometAPI Coming soon 与媒体专文，置信度低）"
      ],
      "releasedAt": "2026-09-23",
      "retirementAt": null,
      "sources": [
        {
          "checkedAt": "2026-10-26",
          "confidence": "high",
          "url": "https://openrouter.ai/api/v1/models"
        },
        {
          "checkedAt": "2026-10-26",
          "confidence": "medium",
          "url": "https://www.alibabacloud.com/help/zh/model-studio/qwen3-8-flash"
        }
      ]
    },
    {
      "caps": {
        "anthropicApi": true,
        "fim": false,
        "parallelTools": true,
        "prefixCompletion": true,
        "responsesApi": true,
        "structuredOutput": true,
        "tools": true,
        "video": true,
        "vision": true
      },
      "channels": {
        "accountPool": [],
        "official": {
          "channel": "aliyun-bailian",
          "modelId": "qwen3.8-flash",
          "qualifiedId": "aliyun-bailian/qwen3.8-flash"
        },
        "openrouterId": "qwen/qwen3.8-flash",
        "openrouterPriceUsd": null,
        "relay": [
          {
            "availability": "unknown",
            "billingMode": "unknown",
            "channel": "qiyue",
            "priceUnknown": true,
            "qualifiedId": "qiyue/qwen3.8-flash"
          },
          {
            "availability": "unknown",
            "billingMode": "unknown",
            "channel": "qy",
            "priceUnknown": true,
            "qualifiedId": "qy/qwen3.8-flash"
          },
          {
            "availability": "unknown",
            "billingMode": "unknown",
            "channel": "sub2",
            "priceUnknown": true,
            "qualifiedId": "sub2/qwen3.8-flash"
          }
        ]
      },
      "contextWindow": 1000000,
      "deprecatedAt": null,
      "display": "Qwen3.8-Flash",
      "effort": {
        "aliases": {},
        "alwaysReasoning": false,
        "default": "unknown",
        "disable": "supported",
        "notes": "开关式思考 + 预算上限 262,144；具体档位区间未核实",
        "param": "enable_thinking + thinking_budget",
        "reasoningBilling": "included_in_output",
        "reasoningPassthrough": "optional",
        "vocab": []
      },
      "id": "qwen3.8-flash",
      "input": [
        "text",
        "image",
        "video"
      ],
      "maxOutput": 131072,
      "output": [
        "text"
      ],
      "perf": {
        "confidence": "low",
        "speedTps": null,
        "ttftMs": null,
        "verbosityMTokensPerIndexRun": null
      },
      "pricing": {
        "alternatePriceList": [
          {
            "cacheRead": 0.016,
            "channel": "aliyun-bailian-singapore",
            "currency": "USD",
            "input": 0.15,
            "output": 0.47
          }
        ],
        "cacheRead": 0.014,
        "cacheWrite": 0.177,
        "currency": "USD",
        "effectiveFrom": "unknown",
        "input": 0.113,
        "longContext": [],
        "notes": "华北2北京价；最大输入 991,808、思考模式最大 CoT 262,144；文档更新时间 2026-10-11",
        "output": 0.382,
        "peakOffpeak": null,
        "perCall": [],
        "unit": "per_1m_tokens"
      },
      "provider": "alibaba",
      "quality": {
        "aaIndex": null,
        "aaVersion": "v4.3.2",
        "confidence": "low",
        "swebenchVerified": null,
        "terminalBench4": null
      },
      "quirks": [
        "兼容 OpenAI 与 Anthropic 协议（可直接接 Claude Code / Codex）",
        "显式缓存有「创建费」0.177（唯一在本表里单列 cacheWrite 的国产模型）",
        "releasedAt 未核实 → unknown"
      ],
      "releasedAt": "unknown",
      "retirementAt": null,
      "sources": [
        {
          "checkedAt": "2026-10-26",
          "confidence": "high",
          "url": "https://www.alibabacloud.com/help/zh/model-studio/qwen3-8-flash"
        }
      ]
    },
    {
      "caps": {
        "anthropicApi": false,
        "fim": false,
        "parallelTools": true,
        "prefixCompletion": true,
        "responsesApi": false,
        "structuredOutput": true,
        "tools": true,
        "vision": false
      },
      "channels": {
        "accountPool": [],
        "official": {
          "channel": "zhipu-official",
          "modelId": "glm-5.3-prime",
          "qualifiedId": "zhipu-official/glm-5.3-prime"
        },
        "openrouterId": "z-ai/glm-5.3-prime",
        "openrouterPriceUsd": {
          "cacheRead": 0.56,
          "input": 2.8,
          "output": 8.8
        },
        "relay": [
          {
            "availability": "unknown",
            "billingMode": "unknown",
            "channel": "qiyue",
            "priceUnknown": true,
            "qualifiedId": "qiyue/glm-5.3-prime"
          },
          {
            "availability": "unknown",
            "billingMode": "unknown",
            "channel": "qy",
            "priceUnknown": true,
            "qualifiedId": "qy/glm-5.3-prime"
          },
          {
            "availability": "unknown",
            "billingMode": "unknown",
            "channel": "sub2",
            "priceUnknown": true,
            "qualifiedId": "sub2/glm-5.3-prime"
          }
        ]
      },
      "contextWindow": 1000000,
      "deprecatedAt": null,
      "display": "GLM-5.3-Prime",
      "effort": {
        "aliases": {},
        "alwaysReasoning": false,
        "default": "unknown",
        "disable": "supported",
        "notes": "开关式 thinking + 最大思维链 131,072（按 GLM-5 官方参数表外推，5.3 未逐项核实）",
        "param": "thinking + max thinking tokens",
        "reasoningBilling": "included_in_output",
        "reasoningPassthrough": "optional",
        "vocab": []
      },
      "id": "glm-5.3-prime",
      "input": [
        "text"
      ],
      "maxOutput": 131072,
      "output": [
        "text"
      ],
      "perf": {
        "confidence": "low",
        "speedTps": null,
        "ttftMs": null,
        "verbosityMTokensPerIndexRun": null
      },
      "pricing": {
        "cacheRead": 0.56,
        "cacheWrite": null,
        "currency": "USD",
        "effectiveFrom": "2026-09-23",
        "input": 2.8,
        "longContext": [],
        "notes": "OpenRouter 挂牌；百炼侧同系列 GLM-5 为 ¥6/¥22/¥1.5（人民币），GLM-5.3 中文渠道价未核实",
        "output": 8.8,
        "peakOffpeak": null,
        "perCall": [],
        "unit": "per_1m_tokens"
      },
      "provider": "zhipu",
      "quality": {
        "aaIndex": null,
        "aaVersion": "v4.3.2",
        "confidence": "low",
        "swebenchVerified": null,
        "terminalBench4": null
      },
      "quirks": [
        "定位 Agentic Engineering，仅文本输入输出",
        "GLM-5 海外曾大幅涨价（媒体标题证据，置信度低）"
      ],
      "releasedAt": "2026-09-23",
      "retirementAt": null,
      "sources": [
        {
          "checkedAt": "2026-10-26",
          "confidence": "high",
          "url": "https://openrouter.ai/api/v1/models"
        },
        {
          "checkedAt": "2026-10-26",
          "confidence": "medium",
          "url": "https://help.aliyun.com/zh/model-studio/glm-5-by-zhipu"
        }
      ]
    },
    {
      "caps": {
        "anthropicApi": false,
        "fim": false,
        "parallelTools": true,
        "prefixCompletion": true,
        "responsesApi": false,
        "structuredOutput": true,
        "tools": true,
        "vision": false
      },
      "channels": {
        "accountPool": [],
        "official": {
          "channel": "zhipu-official",
          "modelId": "glm-5.3-flashx",
          "qualifiedId": "zhipu-official/glm-5.3-flashx"
        },
        "openrouterId": "z-ai/glm-5.3-flashx",
        "openrouterPriceUsd": {
          "cacheRead": 0.09,
          "input": 0.37,
          "output": 1.25
        },
        "relay": [
          {
            "availability": "unknown",
            "billingMode": "unknown",
            "channel": "qiyue",
            "priceUnknown": true,
            "qualifiedId": "qiyue/glm-5.3-flashx"
          },
          {
            "availability": "unknown",
            "billingMode": "unknown",
            "channel": "qy",
            "priceUnknown": true,
            "qualifiedId": "qy/glm-5.3-flashx"
          },
          {
            "availability": "unknown",
            "billingMode": "unknown",
            "channel": "sub2",
            "priceUnknown": true,
            "qualifiedId": "sub2/glm-5.3-flashx"
          }
        ]
      },
      "contextWindow": 1048576,
      "deprecatedAt": null,
      "display": "GLM-5.3-FlashX",
      "effort": {
        "aliases": {},
        "alwaysReasoning": false,
        "default": "unknown",
        "disable": "supported",
        "notes": "同 GLM-5.3 家族（开关式），未逐项核实",
        "param": "thinking + max thinking tokens",
        "reasoningBilling": "included_in_output",
        "reasoningPassthrough": "optional",
        "vocab": []
      },
      "id": "glm-5.3-flashx",
      "input": [
        "text"
      ],
      "maxOutput": 131072,
      "output": [
        "text"
      ],
      "perf": {
        "confidence": "low",
        "speedTps": null,
        "ttftMs": null,
        "verbosityMTokensPerIndexRun": null
      },
      "pricing": {
        "cacheRead": 0.09,
        "cacheWrite": null,
        "currency": "USD",
        "effectiveFrom": "2026-09-18",
        "input": 0.37,
        "longContext": [],
        "notes": "OpenRouter 挂牌；本表性价比最高的中文档之一",
        "output": 1.25,
        "peakOffpeak": null,
        "perCall": [],
        "unit": "per_1m_tokens"
      },
      "provider": "zhipu",
      "quality": {
        "aaIndex": null,
        "aaVersion": "v4.3.2",
        "confidence": "low",
        "swebenchVerified": null,
        "terminalBench4": null
      },
      "quirks": [
        "1M 上下文 + 0.37/1.25，长文档/批量场景的价格优势明显",
        "仅文本，不支持图像"
      ],
      "releasedAt": "2026-09-18",
      "retirementAt": null,
      "sources": [
        {
          "checkedAt": "2026-10-26",
          "confidence": "high",
          "url": "https://openrouter.ai/api/v1/models"
        }
      ]
    }
  ],
  "schemaVersion": "1.0.0"
}

/** Every model entry, frozen, in catalog order. */
export const MODELS = Object.freeze(CATALOG.models)

/**
 * Look one model up.
 *
 * The first argument is a provider or a channel name: the canonical provider
 * ("deepseek"), an official channel ("deepseek-official"), an account-pool
 * channel ("deepseek-account"), a relay ("qiyue", "qy", "sub2") or
 * "openrouter". The second argument is a model id - either the catalog id
 * ("deepseek-flash") or a channel-qualified / OpenRouter id
 * ("deepseek/deepseek-v4.1-flash-1017").
 *
 * When the provider is omitted (or unknown) the id alone is matched, which is
 * what the panel does when the user typed just a model name.
 *
 * @param {string | null | undefined} provider
 * @param {string | null | undefined} id
 * @returns {object | undefined} the matching model entry
 */
export function findModel(provider, id) {
  // findModel(id) is the common case; treat a lone argument as the id.
  if (id === undefined) {
    id = provider
    provider = undefined
  }
  const wantProvider = normalizeKey(provider)
  const wantId = normalizeKey(id)
  if (wantId.length === 0) return undefined

  const channelNames = (model) => {
    const channels = model.channels || {}
    const names = []
    const official = channels.official || {}
    if (typeof official.channel === 'string' && official.channel.length > 0) names.push(official.channel)
    if (typeof channels.openrouterId === 'string' && channels.openrouterId.length > 0) names.push('openrouter')
    for (const entry of channels.accountPool || []) {
      if (entry && typeof entry.channel === 'string' && entry.channel.length > 0) names.push(entry.channel)
    }
    for (const entry of channels.relay || []) {
      if (entry && typeof entry.channel === 'string' && entry.channel.length > 0) names.push(entry.channel)
    }
    return names
  }

  const idMatches = (model) => {
    const channels = model.channels || {}
    const official = channels.official || {}
    if (normalizeKey(model.id) === wantId) return true
    if (normalizeKey(official.modelId) === wantId) return true
    if (normalizeKey(channels.openrouterId) === wantId) return true
    // Channel-qualified ids ("qiyue/deepseek-flash") address a specific resale
    // route, so match those too - otherwise a relay id looks unknown.
    for (const entry of [...(channels.accountPool || []), ...(channels.relay || [])]) {
      if (!entry) continue
      if (normalizeKey(entry.qualifiedId) === wantId) return true
      if (normalizeKey(entry.channel + '/' + entry.modelId) === wantId) return true
    }
    return false
  }

  const candidates = CATALOG.models.filter(idMatches)
  if (candidates.length === 0) return undefined
  if (wantProvider.length === 0) return candidates[0]

  for (const model of candidates) {
    const names = channelNames(model).map(normalizeKey)
    // The bare provider is a valid address too ("deepseek" == any deepseek entry).
    if (names.includes(wantProvider) || normalizeKey(model.provider) === wantProvider) return model
  }
  // A model exists under that id but not under the requested channel: return it
  // anyway so callers can fall back to the canonical entry instead of crashing.
  return candidates[0]
}

/** Lowercase, trim, and treat null/undefined as the empty string. */
function normalizeKey(value) {
  return String(value === undefined || value === null ? '' : value)
    .trim()
    .toLowerCase()
}
