# CLI Unification — `.nexus/` convention

Nexus runs nodes against multiple LLM CLIs (Claude Code, Gemini CLI, others). Each provider has its own native skill/context location (`.claude/skills/`, `GEMINI.md`, `.cursor/rules/`, …) and we don't want to be locked to any one of them.

This document defines a **provider-neutral convention**: nexus copies selected skills into the node's working directory under `.nexus/skills/`, and injects a short bootstrap instruction at chat start telling the CLI to look there.

---

## The convention

When a chat starts in a node:

1. User picks which skills to enable for the chat (UI; not yet implemented).
2. Nexus copies the selected skill folders from the central library into the node's cwd:
   ```
   <node-cwd>/.nexus/skills/<skill-name>/SKILL.md
   <node-cwd>/.nexus/skills/<skill-name>/references/...
   <node-cwd>/.nexus/skills/<skill-name>/scripts/...
   ```
   The whole folder is copied so companion files survive (progressive disclosure on the CLI side keeps working — the model can `Read` deeper files on demand).
3. Nexus injects the **bootstrap block** below into the CLI's system context (via `--append-system-prompt` for Claude Code, prepended to the first user message for Gemini, etc.).
4. From there on, the CLI treats `.nexus/skills/` as a first-class skill source.

Snapshot semantics: skills are copied **at chat start**. Edits to the central library mid-chat do not propagate — a chat sees the version that was active when it began. This is intentional (reproducibility).

---

## Skill folder layout

Each skill is a folder. The folder name is the skill name.

```
.nexus/skills/<skill-name>/
  SKILL.md          # required — frontmatter + markdown body
  references/       # optional — files the model reads on demand
  scripts/          # optional — executable helpers
```

`SKILL.md` frontmatter (canonical schema):

```markdown
---
name: <skill-name>
description: <one-line, used to decide relevance>
loading: always-on | conditional | auto-attached | manual
globs: ["**/*.pdf"]            # optional, for auto-attached
allowed_tools: [Read, Bash]    # optional
---

# Instructions

...full markdown body...
```

`description` is the load decision driver — write it so a model can tell, from the description alone, whether the body is worth reading.

---

## Bootstrap block (injected into every chat)

This is the literal text nexus prepends to the CLI's system context at chat start. Keep it short — it's added to every request.

```
You have access to a set of skills installed at `.nexus/skills/` (relative to the
current working directory). Each subfolder is one skill, identified by its folder
name and described in its `SKILL.md` frontmatter.

When the user's request matches a skill's description, read that skill's
`SKILL.md` (and any referenced files under the skill folder) before responding,
then follow its instructions.

Available skills in `.nexus/skills/`:
- <skill-name>: <description>
- <skill-name>: <description>
...
```

The skill list is rendered from the frontmatter of every `SKILL.md` under `.nexus/skills/` at chat start. Bodies are **not** included — that's the progressive disclosure: model decides, then reads.

For `loading: always-on` skills, the body is concatenated below the bootstrap block instead of just listing the description.

---

## Provider mapping

The convention is the same everywhere; only the injection mechanism differs.

| Provider | How the bootstrap is delivered |
|---|---|
| Claude Code | `--append-system-prompt "$(cat .nexus/bootstrap.txt)"` at chat start |
| Gemini CLI | Prepend bootstrap to first user message (no native append-system flag), or write a session-scoped `GEMINI.md` |
| Cursor | Out of scope for nexus runtime (IDE-driven) |
| Raw Anthropic API | System prompt array, bootstrap as one cached block |
| Raw Gemini API | `system_instruction` string |

Native provider conventions (`.claude/skills/`, `GEMINI.md`) are **not** used by nexus to host skills. Reasons:

- Nexus needs one location it controls across all providers.
- `.nexus/skills/` is unambiguous and won't collide with whatever the user already has in `.claude/` or similar.
- If a user wants a skill to also be picked up by a provider's native loader, that's a separate compile step (see `skills-design.md` "Recommendation").

---

## Lifecycle

- **Chat start**: copy selected skills → `.nexus/skills/`, render bootstrap, inject into CLI.
- **Mid-chat**: skills are read-only from the model's POV. The model may `Read` files under `.nexus/skills/` but should not modify them.
- **Chat end**: `.nexus/skills/` persists in the node's cwd as an audit trail of what was active. Cleanup is manual (or via a future nexus command).
- **Re-running a chat**: copying is idempotent; existing files are overwritten with the canonical version at the time of restart.

---

## Open items

- Conflict policy when two selected skills have overlapping instructions (last-wins? error? merge?).
- Whether to emit a checksum/manifest under `.nexus/skills/.manifest.json` so the model can verify integrity.
- Whether `.nexus/` should be `.gitignore`d by default (probably yes — it's session state, not source).
