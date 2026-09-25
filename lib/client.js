window.__ModuleLoader__.load({
	id: "dsh-prompt-enhance",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.tsx
var index_exports = {};
__export(index_exports, {
  NS: () => NS,
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);

// src/client/EnhanceButton.tsx
var import_react3 = require("react");
var import_react_dom = require("react-dom");

// src/shared/validate.ts
function isInvisibleCodePoint(cp) {
  return cp >= 8203 && cp <= 8205 || cp === 65279 || cp >= 8234 && cp <= 8238 || cp >= 8294 && cp <= 8297;
}
function scanText(text) {
  let count = 0;
  let visibleNonBlank = false;
  for (const ch of text) {
    count++;
    const code = ch.codePointAt(0) ?? 0;
    if (!isInvisibleCodePoint(code) && !/\s/.test(ch)) visibleNonBlank = true;
  }
  return { count, visibleNonBlank };
}
function checkInputText(text, maxChars) {
  const { count, visibleNonBlank } = scanText(text);
  if (!visibleNonBlank) {
    return { ok: false, code: "empty" };
  }
  if (count > maxChars) {
    return { ok: false, code: "too-long", count, max: maxChars };
  }
  return { ok: true };
}

// src/shared/protocol.ts
var ENHANCE_ENDPOINT = "/prompt-enhance/enhance";
var ENHANCE_STREAM_ENDPOINT = "/prompt-enhance/enhance-stream";

// src/client/enhance-client.ts
var EnhanceClientError = class extends Error {
  constructor(detail) {
    super(detail.message);
    this.detail = detail;
  }
};
var KNOWN_ERROR_CODES = /* @__PURE__ */ new Set([
  "rejected",
  "rate-limit",
  "concurrency-limit",
  "timeout",
  "upstream",
  "unconfigured",
  "internal"
]);
function parseError(value) {
  const record = value;
  if (record !== null && typeof record === "object") {
    const code = typeof record.code === "string" && KNOWN_ERROR_CODES.has(record.code) ? record.code : "internal";
    const message = typeof record.message === "string" && record.message !== "" ? record.message : void 0;
    const params = record.params !== null && typeof record.params === "object" ? record.params : void 0;
    return { code, ...message !== void 0 ? { message } : {}, ...params !== void 0 ? { params } : {} };
  }
  return { code: "internal", message: "\u5BBF\u4E3B\u670D\u52A1\u8FD4\u56DE\u5F02\u5E38\u3002" };
}
function parseResult(value) {
  const record = value;
  if (record !== null && typeof record === "object" && typeof record.text === "string" && record.text !== "" && typeof record.provider === "string" && record.provider !== "" && typeof record.model === "string" && record.model !== "" && typeof record.elapsedMs === "number" && Number.isFinite(record.elapsedMs)) {
    return { text: record.text, provider: record.provider, model: record.model, elapsedMs: record.elapsedMs };
  }
  throw new EnhanceClientError({ code: "internal", message: "\u5BBF\u4E3B\u670D\u52A1\u8FD4\u56DE\u4E86\u65E0\u6CD5\u89E3\u6790\u7684\u7ED3\u679C\u3002" });
}
async function readEnvelope(response) {
  let parsed;
  try {
    parsed = await response.json();
  } catch {
    throw new EnhanceClientError({ code: "internal", message: "\u5BBF\u4E3B\u670D\u52A1\u8FD4\u56DE\u4E86\u65E0\u6CD5\u89E3\u6790\u7684\u54CD\u5E94\u3002" });
  }
  const envelope = parsed;
  if (envelope !== null && typeof envelope === "object" && envelope.ok === true) {
    return parseResult(envelope.value);
  }
  if (envelope !== null && typeof envelope === "object" && envelope.error !== void 0) {
    throw new EnhanceClientError(parseError(envelope.error));
  }
  throw new EnhanceClientError({ code: "internal", message: `\u5BBF\u4E3B\u670D\u52A1\u8FD4\u56DE\u5F02\u5E38\uFF08HTTP ${response.status}\uFF09\u3002` });
}
function takeFrames(buffer) {
  const frames = [];
  let rest = buffer;
  for (let index = rest.indexOf("\n\n"); index !== -1; index = rest.indexOf("\n\n")) {
    const raw = rest.slice(0, index);
    rest = rest.slice(index + 2);
    let event = "message";
    const data = [];
    for (const line of raw.split("\n")) {
      if (line.startsWith(":")) continue;
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).trim());
    }
    if (data.length > 0) frames.push({ event, data: data.join("\n") });
  }
  return { frames, rest };
}
function parseFrame(frame) {
  if (frame.event !== "delta" && frame.event !== "done" && frame.event !== "error") return void 0;
  let parsed;
  try {
    parsed = JSON.parse(frame.data);
  } catch {
    return void 0;
  }
  const record = parsed;
  if (record === null || typeof record !== "object" || record.type !== frame.event) return void 0;
  return record;
}
async function requestEnhanceStream(body, options) {
  let response;
  try {
    response = await fetch(ENHANCE_STREAM_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify(body),
      signal: options.signal
    });
  } catch (error) {
    if (options.signal?.aborted) {
      throw new EnhanceClientError({ code: "internal", message: "\u5DF2\u53D6\u6D88\u589E\u5F3A\uFF1B\u539F\u8F93\u5165\u672A\u6539\u52A8\u3002" });
    }
    void error;
    throw new EnhanceClientError({ code: "internal", message: "\u65E0\u6CD5\u8FDE\u63A5\u5BBF\u4E3B\u670D\u52A1\uFF0C\u8BF7\u786E\u8BA4 dsh web \u6B63\u5728\u8FD0\u884C\u540E\u91CD\u8BD5\u3002" });
  }
  const contentType = String(response.headers.get("content-type") ?? "").toLowerCase();
  const stream = response.body;
  const streamable = response.ok && stream !== null && stream !== void 0 && contentType.includes("event-stream");
  if (stream === null || stream === void 0 || !streamable) {
    void stream?.cancel?.().catch(() => {
    });
    return requestEnhance(body, options.signal);
  }
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { frames, rest } = takeFrames(buffer);
      buffer = rest;
      for (const frame of frames) {
        const event = parseFrame(frame);
        if (event === void 0) continue;
        if (event.type === "delta") options.onDelta(event.text);
        else if (event.type === "done") return parseResult(event.value);
        else throw new EnhanceClientError(parseError(event.error));
      }
    }
  } finally {
    void reader.cancel().catch(() => {
    });
  }
  throw new EnhanceClientError({ code: "internal", message: "\u5BBF\u4E3B\u670D\u52A1\u63D0\u524D\u5173\u95ED\u4E86\u589E\u5F3A\u6D41\uFF0C\u8BF7\u91CD\u8BD5\uFF1B\u539F\u8F93\u5165\u672A\u6539\u52A8\u3002" });
}
async function requestEnhance(body, signal) {
  let response;
  try {
    response = await fetch(ENHANCE_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal
    });
  } catch (error) {
    if (signal?.aborted) {
      throw new EnhanceClientError({ code: "internal", message: "\u5DF2\u53D6\u6D88\u589E\u5F3A\uFF1B\u539F\u8F93\u5165\u672A\u6539\u52A8\u3002" });
    }
    void error;
    throw new EnhanceClientError({ code: "internal", message: "\u65E0\u6CD5\u8FDE\u63A5\u5BBF\u4E3B\u670D\u52A1\uFF0C\u8BF7\u786E\u8BA4 dsh web \u6B63\u5728\u8FD0\u884C\u540E\u91CD\u8BD5\u3002" });
  }
  return readEnvelope(response);
}

// src/client/ResultPanel.tsx
var import_react = require("react");

