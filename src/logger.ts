import * as fs from "fs";
import * as fsp from "fs/promises";
import * as path from "path";
import * as os from "os";
import * as vscode from "vscode";

type LogLevel = "off" | "debug" | "info" | "warn" | "error";

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
	off: -1,
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
};

const LOG_RETENTION_DAYS = 7;
const LOG_CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const SENSITIVE_HEADER_KEYS = ["Authorization", "x-api-key", "x-goog-api-key"];

class Logger {
	private _level: LogLevel = "off";
	private _logDir = "";
	private _initialized = false;
	private _outputChannel: vscode.OutputChannel | undefined;
	private _lastCleanupTime = 0;

	/**
	 * Initialize the logger: read config, ensure log directory exists.
	 */
	init(): void {
		this._logDir = path.join(os.homedir(), ".copilot", "oaiproxy", "logs");
		this._outputChannel ??= vscode.window.createOutputChannel("OAIProxy");
		this.reloadConfig();
		this.ensureLogDir();
		this._initialized = true;
	}

	dispose(): void {
		this._outputChannel?.dispose();
		this._outputChannel = undefined;
		this._initialized = false;
	}

	/**
	 * Reload log level from VS Code configuration.
	 */
	reloadConfig(): void {
		const config = vscode.workspace.getConfiguration();
		this._level = config.get<LogLevel>("oaicopilot.logLevel", "off");
	}

	debug(tag: string, data: Record<string, unknown>): void {
		if (this._level === "off" || LOG_LEVEL_PRIORITY[this._level] > LOG_LEVEL_PRIORITY.debug) {
			return;
		}
		if (this.shouldSkipDebugLog(tag, data)) {
			return;
		}
		this.write("debug", tag, data);
	}

	info(tag: string, data: Record<string, unknown>): void {
		if (this._level === "off" || LOG_LEVEL_PRIORITY[this._level] > LOG_LEVEL_PRIORITY.info) {
			return;
		}
		this.write("info", tag, data);
	}

	warn(tag: string, data: Record<string, unknown>): void {
		if (this._level === "off" || LOG_LEVEL_PRIORITY[this._level] > LOG_LEVEL_PRIORITY.warn) {
			return;
		}
		this.write("warn", tag, data);
	}

	error(tag: string, data: Record<string, unknown>): void {
		if (this._level === "off" || LOG_LEVEL_PRIORITY[this._level] > LOG_LEVEL_PRIORITY.error) {
			return;
		}
		this.write("error", tag, data);
	}

	lifecycle(tag: string, data: Record<string, unknown>): void {
		if (!this._initialized) {
			return;
		}

		const sanitizedData = this.sanitizeData(data);
		this.writeOutput("info", tag, sanitizedData);
		if (this._level !== "off" && LOG_LEVEL_PRIORITY[this._level] <= LOG_LEVEL_PRIORITY.info) {
			this.writeFile("info", tag, sanitizedData);
		}
	}

