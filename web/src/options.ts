export type OptionDefinition = Record<string, unknown>;
export type OptionReference = Record<string, Record<string, OptionDefinition>>;

const mainDefaults: Record<string, string> = {
  game: 'doom2',
  port: 'boom',
  length: 'game',
  theme: 'original',
};

export function escapeHTML(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!);
}

export function optionFieldHTML(group: string, key: string, definition: OptionDefinition): string {
  const type = String(definition.type ?? 'choice');
  const slider = definition.values && typeof definition.values === 'object' && !Array.isArray(definition.values)
    ? definition.values as Record<string, unknown> : {};
  const values = Array.isArray(definition.values)
    ? definition.values.map(String)
    : Array.isArray(definition.choices) ? definition.choices.map(String) : [];
  const tooltip = String(definition.tooltip ?? '');
  const defaultValue = String(definition.default ?? slider.default ?? (group === 'main_build_settings' ? mainDefaults[key] : '') ?? '');
  const name = group === 'main_build_settings' ? `core.${escapeHTML(key)}` : `option.${escapeHTML(key)}`;
  const label = escapeHTML(key.replaceAll('_', ' '));
  let control: string;

  if (values.length) {
    const placeholder = defaultValue ? '' : '<option value="" selected>Use Obsidian default</option>';
    control = `<select name="${name}">${placeholder}${values.map((value) =>
      `<option value="${escapeHTML(value)}" ${value === defaultValue ? 'selected' : ''}>${escapeHTML(value.replaceAll('_', ' '))}</option>`,
    ).join('')}</select>`;
  } else if (type === 'boolean') {
    const selected = defaultValue === '0' || defaultValue === 'false' ? '0' : '1';
    control = `<select name="${name}"><option value="1" ${selected === '1' ? 'selected' : ''}>Enabled</option><option value="0" ${selected === '0' ? 'selected' : ''}>Disabled</option></select>`;
  } else if (type === 'slider' && slider.min !== undefined && slider.max !== undefined) {
    control = `<input name="${name}" type="text" inputmode="decimal" placeholder="${escapeHTML(String(slider.min))} to ${escapeHTML(String(slider.max))}" value="${escapeHTML(defaultValue)}">`;
  } else {
    control = `<input name="${name}" value="${escapeHTML(defaultValue)}">`;
  }

  return `<label class="option-field" title="${escapeHTML(tooltip)}">${label}${control}${tooltip ? `<small>${escapeHTML(tooltip)}</small>` : ''}</label>`;
}

export function jobPayload(form: FormData) {
  const options: Record<string, string> = {};
  for (const [name, value] of form.entries()) {
    if (name.startsWith('option.') && String(value) !== '') options[name.slice(7)] = String(value);
  }
  return {
    game: String(form.get('core.game') ?? ''),
    port: String(form.get('core.port') ?? ''),
    theme: String(form.get('core.theme') ?? ''),
    length: String(form.get('core.length') ?? ''),
    seed: String(form.get('seed') ?? ''),
    options,
  };
}