// src/client/locales.ts
var zh = {
  "button.title": "\u63D0\u793A\u8BCD\u589E\u5F3A\uFF08\u91CD\u5199\u4E3A\u7ED3\u6784\u5316\u63D0\u793A\u8BCD\uFF09",
  "button.busy": "\u6B63\u5728\u589E\u5F3A\u2026",
  "panel.title": "\u63D0\u793A\u8BCD\u589E\u5F3A",
  "panel.loading": "\u6B63\u5728\u589E\u5F3A\uFF0C\u7A0D\u5019\u2026",
  "panel.streaming": "\u6B63\u5728\u751F\u6210\uFF08\u8FB9\u5199\u8FB9\u663E\u793A\uFF09\u2026",
  "panel.loading.hint": "\u539F\u6587\u4FDD\u7559\u5728\u8F93\u5165\u6846\u4E2D\uFF0C\u4E0D\u4F1A\u88AB\u52A8\u4FEE\u6539\u3002",
  "panel.cancel": "\u53D6\u6D88",
  "panel.original": "\u539F\u59CB\u63D0\u793A\u8BCD",
  "panel.enhanced": "\u589E\u5F3A\u7ED3\u679C",
  "panel.apply": "\u56DE\u586B\u5230\u8F93\u5165\u6846",
  "panel.copy": "\u590D\u5236\u7ED3\u679C",
  "panel.copied": "\u5DF2\u590D\u5236",
  "panel.copyFailed": "\u590D\u5236\u5931\u8D25",
  "panel.close": "\u5173\u95ED",
  "panel.retry": "\u91CD\u8BD5",
  "panel.stale.warn": "\u8349\u7A3F\u5728\u589E\u5F3A\u671F\u95F4\u6709\u6539\u52A8\u2014\u2014\u589E\u5F3A\u7ED3\u679C\u57FA\u4E8E\u589E\u5F3A\u524D\u7684\u6587\u672C\u3002\u56DE\u586B\u5C06\u8986\u76D6\u4F60\u7684\u6700\u65B0\u7F16\u8F91(\u64A4\u9500\u53EF\u6062\u590D\u56DE\u586B\u524D\u7684\u8349\u7A3F)\u3002",
  "panel.model": "\u6A21\u578B\uFF1A{provider} / {model}",
  "panel.elapsed": "\u8017\u65F6 {ms}",
  "undo.applied": "\u5DF2\u7528\u589E\u5F3A\u7ED3\u679C\u66FF\u6362\u539F\u63D0\u793A\u8BCD",
  "undo.undo": "\u64A4\u9500",
  "undo.dismiss": "\u5173\u95ED\u63D0\u793A",
  "error.empty": "\u8F93\u5165\u6846\u4E3A\u7A7A\uFF0C\u8BF7\u5148\u8F93\u5165\u8981\u589E\u5F3A\u7684\u63D0\u793A\u8BCD\u3002",
  "error.tooLong": "\u5185\u5BB9\u5171 {count} \u4E2A\u5B57\u7B26\uFF0C\u8D85\u8FC7 {max} \u4E2A\u5B57\u7B26\u4E0A\u9650\uFF08\u6309 Unicode \u5B57\u7B26\u6570\u7EDF\u8BA1\uFF0C\u4E0D\u662F token \u6570\uFF09\u3002\u4E3A\u907F\u514D\u6539\u53D8\u539F\u610F\u4E0D\u4F1A\u81EA\u52A8\u622A\u65AD\uFF0C\u8BF7\u7CBE\u7B80\u540E\u518D\u8BD5\u3002",
  "error.imagesOnly": "\u5F53\u524D\u53EA\u9644\u52A0\u4E86\u56FE\u7247\uFF0C\u4EC5\u652F\u6301\u589E\u5F3A\u6587\u672C\u5185\u5BB9\u3002",
  "error.occurrences": "\u8F93\u5165\u5185\u5BB9\u5305\u542B\u547D\u4EE4\u6216\u6587\u4EF6\u5F15\u7528\uFF0C\u6682\u4E0D\u652F\u6301\u589E\u5F3A\uFF1B\u8BF7\u5148\u79FB\u9664\u540E\u518D\u8BD5\u3002",
  "error.phase": "\u5F53\u524D\u8F93\u5165\u6B63\u88AB\u5360\u7528\uFF08\u63D0\u4EA4\u4E2D\uFF09\uFF0C\u8BF7\u7A0D\u540E\u518D\u8BD5\u3002",
  "error.disabled": "\u63D0\u793A\u8BCD\u589E\u5F3A\u5DF2\u5728\u63D2\u4EF6\u8BBE\u7F6E\u4E2D\u5173\u95ED\u3002",
  "error.rejected": "\u589E\u5F3A\u8BF7\u6C42\u88AB\u62D2\u7EDD\u3002",
  "error.timeout": "\u589E\u5F3A\u8D85\u65F6\uFF08{seconds} \u79D2\uFF09\uFF0C\u8BF7\u91CD\u8BD5\uFF1B\u539F\u8F93\u5165\u672A\u6539\u52A8\u3002",
  "error.unconfigured": "\u5C1A\u672A\u786E\u5B9A\u589E\u5F3A\u7528\u7684\u6A21\u578B\uFF1A\u8BF7\u5728\u63D2\u4EF6\u8BBE\u7F6E\u4E2D\u6210\u5BF9\u586B\u5199 provider/model\uFF0C\u6216\u5148\u5728\u5F53\u524D\u4F1A\u8BDD\u53D1\u9001\u4E00\u6761\u6D88\u606F\uFF08\u5C06\u8DDF\u968F\u4F1A\u8BDD\u6A21\u578B\uFF09\u3002",
  "error.upstream": "\u6A21\u578B\u670D\u52A1\u8FD4\u56DE\u9519\u8BEF\uFF0C\u8BF7\u91CD\u8BD5\uFF1B\u539F\u8F93\u5165\u672A\u6539\u52A8\u3002",
  "error.internal": "\u589E\u5F3A\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5\uFF1B\u539F\u8F93\u5165\u672A\u6539\u52A8\u3002",
  "error.rateLimit": "\u8BF7\u6C42\u8FC7\u4E8E\u9891\u7E41\uFF1A\u6BCF\u5206\u949F\u6700\u591A {limit} \u6B21\u589E\u5F3A\uFF0C\u8BF7\u5728 {retryAfterSeconds} \u79D2\u540E\u518D\u8BD5\u3002",
  "error.concurrencyLimit": "\u5DF2\u6709 {max} \u4E2A\u589E\u5F3A\u6B63\u5728\u8FDB\u884C\uFF0C\u8BF7\u7B49\u5176\u4E2D\u4E00\u4E2A\u5B8C\u6210\u540E\u518D\u8BD5\u3002",
  "error.upstream.auth": "\u9274\u6743\u5931\u8D25\uFF1A\u8BF7\u68C0\u67E5\u8BE5 provider \u7684 API Key \u914D\u7F6E\u3002",
  "error.upstream.invalidCredential": "\u9274\u6743\u5931\u8D25\uFF1A\u5B58\u50A8\u7684 API Key \u4E0D\u53EF\u7528\uFF0C\u8BF7\u4FEE\u6B63\u540E\u91CD\u8BD5\u3002",
  "error.upstream.missingCredential": "\u7F3A\u5C11\u8BE5 provider \u7684 API Key\uFF1A\u8BF7\u5728\u300C\u6A21\u578B\u300D\u8BBE\u7F6E\u9875\u4FDD\u5B58\u5BC6\u94A5\uFF0C\u6216\u5728\u542F\u52A8\u73AF\u5883\u91CC\u5BFC\u51FA\u5BF9\u5E94\u7684\u51ED\u636E\u53D8\u91CF\u540E\u91CD\u8BD5\u3002",
  "error.upstream.rateLimit": "\u6A21\u578B\u670D\u52A1\u9650\u6D41\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002",
  "error.upstream.quota": "\u6A21\u578B\u670D\u52A1\u914D\u989D/\u4F59\u989D\u4E0D\u8DB3\uFF0C\u8BF7\u68C0\u67E5\u8D26\u6237\u3002",
  "error.upstream.empty": "\u6A21\u578B\u8FD4\u56DE\u4E86\u7A7A\u54CD\u5E94\uFF0C\u8BF7\u91CD\u8BD5\u3002",
  "error.upstream.contextWindow": "\u8F93\u5165\u8D85\u51FA\u6A21\u578B\u4E0A\u4E0B\u6587\u7A97\u53E3\uFF0C\u8BF7\u7CBE\u7B80\u539F\u6587\u6216\u66F4\u6362\u6A21\u578B\u3002",
  "error.upstream.toolCall": "\u6A21\u578B\u8BF7\u6C42\u4E86\u5DE5\u5177\u8C03\u7528\uFF0C\u63D0\u793A\u8BCD\u589E\u5F3A\u53EA\u9700\u8981\u7EAF\u6587\u672C\uFF1B\u8BF7\u66F4\u6362\u6A21\u578B\u540E\u91CD\u8BD5\u3002",
  "error.upstream.maxTokens": "\u91CD\u5199\u7ED3\u679C\u8FBE\u5230\u8F93\u51FA\u4E0A\u9650\uFF08maxOutputTokens\uFF09\uFF0C\u8BF7\u5728\u8BBE\u7F6E\u4E2D\u8C03\u5927\u4E0A\u9650\u6216\u7CBE\u7B80\u539F\u6587\u540E\u91CD\u8BD5\uFF1B\u63A8\u7406\u6A21\u578B\u4F1A\u5148\u6D88\u8017\u9884\u7B97\u601D\u8003\uFF0C\u4E0A\u9650\u504F\u4F4E\u65F6\u53EF\u80FD\u53EA\u4EA7\u51FA\u601D\u8003\u800C\u6CA1\u6709\u6B63\u6587\u3002",
  "error.upstream.server": "\u6A21\u578B\u670D\u52A1\u7AEF\u8FD4\u56DE\u9519\u8BEF\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002",
  "error.upstream.transport": "\u4E0E\u6A21\u578B\u670D\u52A1\u7684\u8FDE\u63A5\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u7F51\u7EDC\u6216\u4EE3\u7406\u8BBE\u7F6E\u540E\u91CD\u8BD5\u3002",
  // Settings page (settings.section). One label/help pair per form field; the
  // page renders only fields that have a descriptor AND a label here.
  "settings.title": "\u63D0\u793A\u8BCD\u589E\u5F3A",
  "settings.intro": "\u6539\u5199\u8349\u7A3F\u65F6\u4F7F\u7528\u7684\u6A21\u578B\u3001\u9884\u7B97\u4E0E\u5B89\u5168\u8FB9\u754C\u3002\u6539\u5B8C\u5373\u751F\u6548\uFF0C\u65E0\u9700\u91CD\u542F\u3002",
  "settings.loading": "\u6B63\u5728\u8BFB\u53D6\u914D\u7F6E\u2026",
  "settings.unavailable": "\u914D\u7F6E\u6682\u4E0D\u53EF\u7528\uFF1A\u5BBF\u4E3B\u6CA1\u6709\u4E3A\u8BE5\u63D2\u4EF6\u63D0\u4F9B\u914D\u7F6E\u8868\u5355\u3002",
  "settings.reset": "\u6062\u590D\u9ED8\u8BA4",
  "settings.invalid": "{field} \u7684\u53D6\u503C\u4E0D\u5408\u6CD5\uFF0C\u5DF2\u4FDD\u7559\u4E0A\u4E00\u6B21\u7684\u6709\u6548\u503C\u3002",
  "field.enabled.label": "\u542F\u7528\u63D2\u4EF6",
  "field.enabled.help": "\u5173\u95ED\u540E\u9690\u85CF\u8F93\u5165\u6846\u589E\u5F3A\u6309\u94AE\uFF0C\u5E76\u505C\u7528\u6309\u94AE\u3001\u5FEB\u6377\u952E\u4E0E /enhance \u547D\u4EE4\u3002",
  "field.reasoningEffort.label": "\u63A8\u7406\u9884\u7B97",
  "field.reasoningEffort.help": "\u6539\u5199\u662F\u77ED\u800C\u660E\u786E\u7684\u4EFB\u52A1\uFF0C\u4E0D\u9700\u8981\u6DF1\u5EA6\u601D\u8003\uFF0C\u800C\u6A21\u578B\u81EA\u8EAB\u7684\u9ED8\u8BA4\u6863\u5F80\u5F80\u5F88\u8D35\uFF08\u540C\u4E00\u53E5\u8BDD\uFF1Aoff \u7EA6 252 \u8F93\u51FA token\uFF0Chigh \u7EA6 2897\uFF09\u3002inherit \u8868\u793A\u4E0D\u4F20\u8BE5\u5B57\u6BB5\u3001\u5B8C\u5168\u8DDF\u968F\u6A21\u578B\u9ED8\u8BA4\u6863\u3002",
  "field.reasoningEffort.option.off": "\u5173\u95ED\u601D\u8003\uFF08\u6700\u7701\uFF0C\u9ED8\u8BA4\uFF09",
  "field.reasoningEffort.option.low": "\u4F4E",
  "field.reasoningEffort.option.high": "\u9AD8",
  "field.reasoningEffort.option.inherit": "\u8DDF\u968F\u6A21\u578B\u9ED8\u8BA4\u6863",
  "field.maxOutputTokens.label": "\u8F93\u51FA\u4E0A\u9650\uFF08token\uFF09",
  "field.maxOutputTokens.help": "\u63A8\u7406\u4E0E\u6B63\u6587\u5171\u7528\u8FD9\u4EFD\u9884\u7B97\u4E14\u63A8\u7406\u5728\u524D\uFF1B\u4E0A\u9650\u504F\u4F4E\u65F6\u53EF\u80FD\u88AB\u601D\u8003\u5403\u5149\uFF0C\u6700\u7EC8\u53EA\u6709\u601D\u8003\u6CA1\u6709\u6B63\u6587\u3002",
  "field.maxInputChars.label": "\u8F93\u5165\u5B57\u6570\u4E0A\u9650",
  "field.maxInputChars.help": "\u6309 Unicode \u5B57\u7B26\u7EDF\u8BA1\uFF08\u4E00\u4E2A emoji \u7B97\u4E00\u4E2A\uFF09\u3002\u8D85\u9650\u76F4\u63A5\u62D2\u7EDD\uFF0C\u4E0D\u622A\u65AD\uFF0C\u907F\u514D\u6539\u53D8\u539F\u610F\u3002",
  "field.temperature.label": "\u91C7\u6837\u6E29\u5EA6",
  "field.temperature.help": "0\u20131\uFF1B\u8D8A\u4F4E\u8D8A\u5FE0\u5B9E\u4E8E\u539F\u610F\u3002",
  "field.timeoutMs.label": "\u8D85\u65F6\uFF08\u6BEB\u79D2\uFF09",
  "field.timeoutMs.help": "\u5355\u6B21\u589E\u5F3A\u7684\u7AEF\u5230\u7AEF\u4E0A\u9650\uFF0C\u8D85\u65F6\u540E\u53EF\u91CD\u8BD5\uFF0C\u539F\u6587\u4E0D\u53D7\u5F71\u54CD\u3002",
  "field.streaming.label": "\u589E\u91CF\u5C55\u793A",
  "field.streaming.help": "\u6A21\u578B\u8FB9\u5199\u8FB9\u5728\u9762\u677F\u663E\u793A\u3002\u53EA\u5F71\u54CD\u663E\u793A\u8282\u594F\uFF0C\u6700\u7EC8\u7ED3\u679C\u4E0D\u53D8\u3002",
  "field.contextAware.label": "\u4E0A\u4E0B\u6587\u611F\u77E5",
  "field.contextAware.help": "\u8BFB\u53D6\u5F53\u524D\u4F1A\u8BDD\u8FD1\u671F\u5BF9\u8BDD\u6765\u6D88\u89E3\u6307\u4EE3\u3001\u8865\u5168\u7701\u7565\u3002\u5F00\u542F\u540E\u4F1A\u628A\u8FD9\u6BB5\u5386\u53F2\u4E00\u5E76\u53D1\u9001\u7ED9\u6240\u7528\u6A21\u578B\uFF1B\u4ECB\u610F\u9690\u79C1\u53EF\u5173\u95ED\u3002",
  "field.contextMaxMessages.label": "\u4E0A\u4E0B\u6587\u7A97\u53E3\uFF08\u6761\u6570\uFF09",
  "field.contextMaxMessages.help": "\u6700\u591A\u53C2\u8003\u6700\u8FD1\u591A\u5C11\u6761 user/assistant \u8F6E\u6B21\uFF1B0 \u8868\u793A\u4E0D\u53C2\u8003\u3002",
  "field.contextMaxChars.label": "\u4E0A\u4E0B\u6587\u7A97\u53E3\uFF08\u5B57\u6570\uFF09",
  "field.contextMaxChars.help": "\u5386\u53F2\u7247\u6BB5\u7684\u5B57\u7B26\u9884\u7B97\uFF0C\u4ECE\u6700\u65B0\u4E00\u6761\u5411\u524D\u88C5\u914D\uFF1B0 \u8868\u793A\u4E0D\u53C2\u8003\u3002",
  "field.provider.label": "\u6A21\u578B provider \u8986\u76D6",
  "field.provider.help": "\u7559\u7A7A\u5219\u8DDF\u968F\u5F53\u524D\u4F1A\u8BDD\u6A21\u578B\u3002\u586B\u5199\u65F6\u5FC5\u987B\u4E0E\u4E0B\u9762\u7684 model \u6210\u5BF9\u51FA\u73B0\u3002",
  "field.model.label": "\u6A21\u578B model \u8986\u76D6",
  "field.model.help": "\u4E0E provider \u6210\u5BF9\u586B\u5199\uFF1B\u53EA\u586B\u4E00\u4E2A\u4F1A\u88AB\u62D2\u7EDD\u3002",
  "field.shortcut.label": "\u5FEB\u6377\u952E",
  "field.shortcut.help": "\u4F8B\u5982 ctrl+alt+e\u3002\u81F3\u5C11\u5305\u542B ctrl/alt/meta \u4E4B\u4E00\uFF1B\u7559\u7A7A\u5219\u7981\u7528\u3002",
  "field.maxConcurrent.label": "\u5E76\u53D1\u4E0A\u9650",
  "field.maxConcurrent.help": "\u540C\u65F6\u8FDB\u884C\u7684\u589E\u5F3A\u8C03\u7528\u6570\uFF0C\u8D85\u51FA\u8FD4\u56DE 429\u3002",
  "field.rateLimitPerMinute.label": "\u6BCF\u5206\u949F\u6B21\u6570\u4E0A\u9650",
  "field.rateLimitPerMinute.help": "\u6ED1\u52A8\u7A97\u53E3\u9650\u6D41\uFF0C\u8D85\u51FA\u8FD4\u56DE 429\u3002",
  "field.strategyMode.label": "\u81EA\u5B9A\u4E49\u63D0\u793A\u8BCD\u7684\u7EC4\u5408\u65B9\u5F0F",
  "field.strategyMode.help": "replace-default \u6574\u4F53\u66FF\u6362\u5185\u7F6E\u7B56\u7565\uFF08\u5185\u7F6E\u7684\u786C\u6027\u7EA6\u675F\u4E0D\u518D\u751F\u6548\uFF09\uFF1Bextend-default \u628A\u81EA\u5B9A\u4E49\u6587\u672C\u8FFD\u52A0\u5728\u5185\u7F6E\u7B56\u7565\u4E4B\u540E\u3002",
  "field.strategyMode.option.replace-default": "\u6574\u4F53\u66FF\u6362\u5185\u7F6E\u7B56\u7565",
  "field.strategyMode.option.extend-default": "\u8FFD\u52A0\u5728\u5185\u7F6E\u7B56\u7565\u4E4B\u540E",
  "field.systemPrompt.label": "\u81EA\u5B9A\u4E49\u7CFB\u7EDF\u63D0\u793A\u8BCD",
  "field.systemPrompt.help": "\u7559\u7A7A\u4F7F\u7528\u5185\u7F6E\u589E\u5F3A\u7B56\u7565\u3002"
};
var en = {
  "button.title": "Enhance prompt (rewrite into a structured prompt)",
  "button.busy": "Enhancing\u2026",
  "panel.title": "Prompt Enhance",
  "panel.loading": "Enhancing, please wait\u2026",
  "panel.streaming": "Generating (shown as it is written)\u2026",
  "panel.loading.hint": "Your draft stays untouched until you apply the result.",
  "panel.cancel": "Cancel",
  "panel.original": "Original prompt",
  "panel.enhanced": "Enhanced result",
  "panel.apply": "Fill into input box",
  "panel.copy": "Copy result",
  "panel.copied": "Copied",
  "panel.copyFailed": "Copy failed",
  "panel.close": "Close",
  "panel.retry": "Retry",
  "panel.stale.warn": "The draft changed while enhancing \u2014 the result is based on the pre-enhance text. Applying will overwrite your latest edits (undo restores the draft as it was before applying).",
  "panel.model": "Model: {provider} / {model}",
  "panel.elapsed": "{ms} elapsed",
  "undo.applied": "Original prompt replaced by the enhanced version",
  "undo.undo": "Undo",
  "undo.dismiss": "Dismiss",
  "error.empty": "The input box is empty \u2014 type a prompt to enhance first.",
  "error.tooLong": "The draft is {count} characters, above the {max} cap (Unicode characters, not tokens). It is never auto-truncated (that would change your meaning) \u2014 please shorten it.",
  "error.imagesOnly": "Only images are attached; prompt enhance supports text only.",
  "error.occurrences": "The draft contains commands or file references, which are not supported yet \u2014 remove them first.",
  "error.phase": "The input box is busy (submitting) \u2014 try again in a moment.",
  "error.disabled": "Prompt enhance is disabled in the plugin settings.",
  "error.rejected": "The enhance request was rejected.",
  "error.timeout": "The enhancement timed out ({seconds}s). Retry; your draft is untouched.",
  "error.unconfigured": "No model resolved for the enhancement: pair provider/model in the plugin settings, or send a message in the current session first (the enhancement will follow the session model).",
  "error.upstream": "The model provider returned an error. Retry; your draft is untouched.",
  "error.internal": "Enhancement failed. Retry; your draft is untouched.",
  "error.rateLimit": "Too many requests \u2014 at most {limit} enhancements per minute; retry in {retryAfterSeconds} seconds.",
  "error.concurrencyLimit": "{max} enhancements are already running \u2014 wait for one to finish, then retry.",
  "error.upstream.auth": "Authentication failed \u2014 check the API key configured for this provider.",
  "error.upstream.invalidCredential": "Authentication failed \u2014 the stored API key is invalid; fix it and retry.",
  "error.upstream.missingCredential": "No API key for this provider \u2014 save one on the Models settings page, or export the matching credential variable in the launching environment, then retry.",
  "error.upstream.rateLimit": "The model provider is rate-limiting; retry later.",
  "error.upstream.quota": "The model provider reports a quota/balance issue \u2014 check your account.",
  "error.upstream.empty": "The model returned an empty response; retry.",
  "error.upstream.contextWindow": "The input exceeds the model context window \u2014 shorten it or switch models.",
  "error.upstream.toolCall": "The model requested tool calls, but prompt enhance needs plain text \u2014 switch models and retry.",
  "error.upstream.maxTokens": "The rewrite hit the output cap (maxOutputTokens) \u2014 raise it in settings or shorten the draft. Reasoning models spend budget on reasoning first, so a low cap can yield reasoning with no visible text.",
  "error.upstream.server": "The model provider returned a server error; retry later.",
  "error.upstream.transport": "Could not reach the model provider \u2014 check the network or proxy settings, then retry.",
  "settings.title": "Prompt enhance",
  "settings.intro": "Model, budget, and safety bounds for the rewrite. Changes apply immediately; no restart.",
  "settings.loading": "Reading configuration\u2026",
  "settings.unavailable": "Configuration is unavailable: the host serves no form for this plugin.",
  "settings.reset": "Reset",
  "settings.invalid": "{field} is out of range; the last valid value is kept.",
  "field.enabled.label": "Enable the plugin",
  "field.enabled.help": "Off hides the composer button and disables the button, the shortcut, and /enhance.",
  "field.reasoningEffort.label": "Reasoning budget",
  "field.reasoningEffort.help": "A rewrite is short and well-specified, and the model default is expensive (same draft: 252 output tokens at off, 2897 at high). inherit sends no field and follows the model default.",
  "field.reasoningEffort.option.off": "Off (cheapest, default)",
  "field.reasoningEffort.option.low": "Low",
  "field.reasoningEffort.option.high": "High",
  "field.reasoningEffort.option.inherit": "Follow the model default",
  "field.maxOutputTokens.label": "Output cap (tokens)",
  "field.maxOutputTokens.help": "Reasoning and text share this budget and reasoning runs first; too low a cap can be consumed by reasoning alone, leaving no text.",
  "field.maxInputChars.label": "Input character cap",
  "field.maxInputChars.help": "Counted in Unicode characters (one emoji is one). Over-limit drafts are rejected, never truncated.",
  "field.temperature.label": "Sampling temperature",
  "field.temperature.help": "0\u20131; lower stays closer to the original wording.",
  "field.timeoutMs.label": "Timeout (ms)",
  "field.timeoutMs.help": "End-to-end deadline of one enhancement; a timeout is retryable and never touches the draft.",
  "field.streaming.label": "Incremental display",
  "field.streaming.help": "Show the rewrite as it is written. Display only \u2014 the final result is unchanged.",
  "field.contextAware.label": "Context aware",
  "field.contextAware.help": "Ground the rewrite in the recent conversation. With this on, those turns are sent to the model you configured; turn it off if that matters.",
  "field.contextMaxMessages.label": "Context window (turns)",
  "field.contextMaxMessages.help": "How many recent user/assistant turns may be used; 0 uses none.",
  "field.contextMaxChars.label": "Context window (characters)",
  "field.contextMaxChars.help": "Character budget of the history snippet, spent newest-first; 0 uses none.",
  "field.provider.label": "Provider override",
  "field.provider.help": "Empty follows the current session model. Must be filled together with the model below.",
  "field.model.label": "Model override",
  "field.model.help": "Pair with the provider; one without the other is rejected.",
  "field.shortcut.label": "Shortcut",
  "field.shortcut.help": "For example ctrl+alt+e. Needs at least one of ctrl/alt/meta; empty disables it.",
  "field.maxConcurrent.label": "Concurrency cap",
  "field.maxConcurrent.help": "Enhancements running at once; extra requests answer 429.",
  "field.rateLimitPerMinute.label": "Per-minute cap",
  "field.rateLimitPerMinute.help": "Sliding-window rate limit; extra requests answer 429.",
  "field.strategyMode.label": "Custom prompt composition",
  "field.strategyMode.help": "replace-default swaps the built-in strategy out (its hard rules no longer apply); extend-default appends your text after it.",
  "field.strategyMode.option.replace-default": "Replace the built-in strategy",
  "field.strategyMode.option.extend-default": "Append after the built-in strategy",
  "field.systemPrompt.label": "Custom system prompt",
  "field.systemPrompt.help": "Empty uses the built-in enhancement strategy."
};
var dictionaries = { zh, en };
var NS = "prompt-enhance";

