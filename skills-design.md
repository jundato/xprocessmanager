# Skills Design — Cross-LLM Unification

Notes for building a unified "skills" abstraction that works across Claude, Gemini, and (eventually) other LLMs.

---

## Core concept

A **skill** is a packaged unit of model guidance: instructions, optional companion files, optional allowed-tools list, identified by `name` + `description`.

Two loading strategies:

- **Always-on** — full body injected into every request's system context (analogous to `CLAUDE.md` / `GEMINI.md`)
- **Conditional / progressive disclosure** — only `name` + `description` injected by default; full body fetched on demand when the model decides it's relevant

Progressive disclosure is the interesting case — it keeps token costs low when many skills exist.

---

## Provider matrix

| Need | Claude Code | Gemini CLI | Cursor |
|---|---|---|---|
| Always-on context file | `CLAUDE.md` | `GEMINI.md` | `.cursor/rules/*.mdc` (`always`) |
| Conditional skill (progressive disclosure) | `.claude/skills/<n>/SKILL.md` | *(no native equivalent)* | Rules with `agent requested` type |
| Auto-attached by file glob | *(via skill content cues)* | *(via GEMINI.md content cues)* | Rules with `auto attached` + globs |
| Ad-hoc system prompt (one-shot) | `--append-system-prompt` | *(no clean flag — temp file or pipe)* | N/A (IDE-driven) |
| Slash command | `.claude/commands/<n>.md` (YAML+md) | `~/.gemini/commands/<n>.toml` | N/A |
| Args placeholder | `$ARGUMENTS` | `{{args}}` | N/A |
| Settings | `.claude/settings.json` | `~/.gemini/settings.json` | `~/.cursor/mcp.json`, `.cursor/` |
| Caching | Implicit, prefix-keyed, 5min TTL | Explicit `cachedContents` API | Vendor-managed |

---

## API-level injection

### Anthropic (Claude)

System prompt accepts an **array of text blocks**, each with optional `cache_control`:

```python
client.messages.create(
    model="claude-opus-4-7",
    system=[
        {"type": "text", "text": BASE_PERSONA},
        {
            "type": "text",
            "text": "<skill name='pdf-extraction'>\n...body...\n</skill>",
            "cache_control": {"type": "ephemeral"}
        },
    ],
    messages=[...],
)
```

**Caching rules:**
- Max 4 cache breakpoints per request (across `system` + `tools` + `messages`)
- Min cacheable size: 1024 tokens (Sonnet/Opus), 2048 (Haiku) — below that, breakpoint silently ignored
- Prefix-based: everything *before* a breakpoint cached up to that point
- TTL: `ephemeral` = 5min, `{"ttl": "1h"}` = 1 hour (more expensive write, cheaper if reused)
- Keyed on exact bytes — no timestamps/IDs in cached blocks

**Verification:**
```python
resp.usage.cache_creation_input_tokens  # tokens written (first call)
resp.usage.cache_read_input_tokens      # tokens served from cache
resp.usage.input_tokens                  # uncached
```

### Gemini

Single `system_instruction` string (not array). No inline cache markers.

```python
client.models.generate_content(
    model="gemini-2.5-pro",
    config=types.GenerateContentConfig(
        system_instruction="...persona + skill bodies concatenated...",
    ),
    contents="user prompt",
)
```

**Caching: explicit `cachedContents`:**

```python
cache = client.caches.create(
    model="gemini-2.5-pro",
    config=types.CreateCachedContentConfig(
        system_instruction="...skills here...",
        ttl="3600s",
    ),
)
client.models.generate_content(
    model="gemini-2.5-pro",
    contents="task",
    config=types.GenerateContentConfig(cached_content=cache.name),
)
```

Differences vs Anthropic:
- Explicit cache lifecycle (you create/delete the object)
- Min size historically 32k tokens for Pro (lower for newer models — verify)
- Storage cost in addition to read discount
- No "breakpoint" concept; cache is whole-chunk
- Some Gemini models also do implicit caching, but it's opaque

---

## How to inject a skill body

Best practices, regardless of provider:

1. **Inject full body verbatim** — skills are *instructions*, not info. Summarizing loses precision; the model hallucinates around fuzzy guidance.
2. **Strip frontmatter** — `name`, `description`, `type`, `allowed-tools` are loader metadata, redundant once loaded.
3. **Wrap in delimiter** — XML-tagged is canonical for Claude:
   ```
   <skill name="pdf-extraction">
   ...full markdown body...
   </skill>
   ```
   Markdown header (`## Skill: pdf-extraction`) also works, lighter weight.
4. **Place behind cache breakpoint** — system prompt or tool result, before user message.
5. **Big skills (>2-3k tokens) → split** — short SKILL.md with references to companion files; let the agent `Read` deeper files on demand.

**Don't:**
- Pre-summarize with another LLM call (lossy, slow)
- Mix multiple skills into one giant blob (kills selective load/unload)
- Re-inject without caching (token waste)

---

## CLI-level injection

