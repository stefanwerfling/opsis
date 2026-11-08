---
name: opsis-ui-spec
description: Get a human-approved UI specification from OPSIS before building or changing a screen, and describe the components of an OPSIS screenshot on request. Use when the user wants a UI built "like this screenshot", wants to change an existing screen, asks to "spec", "annotate" or "review" a UI with OPSIS, or asks you to describe the components of an OPSIS session. Requires the opsis MCP server.
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

## Describing components (proposals)

When the user asks you to describe the components of a session (also one they uploaded in the
browser), or wants a head start before reviewing:

1. Find the session: the user names it, or use `opsis_list_sessions` and take the newest
   `awaiting_review` one. Proposals are only possible in that status.
2. Look: `opsis_get_session` for the screenshots, then `opsis_get_screenshot` with
   `include_image: true`. For tall pages, look at details with `crop` in steps of about one screen
   height. Convert to original pixels: `x = image.x + thumbnail_x × image.scale`, and the same for y.
3. Propose the structure top-down with `opsis_propose_components`: sections, then their parts
   (`parent_ref`), with a tight `region` each and a short `name`. Fill in `spec` only with what is
   visible or obvious: `general.description`, and where clear `purpose`, `interaction.*` and
   `acceptance.expectedLayout`. Leave fields out rather than guess. Split very large pages over
   several calls (`parent_id` attaches to components you created earlier).
4. Tell the user how many components you proposed and give the `editor_url`. All values are marked
   as unconfirmed until they confirm or change them.

## Rules

- Never claim that a specification exists before `opsis_wait_for_specification` returned `done: true`
  with `status: "ready"` or `"delivered"`.
- `NOT_FOUND` for a project the user names means this agent has no access. Ask the user to grant
  it in OPSIS (Agents page). Do not create a duplicate project.
- The prompt can be fetched again any time with the same `session_id` or `version_id`.
- For earlier versions of a screen use `opsis_get_ui_history` and
  `opsis_get_specification { version_id }`.
