# fable-mode

A Claude skill that enforces staged execution discipline on large tasks:
a written stage plan, parallel delegation where the runtime allows, a
verification check at each stage that can actually fail, and a skeptical
self-review before delivery.

## What it does

The skill shapes the *procedure* a model follows on complex work. It makes
the model decompose before acting, delegate independent sub-work where
subagent tooling exists, verify each stage against a failable check rather
than a feeling, and critique its own output before delivering it.

## What it does not do

It does not change the underlying model's capability. Coherence across
long tasks and genuine self-correction live in the model's weights, not
in a prompt. On a model that already does these well, the skill
reinforces good habits. On a weaker model, it imposes structure the model
would otherwise skip, but it cannot raise the reasoning ceiling. Treat it as
a checklist, not a capability transplant.

## When to use it

Trigger on tasks that span multiple files, multiple sources, or multiple
sessions, or when you explicitly ask for systematic execution. Do not use it
on tasks with one obvious approach that fit in a single pass. Staging a
trivial task wastes effort and buries the answer.

## Variants

Three skills share the same core loop. Pick by how you want the work run:

- `fable-mode` - the default. Runs the loop inline on the current model (Opus
  when that is the host). Use this unless you want the work pinned to a
  specific model.
- `fable-sonnet` - spawns a subagent pinned to Claude Sonnet. The balanced
  choice: strong reasoning at lower cost than Opus. Requires a runtime with
  the Agent tool.
- `fable-haiku` - spawns a subagent pinned to Claude Haiku. For high-volume or
  cost-sensitive work where structure matters more than peak synthesis.
  Requires a runtime with the Agent tool.

The variants pass the same stage map, failable verification, self-critique,
warning threshold, and find-and-replace safety rules down to their subagent.
They do not raise the chosen model's reasoning ceiling.

## Files

- `SKILL.md` - the skill itself
- `EXAMPLE.md` - a worked before/after showing the verification check catching
  an error that a one-shot attempt ships
- `fable-sonnet/SKILL.md` - the Sonnet variant
- `fable-haiku/SKILL.md` - the Haiku variant

## Installation

Place each skill directory (`fable-mode`, and optionally `fable-sonnet` /
`fable-haiku`) wherever your Claude environment loads skills from (for example,
a skills directory read by Claude Code), then invoke it by name or let it
trigger on a qualifying task. Each variant's folder name must match the `name:`
field in its frontmatter.