// src/client/ResultPanel.tsx
var import_jsx_runtime = require("react/jsx-runtime");
var retryable = (code) => code === "upstream" || code === "timeout" || code === "internal";
function upstreamKeyOf(reason) {
  const camel = reason.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
  return `error.upstream.${camel}`;
}
function localizedErrorMessage(t, code, params) {
  if (code === "rejected" && typeof params?.count === "number" && typeof params?.max === "number") {
    return t("error.tooLong", { count: params.count, max: params.max });
  }
  if (code === "upstream" && typeof params?.reason === "string") {
    const specific = upstreamKeyOf(params.reason);
    if (specific in zh) return t(specific);
  }
  switch (code) {
    case "rejected":
      return t("error.rejected");
    case "rate-limit":
      return t("error.rateLimit", params);
    case "concurrency-limit":
      return t("error.concurrencyLimit", params);
    case "timeout":
      return t("error.timeout", params);
    case "unconfigured":
      return t("error.unconfigured");
    case "upstream":
      return t("error.upstream");
    default:
      return t("error.internal");
  }
}
function fallbackCopy(text) {
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    textarea.remove();
    return ok;
  } catch {
    return false;
  }
}
function ResultPanel(props) {
  const { state, t, onApply, onCancel, onRetry } = props;
  const [copied, setCopied] = (0, import_react.useState)("idle");
  const panelRef = (0, import_react.useRef)(null);
  (0, import_react.useEffect)(() => {
    const onKeyDown = (event) => {
      if (event.isComposing) return;
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key === "Tab") {
        const panel = panelRef.current;
        if (panel === null) return;
        const focusables = panel.querySelectorAll('button:not([disabled]), [href], input, [tabindex]:not([tabindex="-1"])');
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (first === void 0 || last === void 0) return;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);
  (0, import_react.useEffect)(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus();
    return () => previous?.focus();
  }, []);
  const copy = (0, import_react.useCallback)(() => {
    if (state.result === void 0) return;
    const text = state.result.text;
    const done = (ok) => setCopied(ok ? "ok" : "failed");
    if (navigator.clipboard !== void 0) {
      navigator.clipboard.writeText(text).then(() => done(true), () => done(fallbackCopy(text)));
      return;
    }
    done(fallbackCopy(text));
  }, [state.result]);
  const formatMs = (ms) => ms < 1e3 ? `${ms}ms` : `${(ms / 1e3).toFixed(1)}s`;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-pe-overlay", onMouseDown: (event) => {
    if (event.target === event.currentTarget) onCancel();
  }, children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    "section",
    {
      ref: panelRef,
      className: "dsh-pe-panel",
      role: "dialog",
      "aria-modal": "true",
      "aria-label": t("panel.title"),
      tabIndex: -1,
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", { className: "dsh-pe-head", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
            "\u2728 ",
            t("panel.title")
          ] }),
          state.phase === "result" && state.result !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsh-pe-meta", children: [
            t("panel.model", { provider: state.result.provider, model: state.result.model }),
            " \xB7 ",
            t("panel.elapsed", { ms: formatMs(state.result.elapsedMs) })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "dsh-pe-close", "aria-label": t("panel.close"), onClick: onCancel, children: "\u2715" })
        ] }),
        state.phase === "loading" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-pe-loading", children: state.streaming === void 0 || state.streaming === "" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-pe-spin", "aria-hidden": true }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { children: t("panel.loading") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-pe-hint", children: t("panel.loading.hint") })
        ] }) : (
          // Incremental view: the text already generated, replaced by the
          // normalized full body the moment the call settles.
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-pe-stream", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-pe-col-title", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-pe-spin small", "aria-hidden": true }),
              t("panel.streaming")
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("pre", { className: "dsh-pe-col-text", children: state.streaming })
          ] })
        ) }),
        state.phase === "error" && state.error !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-pe-error", children: state.error.localized !== void 0 ? (
          // Client-side guard failures carry their own pre-localized copy.
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { children: state.error.localized })
        ) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { children: localizedErrorMessage(t, state.error.code, state.error.params) }),
          state.error.message !== void 0 && state.error.message !== "" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-pe-error-detail", children: state.error.message })
        ] }) }),
        state.phase === "result" && state.result !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-pe-body", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-pe-col", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-pe-col-title", children: t("panel.original") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("pre", { className: "dsh-pe-col-text", children: state.original })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-pe-col", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-pe-col-title", children: t("panel.enhanced") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("pre", { className: "dsh-pe-col-text", children: state.result.text })
          ] })
        ] }),
        state.phase === "result" && state.stale && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-pe-stale", children: [
          "\u26A0 ",
          t("panel.stale.warn")
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("footer", { className: "dsh-pe-foot", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-pe-grow" }),
          state.phase === "error" && retryable(state.error?.code) && onRetry !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "dsh-pe-btn-action plain", onClick: onRetry, children: t("panel.retry") }),
          state.phase === "result" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "dsh-pe-btn-action plain", onClick: copy, children: copied === "ok" ? t("panel.copied") : copied === "failed" ? t("panel.copyFailed") : t("panel.copy") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "dsh-pe-btn-action primary", onClick: onApply, children: t("panel.apply") })
          ] }),
          state.phase !== "result" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "dsh-pe-btn-action plain", onClick: onCancel, children: state.phase === "loading" ? t("panel.cancel") : t("panel.close") })
        ] })
      ]
    }
  ) });
}

