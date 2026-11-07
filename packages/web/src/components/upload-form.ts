import type { UiView } from '@opsis/core';
import { DEVICE_CATEGORIES, IMAGE_LIMITS, IMAGE_MIME_TYPES } from '@opsis/core/browser';
import { api } from '../api.js';
import { formValue, h, replaceChildren } from '../dom.js';
import { t } from '../i18n/i18n.js';
import { navigate, pathTo } from '../router.js';
import { field, formError, formatBytes, handleSubmit } from '../ui.js';

export interface UploadForm {
  readonly element: HTMLFormElement;
  /** Refreshes the UI view choices while keeping the current selection. */
  setUiViews(views: readonly UiView[]): void;
}

/**
 * Screenshot upload by the human user. The checks here only give fast feedback – the
 * server validates the real image content (magic bytes, full decode, limits) regardless.
 */
export const createUploadForm = (projectId: string, preselectedUiId?: string): UploadForm => {
  const uiSelect = h('select', { attrs: { name: 'uiId' } }, h('option', { attrs: { value: '' } }, '—'));
  const form = h('form', { class: 'stack' });
  const fileInput = h('input', {
    attrs: { type: 'file', name: 'image', accept: IMAGE_MIME_TYPES.join(','), required: true },
  });
  const number = (name: string, placeholder: string) =>
    h('input', { attrs: { type: 'number', name, min: 1, max: 16384, step: 1, placeholder } });

  replaceChildren(
    form,
    field(t('upload.file', { size: formatBytes(IMAGE_LIMITS.maxBytes) }), fileInput),
    h(
      'fieldset',
      {},
      h('legend', {}, t('upload.target')),
      field(t('upload.targetExisting'), uiSelect),
      field(
        t('upload.targetPath'),
        h('input', { attrs: { name: 'uiPath', maxlength: 500, placeholder: '/admin/users/:id' } }),
        t('ui.pathHint'),
      ),
    ),
    field(t('upload.title'), h('input', { attrs: { name: 'title', maxlength: 200 } }), t('common.optional')),
    h(
      'div',
      { class: 'row' },
      field(
        t('upload.device'),
        h(
          'select',
          { attrs: { name: 'deviceCategory' } },
          DEVICE_CATEGORIES.map((device) => h('option', { attrs: { value: device } }, t(`device.${device}`))),
        ),
      ),
      field(
        t('upload.variant'),
        h('input', { attrs: { name: 'variantLabel', maxlength: 100 } }),
        t('upload.variantHint'),
      ),
    ),
    field(
      t('upload.viewport'),
      h('div', { class: 'row' }, number('viewportWidth', '1440'), '×', number('viewportHeight', '900')),
      t('common.optional'),
    ),
    field(
      t('upload.description'),
      h('textarea', { attrs: { name: 'description', rows: 3, maxlength: 10000 } }),
    ),
    formError(),
    h('button', { attrs: { type: 'submit' } }, t('upload.submit')),
  );

  form.addEventListener(
    'submit',
    handleSubmit(form, async () => {
      const file = fileInput.files?.[0];
      if (file === undefined) throw new Error(t('upload.missingFile'));
      if (file.size > IMAGE_LIMITS.maxBytes) {
        throw new Error(t('upload.tooLarge', { size: formatBytes(IMAGE_LIMITS.maxBytes) }));
      }
      if (file.type !== '' && !(IMAGE_MIME_TYPES as readonly string[]).includes(file.type)) {
        throw new Error(t('upload.wrongType'));
      }
      const uiId = formValue(form, 'uiId');
      const uiPath = formValue(form, 'uiPath');
      if (uiId === '' && uiPath === '') throw new Error(t('upload.missingTarget'));

      const body = new FormData();
      // Text fields first, the file last: the server reads the multipart stream in order.
      const optionalFields = [
        'title',
        'deviceCategory',
        'variantLabel',
        'viewportWidth',
        'viewportHeight',
        'description',
      ];
      if (uiId !== '') body.set('uiId', uiId);
      if (uiPath !== '') body.set('uiPath', uiPath);
      for (const name of optionalFields) {
        const value = formValue(form, name);
        if (value !== '') body.set(name, value);
      }
      body.set('image', file, file.name);

      const result = await api.uploadScreenshot(projectId, body);
      navigate(pathTo('sessions', result.session.id));
    }),
  );

  let selected = preselectedUiId ?? '';
  uiSelect.addEventListener('change', () => {
    selected = uiSelect.value;
  });

  return {
    element: form,
    setUiViews: (views) => {
      replaceChildren(
        uiSelect,
        h('option', { attrs: { value: '' } }, '—'),
        views.map((view) =>
          h(
            'option',
            { attrs: { value: view.uiId }, props: { selected: view.uiId === selected } },
            `${view.uiId} · ${view.path}`,
          ),
        ),
      );
    },
  };
};