	/**
	 * Sanitize sensitive headers: show only first 4 chars + "***" for auth-related keys.
	 */
	sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
		const sanitized: Record<string, string> = {};
		for (const [key, value] of Object.entries(headers)) {
			if (SENSITIVE_HEADER_KEYS.includes(key)) {
				// Extract the token part after "Bearer " if present
				const tokenPrefix = value.startsWith("Bearer ") ? "Bearer " : "";
				const token = value.startsWith("Bearer ") ? value.slice(7) : value;
				if (token.length <= 4) {
					sanitized[key] = tokenPrefix + "***";
				} else {
					sanitized[key] = tokenPrefix + token.slice(0, 4) + "***";
				}
			} else {
				sanitized[key] = value;
			}
		}
		return sanitized;
	}

	/**
	 * Sanitize any object that may contain headers deeply.
	 * Looks for "headers" keys at any level and sanitates them.
	 */
	sanitizeData(data: Record<string, unknown>): Record<string, unknown> {
		const result: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(data)) {
			if (key === "headers" && value && typeof value === "object" && !Array.isArray(value)) {
				result[key] = this.sanitizeHeaders(value as Record<string, string>);
			} else if (value && typeof value === "object" && !Array.isArray(value)) {
				result[key] = this.sanitizeData(value as Record<string, unknown>);
			} else {
				result[key] = value;
			}
		}
		return result;
	}

	private ensureLogDir(): void {
		if (!fs.existsSync(this._logDir)) {
			fs.mkdirSync(this._logDir, { recursive: true });
		}
	}

	private getLogFilePath(): string {
		const now = new Date();
		const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
		return path.join(this._logDir, `oaiproxy-${dateStr}.log`);
	}

	private write(level: string, tag: string, data: Record<string, unknown>): void {
		if (!this._initialized) {
			return;
		}

		const sanitizedData = this.sanitizeLogData(tag, data);
		this.writeOutput(level, tag, sanitizedData);
		this.writeFile(level, tag, sanitizedData);
	}

	private sanitizeLogData(tag: string, data: Record<string, unknown>): Record<string, unknown> {
		const sanitizedData = this.sanitizeData(data);
		if (tag.includes(".stream.chunk")) {
			return this.summarizeStreamChunkData(sanitizedData);
		}
		return sanitizedData;
	}

	private shouldSkipDebugLog(tag: string, data: Record<string, unknown>): boolean {
		if (!tag.endsWith(".stream.chunk")) {
			return false;
		}

		return !this.isImportantStreamChunk(data.data);
	}

	private isImportantStreamChunk(payload: unknown): boolean {
		if (payload === "[DONE]") {
			return true;
		}

		const metadata = this.extractStreamPayloadMetadata(this.parseStreamPayload(payload));
		return (
			metadata.done === true ||
			metadata.usage !== undefined ||
			metadata.usageMetadata !== undefined ||
			metadata.finishReason !== undefined ||
			metadata.type === "message_start" ||
			metadata.type === "message_stop"
		);
	}

	private parseStreamPayload(payload: unknown): unknown {
		if (typeof payload !== "string" || payload === "[DONE]") {
			return payload;
		}

		try {
			return JSON.parse(payload);
		} catch {
			return payload;
		}
	}

	private summarizeStreamChunkData(data: Record<string, unknown>): Record<string, unknown> {
		if (!("data" in data)) {
			return data;
		}

		return {
			...data,
			data: this.summarizeStreamPayload(data.data),
		};
	}

	private summarizeStreamPayload(payload: unknown): Record<string, unknown> {
		if (typeof payload === "string") {
			const summary: Record<string, unknown> = {
				rawOmitted: true,
				rawType: "string",
				rawLength: payload.length,
			};
			if (payload === "[DONE]") {
				summary.done = true;
				return summary;
			}

			try {
				Object.assign(summary, this.extractStreamPayloadMetadata(JSON.parse(payload)));
			} catch {
				summary.parseableJson = false;
			}
			return summary;
		}

		return {
			rawOmitted: true,
			rawType: Array.isArray(payload) ? "array" : typeof payload,
			...this.extractStreamPayloadMetadata(payload),
		};
	}

	private extractStreamPayloadMetadata(payload: unknown): Record<string, unknown> {
		if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
			return {};
		}

		const obj = payload as Record<string, unknown>;
		const summary: Record<string, unknown> = {};
		for (const key of ["id", "object", "model", "type", "event"]) {
			if (typeof obj[key] === "string") {
				summary[key] = obj[key];
			}
		}
		if (typeof obj.done === "boolean") {
			summary.done = obj.done;
		}
		if (obj.usage && typeof obj.usage === "object" && !Array.isArray(obj.usage)) {
			summary.usage = obj.usage;
		}
		if (obj.usageMetadata && typeof obj.usageMetadata === "object" && !Array.isArray(obj.usageMetadata)) {
			summary.usageMetadata = obj.usageMetadata;
		}
		if (typeof obj.delta === "string") {
			summary.deltaLength = obj.delta.length;
		} else if (obj.delta && typeof obj.delta === "object" && !Array.isArray(obj.delta)) {
			this.addDeltaMetadata(summary, obj.delta as Record<string, unknown>, "delta");
		}
		if (typeof obj.response === "string") {
			summary.responseLength = obj.response.length;
		}
		if (obj.message && typeof obj.message === "object" && !Array.isArray(obj.message)) {
			const message = obj.message as Record<string, unknown>;
			if (typeof message.role === "string") {
				summary.messageRole = message.role;
			}
			if (typeof message.content === "string") {
				summary.messageContentLength = message.content.length;
			}
		}

		const choice = Array.isArray(obj.choices) && obj.choices[0] && typeof obj.choices[0] === "object"
			? obj.choices[0] as Record<string, unknown>
			: undefined;
		if (choice) {
			if (typeof choice.finish_reason === "string") {
				summary.finishReason = choice.finish_reason;
			}
			if (typeof choice.finishReason === "string") {
				summary.finishReason = choice.finishReason;
			}
			if (choice.delta && typeof choice.delta === "object" && !Array.isArray(choice.delta)) {
				this.addDeltaMetadata(summary, choice.delta as Record<string, unknown>, "choiceDelta");
			}
		}

		const candidate = Array.isArray(obj.candidates) && obj.candidates[0] && typeof obj.candidates[0] === "object"
			? obj.candidates[0] as Record<string, unknown>
			: undefined;
		if (candidate) {
			if (typeof candidate.finishReason === "string") {
				summary.finishReason = candidate.finishReason;
			}
			const content = candidate.content;
			if (content && typeof content === "object" && !Array.isArray(content)) {
				const parts = (content as Record<string, unknown>).parts;
				if (Array.isArray(parts)) {
					summary.candidatePartCount = parts.length;
					summary.candidateTextLength = parts.reduce((total, part) => {
						if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") {
							return total + ((part as { text: string }).text.length);
						}
						return total;
					}, 0);
				}
			}
		}

		return summary;
	}

	private addDeltaMetadata(summary: Record<string, unknown>, delta: Record<string, unknown>, prefix: string): void {
		summary[`${prefix}Keys`] = Object.keys(delta);
		if (typeof delta.content === "string") {
			summary[`${prefix}ContentLength`] = delta.content.length;
		}
		if (typeof delta.reasoning_content === "string") {
			summary[`${prefix}ReasoningLength`] = delta.reasoning_content.length;
		}
		if (typeof delta.text === "string") {
			summary[`${prefix}TextLength`] = delta.text.length;
		}
		if (Array.isArray(delta.tool_calls)) {
			summary[`${prefix}ToolCallCount`] = delta.tool_calls.length;
		}
	}

	private writeOutput(level: string, tag: string, data: Record<string, unknown>): void {
		this._outputChannel?.appendLine(`[${new Date().toISOString()}] ${level.toUpperCase()} ${tag} ${JSON.stringify(data)}`);
	}

	private writeFile(level: string, tag: string, data: Record<string, unknown>): void {
		const logEntry = {
			ts: new Date().toISOString(),
			level,
			tag,
			data,
		};

		const line = JSON.stringify(logEntry) + "\n";
		const filePath = this.getLogFilePath();

		fsp.appendFile(filePath, line, "utf8").catch((e) => {
			console.error("[OAIProxy Logger] Failed to write log:", e);
		});

		const now = Date.now();
		if (now - this._lastCleanupTime > LOG_CLEANUP_INTERVAL_MS) {
			this._lastCleanupTime = now;
			this.cleanOldLogs();
		}
	}

	private cleanOldLogs(): void {
		fsp.readdir(this._logDir).then((files) => {
			const now = new Date();
			const cutoffTime = now.getTime() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;

			for (const file of files) {
				const match = file.match(/^oaiproxy-(\d{4})(\d{2})(\d{2})\.log$/);
				if (!match) {
					continue;
				}

				const year = parseInt(match[1], 10);
				const month = parseInt(match[2], 10) - 1;
				const day = parseInt(match[3], 10);
				const fileDate = new Date(year, month, day);

				if (fileDate.getTime() < cutoffTime) {
					const filePath = path.join(this._logDir, file);
					fsp.unlink(filePath).catch((e) => {
						console.error("[OAIProxy Logger] Failed to delete old log:", e);
					});
				}
			}
		}).catch((e) => {
			console.error("[OAIProxy Logger] Failed to clean old logs:", e);
		});
	}
}

export const logger = new Logger();