// src/client/undo-stack.ts
function totalOf(stacks) {
  let n = 0;
  for (const stack of stacks.values()) n += stack.length;
  return n;
}
function createUndoStack(maxDepth = 3, maxTotalEntries = 60) {
  const stacks = /* @__PURE__ */ new Map();
  return {
    push(sessionId, entry) {
      const stack = stacks.get(sessionId) ?? [];
      stack.push(entry);
      while (stack.length > maxDepth) stack.shift();
      stacks.delete(sessionId);
      stacks.set(sessionId, stack);
      while (totalOf(stacks) > maxTotalEntries) {
        const oldest = stacks.keys().next().value;
        if (oldest === void 0) break;
        stacks.delete(oldest);
      }
    },
    peek(sessionId) {
      const stack = stacks.get(sessionId);
      return stack === void 0 || stack.length === 0 ? void 0 : stack[stack.length - 1];
    },
    pop(sessionId) {
      const stack = stacks.get(sessionId);
      const entry = stack?.pop();
      if (stack !== void 0 && stack.length === 0) stacks.delete(sessionId);
      return entry;
    },
    clear(sessionId) {
      stacks.delete(sessionId);
    },
    depth(sessionId) {
      return stacks.get(sessionId)?.length ?? 0;
    }
  };
}

