# Operator profile and Skill precedence

## Result

The envelope is model-generated content caused by a prompt-precedence conflict,
not a Skill body, ACP normalization, Cabinet persistence, UI rendering, or
harness extraction.

The selected operator profile was active and contributed the conflict. Its
identity contains a broad default requirement to wrap every run in an
operational report, but it had no exception for an explicit current-user output
shape. Because Hermes places the profile identity in the system message, that
default outranked the user-role exact-token request unless the system prompt
itself made the intended precedence explicit.

The first safely evidenced divergence is raw ACP assistant content. The
available failure artifact did not preserve a safe separate raw-provider-final
field, so raw-provider equality remains unknown; source tracing proves the ACP
server forwards the agent final response without adding an envelope.

## Skill finding

`one-three-one-rule` was installed and enabled for the selected profile. That is
not the same as being loaded:

- Hermes injects only the Skill index name and description when Skill tools are
  available.
- It does not globally inject the full `SKILL.md`.
- Full Skill instructions require deliberate `skill_view` selection.
- The failed acceptance recorded no tool invocation.
- The Skill's own applicability is a real multi-option decision; it explicitly
  excludes simple questions and already-decided formats.

Therefore the Skill was available but not selected or loaded, and it did not
cause or contribute to the envelope.

In no-tools mode, the Skill index is absent because system-prompt construction
only calls Skill discovery when a Skill tool exists. Skills do not become
tools, and no-tools does not by itself rewrite response text.

## Exact model-facing hierarchy

Before the correction, Hermes assembled one system message in this order:

1. Profile `SOUL.md` identity.
2. Stable Hermes operational guidance.
3. Available Skill index, only when Skill tools exist.
4. Environment, active-profile, and platform guidance.
5. Caller system message and workspace context files.
6. Memory, user profile, and session metadata.
7. Optional ephemeral system additions.
8. Conversation history and the current user message as user-role content.

Cabinet's ACP call supplies the user content and prior history. It supplies no
Cabinet-specific or acceptance-specific system instruction and no model-output
post-processor.

The correction inserts one general precedence rule after the profile, Skill,
and platform defaults: explicit current-user response-shape constraints govern
format unless safety, security, or another higher-priority instruction
conflicts. It does not parse arbitrary prompts, name acceptance tokens, strip
output, disable Skills, or weaken action policy. Ordinary decision prompts can
still use operator or 1-3-1 formatting.

## Offline proof

The experiment used a disposable Hermes root and a loopback-only OpenAI-shaped
fake provider on port 4332. It covered:

1. Operator profile with no Skills.
2. Operator profile with the Skill installed and enabled.
3. Exact-output request.
4. Ordinary technical decision.
5. Follow-up in the same session.
6. No-tools mode.
7. Normal tools-mode fixture with no tool invocation.

It also covered exact `ALPHA`, JSON-only, one-word `Ready`, and an ordinary
decision response. All ten loopback requests passed. There were zero external
model requests and zero tool calls. Exact examples appear only in tests, never
in runtime matching logic.

## Companion patch

- Parent: `ad7fff50a72c4534cdcc7a34b99c19344b2459a5`
- Commit: `3eab6b8f46f26fa712688614ed76a466a1cf9c5b`
- Patch: `0001-fix-agent-honor-explicit-output-constraints.patch`
- SHA-256: `2332868c2aa58b03845f069e13ade5aee5dbe3f06f1e9ac4d296c64206a40c5e`
- Installed: no

Verification passed 178 companion prompt/profile tests with one existing skip,
Ruff, `git diff --check`, and all ten loopback capture cases.

No live profile, Skill, Hermes runtime, Cabinet production process, canonical
data, configuration, credential file, launch service, remote, or deployment
was modified.

One preliminary process was rejected because it imported Hermes before setting
the disposable root. Startup initialized the configured external secret source
and emitted only a count; no secret values were printed or inspected, no model
request was made, and no mutation occurred. The harness was corrected to bind
the disposable root before every Hermes import, and all accepted cases were
rerun without secret-source activity.
