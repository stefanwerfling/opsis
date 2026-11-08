---
name: opsis-ui-spec
description: Get a human-approved UI specification from OPSIS before building or changing a screen. Use when the user wants a UI built "like this screenshot", wants to change an existing screen, or asks to "spec", "annotate" or "review" a UI with OPSIS. Requires the opsis MCP server.
---

# UI specification with OPSIS

OPSIS turns a screenshot into a specification that a human writes and approves. You submit
the screenshot, the human marks and describes the components in the OPSIS editor, and you
implement the released implementation prompt. You cannot edit or release a specification;
do not guess what the human will specify.

## Steps

1. **Project:** `opsis_list_projects`. Pick the project for this repository. Create one with
   `opsis_create_project` only if none fits; use the repository name.
2. **Screenshot:** take or locate the screenshot (PNG, JPEG or WebP). Use the route of the screen as
   `ui_path` (e.g. `/settings/profile`) so later screenshots of the same screen land in the
   same UI view and its history.
   - Up to a few MB: `opsis_submit_screenshot` with `image_base64` (no `data:` prefix).
   - Larger files: `opsis_request_upload`, then
     `curl -T <file> -H 'content-type: image/png' "<upload_url>"` within 15 minutes.
   - Fill in `viewport_width`, `viewport_height` and `device_type`. Put what the user wants changed into
     `description`.
   - For more variants of the same screen (mobile, dark mode, error state), submit them with
     the returned `session_id` and a `variant_label`.
3. **Hand over:** tell the user, in one short message, that the screenshot is ready for
   review and give them the `editor_url`. Mention what they should look at if you know it.
4. **Wait:** call `opsis_wait_for_specification` with `timeout_seconds: 600` in a loop until
   `done` is true. A timeout (`done: false`) is normal; call it again. Do not poll with other
   tools in between, and do not start implementing while waiting.
   - `status: "cancelled"` or `"failed"`: stop and tell the user.
5. **Implement:** `opsis_get_implementation_prompt`. Treat the markdown as the specification of the
   task: it lists components, behaviour, acceptance criteria and open questions. Implement it, run
   the project's checks, and report back with the OPSIS version number (`version_no`).
   - Open questions in the prompt are for the user. Ask them; do not invent answers.

## Rules

- Never claim that a specification exists before `opsis_wait_for_specification` returned `done: true`
  with `status: "ready"` or `"delivered"`.
- `NOT_FOUND` for a project the user names means this agent has no access. Ask the user to grant
  it in OPSIS (Agents page). Do not create a duplicate project.
- The prompt can be fetched again any time with the same `session_id` or `version_id`.
- For earlier versions of a screen use `opsis_get_ui_history` and
  `opsis_get_specification { version_id }`.