// src/client/ui-state.ts
var listeners = /* @__PURE__ */ new Set();
var panelState;
var version = 0;
function notify() {
  version++;
  for (const listener of listeners) listener();
}
var pendingDeltaText = "";
var pendingDeltaSession;
var pendingDeltaScheduled = false;
function flushPendingDelta() {
  pendingDeltaScheduled = false;
  if (pendingDeltaText === "" || pendingDeltaSession === void 0) return;
  const sessionId = pendingDeltaSession;
  const text = pendingDeltaText;
  pendingDeltaText = "";
  pendingDeltaSession = void 0;
  if (panelState === void 0 || panelState.sessionId !== sessionId || panelState.phase !== "loading") return;
  panelState = { ...panelState, streaming: (panelState.streaming ?? "") + text };
  notify();
}
function scheduleDeltaFlush() {
  if (pendingDeltaScheduled) return;
  pendingDeltaScheduled = true;
  queueMicrotask(flushPendingDelta);
}
var undoStore = createUndoStack(3);
function pushUndo(sessionId, entry) {
  undoStore.push(sessionId, entry);
  notify();
}
function peekUndo(sessionId) {
  return undoStore.peek(sessionId);
}
function popUndo(sessionId) {
  const entry = undoStore.pop(sessionId);
  notify();
  return entry;
}
var sessions = /* @__PURE__ */ new Map();
var lastMountedSession;
function subscribe(listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function getVersion() {
  return version;
}
function getPanel() {
  return panelState;
}
function openLoading(state) {
  panelState?.abort?.();
  panelState = { ...state, phase: "loading" };
  notify();
}
function settleResult(sessionId, result) {
  if (panelState?.sessionId !== sessionId || panelState.phase !== "loading") return;
  panelState = { sessionId, phase: "result", original: panelState.original, result };
  notify();
}
function settleError(sessionId, error) {
  if (panelState?.sessionId !== sessionId || panelState.phase !== "loading") return;
  panelState = { sessionId, phase: "error", original: panelState.original, error };
  notify();
}
function appendDelta(sessionId, text) {
  if (text === "") return;
  if (panelState === void 0 || panelState.sessionId !== sessionId || panelState.phase !== "loading") return;
  pendingDeltaText += text;
  pendingDeltaSession = sessionId;
  scheduleDeltaFlush();
}
function openError(sessionId, original, error) {
  panelState?.abort?.();
  panelState = { sessionId, phase: "error", original, error };
  notify();
}
function setStale(sessionId, stale) {
  if (panelState?.sessionId !== sessionId || panelState.phase !== "result" || panelState.stale === stale) return;
  panelState = { ...panelState, stale };
  notify();
}
function closePanel() {
  panelState?.abort?.();
  if (panelState === void 0) return;
  panelState = void 0;
  notify();
}
function registerSession(sessionId, entry) {
  sessions.set(sessionId, entry);
  lastMountedSession = sessionId;
  notify();
  return () => {
    if (sessions.get(sessionId) === entry) sessions.delete(sessionId);
    if (lastMountedSession === sessionId) {
      const keys = [...sessions.keys()];
      lastMountedSession = keys[keys.length - 1];
    }
    if (panelState?.sessionId === sessionId) closePanel();
    undoStore.clear(sessionId);
    notify();
  };
}
function shortcutTarget() {
  const active = document.activeElement;
  if (active !== null && active instanceof Element) {
    let node = active;
    for (let depth = 0; depth < 8 && node !== null; depth++) {
      for (const entry of sessions.values()) {
        if (entry.root !== null && (node === entry.root || node.contains(entry.root))) {
          const found = entry;
          return () => found.run();
        }
      }
      node = node.parentElement;
    }
  }
  const fallback = lastMountedSession !== void 0 ? sessions.get(lastMountedSession) : void 0;
  return fallback === void 0 ? void 0 : () => fallback.run();
}

// src/client/settings.ts
var DEFAULT_CLIENT_SETTINGS = {
  enabled: true,
  maxInputChars: 12e3,
  shortcut: "ctrl+alt+e",
  streaming: true
};
var listeners2 = /* @__PURE__ */ new Set();
var current = DEFAULT_CLIENT_SETTINGS;
function setClientSettings(next) {
  current = next;
  for (const listener of listeners2) listener();
}
function getClientSettings() {
  return current;
}
function subscribeClientSettings(listener) {
  listeners2.add(listener);
  return () => {
    listeners2.delete(listener);
  };
}
function decodeClientSettings(section) {
  const record = section;
  if (record === null || typeof record !== "object") return DEFAULT_CLIENT_SETTINGS;
  return {
    enabled: typeof record.enabled === "boolean" ? record.enabled : DEFAULT_CLIENT_SETTINGS.enabled,
    maxInputChars: typeof record.maxInputChars === "number" && Number.isFinite(record.maxInputChars) && record.maxInputChars > 0 ? Math.floor(record.maxInputChars) : DEFAULT_CLIENT_SETTINGS.maxInputChars,
    shortcut: typeof record.shortcut === "string" ? record.shortcut : DEFAULT_CLIENT_SETTINGS.shortcut,
    streaming: typeof record.streaming === "boolean" ? record.streaming : DEFAULT_CLIENT_SETTINGS.streaming
  };
}

// src/client/session-key.ts
var import_react2 = require("react");
var fallbackSeq = 0;
var zoneKeys = /* @__PURE__ */ new WeakMap();
function fallbackKeyOf(share) {
  if (share === void 0) return `pe:mount:${++fallbackSeq}`;
  const known = zoneKeys.get(share);
  if (known !== void 0) return known;
  const minted = `pe:zone:${++fallbackSeq}`;
  zoneKeys.set(share, minted);
  return minted;
}
function useSessionKey(maybeSessionId, share) {
  const fallback = (0, import_react2.useRef)(void 0);
  if (maybeSessionId !== void 0 && maybeSessionId !== "") return maybeSessionId;
  if (fallback.current === void 0) fallback.current = fallbackKeyOf(share);
  return fallback.current;
}
function serverSessionId(maybeSessionId) {
  return maybeSessionId !== void 0 && maybeSessionId !== "" ? maybeSessionId : void 0;
}

// src/client/EnhanceButton.tsx
var import_jsx_runtime2 = require("react/jsx-runtime");
function EnhanceButton(props) {
  const { t, sessionId, useInput, inputActions } = props;
  const uiKey = useSessionKey(sessionId, inputActions);
  const wireId = serverSessionId(sessionId);
  const draft = useInput((state) => state.draft);
  const phase = useInput((state) => state.phase);
  const occurrenceCount = useInput((state) => state.occurrences?.length ?? 0);
  const imageCount = useInput((state) => {
    const compatible = state;
    return compatible.attachmentIds?.length ?? compatible.imageIds?.length ?? 0;
  });
  const settings = (0, import_react3.useSyncExternalStore)(subscribeClientSettings, getClientSettings);
  const panel = (0, import_react3.useSyncExternalStore)(subscribe, getPanel);
  const rootRef = (0, import_react3.useRef)(null);
  const busy = panel !== void 0 && panel.sessionId === uiKey && panel.phase === "loading";
  const anyBusy = panel !== void 0 && panel.phase === "loading";
  const start = (0, import_react3.useCallback)(() => {
    if (anyBusy) return;
    if (!settings.enabled) {
      openError(uiKey, draft, { code: "rejected", message: t("error.disabled"), localized: t("error.disabled") });
      return;
    }
    if (imageCount > 0 && draft.trim() === "") {
      openError(uiKey, draft, { code: "rejected", message: t("error.imagesOnly"), localized: t("error.imagesOnly") });
      return;
    }
    const check = checkInputText(draft, settings.maxInputChars);
    if (!check.ok) {
      const message = check.code === "empty" ? t("error.empty") : t("error.tooLong", { count: check.count, max: check.max });
      openError(uiKey, draft, { code: "rejected", message, localized: message });
      return;
    }
    if (occurrenceCount > 0) {
      openError(uiKey, draft, { code: "rejected", message: t("error.occurrences"), localized: t("error.occurrences") });
      return;
    }
    if (phase !== "plain") {
      openError(uiKey, draft, { code: "rejected", message: t("error.phase"), localized: t("error.phase") });
      return;
    }
    const controller = new AbortController();
    openLoading({ sessionId: uiKey, original: draft, abort: () => controller.abort() });
    const settle = (result) => settleResult(uiKey, result);
    const fail = (error) => {
      const detail = error instanceof EnhanceClientError ? error.detail : { code: "internal", message: error instanceof Error ? error.message : String(error) };
      settleError(uiKey, detail);
    };
    if (settings.streaming) {
      requestEnhanceStream({ sessionId: wireId, text: draft }, {
        signal: controller.signal,
        onDelta: (delta) => appendDelta(uiKey, delta)
      }).then(settle, fail);
      return;
    }
    requestEnhance({ sessionId: wireId, text: draft }, controller.signal).then(settle, fail);
  }, [anyBusy, draft, imageCount, occurrenceCount, phase, settings, uiKey, wireId, t]);
  const runRef = (0, import_react3.useRef)(start);
  (0, import_react3.useEffect)(() => {
    runRef.current = start;
  });
  (0, import_react3.useEffect)(() => {
    const entry = {
      root: rootRef.current,
      run: () => runRef.current()
    };
    return registerSession(uiKey, entry);
  }, [uiKey]);
  (0, import_react3.useEffect)(() => {
    if (panel !== void 0 && panel.sessionId === uiKey && panel.phase === "result") {
      setStale(uiKey, draft !== panel.original);
    }
  }, [draft, panel, uiKey]);
  const apply2 = (0, import_react3.useCallback)(() => {
    if (panel === void 0 || panel.phase !== "result" || panel.result === void 0) return;
    pushUndo(uiKey, { original: draft, applied: panel.result.text });
    inputActions.setDraft(panel.result.text);
    closePanel();
  }, [draft, inputActions, panel, uiKey]);
  if (!settings.enabled) return null;
  const owned = panel !== void 0 && panel.sessionId === uiKey ? panel : void 0;
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
      "button",
      {
        ref: rootRef,
        type: "button",
        className: `dsh-pe-btn${busy ? " is-busy" : ""}`,
        title: busy ? t("button.busy") : t("button.title"),
        "aria-label": t("button.title"),
        disabled: anyBusy && !busy,
        onClick: start,
        children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dsh-pe-btn-icon", "aria-hidden": true, children: busy ? "\u25CC" : "\u2728" })
      }
    ),
    owned !== void 0 && (0, import_react_dom.createPortal)(
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
        ResultPanel,
        {
          state: owned,
          t,
          onApply: apply2,
          onCancel: () => closePanel(),
          onRetry: owned.phase === "error" ? start : void 0
        }
      ),
      document.body
    )
  ] });
}

