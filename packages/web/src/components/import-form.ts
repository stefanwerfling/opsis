import { api } from '../api.js';
import { h } from '../dom.js';
import { t } from '../i18n/i18n.js';
import { navigate, pathTo } from '../router.js';
import { field, formError, handleSubmit } from '../ui.js';

/** ZIP import of a released version (05 §7); the server does all checks. */
export const createImportForm = (projectId: string): HTMLFormElement => {
  const fileInput = h('input', {
    attrs: { type: 'file', name: 'archive', accept: '.zip,application/zip', required: true },
  });
  const form = h(
    'form',
    { class: 'stack' },
    field(t('import.file'), fileInput, t('import.hint')),
    formError(),
    h('button', { attrs: { type: 'submit' } }, t('import.submit')),
  );
  form.addEventListener(
    'submit',
    handleSubmit(form, async () => {
      const file = fileInput.files?.[0];
      if (file === undefined) throw new Error(t('import.missingFile'));
      const body = new FormData();
      body.set('archive', file, file.name);
      const result = await api.importArchive(projectId, body);
      navigate(pathTo('versions', result.uiVersion.id));
    }),
  );
  return form;
};
