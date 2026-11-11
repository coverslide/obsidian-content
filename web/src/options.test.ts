import { describe, expect, it } from 'vitest';
import { escapeHTML, jobPayload, optionFieldHTML } from './options';

describe('escapeHTML', () => {
  it('escapes HTML-sensitive characters', () => {
    expect(escapeHTML(`<img src="x" onerror='run()'>&`)).toBe('&lt;img src=&quot;x&quot; onerror=&#39;run()&#39;&gt;&amp;');
  });
});

describe('optionFieldHTML', () => {
  it('uses Obsidian defaults for unselected choices and escapes option labels/values', () => {
    const html = optionFieldHTML('architecture', 'wall_type', {
      type: 'choice', values: ['brick', '<script>'], tooltip: 'Pick "one"',
    });
    expect(html).toContain('Use Obsidian default');
    expect(html).toContain('value="&lt;script&gt;"');
    expect(html).not.toContain('<script>');
    expect(html).toContain('title="Pick &quot;one&quot;"');
  });

  it('selects the established defaults for core build settings', () => {
    const game = optionFieldHTML('main_build_settings', 'game', { values: ['doom1', 'doom2'] });
    const length = optionFieldHTML('main_build_settings', 'length', { values: ['single', 'game'] });
    expect(game).toContain('<option value="doom2" selected>doom2</option>');
    expect(length).toContain('<option value="game" selected>game</option>');
  });

  it('renders boolean values and slider bounds/defaults', () => {
    expect(optionFieldHTML('combat', 'enabled', { type: 'boolean', default: 0 })).toContain('value="0" selected>Disabled');
    const slider = optionFieldHTML('architecture', 'size', {
      type: 'slider', values: { min: 1, max: 9, default: 5, nan: ['mixed'] },
    });
    expect(slider).toContain('value="5"');
    expect(slider).toContain('placeholder="1 to 9"');
  });
});

describe('jobPayload', () => {
  it('collects core settings and only explicitly selected module options', () => {
    const form = new FormData();
    form.set('core.game', 'doom2');
    form.set('core.port', 'boom');
    form.set('core.theme', 'original');
    form.set('core.length', 'game');
    form.set('seed', 'patient seed');
    form.set('option.float_size', '48');
    form.set('option.traps', '');

    expect(jobPayload(form)).toEqual({
      game: 'doom2', port: 'boom', theme: 'original', length: 'game', seed: 'patient seed',
      options: { float_size: '48' },
    });
  });
});