// src/client/UndoBar.tsx
var import_react4 = require("react");
var import_jsx_runtime3 = require("react/jsx-runtime");
function UndoBar(props) {
  const { t, sessionId, useInput, inputActions } = props;
  const uiKey = useSessionKey(sessionId, inputActions);
  const draft = useInput((state) => state.draft);
  (0, import_react4.useSyncExternalStore)(subscribe, getVersion);
  const entry = peekUndo(uiKey);
  (0, import_react4.useEffect)(() => {
    if (entry !== void 0 && entry.applied !== draft) popUndo(uiKey);
  }, [draft, entry, uiKey]);
  if (entry === void 0 || entry.applied !== draft) return null;
  const undo = () => {
    inputActions.setDraft(entry.original);
    popUndo(uiKey);
  };
  const dismiss = () => {
    popUndo(uiKey);
  };
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dsh-pe-undo", children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "dsh-pe-undo-check", "aria-hidden": true, children: "\u2713" }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: t("undo.applied") }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", className: "dsh-pe-undo-link", onClick: undo, children: t("undo.undo") }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", className: "dsh-pe-undo-x", "aria-label": t("undo.dismiss"), onClick: dismiss, children: "\u2715" })
  ] });
}

// src/client/SettingsPanel.tsx
var import_react5 = require("react");
var import_jsx_runtime4 = require("react/jsx-runtime");
var FIELDS = [
  { key: "enabled", kind: "boolean", slug: "enabled" },
  { key: "reasoningEffort", kind: "enum", slug: "reasoningEffort", options: ["off", "low", "high", "inherit"] },
  { key: "maxOutputTokens", kind: "number", slug: "maxOutputTokens", min: 256, max: 65536 },
  { key: "maxInputChars", kind: "number", slug: "maxInputChars", min: 200, max: 2e5 },
  { key: "temperature", kind: "number", slug: "temperature", min: 0, max: 1 },
  { key: "timeoutMs", kind: "number", slug: "timeoutMs", min: 5e3, max: 6e5 },
  { key: "streaming", kind: "boolean", slug: "streaming" },
  { key: "contextAware", kind: "boolean", slug: "contextAware" },
  { key: "contextMaxMessages", kind: "number", slug: "contextMaxMessages", min: 0, max: 50 },
  { key: "contextMaxChars", kind: "number", slug: "contextMaxChars", min: 0, max: 1e5 },
  { key: "provider", kind: "text", slug: "provider" },
  { key: "model", kind: "text", slug: "model" },
  { key: "shortcut", kind: "text", slug: "shortcut" },
  { key: "maxConcurrent", kind: "number", slug: "maxConcurrent", min: 1, max: 16 },
  { key: "rateLimitPerMinute", kind: "number", slug: "rateLimitPerMinute", min: 1, max: 600 },
  { key: "strategyMode", kind: "enum", slug: "strategyMode", options: ["replace-default", "extend-default"] },
  { key: "systemPrompt", kind: "textArea", slug: "systemPrompt" }
];
function optionKey(slug, option) {
  return `field.${slug}.option.${option}`;
}
function labelKey(slug) {
  return `field.${slug}.label`;
}
function helpKey(slug) {
  return `field.${slug}.help`;
}
function hasKey(t, key) {
  return t(key) !== key;
}
function coerce(spec, raw) {
  if (spec.kind === "boolean") return raw === true || raw === "true";
  const text = String(raw);
  if (spec.kind === "text" || spec.kind === "textArea" || spec.kind === "enum") return text;
  if (text.trim() === "") return void 0;
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return void 0;
  if (spec.min !== void 0 && parsed < spec.min) return void 0;
  if (spec.max !== void 0 && parsed > spec.max) return void 0;
  return Number.isInteger(parsed) ? parsed : parsed;
}
function SettingsPanel(props) {
  const { t, configForms, entryId } = props;
  const form = (0, import_react5.useMemo)(() => configForms.get(entryId), [configForms, entryId]);
  const snapshot = (0, import_react5.useSyncExternalStore)(
    (0, import_react5.useCallback)((listener) => form.subscribe(listener), [form]),
    (0, import_react5.useCallback)(() => form.getSnapshot(), [form])
  );
  const [drafts, setDrafts] = (0, import_react5.useState)({});
  const [error, setError] = (0, import_react5.useState)(void 0);
  const value = snapshot.value ?? {};
  const shown = (spec) => {
    const draft = drafts[spec.key];
    if (draft !== void 0) return draft;
    const current2 = value[spec.key];
    if (spec.kind === "boolean") return current2 === true;
    if (current2 === void 0 || current2 === null) return "";
    return String(current2);
  };
  const commit = (spec) => {
    const draft = drafts[spec.key];
    if (draft === void 0) return;
    const next = coerce(spec, draft);
    if (next === void 0) {
      setError(t("settings.invalid", { field: t(labelKey(spec.slug)) }));
      return;
    }
    setError(void 0);
    void form.set(spec.key, next);
  };
  const reset = (spec) => {
    setError(void 0);
    setDrafts((current2) => {
      const next = { ...current2 };
      delete next[spec.key];
      return next;
    });
    void form.unset(spec.key);
  };
  const edit = (spec, raw) => {
    setDrafts((current2) => ({ ...current2, [spec.key]: raw }));
    if (spec.kind === "boolean" || spec.kind === "enum") {
      const next = coerce(spec, raw);
      if (next !== void 0) {
        setError(void 0);
        void form.set(spec.key, next);
        setDrafts((current2) => {
          const rest = { ...current2 };
          delete rest[spec.key];
          return rest;
        });
      }
    }
  };
  if (snapshot.status === "unavailable") {
    return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "dsh-pe-settings-note", children: t("settings.unavailable") });
  }
  if (snapshot.status === "loading") {
    return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "dsh-pe-settings-note", children: t("settings.loading") });
  }
  const writable = snapshot.writable !== false;
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "dsh-pe-settings", children: [
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: "dsh-pe-settings-intro", children: t("settings.intro") }),
    error !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "dsh-pe-settings-error", children: error }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "dsh-pe-settings-fields", children: FIELDS.map((spec) => {
      const control = shown(spec);
      const disabled = !writable;
      return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "dsh-pe-field", children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "dsh-pe-field-head", children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("label", { className: "dsh-pe-field-label", htmlFor: `dsh-pe-field-${spec.key}`, children: t(labelKey(spec.slug)) }),
          hasKey(t, helpKey(spec.slug)) && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: "dsh-pe-field-help", children: t(helpKey(spec.slug)) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "dsh-pe-field-control", children: [
          spec.kind === "boolean" && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
            "input",
            {
              id: `dsh-pe-field-${spec.key}`,
              type: "checkbox",
              checked: control === true,
              disabled,
              onChange: (event) => edit(spec, event.target.checked)
            }
          ),
          spec.kind === "enum" && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
            "select",
            {
              id: `dsh-pe-field-${spec.key}`,
              value: String(control),
              disabled,
              onChange: (event) => edit(spec, event.target.value),
              children: (spec.options ?? []).map((option) => /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("option", { value: option, children: t(optionKey(spec.slug, option)) }, option))
            }
          ),
          (spec.kind === "text" || spec.kind === "number") && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
            "input",
            {
              id: `dsh-pe-field-${spec.key}`,
              type: spec.kind === "number" ? "number" : "text",
              value: String(control),
              disabled,
              min: spec.min,
              max: spec.max,
              onChange: (event) => setDrafts((current2) => ({ ...current2, [spec.key]: event.target.value })),
              onBlur: () => commit(spec),
              onKeyDown: (event) => {
                if (event.key === "Enter") commit(spec);
              }
            }
          ),
          spec.kind === "textArea" && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
            "textarea",
            {
              id: `dsh-pe-field-${spec.key}`,
              value: String(control),
              disabled,
              rows: 4,
              onChange: (event) => setDrafts((current2) => ({ ...current2, [spec.key]: event.target.value })),
              onBlur: () => commit(spec)
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
            "button",
            {
              type: "button",
              className: "dsh-pe-field-reset",
              disabled,
              onClick: () => reset(spec),
              children: t("settings.reset")
            }
          )
        ] })
      ] }, spec.key);
    }) })
  ] });
}

