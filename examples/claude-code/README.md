# Claude Code example

- `.mcp.json` connects Claude Code to a local OPSIS. The token comes from the environment:
  `export OPSIS_TOKEN=opsis_…`, created on the OPSIS **Agents** page or with
  `opsis agent create`.
- `.claude/skills/opsis-ui-spec/SKILL.md` is the workflow as a skill (submit → hand over → wait →
  implement).
- `CLAUDE.md` is a short section for a project's CLAUDE.md that makes OPSIS the default for UI work.

Copy the files into the root of the project the agent works on. The reference for all
tools is [docs/mcp.md](../../docs/mcp.md).
