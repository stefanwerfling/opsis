<!-- Example section for a project's CLAUDE.md. Copy it and adjust the project name. -->

## UI changes with OPSIS

UI work goes through OPSIS (MCP server `opsis`, project `shop`). Before building or changing
a screen, get a human-approved specification:

1. Submit a screenshot of the current state, or of the mock-up, with `opsis_submit_screenshot`.
   Set `ui_path` to the route.
2. Give me the `editor_url`. Then wait with `opsis_wait_for_specification` until `done`.
3. Implement exactly what `opsis_get_implementation_prompt` returns. Ask me about its open
   questions.

Do not implement UI changes that have no released OPSIS specification, unless I say so.
The skill `opsis-ui-spec` describes the details.