### Claude Code

**Project-scoped skill (proper progressive disclosure):**
```
.claude/skills/pdf-extraction/SKILL.md
.claude/skills/pdf-extraction/references/table-formats.md
```

`SKILL.md`:
```markdown
---
name: pdf-extraction
description: Extract structured data and tables from PDF files
---

# Instructions
...
```

Only `name` + `description` injected at startup (~20 tokens). Body loaded via `Skill` tool when invoked.

**Always-on context:**
```
./CLAUDE.md            # project
~/.claude/CLAUDE.md    # global
```

**Ad-hoc system prompt:**
```bash
claude --append-system-prompt "$(cat skill.md)" -p "task"
```

**Custom slash command:**
```
.claude/commands/extract-pdf.md
```
```markdown
---
description: Extract from a PDF
allowed-tools: Read, Bash
---

You are operating under the pdf-extraction skill.
...
User request: $ARGUMENTS
```

**Settings hierarchy:**
- `~/.claude/settings.json` — user
- `.claude/settings.json` — project, checked in
- `.claude/settings.local.json` — project, gitignored

### Gemini CLI

**Project-scoped context:**
```
./GEMINI.md
~/.gemini/GEMINI.md    # global
```

Auto-loaded, hierarchically merged (project wins).

**Ad-hoc:** No clean equivalent of `--append-system-prompt`. Workarounds:
- Pipe content into the user prompt itself
- Write a temporary `GEMINI.md`, run, delete

**Custom command (TOML):**
```
~/.gemini/commands/extract-pdf.toml
```
```toml
description = "Extract from a PDF"
prompt = """
You are operating under the pdf-extraction skill.
...
User request: {{args}}
"""
```

**Settings:** `~/.gemini/settings.json` (MCP servers, auth, model selection).

---

## IDE-level injection (Cursor)

Cursor is IDE-driven, not CLI-driven — there's no `--append-system-prompt` equivalent. The skill analog is **Rules** (MDC files).

### Rule file format

```
.cursor/rules/<name>.mdc
```

```markdown
---
description: When to apply this rule
globs: ["**/*.tsx", "**/*.ts"]
alwaysApply: false
---

# Rule body in markdown
...
```

### Four rule types

| Type | Frontmatter signature | Behavior |
|---|---|---|
| `always` | `alwaysApply: true` | Full body injected into every request's system prompt |
| `auto attached` | `globs: [...]` (no `alwaysApply`) | Full body injected when a matching file is in context |
| `agent requested` | `description` only, no globs/alwaysApply | Description in system prompt; model fetches body on demand |
| `manual` | none of the above | Only loaded when `@RuleName` is explicitly invoked |

`agent requested` is the closest analog to Claude Code's progressive-disclosure skill loading.

### File locations

- `.cursor/rules/<name>.mdc` — project rules (checked into the repo)
- User Rules: configured via Cursor Settings → Rules → User Rules (typically a text field rather than files; older/newer versions may also support `~/.cursor/rules/` — verify your version)

### MCP config

- `.cursor/mcp.json` — project-scoped MCP servers
- `~/.cursor/mcp.json` — global MCP servers

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path"]
    }
  }
}
```

Like everywhere else, full MCP tool schemas are injected — not summaries — so connect servers selectively to control token cost.

### Invocation

- **`always` / `auto attached`** — automatic, no user action
- **`agent requested`** — model decides based on description
- **`manual`** — type `@RuleName` in the chat input

### Storage internals (for inspection / debugging)

Cursor inherits VS Code's storage: SQLite at:
- `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb` (global)
- `~/Library/Application Support/Cursor/User/workspaceStorage/<hash>/state.vscdb` (per-workspace)

Key/value `ItemTable` with JSON blobs under keys like:
- `workbench.panel.aichat.view.aichat.chatdata` — chat panel data
- `aiService.prompts` — prompt history
- `composer.composerData` — Composer sessions

```bash
sqlite3 ~/Library/Application\ Support/Cursor/User/globalStorage/state.vscdb \
  "SELECT key FROM ItemTable WHERE key LIKE '%chat%' OR key LIKE '%composer%';"
