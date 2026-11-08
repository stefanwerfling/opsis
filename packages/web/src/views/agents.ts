import type { AgentWithGrants, CreatedAgent, Project } from '@opsis/core';
import { api } from '../api.js';
import { formValue, h, replaceChildren } from '../dom.js';
import { t } from '../i18n/i18n.js';
import { pathTo } from '../router.js';
import {
  Disposer,
  copyButton,
  errorBox,
  field,
  formError,
  formatDateTime,
  handleSubmit,
  liveSection,
  type View,
} from '../ui.js';

const mcpConfig = (): string =>
  JSON.stringify(
    {
      mcpServers: {
        opsis: {
          type: 'http',
          url: `${location.origin}/mcp`,
          headers: { Authorization: 'Bearer ${OPSIS_TOKEN}' },
        },
      },
    },
    null,
    2,
  );

/** The token is only in this panel's DOM; it is gone once the page is left. */
const tokenPanel = (created: CreatedAgent): HTMLElement => {
  const output = h('div');
  return h(
    'div',
    { class: 'stack token-panel', attrs: { role: 'status' } },
    h('strong', {}, t('agents.tokenTitle', { name: created.agent.name })),
    h('p', { class: 'notice warning' }, t('agents.tokenOnce')),
    h(
      'div',
      { class: 'row' },
      h('code', { class: 'token' }, created.token),
      copyButton(() => created.token, output),
    ),
    h('p', { class: 'muted' }, t('agents.configHint')),
    h('pre', { class: 'config' }, mcpConfig()),
    copyButton(mcpConfig, output),
    output,
  );
};

const projectChecks = (projects: readonly Project[], name: string): HTMLElement =>
  projects.length === 0
    ? h('p', { class: 'muted' }, t('agents.noProjects'))
    : h(
        'div',
        { class: 'stack checks' },
        projects.map((project) =>
          h(
            'label',
            { class: 'inline' },
            h('input', { attrs: { type: 'checkbox', name, value: project.id } }),
            project.name,
            h('span', { class: 'muted' }, ` (${project.slug})`),
          ),
        ),
      );

interface AgentForm {
  readonly element: HTMLFormElement;
  refreshProjects(projects: readonly Project[]): void;
}

const createAgentForm = (result: HTMLElement): AgentForm => {
  const checks = h('div');
  const form = h(
    'form',
    { class: 'stack' },
    field(
      t('agents.name'),
      h('input', {
        attrs: { name: 'name', required: true, maxlength: 100, placeholder: 'claude-code-laptop' },
      }),
      t('agents.nameHint'),
    ),
    h('fieldset', {}, h('legend', {}, t('agents.projects')), checks),
    formError(),
    h('button', { attrs: { type: 'submit' } }, t('common.create')),
  );
  form.addEventListener(
    'submit',
    handleSubmit(form, async () => {
      const projectIds = [...form.querySelectorAll<HTMLInputElement>('input[name="project"]:checked')].map(
        (input) => input.value,
      );
      const created = await api.createAgent({ name: formValue(form, 'name'), projectIds });
      form.reset();
      replaceChildren(result, tokenPanel(created));
    }),
  );
  return {
    element: form,
    refreshProjects: (projects) => {
      replaceChildren(checks, projectChecks(projects, 'project'));
    },
  };
};

const agentCard = (agent: AgentWithGrants, projects: readonly Project[]): HTMLElement => {
  const output = h('div');
  const revoked = agent.revokedAt !== null;
  let confirming = false;
  const revoke = h(
    'button',
    {
      class: 'danger',
      attrs: { type: 'button' },
      onClick: () => {
        // Two clicks instead of a browser dialog; revocation cannot be undone.
        if (!confirming) {
          confirming = true;
          revoke.textContent = t('agents.revokeConfirm');
          return;
        }
        revoke.disabled = true;
        api.revokeAgent(agent.id).catch((error: unknown) => {
          revoke.disabled = false;
          replaceChildren(output, errorBox(error));
        });
      },
    },
    t('agents.revoke'),
  );
  const grants = new Set(agent.projectIds);
  return h(
    'li',
    { class: `card agent${revoked ? ' revoked' : ''}` },
    h(
      'div',
      { class: 'section-head' },
      h('strong', {}, agent.name),
      revoked
        ? h(
            'span',
            { class: 'badge status-cancelled' },
            t('agents.revokedAt', { date: formatDateTime(agent.revokedAt) }),
          )
        : revoke,
    ),
    h(
      'div',
      { class: 'muted' },
      h('code', {}, agent.id),
      ' · ',
      t('projects.created', { date: formatDateTime(agent.createdAt) }),
    ),
    h(
      'fieldset',
      { attrs: { disabled: revoked } },
      h('legend', {}, t('agents.projects')),
      projects.length === 0
        ? h('p', { class: 'muted' }, t('agents.noProjects'))
        : projects.map((project) =>
            h(
              'label',
              { class: 'inline' },
              h('input', {
                attrs: { type: 'checkbox' },
                props: { checked: grants.has(project.id) },
                onChange: (event) => {
                  const input = event.currentTarget as HTMLInputElement;
                  input.disabled = true;
                  api.setAgentGrant(agent.id, project.id, input.checked).catch((error: unknown) => {
                    input.checked = !input.checked;
                    input.disabled = false;
                    replaceChildren(output, errorBox(error));
                  });
                },
              }),
              h('a', { attrs: { href: pathTo('projects', project.id) } }, project.name),
            ),
          ),
    ),
    output,
  );
};

export const agentsView: View = (root) => {
  const disposer = new Disposer();
  let projects: readonly Project[] = [];
  const result = h('div');
  const form = createAgentForm(result);
  const list = disposer.add(
    liveSection({
      load: () => Promise.all([api.listAgents(), api.listProjects()]),
      relevant: (event) => event.type === 'AgentChanged' || event.type === 'ProjectChanged',
      onData: ([, loaded]) => {
        const changed = JSON.stringify(loaded) !== JSON.stringify(projects);
        projects = loaded;
        if (changed) form.refreshProjects(loaded);
      },
      render: ([agents, loaded]) =>
        agents.length === 0
          ? h('p', { class: 'muted' }, t('agents.empty'))
          : h(
              'ul',
              { class: 'cards' },
              agents.map((agent) => agentCard(agent, loaded)),
            ),
    }),
  );
  form.refreshProjects([]);
  root.append(
    h('nav', { class: 'breadcrumb' }, h('a', { attrs: { href: '/' } }, t('projects.title'))),
    h('h1', {}, t('agents.title')),
    h('p', { class: 'muted' }, t('agents.intro')),
    h(
      'div',
      { class: 'columns' },
      h('section', {}, list.element),
      h('section', { class: 'panel stack' }, h('h2', {}, t('agents.new')), form.element, result),
    ),
  );
  return disposer.dispose;
};
