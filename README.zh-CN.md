<div align="center">

<img src="assets/logo.png" alt="OAIProxy Logo" width="120" height="120">

# OAIProxy

**自维护的 VS Code 扩展，用于在 GitHub Copilot Chat 中使用 OpenAI/Ollama/Anthropic/Gemini API 兼容供应商，并内置 Kimi、DeepSeek、MiniMax 预设** 🔥

[English](README.md) | 简体中文

</div>

[![License](https://img.shields.io/github/license/lqdflying/OAIProxy?color=orange&label=License)](https://github.com/lqdflying/OAIProxy/blob/main/LICENSE)

## 特性
- **多 API 支持**：OpenAI/Ollama/Anthropic/Gemini API，并内置 Kimi、DeepSeek、MiniMax、ModelScope、SiliconFlow 等 OpenAI 兼容供应商预设
- **视觉模型**：完整支持图像理解能力
- **视觉桥接**：在纯文本模型中使用图像 — OAIProxy 通过配置的视觉模型自动描述图像，并采用 LRU 缓存
- **思维链标签支持**：在所有供应商（OpenAI、Ollama、Gemini、Anthropic）中无缝显示模型思维/推理模块
- **思维链力度控制**：模型选择器中 VS Code 内置的按模型 Thinking Effort 下拉菜单 — 实时自定义推理力度
- **高级配置**：灵活的对话请求选项，支持思维链/推理控制
- **多供应商管理**：同时配置多个供应商模型，自动管理各供应商 API 密钥
- **同模型多配置**：为同一模型定义不同参数配置（如 GLM-4.6 开启/关闭思维链）
- **可视化配置界面**：直观的界面管理供应商和模型
- **自动重试**：处理 API 错误（429、500、502、503、504），支持指数退避
- **请求取消**：即时停止进行中的聊天请求 — 所有五种 API 模式均连接到 HTTP `AbortController`
- **Token 用量**：状态栏实时显示 token 计数和供应商 API 密钥管理
- **Git 集成**：使用 OpenAI/OpenAI Responses/Ollama/Anthropic 模型直接从源代码管理生成提交信息
- **导入/导出**：轻松分享和备份配置
- **工具优化**：对支持的流式工具调用优化 agent `read_file` 工具处理，避免对大文件读取小片段。
- **结构化日志**：基于文件的请求/调试日志，支持日志轮转和可配置级别（`off`/`debug`/`info`/`warn`/`error`）

## 环境要求
- VS Code 1.120.0 或更高版本。
- OpenAI 兼容供应商的 API 密钥。

## 快速开始
1. 安装 OAIProxy VSIX 包（`lqdflying.oaiproxy`）。
2. 打开 VS Code 设置，配置 `oaicopilot.baseUrl` 和 `oaicopilot.models`。
3. 打开 GitHub Copilot Chat 界面。
4. 点击模型选择器，选择 "Manage Models..."。
5. 选择 "OAIProxy" 供应商。
6. 输入你的 API 密钥——它将保存在本地。
7. 选择你想添加到模型选择器中的模型。

> 兼容性说明：OAIProxy 仍使用现有的 `oaicopilot.*` 设置键，因此已有 JSON 模型配置可以继续使用。由于扩展 ID 已改为 `lqdflying.oaiproxy`，VS Code 可能需要你在新扩展下重新输入一次 API Key。

### 配置示例

```json
"oaicopilot.baseUrl": "https://api-inference.modelscope.cn/v1",
"oaicopilot.models": [
    {
        "id": "Qwen/Qwen3-Coder-480B-A35B-Instruct",
        "owned_by": "modelscope",
        "context_length": 256000,
        "max_tokens": 8192
    }
]
```

## 配置界面

本扩展提供可视化配置界面，用于管理供应商、模型和 API 密钥，无需手动编辑 JSON 文件。可通过命令面板（`OAIProxy: Open Configuration UI`）打开，或点击 OAIProxy 状态栏项。

供应商管理表单内置 Kimi、DeepSeek、MiniMax 预设。选择预设会填入供应商 ID、Base URL 和 `openai` API 模式；模型 ID 仍以供应商当前文档或模型列表为准。

→ [完整配置指南](doc/configuration.zh-CN.md)

## 多 API 模式

支持五种 API 协议：`openai`（Chat Completions）、`openai-responses`（Responses）、`ollama`、`anthropic` 和 `gemini`。通过 `apiMode` 参数为每个模型指定。

Kimi、DeepSeek 和 MiniMax 使用现有 `openai` 模式，因为它们的托管 API 与 OpenAI 格式兼容。

→ [完整多 API 指南](doc/configuration.zh-CN.md#多-api-模式)

## 视觉桥接

在纯文本模型中使用图像。OAIProxy 通过配置的视觉能力模型自动描述图像，然后以文本形式转发，并采用 LRU 缓存（50 条，~500KB）。

→ [视觉桥接指南](doc/vision-bridge.zh-CN.md)

## 多供应商指南

同时配置多个供应商的模型。使用 `owned_by` 按供应商分组模型，自动按供应商管理 API 密钥，存储为 `oaicopilot.apiKey.<provider>`。

→ [多供应商指南](doc/configuration.zh-CN.md#多供应商指南)

## 同模型多配置

通过 `configId` 为同一模型 ID 定义多个配置（如 `glm-4.6::thinking` 和 `glm-4.6::no-thinking`），每个配置独立设置参数。

→ [多配置指南](doc/configuration.zh-CN.md#同模型多配置)

## 思维链力度控制

VS Code 1.120+ 在模型选择器中提供按模型的 Thinking Effort 下拉菜单。通过 `supports_reasoning_effort: true` 启用。DeepSeek 模型默认使用 `high`/`max`。

→ [思维链力度指南](doc/thinking-effort.zh-CN.md)

## 自定义请求头

为每个模型供应商指定自定义 HTTP 请求头（API 版本控制、额外认证、调试 token）。每次请求时与默认请求头合并。

→ [自定义请求头指南](doc/custom-headers.zh-CN.md)

## 自定义请求体参数

使用 `extra` 字段在所有 API 模式中向 API 请求体注入任意 JSON 参数。可覆盖标准参数或添加供应商特定功能。

→ [自定义请求体指南](doc/custom-request-body.zh-CN.md)

## 模型参数

全部 30 多个可配置模型参数的完整参考（`id`、`owned_by`、`temperature`、`reasoning_effort`、`vision`、`toolCalling`、`apiMode` 等）。

→ [模型参数参考](doc/model-parameters.zh-CN.md)

## 日志

OAIProxy 会始终把扩展生命周期事件（安装、更新、激活）写入 VS Code Output 面板。打开 `Output: Show Output`，然后选择 `OAIProxy`。

如需请求和调试日志，在 VS Code 用户 Settings JSON 中添加：

```json
"oaicopilot.logLevel": "debug"
```

可选值为 `off`、`debug`、`info`、`warn`、`error`。文件日志写入 `~/.copilot/oaiproxy/logs/`，支持每日轮转（超过 7 天的日志自动清理）。敏感请求头值（`Authorization`、`x-api-key`、`x-goog-api-key`）会在日志输出中自动脱敏。

## 致谢

感谢所有贡献者。

- [贡献者](https://github.com/lqdflying/OAIProxy/graphs/contributors)
- [Hugging Face Chat 扩展](https://github.com/huggingface/huggingface-vscode-chat)
- [VS Code Chat Provider API](https://code.visualstudio.com/api/extension-guides/ai/language-model-chat-provider)

## 支持 & 许可证
- 提交 Issue：https://github.com/lqdflying/OAIProxy/issues
- 许可证：MIT。
- 原上游项目版权 Copyright (c) 2025 Johnny Zhao；OAIProxy 修改部分版权 Copyright (c) 2026 lqdflying。