// src/client/styles.ts
var STYLE_ID = "dsh-prompt-enhance-styles";
var CSS = `
.dsh-pe-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--dsh-pe-z-index, 1000);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: rgba(0, 0, 0, 0.32);
  padding: 24px 16px;
}
.dsh-pe-panel {
  --pe-bg: #1f2127;
  --pe-fg: #e6e8ee;
  --pe-fg-dim: rgba(230, 232, 238, 0.55);
  --pe-border: rgba(127, 127, 127, 0.35);
  --pe-separator: rgba(127, 127, 127, 0.25);
  --pe-hover: rgba(127, 127, 127, 0.18);
  --pe-danger: #ffb4a8;
  --pe-warn-fg: #e8c07d;
  --pe-warn-border: rgba(230, 158, 60, 0.35);
  --pe-warn-bg: rgba(230, 158, 60, 0.12);
  display: flex;
  flex-direction: column;
  width: min(880px, 100%);
  max-height: min(70vh, 640px);
  border-radius: 12px;
  border: 1px solid var(--pe-border);
  background: var(--pe-bg);
  color: var(--pe-fg);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
  overflow: hidden;
  outline: none;
}
@media (prefers-color-scheme: light) {
  .dsh-pe-panel {
    --pe-bg: #ffffff;
    --pe-fg: #1c1e24;
    --pe-fg-dim: rgba(28, 30, 36, 0.55);
    --pe-border: rgba(0, 0, 0, 0.18);
    --pe-separator: rgba(0, 0, 0, 0.12);
    --pe-hover: rgba(0, 0, 0, 0.08);
    --pe-danger: #a63a2e;
    --pe-warn-fg: #8a5a00;
    --pe-warn-border: rgba(176, 122, 0, 0.4);
    --pe-warn-bg: rgba(230, 158, 60, 0.15);
  }
}
.dsh-pe-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--pe-separator);
  font-size: 13px;
  font-weight: 600;
}
.dsh-pe-head .dsh-pe-meta { margin-left: auto; font-weight: 400; font-size: 11px; opacity: 0.6; }
.dsh-pe-close {
  border: none; background: transparent; color: inherit; opacity: 0.6;
  font-size: 15px; cursor: pointer; padding: 2px 6px; border-radius: 4px;
}
.dsh-pe-close:hover { opacity: 1; background: var(--pe-hover); }
.dsh-pe-body { display: flex; flex: 1; min-height: 0; }
.dsh-pe-col {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.dsh-pe-col + .dsh-pe-col { border-left: 1px solid var(--pe-separator); }
.dsh-pe-col-title {
  padding: 8px 14px 6px;
  font-size: 11px;
  letter-spacing: 0.04em;
  opacity: 0.55;
}
.dsh-pe-col-text {
  flex: 1;
  margin: 0;
  padding: 0 14px 12px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: inherit;
  font-size: 13px;
  line-height: 1.6;
}
.dsh-pe-error {
  padding: 20px 16px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--pe-danger);
  white-space: pre-wrap;
}
.dsh-pe-error .dsh-pe-error-detail {
  margin-top: 8px;
  font-size: 12px;
  opacity: 0.75;
  color: inherit;
}
.dsh-pe-loading {
  display: flex; flex-direction: column; gap: 8px;
  align-items: center; justify-content: center;
  flex: 1; padding: 28px 16px; font-size: 13px;
}
.dsh-pe-loading .dsh-pe-hint { font-size: 11px; opacity: 0.55; }
/* Incremental view: the streamed text takes the whole body, left-aligned. */
.dsh-pe-stream {
  display: flex; flex-direction: column;
  flex: 1; min-height: 0; width: 100%;
}
.dsh-pe-stream .dsh-pe-col-title {
  display: flex; align-items: center; gap: 6px;
  padding-left: 0;
}
.dsh-pe-spin.small { width: 11px; height: 11px; border-width: 1px; }
.dsh-pe-spin {
  width: 22px; height: 22px; border-radius: 50%;
  border: 2px solid var(--pe-separator); border-top-color: #6ea8ff;
  animation: dsh-pe-spin 0.9s linear infinite;
}
.dsh-pe-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-top: 1px solid var(--pe-separator);
}
.dsh-pe-foot .dsh-pe-grow { flex: 1; }
.dsh-pe-btn-action {
  border: none; border-radius: 6px; padding: 6px 14px;
  font-size: 12px; cursor: pointer; line-height: 1;
}
.dsh-pe-btn-action.primary { background: #3f76e1; color: #fff; }
.dsh-pe-btn-action.primary:hover { background: #4d82ec; }
.dsh-pe-btn-action.plain { background: var(--pe-hover); color: inherit; }
.dsh-pe-btn-action.plain:hover { background: rgba(127, 127, 127, 0.3); }

.dsh-pe-stale {
  padding: 8px 14px;
  font-size: 12px;
  line-height: 1.5;
  border-top: 1px solid var(--pe-warn-border);
  background: var(--pe-warn-bg);
  color: var(--pe-warn-fg);
}

.dsh-pe-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 28px;
  padding: 0 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  opacity: 0.75;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  white-space: nowrap;
}
.dsh-pe-btn:hover:not(:disabled) { opacity: 1; background: var(--pe-hover); }
.dsh-pe-btn:disabled { opacity: 0.45; cursor: default; }
.dsh-pe-btn .dsh-pe-btn-icon { font-size: 14px; }
.dsh-pe-btn.is-busy .dsh-pe-btn-icon { animation: dsh-pe-spin 1s linear infinite; }
@keyframes dsh-pe-spin { to { transform: rotate(360deg); } }

.dsh-pe-undo {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 4px;
  font-size: 12px;
  color: inherit;
  opacity: 0.85;
}
.dsh-pe-undo .dsh-pe-undo-check { color: #7ed491; }
.dsh-pe-undo-link {
  border: none; background: var(--pe-hover); color: inherit;
  border-radius: 5px; padding: 3px 10px; font-size: 12px; cursor: pointer;
}
.dsh-pe-undo-link:hover { background: rgba(127,127,127,0.3); }
.dsh-pe-undo-x {
  border: none; background: transparent; color: inherit; opacity: 0.55;
  cursor: pointer; padding: 0 4px; font-size: 12px;
}
.dsh-pe-undo-x:hover { opacity: 1; }

/* The plugin's own Settings page (settings.section). It inherits the shell's
   text color and only draws structure, so it follows whichever skin is active
   instead of importing host theme internals. */
.dsh-pe-settings { display: flex; flex-direction: column; gap: 16px; padding: 4px 0 24px; }
.dsh-pe-settings-intro { margin: 0; font-size: 13px; line-height: 1.6; opacity: 0.75; }
.dsh-pe-settings-note { padding: 16px 0; font-size: 13px; opacity: 0.7; }
.dsh-pe-settings-error {
  padding: 8px 10px; border-radius: 6px; font-size: 13px;
  border: 1px solid rgba(220, 90, 90, 0.5); background: rgba(220, 90, 90, 0.12);
}
.dsh-pe-settings-fields { display: flex; flex-direction: column; gap: 14px; }
.dsh-pe-field {
  display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: flex-start;
  padding-bottom: 12px; border-bottom: 1px solid rgba(127, 127, 127, 0.18);
}
.dsh-pe-field-head { flex: 1 1 260px; min-width: 200px; }
.dsh-pe-field-label { display: block; font-size: 13px; font-weight: 600; }
.dsh-pe-field-help { margin: 2px 0 0; font-size: 12px; line-height: 1.55; opacity: 0.62; }
.dsh-pe-field-control { display: flex; align-items: center; gap: 8px; flex: 0 1 260px; }
.dsh-pe-field-control input[type="text"],
.dsh-pe-field-control input[type="number"],
.dsh-pe-field-control select,
.dsh-pe-field-control textarea {
  flex: 1 1 auto; min-width: 0; padding: 4px 8px; font: inherit; font-size: 13px;
  color: inherit; background: rgba(127, 127, 127, 0.12);
  border: 1px solid rgba(127, 127, 127, 0.32); border-radius: 6px;
}
.dsh-pe-field-control input[type="checkbox"] { flex: 0 0 auto; width: 16px; height: 16px; }
.dsh-pe-field-control textarea { resize: vertical; line-height: 1.5; }
.dsh-pe-field-control :disabled { opacity: 0.5; }
.dsh-pe-field-reset {
  flex: 0 0 auto; padding: 3px 8px; font: inherit; font-size: 12px;
  color: inherit; opacity: 0.6; cursor: pointer;
  background: transparent; border: 1px solid rgba(127, 127, 127, 0.32); border-radius: 6px;
}
.dsh-pe-field-reset:hover { opacity: 1; }
`;
function ensureStyles() {
  if (document.getElementById(STYLE_ID) !== null) return false;
  const element = document.createElement("style");
  element.id = STYLE_ID;
  element.textContent = CSS;
  document.head.appendChild(element);
  return true;
}