```

### Caching

Vendor-managed and opaque. No user-controllable cache breakpoints. Cursor pricing is subscription-based (request-counted), so the cost model is different from raw API calls.

### Limitations vs Claude Code

- No CLI ad-hoc injection — must edit/add rule files and reload
- No companion-file pattern (`references/`, `scripts/`) — rule body is a single MDC file
- No `$ARGUMENTS`-style slash commands — invocation is `@RuleName` only

---

## "One-shot" vs caching — clarification

**One-shot** = invocation mode (single request → response → exit). Non-interactive. Caching still happens.

When re-running the same `claude -p "..."` prompt within 5 minutes:
- **First call:** `cache_creation_input_tokens` large (system + CLAUDE.md + skills + tools written to cache)
- **Second call:** `cache_read_input_tokens` matches; cost ~10% of normal input rate for that prefix
- The user message itself is typically *not* cached (no breakpoint after it by default)

Cache invalidation triggers:
- 5+ minutes idle (TTL only refreshes on hits)
- Any byte change in the prefix (CLAUDE.md edit, new skill, changed `--append-system-prompt`, new MCP server)
- Different working directory (different `CLAUDE.md` resolution)

---

## Unification design

### What we'd build

A provider-agnostic skill loader that:

1. **Reads a canonical skill format** (single source of truth):
   ```
   skills/
     pdf-extraction/
       SKILL.md         # frontmatter + body
       references/
       scripts/
   ```

2. **Adapts to each provider:**
   - **Claude API:** emit `system=[...]` array with `cache_control` per skill
   - **Claude CLI:** symlink/copy into `.claude/skills/<n>/SKILL.md` (use native skill system)
   - **Gemini API:** concatenate bodies into `system_instruction`, optionally create `cachedContents`
   - **Gemini CLI:** concatenate bodies into `GEMINI.md`
   - **Cursor:** emit as `.cursor/rules/<n>.mdc` with appropriate type

3. **Implements progressive disclosure where native (Claude) and emulates where not (Gemini)**:
   - For Gemini, "conditional" skills could be loaded via a custom slash command that injects the body on demand
   - Or via runtime: detect file globs → set up the right `GEMINI.md` for that session

### Canonical skill schema

```yaml
---
name: pdf-extraction
description: Extract structured data and tables from PDF files
loading: conditional   # or "always-on", "auto-attached"
globs: ["**/*.pdf"]    # optional, for auto-attach
allowed_tools:         # optional, provider-translated
  - Read
  - Bash(pdftotext:*)
---

# Instructions
...
```

Body in plain markdown; identifier metadata in frontmatter.

### Provider translation table

| Canonical field | Claude Code | Gemini CLI | Cursor | Anthropic API | Gemini API |
|---|---|---|---|---|---|
| `name` | SKILL.md `name` | section header | MDC filename | XML attr | XML attr |
| `description` | SKILL.md `description` | section comment | MDC `description` | XML attr | XML attr |
| `loading: always-on` | `CLAUDE.md` | `GEMINI.md` | MDC w/ `alwaysApply: true` | system block w/ no Skill tool | concat into `system_instruction` |
| `loading: conditional` | `.claude/skills/...` (native) | custom command + lazy load | MDC w/ description-only (`agent requested`) | system block, accessed via tool | needs custom orchestration |
| `loading: auto-attached` | not native; encode in body | not native; encode in body | MDC w/ `globs` (`auto attached`) | runtime context-detect | runtime context-detect |
| `loading: manual` | slash command in `.claude/commands/` | slash command in `~/.gemini/commands/` | MDC w/ no triggers (`@RuleName`) | runtime injection | runtime injection |
| `globs` | metadata only | metadata only | MDC `globs` field (native) | runtime filter | runtime filter |
| `allowed_tools` | YAML same field | translate to Gemini permissions | not supported (IDE permission model) | tools array filter | tools array filter |

Key insight: **Cursor is the only one with native `auto-attached` (glob-based)** loading. Claude Code and Gemini CLI both require encoding the trigger condition into the skill body and trusting the model to apply it. If `auto-attached` skills are important, Cursor's the reference implementation — Claude/Gemini will need orchestration to match.

### Open questions for nexus

- Where do skills live in the nexus repo? Suggest `skills/` at repo root, mirrored to provider-specific locations on session start.
- Single-source-of-truth strategy: write canonical, generate per-provider artifacts (compile step) vs. read canonical at runtime and translate live?
  - **Compile step** is simpler, easier to debug, but stale until rebuilt
  - **Runtime translate** is dynamic but adds complexity and a layer of indirection
- For conditional loading on Gemini, do we accept "always-on with a marker" as the fallback, or build a real lazy-load shim?
- How do we handle skill conflicts when multiple skills target the same context window in always-on mode?

### Recommendation (initial)

Start with a **compile step**:
- Source of truth: `skills/<n>/SKILL.md` (canonical schema above)
- Build script reads all skills, emits:
  - `.claude/skills/<n>/SKILL.md` (verbatim — Claude has native skill system)
  - `GEMINI.md` (concatenated bodies of `loading: always-on` skills, plus an index of conditional ones)
  - `~/.gemini/commands/load-<n>.toml` (per-skill custom command for lazy load on Gemini)
  - `.cursor/rules/<n>.mdc` with frontmatter translated from canonical `loading`:
    - `always-on` → `alwaysApply: true`
    - `auto-attached` → `globs: [...]` (Cursor's native auto-attach)
    - `conditional` → `description` only (Cursor's `agent requested`)
    - `manual` → no trigger fields (invoked via `@RuleName`)
- Run on commit hook + manual `nexus skills build`

This trades dynamism for simplicity and lets each provider use its native UX. Cursor benefits most because all four loading modes map cleanly; Claude is second (skills + slash commands cover most modes); Gemini needs the most emulation (no native conditional or auto-attach).
