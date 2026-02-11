# Исследование: Миграция CodeLayer UI на opencode server

> Результат исследования для создания нового репозитория на базе humanlayer-wui,
> интегрированного с opencode server вместо hld daemon.

---

## Оглавление

1. [Текущая архитектура (hld)](#1-текущая-архитектура-hld)
2. [Целевая архитектура (opencode)](#2-целевая-архитектура-opencode)
3. [Зависимости WUI от монорепо](#3-зависимости-wui-от-монорепо)
4. [Маппинг моделей данных](#4-маппинг-моделей-данных)
5. [Маппинг API методов](#5-маппинг-api-методов)
6. [Маппинг SSE событий](#6-маппинг-sse-событий)
7. [Tauri слой — замена daemon.rs](#7-tauri-слой--замена-daemonrs)
8. [Карта затронутых файлов](#8-карта-затронутых-файлов)
9. [Матрица фич](#9-матрица-фич)
10. [План миграции по фазам](#10-план-миграции-по-фазам)
11. [Риски и решения](#11-риски-и-решения)

---

## 1. Текущая архитектура (hld)

### Поток данных

```
Claude Code → MCP Protocol → hlyr → JSON-RPC → hld daemon → HumanLayer Cloud API
                                                     ↑
                                                CodeLayer WUI
                                              (Tauri + React)
```

### Связь WUI ↔ hld

- **Протокол**: HTTP поверх TCP (порт выделяется динамически)
- **Real-time**: SSE (Server-Sent Events) для получения обновлений
- **SDK**: `@humanlayer/hld-sdk` — сгенерированный TypeScript клиент из OpenAPI спецификации
- **Tauri**: Rust-бэкенд запускает бинарник `hld`, читает порт из stdout, мониторит процесс

### Интерфейс `DaemonClient` (34 метода)

```typescript
interface DaemonClient {
  // Подключение
  connect(): Promise<void>;
  reconnect(): Promise<void>;
  disconnect(): Promise<void>;
  health(): Promise<HealthCheckResponse>;

  // Сессии (16 методов)
  launchSession(params): Promise<CreateSessionResponseData>;
  listSessions(): Promise<Session[]>;
  getSessionLeaves(filter?): Promise<{ sessions; counts }>;
  getSessionState(sessionId): Promise<SessionState>;
  continueSession(sessionId, message): Promise<{ success; new_session_id? }>;
  interruptSession(sessionId): Promise<{ success }>;
  updateSession(sessionId, updates): Promise<{ success }>;
  updateSessionSettings(sessionId, settings): Promise<{ success }>;
  updateSessionTitle(sessionId, title): Promise<{ success }>;
  archiveSession(sessionId): Promise<{ success }>;
  bulkArchiveSessions(sessionIds): Promise<{ success; archived_count }>;
  searchSessions(params): Promise<{ data: Session[] }>;
  getSessionSnapshots(sessionId): Promise<SessionSnapshot[]>;
  getSlashCommands(params): Promise<{ data: SlashCommand[] }>;

  // Диалог (1 метод)
  getConversation(params): Promise<ConversationEvent[]>;

  // Одобрения (3 метода)
  fetchApprovals(sessionId?): Promise<Approval[]>;
  approveFunctionCall(approvalId, comment?): Promise<{ success }>;
  denyFunctionCall(approvalId, comment?): Promise<{ success }>;

  // Подписка на события (1 метод)
  subscribeToEvents(options): SubscriptionHandle;

  // Утилиты (5 методов)
  getRecentPaths(limit?): Promise<RecentPath[]>;
  getDebugInfo(): Promise<DebugInfo>;
  fuzzySearchFiles(params): Promise<FuzzySearchFilesResponse>;
  discoverAgents(workingDir): Promise<Agent[]>;
  validateDirectory(path): Promise<ValidateDirectoryResponse>;
}
```

### Ключевые модели данных hld

#### Session

```typescript
interface Session {
  id: string;
  runId: string;
  claudeSessionId?: string;
  parentSessionId?: string;
  status: SessionStatus; // 'running' | 'completed' | 'failed' | 'waiting_input' | 'draft'
  query: string;
  summary?: string;
  title?: string;
  model?: string;
  modelId?: string;
  workingDir?: string;
  additionalDirectories?: string[];
  createdAt: Date;
  lastActivityAt: Date;
  completedAt?: Date;
  errorMessage?: string;
  // Метрики стоимости (на уровне сессии)
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  effectiveContextTokens?: number;
  contextLimit?: number;
  durationMs?: number;
  // Настройки
  autoAcceptEdits?: boolean;
  dangerouslySkipPermissions?: boolean;
  dangerouslySkipPermissionsExpiresAt?: Date;
  archived?: boolean;
  // Прокси
  proxyEnabled?: boolean;
  proxyBaseUrl?: string;
  proxyModelOverride?: string;
  // Черновик
  editorState?: string;
}
```

#### ConversationEvent (плоская модель)

```typescript
interface ConversationEvent {
  id: number; // числовой ID
  sessionId: string;
  sequence: number; // порядковый номер
  eventType: "message" | "tool_call" | "tool_result" | "system" | "thinking";
  createdAt: Date;
  role?: "user" | "assistant" | "system";
  content?: string;
  // Для tool_call
  toolId?: string;
  toolName?: string;
  toolInputJson?: string;
  parentToolUseId?: string; // вложенные вызовы
  // Для tool_result
  toolResultForId?: string;
  toolResultContent?: string;
  isCompleted?: boolean;
  // Для одобрений
  approvalStatus?: "pending" | "approved" | "denied" | "resolved";
  approvalId?: string;
}
```

#### Approval

```typescript
interface Approval {
  id: string;
  runId: string;
  sessionId: string;
  status: "pending" | "approved" | "denied" | "resolved";
  createdAt: Date;
  respondedAt?: Date;
  toolName: string;
  toolInput: Record<string, any>;
  comment?: string; // комментарий при одобрении/отказе
}
```

#### SSE события hld (5 типов)

```typescript
type EventType =
  | "new_approval" // новый запрос на одобрение
  | "approval_resolved" // одобрение разрешено
  | "session_status_changed" // статус сессии изменился
  | "conversation_updated" // обновление диалога
  | "session_settings_changed"; // настройки сессии изменились
```

---

## 2. Целевая архитектура (opencode)

### Поток данных

```
opencode serve → HTTP API (порт 4096 по умолчанию)
                        ↑
                   Новый UI (Tauri + React)
                   использует @opencode-ai/sdk
```

### Подключение

- **Протокол**: HTTP на настраиваемом порту (по умолчанию 4096)
- **Real-time**: SSE на эндпоинте `GET /event`
- **SDK**: `@opencode-ai/sdk` — npm-пакет с типобезопасным клиентом
- **Аутентификация**: Basic Auth через `OPENCODE_SERVER_PASSWORD` (опционально)

### SDK API

```typescript
import { createOpencodeClient } from '@opencode-ai/sdk'

const client = createOpencodeClient({
  baseUrl: 'http://localhost:4096',
})

// Сессии
client.session.list()
client.session.create({ body: { title? } })
client.session.get({ path: { id } })
client.session.delete({ path: { id } })
client.session.update({ path: { id }, body: { title? } })
client.session.abort({ path: { id } })
client.session.fork({ path: { id }, body: { messageID? } })
client.session.share({ path: { id } })
client.session.unshare({ path: { id } })
client.session.diff({ path: { id } })
client.session.revert({ path: { id }, body: { messageID } })
client.session.unrevert({ path: { id } })
client.session.summarize({ path: { id }, body: { providerID, modelID } })
client.session.children({ path: { id } })
client.session.messages({ path: { id } })  // → Array<{ info: Message, parts: Part[] }>
client.session.prompt({ path: { id }, body: { parts, model? } })
client.session.promptAsync({ path: { id }, body: { parts } })  // fire-and-forget
client.session.command({ path: { id }, body: { command, arguments } })
client.session.shell({ path: { id }, body: { agent, command } })
client.session.todo({ path: { id } })
client.session.init({ path: { id }, body: { modelID, providerID, messageID } })
client.session.status()  // → { [sessionID]: SessionStatus }

// События (SSE)
const result = await client.event.subscribe()  // НЕ event.list()!
// result — ServerSentEventsResult, итерация через stream

// Глобальные события (кросс-директория)
const globalResult = await client.global.event()
// → GlobalEvent = { directory: string, payload: Event }

// Файлы
client.find.files({ query: { query } })
client.find.text({ query: { pattern } })
client.find.symbols({ query: { query } })
client.file.read({ query: { path } })
client.file.list({ query: { path } })
client.file.status()

// Провайдеры — ОБА метода существуют, но разные:
client.provider.list()         // → { all: [...], default: {...}, connected: [...] }
client.config.providers()      // → { providers: Provider[], default: {...} }
client.config.get()
client.config.update({ body })  // НЕ config.patch()!

// Агенты
client.app.agents()  // НЕ app.modes()!

// Права (permission respond) — top-level метод
client.postSessionIdPermissionsPermissionId({
  path: { id: sessionID, permissionID },
  body: { response: 'once' | 'always' | 'reject' }
})
```

### Ключевые модели данных opencode

#### Session

```typescript
type Session = {
  id: string;
  // SPIKE: slug НЕ существует в SDK v1.1.58 — убрано
  projectID: string;
  directory: string;
  parentID?: string;
  title: string;
  version: string;
  summary?: {
    additions: number;
    deletions: number;
    files: number;
    diffs?: FileDiff[];
  };
  share?: { url: string };
  time: {
    created: number; // unix timestamp
    updated: number;
    compacting?: number;
    // SPIKE: archived НЕ существует — нет архивации в opencode, только delete
  };
  // SPIKE: permission НЕ является полем Session — нет PermissionRuleset
  revert?: {
    messageID: string;
    partID?: string;
    snapshot?: string; // SPIKE: дополнительные поля из реального типа
    diff?: string;
  };
};
```

#### SessionStatus (отдельно, через /session/status)

```typescript
type SessionStatus =
  | { type: "idle" }
  | { type: "busy" }
  | { type: "retry"; attempt: number; message: string; next: number };
```

#### Message (иерархическая модель)

```typescript
type Message = UserMessage | AssistantMessage;

type AssistantMessage = {
  id: string;
  sessionID: string;
  role: "assistant";
  parentID: string;
  modelID: string;
  providerID: string;
  mode: string; // SPIKE: поле называется mode, НЕ agent
  path: {
    // SPIKE: дополнительное поле
    cwd: string;
    root: string;
  };
  time: { created: number; completed?: number };
  error?:
    | ProviderAuthError
    | UnknownError
    | MessageOutputLengthError
    | MessageAbortedError
    | ApiError;
  summary?: boolean; // SPIKE: дополнительное поле
  cost: number;
  tokens: {
    input: number;
    output: number;
    reasoning: number;
    cache: { read: number; write: number };
  };
  finish?: string;
};
```

#### Part (12 типов — в отличие от плоских событий hld)

```typescript
type Part =
  | TextPart // Текстовое содержимое
  | ReasoningPart // Мышление (thinking)
  | ToolPart // Вызов инструмента
  | SubtaskPart // Подзадача агента
  | FilePart // Файловая операция
  | StepStartPart // Начало шага
  | StepFinishPart // Завершение шага
  | SnapshotPart // Снимок файла
  | PatchPart // Патч файла
  | AgentPart // Мета-информация агента
  | RetryPart // Повтор запроса
  | CompactionPart; // Сжатие контекста

type ToolPart = {
  id: string;
  sessionID: string;
  messageID: string;
  type: "tool";
  callID: string;
  tool: string;
  state:
    | ToolStatePending
    | ToolStateRunning
    | ToolStateCompleted
    | ToolStateError;
  metadata?: Record<string, unknown>;
};
```

#### Permission (вместо Approval)

```typescript
// SPIKE: реальный тип из SDK v1.1.58 — отличается от исходного исследования
type Permission = {
  id: string;
  type: string; // тип разрешения (e.g., "bash", "edit")
  pattern?: string | string[]; // паттерн для "always" правил
  sessionID: string;
  messageID: string;
  callID?: string; // Tool call ID если связано с инструментом
  title: string; // Человекочитаемое описание
  metadata: Record<string, unknown>;
  time: { created: number };
};

// Ответ: "once" | "always" | "reject"
// Endpoint: POST /session/{id}/permissions/{permissionID}
// Body: { response: "once" | "always" | "reject" }
```

#### SSE события opencode (43 типа)

Ключевые для UI:

```typescript
// Сессии
'session.created'         → { info: Session }
'session.updated'         → { info: Session }
'session.deleted'         → { info: Session }
'session.status'          → { sessionID, status: SessionStatus }
'session.error'           → { sessionID, error }
'session.idle'            → { ... }

// Сообщения
'message.updated'         → { info: Message }
'message.removed'         → { info: Message }
'message.part.updated'    → { part: Part, delta?: string }
'message.part.removed'    → { part: Part }

// Разрешения
// SPIKE: событие называется permission.updated, НЕ permission.asked!
'permission.updated'      → Permission  // новый запрос на разрешение
// SPIKE: EventPermissionReplied СУЩЕСТВУЕТ (R3 был неправ)
'permission.replied'      → { sessionID, permissionID, response }

// Задачи
'todo.updated'            → { sessionID, todos: Todo[] }

// Файлы
'file.edited'             → { ... }
'file.watcher.updated'    → { ... }

// Прочее
'server.connected'        → {}   // первое событие при подключении
'lsp.updated'             → { ... }
'mcp.tools.changed'       → { ... }
'vcs.branch.updated'      → { ... }
```

---

## 3. Зависимости WUI от монорепо

### Критическая зависимость: `@humanlayer/hld-sdk`

```json
// humanlayer-wui/package.json
"@humanlayer/hld-sdk": "file:../hld/sdk/typescript"
```

**14 файлов** импортируют типы из этого пакета:

| Файл                                                 | Что импортирует                                                                                     |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `src/lib/daemon/types.ts`                            | SessionStatus, ApprovalStatus, Session, Approval, ConversationEvent, Event, EventType, Agent, и др. |
| `src/lib/daemon/http-client.ts`                      | HLDClient, все типы запросов/ответов                                                                |
| `src/utils/errors.ts`                                | ResponseError                                                                                       |
| `src/components/.../ConversationEventRow.tsx`        | ApprovalStatus, ConversationEvent                                                                   |
| `src/components/.../BashToolCallContent.tsx`         | ApprovalStatus                                                                                      |
| `src/components/.../EditToolCallContent.tsx`         | ApprovalStatus                                                                                      |
| `src/components/.../MultiEditToolCallContent.tsx`    | ApprovalStatus                                                                                      |
| `src/components/.../NotebookEditToolCallContent.tsx` | ApprovalStatus                                                                                      |
| `src/components/.../NotebookReadToolCallContent.tsx` | ApprovalStatus                                                                                      |
| `src/components/.../ExitPlanModeToolCallContent.tsx` | ApprovalStatus                                                                                      |
| и ещё 4 файла (stories, тесты)                       | Различные типы                                                                                      |

### Tauri/Rust зависимости

- `src-tauri/Cargo.toml` — **нет** workspace-зависимостей на другие крейты монорепо
- `src-tauri/tauri.conf.json` — бандлит бинарники `bin/hld` и `bin/humanlayer`
- `src-tauri/src/daemon.rs` — запускает и управляет процессом `hld`

### Прочие зависимости на монорепо

- `Makefile` строка 42 — ссылается на `../hack/run_silent.sh` (CI/CD, не критично)
- Конфиги (tsconfig, eslint, prettier) — **полностью автономны**, не ссылаются на родителя

### Вывод: что нужно для извлечения

1. ❌ Удалить `@humanlayer/hld-sdk` — заменить на `@opencode-ai/sdk`
2. ❌ Удалить/переписать `src/lib/daemon/` (6 файлов)
3. ❌ Удалить/переписать `src-tauri/src/daemon.rs`
4. ✅ Все остальные файлы — автономны и копируются как есть

---

## 4. Маппинг моделей данных

### Session: hld → opencode

| Поле hld                        | Поле opencode                    | Примечание                                   |
| ------------------------------- | -------------------------------- | -------------------------------------------- |
| `id`                            | `id`                             | Прямое соответствие                          |
| `parentSessionId`               | `parentID`                       | Переименование                               |
| `title`                         | `title`                          | Прямое                                       |
| `query`                         | —                                | Нет прямого аналога; первое сообщение        |
| `status`                        | Через `/session/status`          | Отдельный запрос/событие                     |
| `workingDir`                    | `directory`                      | Переименование                               |
| `createdAt`                     | `time.created`                   | Date → unix timestamp                        |
| `lastActivityAt`                | `time.updated`                   | Date → unix timestamp                        |
| `completedAt`                   | —                                | Определять из status=idle + finish           |
| `summary`                       | `summary.body`?                  | Другая структура                             |
| `model` / `modelId`             | —                                | На уровне Message, не Session                |
| `costUsd`                       | —                                | Суммировать из `AssistantMessage.cost`       |
| `inputTokens` / `outputTokens`  | —                                | Суммировать из `AssistantMessage.tokens`     |
| `archived`                      | —                                | **SPIKE: НЕТ time.archived** — только delete |
| `runId`                         | —                                | Нет аналога (Claude-специфично)              |
| `claudeSessionId`               | —                                | Нет аналога                                  |
| `proxyEnabled` / `proxyBaseUrl` | —                                | Нет аналога                                  |
| `dangerouslySkipPermissions`    | `permission` (PermissionRuleset) | Другая концепция                             |
| `editorState`                   | —                                | Нет аналога (draft-сессии)                   |
| —                               | ~~`slug`~~                       | **SPIKE: НЕТ slug** — не существует в SDK    |
| —                               | `share.url`                      | Новое: ссылка для шаринга                    |
| —                               | `version`                        | Новое: версия opencode                       |

### ConversationEvent (hld) → Message + Part[] (opencode)

| eventType hld              | Тип в opencode                                          | Маппинг                        |
| -------------------------- | ------------------------------------------------------- | ------------------------------ |
| `message` (role=user)      | `UserMessage` + `TextPart`                              | Развернуть Part.text в content |
| `message` (role=assistant) | `AssistantMessage` + `TextPart`                         | Развернуть Part.text в content |
| `thinking`                 | `AssistantMessage` + `ReasoningPart`                    | Part.type='reasoning'          |
| `tool_call`                | `AssistantMessage` + `ToolPart` (state=pending/running) | Нужно извлечь tool, callID     |
| `tool_result`              | `AssistantMessage` + `ToolPart` (state=completed/error) | Результат внутри ToolState     |
| `system`                   | `UserMessage` с system prompt                           | Или синтетическое событие      |

**Ключевая сложность**: hld использует **плоский список** с `sequence` номером, opencode — **иерархию** Message → Part[]. Нужен трансформер, который развернёт иерархию в плоский список для существующих UI-компонентов.

### Approval (hld) → Permission (opencode)

| Поле hld                           | Поле opencode                   | Примечание                                 |
| ---------------------------------- | ------------------------------- | ------------------------------------------ |
| `id`                               | `PermissionRequest.id`          | Прямое                                     |
| `sessionId`                        | `sessionID`                     | Переименование                             |
| `status` (pending/approved/denied) | Нет статуса — событийная модель | asked → replied                            |
| `toolName`                         | `permission` + `tool.callID`    | Другая структура                           |
| `toolInput`                        | `metadata`                      | Приблизительный аналог                     |
| `comment`                          | —                               | **Нет аналога** — opencode не поддерживает |
| `respondedAt`                      | —                               | Только через событие `permission.replied`  |
| Ответ: approve/deny                | Ответ: once/always/reject       | `approve` ≈ `once`, `deny` ≈ `reject`      |

---

## 5. Маппинг API методов

### Прямое соответствие

| DaemonClient метод     | opencode SDK                             | Примечание                |
| ---------------------- | ---------------------------------------- | ------------------------- |
| `health()`             | `client.global.health()`                 | Эндпоинт `/global/health` |
| `listSessions()`       | `client.session.list()`                  | Прямое                    |
| `interruptSession(id)` | `client.session.abort({ path: { id } })` | Переименование            |
| `discoverAgents(dir)`  | `client.app.agents()`                    | Не привязано к директории |
| `getSlashCommands()`   | `client.command.list()`                  | Прямое                    |

### Требует трансформации

| DaemonClient метод           | opencode SDK                                         | Как адаптировать                                              |
| ---------------------------- | ---------------------------------------------------- | ------------------------------------------------------------- |
| `launchSession(params)`      | `session.create()` + `session.prompt()`              | Двухшаговый: создать → отправить первое сообщение             |
| `continueSession(id, msg)`   | `session.prompt({ path: {id}, body: { parts } })`    | Обернуть текст в `[{ type: 'text', text: msg }]`              |
| `getConversation(params)`    | `session.messages({ path: {id} })`                   | **Тяжёлая трансформация**: Message/Part → ConversationEvent[] |
| `fetchApprovals(id)`         | Нет list API — отслеживать из SSE                    | Хранить в клиентском состоянии из событий `permission.asked`  |
| `sendDecision(id, decision)` | `postSessionByIdPermissionsByPermissionId()`         | `approve` → `once`, `deny` → `reject`                         |
| `getSessionLeaves(filter)`   | `session.list()` + фильтрация                        | Нет серверной фильтрации по archived/draft                    |
| `updateSession(id, updates)` | `session.update()`                                   | Только `title` поддерживается                                 |
| `getSessionSnapshots(id)`    | `session.diff({ path: {id} })`                       | Другая концепция: diff вместо snapshots                       |
| `fuzzySearchFiles(params)`   | `client.find.files()`                                | Немного другие параметры                                      |
| `subscribeToEvents(options)` | `client.event.subscribe()` — **SPIKE: подтверждено** | Другой формат событий (31 тип в Event union vs 5)             |

### Нет аналога в opencode (эмуляция или удаление)

| DaemonClient метод        | Решение                                                                                      |
| ------------------------- | -------------------------------------------------------------------------------------------- |
| `archiveSession()`        | **SPIKE: нет archive API** — эмулировать через localStorage или soft-delete на нашей стороне |
| `bulkArchiveSessions()`   | Удалить или эмулировать                                                                      |
| `searchSessions(query)`   | Фильтрация на клиенте по `session.list()`                                                    |
| `updateSessionSettings()` | Частично через `config.patch()`                                                              |
| `getRecentPaths()`        | Эмулировать через localStorage                                                               |
| `getDebugInfo()`          | Заменить на `client.lsp()` + `client.mcp()`                                                  |
| `validateDirectory()`     | Заменить на `client.find.files()`                                                            |

### Новые возможности opencode (которых не было в hld)

| Метод                             | Что даёт                           |
| --------------------------------- | ---------------------------------- |
| `session.fork()`                  | Форк сессии с точки сообщения      |
| `session.share()` / `unshare()`   | Публичный шаринг сессий            |
| `session.diff()`                  | Просмотр изменений файлов          |
| `session.revert()` / `unrevert()` | Откат изменений                    |
| `session.todo()`                  | Серверный список задач             |
| `provider.list()` / `auth()`      | Управление провайдерами и моделями |
| `find.text()` / `find.symbols()`  | Поиск по содержимому и символам    |
| `file.read()` / `file.status()`   | Просмотр файлов и VCS-статуса      |
| `config.get()` / `patch()`        | Управление конфигурацией           |

---

## 6. Маппинг SSE событий

### Прямое соответствие

| hld событие                | opencode событие                           | Данные                                  |
| -------------------------- | ------------------------------------------ | --------------------------------------- |
| `session_status_changed`   | `session.status`                           | `{ sessionID, status }`                 |
| `new_approval`             | `permission.updated` **(НЕ `asked`!)**     | `Permission`                            |
| `approval_resolved`        | `permission.replied` **(СУЩЕСТВУЕТ!)**     | `{ sessionID, permissionID, response }` |
| `conversation_updated`     | `message.updated` + `message.part.updated` | Нужно агрегировать                      |
| `session_settings_changed` | `session.updated`                          | Внутри `Session` объекта                |

### Новые события opencode (без аналога в hld)

```
session.created         — создание сессии
session.deleted         — удаление сессии
session.idle            — сессия стала idle
session.error           — ошибка в сессии
session.diff            — изменения файлов
message.removed         — удаление сообщения
message.part.removed    — удаление части сообщения
todo.updated            — обновление списка задач
file.edited             — редактирование файла
file.watcher.updated    — изменения в файловой системе
lsp.updated             — обновление LSP
mcp.tools.changed       — изменение MCP-инструментов
vcs.branch.updated      — смена ветки VCS
pty.created/updated/exited — терминальные сессии
server.connected        — первое событие подключения
```

### Архитектура SSE подписки

```
opencode: GET /event → text/event-stream
  ↓
Каждое событие: { type: "event.name", properties: { ... } }
  ↓
Heartbeat каждые 30 секунд: { type: "server.heartbeat" }
  ↓
JS SDK: for await (const event of events.stream) { ... }
```

---

## 7. Tauri слой — замена daemon.rs

### Текущий daemon.rs (591 строк)

Управляет жизненным циклом процесса `hld`:

1. Находит бинарник (`hld-dev` для разработки, `bin/hld` для продакшена)
2. Устанавливает переменные окружения (`HUMANLAYER_*`)
3. Запускает процесс с захватом stdout/stderr
4. Читает порт из первой строки stdout (`HTTP_PORT=XXXX`)
5. Ждёт health check (`GET /api/v1/health`, таймаут 10 сек)
6. Мониторит процесс в фоновой задаче (каждую секунду)
7. Останавливает: SIGTERM → ждёт 15 сек → SIGKILL

### Что менять для opencode

| Компонент         | Было (hld)                | Станет (opencode)                              |
| ----------------- | ------------------------- | ---------------------------------------------- |
| Бинарник          | `hld` / `hld-dev`         | `opencode` (из PATH или бандл)                 |
| Команда запуска   | `./hld`                   | `opencode serve --port 0 --hostname 127.0.0.1` |
| Обнаружение порта | Stdout: `HTTP_PORT=XXXX`  | Stdout или фиксированный `--port 4096`         |
| Health check      | `GET /api/v1/health`      | `GET /global/health`                           |
| Env переменные    | `HUMANLAYER_*`            | `OPENCODE_*` (или параметры CLI)               |
| Директория данных | `~/.humanlayer/`          | `~/.opencode/` (или стандартная XDG)           |
| Database path     | `daemon-{branch}.db`      | Управляется opencode                           |
| Socket path       | `daemon-{branch}.sock`    | Не нужен (HTTP only)                           |
| Store path        | `codelayer-{branch}.json` | `opencode-ui-{branch}.json`                    |

### DaemonInfo → ServerInfo

```rust
// Было
struct DaemonInfo {
    port: u16,
    pid: u32,
    database_path: String,
    socket_path: String,
    branch_id: String,
    is_running: bool,
}

// Станет
struct ServerInfo {
    port: u16,
    pid: u32,
    base_url: String,       // http://localhost:{port}
    is_running: bool,
}
```

### Tauri-команды: переименование

| Было                | Станет              |
| ------------------- | ------------------- |
| `start_daemon`      | `start_server`      |
| `stop_daemon`       | `stop_server`       |
| `get_daemon_info`   | `get_server_info`   |
| `is_daemon_running` | `is_server_running` |

### Что НЕ меняется в Tauri

- Все плагины (fs, opener, notification, clipboard, shortcuts, store, log)
- Управление окнами (размер, позиция, тема)
- Quick Launcher окно
- Логирование
- macOS-специфичный код (цвет фона, тема)

### tauri.conf.json — изменения

```json
{
  "productName": "OpenCode UI", // было: CodeLayer
  "identifier": "dev.opencode.ui", // было: dev.humanlayer.wui
  "bundle": {
    "resources": ["bin/opencode"] // было: ["bin/hld", "bin/humanlayer"]
  }
}
```

---

## 8. Карта затронутых файлов

### Файлы для полной ПЕРЕЗАПИСИ (создать с нуля)

| Файл                                                  | Причина                                 |
| ----------------------------------------------------- | --------------------------------------- |
| `src/lib/daemon/` → `src/lib/opencode/`               | Новый клиент на базе `@opencode-ai/sdk` |
| `src/lib/opencode/client.ts`                          | OpencodeClientAdapter                   |
| `src/lib/opencode/types.ts`                           | Внутренние типы + маппинг               |
| `src/lib/opencode/transformers.ts`                    | Message/Part → ConversationEvent        |
| `src/lib/opencode/events.ts`                          | Адаптер SSE событий                     |
| `src-tauri/src/daemon.rs` → `src-tauri/src/server.rs` | Запуск opencode вместо hld              |

### Файлы для ТЯЖЁЛОЙ адаптации

| Файл                               | Что менять                               |
| ---------------------------------- | ---------------------------------------- |
| `src/hooks/useSubscriptions.ts`    | Другой формат событий (43 типа вместо 5) |
| `src/hooks/useConversation.ts`     | Message/Part вместо ConversationEvent    |
| `src/hooks/useApprovals.ts`        | Permission вместо Approval               |
| `src/hooks/useDaemonConnection.ts` | Новый URL, health check                  |
| `src/hooks/useSessions.ts`         | Трансформация моделей                    |
| `src/stores/appStore.ts`           | Все daemon-вызовы                        |
| `src/AppStore.ts`                  | Session/Approval модели                  |
| `src-tauri/src/lib.rs`             | Переименование команд, новые env vars    |

### Файлы для ЛЁГКОЙ адаптации (замена импортов + типов)

| Файл                                                 | Что менять                            |
| ---------------------------------------------------- | ------------------------------------- |
| `src/components/.../ConversationEventRow.tsx`        | Импорт ApprovalStatus из нового места |
| `src/components/.../BashToolCallContent.tsx`         | То же                                 |
| `src/components/.../EditToolCallContent.tsx`         | То же                                 |
| `src/components/.../MultiEditToolCallContent.tsx`    | То же                                 |
| `src/components/.../NotebookEditToolCallContent.tsx` | То же                                 |
| `src/components/.../NotebookReadToolCallContent.tsx` | То же                                 |
| `src/components/.../ExitPlanModeToolCallContent.tsx` | То же                                 |
| `src/components/.../TaskGroupEventRow.tsx`           | ConversationEvent импорт              |
| `src/utils/errors.ts`                                | ResponseError → стандартный Error     |

### Файлы БЕЗ ИЗМЕНЕНИЙ (~85% кодовой базы)

- Все компоненты `src/components/ui/` (shadcn)
- `src/components/Layout.tsx`
- `src/components/DvdScreensaver.tsx`
- `src/components/ErrorBoundary.tsx`
- Все CSS/стили
- `src/router.tsx`
- `src/main.tsx`
- Все утилиты кроме `errors.ts`
- `vite.config.ts`, `tsconfig.json`, `eslint.config.mjs`
- `src-tauri/Cargo.toml` (кроме ресурсов)
- `src-tauri/capabilities/default.json`

---

## 9. Матрица фич

| Фича                    | hld           | opencode                      | Статус миграции                                             |
| ----------------------- | ------------- | ----------------------------- | ----------------------------------------------------------- |
| Список сессий           | ✅            | ✅                            | Прямой маппинг                                              |
| Создание сессии         | ✅            | ✅                            | Двухшаговый (create + prompt)                               |
| Продолжение сессии      | ✅            | ✅                            | prompt_async                                                |
| Прерывание сессии       | ✅            | ✅                            | abort                                                       |
| Просмотр диалога        | ✅ плоский    | ✅ иерархический              | Трансформация Message/Part → events                         |
| Одобрения               | ✅ CRUD       | ⚠️ Permissions (respond only) | Упрощённый UX                                               |
| Комментарий к одобрению | ✅            | ❌                            | Убрать                                                      |
| Draft-сессии            | ✅            | ❌                            | Убрать или localStorage                                     |
| Архив сессий            | ✅            | ❌ нет archive API            | **SPIKE: нет time.archived** — эмулировать на нашей стороне |
| Стоимость (cost)        | ✅ на Session | ⚠️ на Message                 | Суммировать из сообщений                                    |
| Токены                  | ✅ на Session | ⚠️ на Message                 | Суммировать из сообщений                                    |
| Поиск файлов            | ✅ fuzzy      | ✅ fuzzy + text + symbols     | Расширяется                                                 |
| Slash-команды           | ✅            | ✅                            | Прямой маппинг                                              |
| Шаринг сессии           | ❌            | ✅                            | **Новая фича**                                              |
| Diff сессии             | ❌            | ✅                            | **Новая фича**                                              |
| Fork сессии             | ❌            | ✅                            | **Новая фича**                                              |
| Revert изменений        | ❌            | ✅                            | **Новая фича**                                              |
| Todo-список (серверный) | ❌            | ✅                            | **Новая фича**                                              |
| Управление провайдерами | ❌            | ✅                            | **Новая фича**                                              |
| Выбор модели            | ⚠️ ограничено | ✅ полное                     | **Улучшение**                                               |
| OAuth авторизация       | ❌            | ✅                            | **Новая фича**                                              |
| Статус LSP/MCP          | ❌            | ✅                            | **Новая фича**                                              |
| VCS информация          | ❌            | ✅                            | **Новая фича**                                              |
| Настройки прокси        | ✅            | ❌                            | Убрать                                                      |
| Auto-accept edits       | ✅            | ✅ через permissions          | Маппинг                                                     |
| Skip permissions        | ✅ с таймером | ✅ PermissionRuleset          | Другая концепция                                            |

---

## 10. План миграции по фазам

### Фаза 0: Создание репозитория (1 день)

1. Скопировать `humanlayer-wui/` в новый репозиторий
2. Удалить `@humanlayer/hld-sdk` из `package.json`
3. Добавить `@opencode-ai/sdk`
4. Удалить `src/lib/daemon/` (будет заменён)
5. Обновить `src-tauri/tauri.conf.json` (имя, ID, ресурсы)

### Фаза 1: Слой адаптера (4 дня)

1. Создать `src/lib/opencode/client.ts` — основной клиент
2. Создать `src/lib/opencode/types.ts` — внутренние типы
3. Создать `src/lib/opencode/transformers.ts` — маппинг моделей
4. Создать `src/lib/opencode/events.ts` — адаптер SSE
5. Написать тесты трансформеров

### Фаза 2: Tauri слой (2 дня, параллельно с Фазой 1)

1. Переписать `daemon.rs` → `server.rs`
2. Обновить `lib.rs` (команды, env vars)
3. Обновить конфиги Tauri

### Фаза 3: Хуки (4 дня)

1. `useDaemonConnection` → `useServerConnection`
2. `useSubscriptions` — новый формат событий
3. `useSessions` — адаптация моделей
4. `useConversation` — тяжёлая переработка
5. `useApprovals` → `usePermissions`

### Фаза 4: AppStore (3 дня, параллельно с Фазой 3)

1. Замена daemon-вызовов на новый клиент
2. Адаптация моделей Session/Approval в сторе
3. Адаптация тестов

### Фаза 5: UI-компоненты (4 дня)

1. ConversationStream — адаптация рендеринга
2. Tool content компоненты — замена ApprovalStatus
3. SessionTable — обновление статусов и фильтров
4. QuickLauncher — провайдеры, модели, файлы
5. Новые компоненты (share, diff, provider selector)

### Фаза 6: Полировка (3 дня)

1. Удалить все hld-ссылки
2. `bun run typecheck` + `bun run lint`
3. Адаптировать тесты
4. Обновить Storybook

### Итого: ~15 рабочих дней (3 недели)

```
Неделя 1: Фаза 0 + Фаза 1 + Фаза 2
Неделя 2: Фаза 3 + Фаза 4
Неделя 3: Фаза 5 + Фаза 6
```

---

## 11. Риски и решения

### 1. Трансформация диалогов (Высокий риск)

**Проблема**: hld использует плоский `ConversationEvent[]`, opencode — иерархический `Message` + `Part[]`. UI-компоненты завязаны на плоскую модель.

**Решение**: Написать трансформер `flattenMessages(messages) → ConversationEvent[]` с тестами. Это позволит сохранить существующие UI-компоненты без переписывания.

### 2. Упрощение одобрений (Средний риск)

**Проблема**: hld имеет полноценный CRUD для Approval с комментариями. opencode имеет только событийную модель Permission (asked → replied).

**Решение**: Для V1 принять упрощённый UX: approve (once) / deny (reject) / always allow. Комментарии убрать. Отслеживать активные permissions в клиентском состоянии из SSE.

### 3. Отсутствие draft-сессий (Низкий риск)

**Проблема**: hld поддерживает draft-сессии с сохранением состояния редактора.

**Решение**: Для V1 убрать. Если нужно — эмулировать через localStorage.

### 4. Стоимость/токены (Средний риск)

**Проблема**: hld хранит cost/tokens на Session. opencode — на каждом AssistantMessage.

**Решение**: Суммировать при загрузке сообщений: `totalCost = messages.sum(m => m.cost)`.

### 5. opencode должен быть установлен (Средний риск)

**Проблема**: hld — бандлится в Tauri-приложение. opencode нужно установить отдельно.

**Решение**: Вариант А — бандлить `opencode` бинарник. Вариант Б — при первом запуске проверять `which opencode` и предлагать установку.

### 6. Гранулярность SSE событий (Низкий риск)

**Проблема**: opencode присылает ~43 типа событий, WUI привык к 5.

**Решение**: Адаптер событий с фильтрацией и агрегацией. Большинство событий просто игнорируются, ключевые маппятся на внутренние типы.