// src/client/shortcut.ts
var MODIFIER_ALIASES = /* @__PURE__ */ new Map([
  ["ctrl", "ctrl"],
  ["control", "ctrl"],
  ["alt", "alt"],
  ["option", "alt"],
  ["shift", "shift"],
  ["meta", "meta"],
  ["cmd", "meta"],
  ["command", "meta"],
  ["win", "meta"],
  ["super", "meta"]
]);
var isKeyToken = (token) => /^[a-z0-9]$/.test(token) || /^f([1-9]|1[0-2])$/.test(token);
function codeFor(token) {
  if (/^[a-z]$/.test(token)) return `Key${token.toUpperCase()}`;
  if (/^[0-9]$/.test(token)) return `Digit${token}`;
  return `F${token.slice(1)}`;
}
function parseShortcut(spec) {
  if (spec === void 0) return null;
  const tokens = spec.trim().toLowerCase().split("+").map((token) => token.trim()).filter((token) => token !== "");
  if (tokens.length === 0 || tokens.length > 5) return null;
  const modifiers = { ctrl: false, alt: false, shift: false, meta: false };
  const last = tokens[tokens.length - 1] ?? "";
  if (!isKeyToken(last)) return null;
  for (const token of tokens.slice(0, -1)) {
    const modifier = MODIFIER_ALIASES.get(token);
    if (modifier === void 0) return null;
    modifiers[modifier] = true;
  }
  if (!modifiers.ctrl && !modifiers.alt && !modifiers.meta) return null;
  return { ...modifiers, key: last, code: codeFor(last) };
}
function matchesShortcut(event, combo) {
  if (combo === null) return false;
  return event.ctrlKey === combo.ctrl && event.altKey === combo.alt && event.shiftKey === combo.shift && event.metaKey === combo.meta && (event.code === combo.code || event.key.toLowerCase() === combo.key);
}

// src/client/index.tsx
var import_jsx_runtime5 = require("react/jsx-runtime");
var inject = ["slots", "locale"];
function apply(ctx) {
  ensureStyles();
  ctx.effect(() => {
    try {
      return ctx.locale.register(NS, dictionaries);
    } catch {
      return () => {
      };
    }
  }, "dsh-prompt-enhance: dictionaries");
  ctx.inject(["configForms"], (settingsCtx) => {
    const scope = settingsCtx.configForms.get(NS);
    const sync = () => {
      setClientSettings(decodeClientSettings(scope.getSnapshot().value));
    };
    sync();
    ctx.effect(() => scope.subscribe(sync), "dsh-prompt-enhance: settings mirror");
  });
  ctx.inject(["slots"], (slotsCtx) => {
    const slots = slotsCtx.slots;
    return slots.inject("conversation.input.right", () => {
      try {
        return slots.register(
          { name: "conversation.input.right", id: "prompt-enhance", order: 60, locale: NS },
          EnhanceButton
        );
      } catch {
        return () => {
        };
      }
    });
  });
  ctx.inject(["slots"], (slotsCtx) => {
    const slots = slotsCtx.slots;
    return slots.inject("conversation.input.dock", () => {
      try {
        return slots.register(
          { name: "conversation.input.dock", id: "prompt-enhance-undo", order: 90, locale: NS },
          UndoBar
        );
      } catch {
        return () => {
        };
      }
    });
  });
  ctx.inject(["slots", "configForms"], (settingsCtx) => {
    const slots = settingsCtx.slots;
    const configForms = settingsCtx.configForms;
    return slots.inject("settings.section", () => {
      try {
        return slots.register(
          {
            name: "settings.section",
            id: NS,
            order: 120,
            label: () => settingsCtx.locale.bind(NS)("settings.title"),
            locale: NS
          },
          // The seat injects only `t`/`renderSlot`; the two extra props are
          // bound here, which is why the component is adapted rather than
          // registered directly.
          ((props) => /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(SettingsPanel, { ...props, configForms, entryId: NS }))
        );
      } catch {
        return () => {
        };
      }
    });
  });
  ctx.effect(() => {
    const onKeyDown = (event) => {
      if (event.defaultPrevented || event.isComposing) return;
      const combo = parseShortcut(getClientSettings().shortcut);
      if (!matchesShortcut(event, combo)) return;
      const target = shortcutTarget();
      if (target === void 0) return;
      event.preventDefault();
      event.stopPropagation();
      target();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, "dsh-prompt-enhance: shortcut");
}

		return module.exports;
	}
});

