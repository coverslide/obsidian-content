import CustomElement from '@coverslide/customelement';
import { escapeHTML, jobPayload, optionFieldHTML, type OptionReference } from './options';
import './style.css';
import './api-error.css';
import './log-tail.css';

type JobSettings = { game:string; port:string; theme:string; length:string; seed:string; options:Record<string,string> };
type Job = { id:string; status:string; createdAt:string; error?:string; file?:string; settings?:JobSettings };
const lastSettingsKey = 'obsidian-web:last-settings:v1';
const globalOptionsKey = 'obsidian-web:global-options:v1';
type GlobalOptions = { touchControls:'auto'|'on'|'off'; size:number; opacity:number };
const defaultGlobalOptions:GlobalOptions = { touchControls:'auto', size:1, opacity:0.58 };
const recentLimit = 5;
const historyPageSize = 20;
const previewIWADs:Record<string,string> = {
  doom1:'doom.wad', ultdoom:'doom.wad', doom2:'doom2.wad',
  tnt:'tnt.wad', plutonia:'plutonia.wad', heretic:'heretic.wad',
  hexen:'hexen.wad', strife:'strife1.wad', hacx:'hacx.wad', chex3:'chex3.wad', harmony:'harm1.wad',
};
const availableIWADs = [
  ['doom.wad', 'The Ultimate DOOM'], ['doom2.wad', 'DOOM II'], ['tnt.wad', 'Final DOOM: TNT'],
  ['plutonia.wad', 'Final DOOM: Plutonia'], ['heretic.wad', 'Heretic'], ['hexen.wad', 'Hexen'],
  ['strife1.wad', 'Strife'], ['hacx.wad', 'Hacx'], ['chex3.wad', 'Chex Quest 3'],
  ['harm1.wad', 'Harmony'], ['hexdd.wad', 'Hexen: Deathkings'], ['freedoom.wad', 'Freedoom'], ['freedoom1.wad', 'Freedoom: Phase 1'],
  ['freedoom2.wad', 'Freedoom: Phase 2'], ['freedm.wad', 'FreeDM'],
];

type IncludedWad = { title:string; iwad:string; files:string[]; description:string };
const wadPath = (file:string) => `/play/private/available-wads/${encodeURIComponent(file)}`;

function playerHref(file:string, mods:string[] = []) {
  const params = new URLSearchParams({ iwad: file === 'hexdd.wad' ? 'hexen.wad' : file });
  for (const mod of (file === 'hexdd.wad' ? ['/play/private/hexdd.wad', ...mods] : mods)) params.append('modurl', mod);
  return `/play/?${params.toString()}`;
}

function launchHref(file:string, mods:string[] = []) {
  const params = new URLSearchParams({ iwad: file === 'hexdd.wad' ? 'hexen.wad' : file });
  for (const mod of (file === 'hexdd.wad' ? ['/play/private/hexdd.wad', ...mods] : mods)) params.append('modurl', mod);
  return `/#/launch?${params.toString()}`;
}

function launcherHash(file:string, mods:string[] = []) {
  const params = new URLSearchParams({ iwad:file });
  for (const mod of mods) params.append('modurl', mod);
  return `#/launch?${params.toString()}`;
}

class ObsidianApp extends CustomElement {
  static localName = 'app';
  static template = null;
  private reference:OptionReference = {};
  private timer?:number;
  private page = 1;
  private logContents = new Map<string,string>();
  private jobSnapshots = new Map<string,string>();
  private routeListener = () => this.renderRoute();

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('hashchange', this.routeListener);
    this.renderRoute();
    this.timer = window.setInterval(() => void this.refresh(), 2500);
  }

  disconnectedCallback() {
    if (this.timer) clearInterval(this.timer);
    window.removeEventListener('hashchange', this.routeListener);
  }

  private runId() {
    const match = location.hash.match(/^#\/runs\/([^/?#]+)/);
    if (!match) return;
    try { return decodeURIComponent(match[1]); } catch (error) {
      console.error('Invalid run id in route', error);
      return;
    }
  }

  private isHistory() { return location.hash === '#/runs' || location.hash.startsWith('#/runs?'); }

  private renderRoute() {
    if (this.runId()) this.renderRunDetail();
    else if (this.isHistory()) this.renderHistory();
    else if (location.hash === '#/options') this.renderOptions();
    else if (location.hash === '#/launch' || location.hash.startsWith('#/launch?')) this.renderLauncher();
    else this.renderHome();
    void this.refresh();
  }

  private renderRunDetail() {
    this.innerHTML = `<main class="shell history-shell run-shell"><header><a class="brand home-link" href="#/"><span class="sigil">O</span><span><p class="eyebrow">OBSIDIAN LEVEL MAKER</p><h1>Level Forge</h1></span></a><nav class="top-links"><a class="online" href="#/launch">PLAY DOOM</a><a class="online" href="#/options">OPTIONS</a><a class="online" href="#/runs">← ALL RUNS</a></nav></header><section class="history-intro"><p class="eyebrow">RUN DETAILS</p><h2>Generated run</h2><p class="lede">Status, output, settings, and generated files for this run.</p></section><section class="history-panel"><div class="section-title"><span>RUN</span><h3>Run details</h3></div><div id="run-detail"><div class="empty"><p>Loading run…</p></div></div></section><footer><span>OBSIDIAN · PROCEDURAL WORLD GENERATOR</span><a href="#/runs">BACK TO RUNS</a></footer></main>`;
  }

  private readGlobalOptions():GlobalOptions {
    try {
      const saved = JSON.parse(localStorage.getItem(globalOptionsKey) || 'null');
      return {
        touchControls: ['auto', 'on', 'off'].includes(saved?.touchControls) ? saved.touchControls : defaultGlobalOptions.touchControls,
        size: Number.isFinite(saved?.size) ? Math.min(1.35, Math.max(0.75, saved.size)) : defaultGlobalOptions.size,
        opacity: Number.isFinite(saved?.opacity) ? Math.min(0.9, Math.max(0.25, saved.opacity)) : defaultGlobalOptions.opacity,
      };
    } catch (error) {
      console.error('Could not read saved player options; using defaults', error);
      return { ...defaultGlobalOptions };
    }
  }

  private renderOptions() {
    const options = this.readGlobalOptions();
    const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
    const controlsActive = options.touchControls === 'on' || (options.touchControls === 'auto' && coarsePointer);
    this.innerHTML = `<main class="shell history-shell options-shell"><header><a class="brand home-link" href="#/"><span class="sigil">O</span><span><p class="eyebrow">OBSIDIAN LEVEL MAKER</p><h1>Level Forge</h1></span></a><nav class="top-links"><a class="online" href="#/launch">PLAY DOOM</a><a class="online" href="#/runs">RUN HISTORY</a><a class="online" href="#/">BUILDER</a></nav></header><section class="history-intro"><p class="eyebrow">GLOBAL PREFERENCES</p><h2>Options</h2><p class="lede">These settings are saved in this browser and used by the bundled game player.</p></section><section class="history-panel global-options-panel"><div class="section-title"><span>01</span><h3>Player controls</h3></div><label for="touch-controls-mode">TOUCH CONTROLS</label><select id="touch-controls-mode"><option value="auto" ${options.touchControls === 'auto' ? 'selected' : ''}>Automatic — detect coarse pointer</option><option value="on" ${options.touchControls === 'on' ? 'selected' : ''}>Always on</option><option value="off" ${options.touchControls === 'off' ? 'selected' : ''}>Always off</option></select><p class="form-note option-status" id="touch-controls-status">${options.touchControls === 'auto' ? `Automatic mode: controls are ${controlsActive ? 'enabled' : 'disabled'} for this device (${coarsePointer ? 'coarse pointer detected' : 'no coarse pointer detected'}).` : `Touch controls are forced ${options.touchControls === 'on' ? 'on' : 'off'} for this browser.`}</p><label for="touch-control-size">STICK SIZE <output id="touch-size-value">${options.size.toFixed(2)}</output><input id="touch-control-size" type="range" min="0.75" max="1.35" step="0.05" value="${options.size}"></label><label for="touch-control-opacity">CONTROL OPACITY <output id="touch-opacity-value">${options.opacity.toFixed(2)}</output><input id="touch-control-opacity" type="range" min="0.25" max="0.9" step="0.01" value="${options.opacity}"></label><p class="form-note option-saved" id="options-saved" aria-live="polite">Saved automatically on this device.</p></section><footer><span>OBSIDIAN · BROWSER OPTIONS</span><a href="#/">BACK TO BUILDER</a></footer></main>`;
    const mode = this.querySelector<HTMLSelectElement>('#touch-controls-mode')!;
    const size = this.querySelector<HTMLInputElement>('#touch-control-size')!;
    const opacity = this.querySelector<HTMLInputElement>('#touch-control-opacity')!;
    const save = () => {
      const value:GlobalOptions = { touchControls:mode.value as GlobalOptions['touchControls'], size:Number(size.value), opacity:Number(opacity.value) };
      try {
        localStorage.setItem(globalOptionsKey, JSON.stringify(value));
        this.querySelector<HTMLElement>('#options-saved')!.textContent = 'Saved automatically on this device.';
      } catch (error) {
        console.error('Could not save global player options', error);
        this.querySelector<HTMLElement>('#options-saved')!.textContent = 'Could not save preferences in this browser.';
      }
      this.querySelector<HTMLOutputElement>('#touch-size-value')!.value = value.size.toFixed(2);
      this.querySelector<HTMLOutputElement>('#touch-opacity-value')!.value = value.opacity.toFixed(2);
      const active = value.touchControls === 'on' || (value.touchControls === 'auto' && window.matchMedia('(pointer: coarse)').matches);
      this.querySelector<HTMLElement>('#touch-controls-status')!.textContent = value.touchControls === 'auto'
        ? `Automatic mode: controls are ${active ? 'enabled' : 'disabled'} for this device (${window.matchMedia('(pointer: coarse)').matches ? 'coarse pointer detected' : 'no coarse pointer detected'}).`
        : `Touch controls are forced ${value.touchControls === 'on' ? 'on' : 'off'} for this browser.`;
    };
    mode.addEventListener('change', save);
    size.addEventListener('input', save);
    opacity.addEventListener('input', save);
  }

  private renderLauncher() {
    const routeParams = new URLSearchParams(location.hash.split('?')[1] ?? '');
    const selected = routeParams.get('iwad') ?? 'doom2.wad';
    const mods = routeParams.getAll('modurl');
    this.innerHTML = `<main class="shell history-shell launcher-shell"><header><a class="brand home-link" href="#/"><span class="sigil">O</span><span><p class="eyebrow">OBSIDIAN LEVEL MAKER</p><h1>Level Forge</h1></span></a><nav class="top-links"><a class="online" href="#/">← BUILDER</a><a class="online" href="#/options">OPTIONS</a><a class="online" href="#/runs">RUN HISTORY</a></nav></header><section class="history-intro"><p class="eyebrow">UZDOOM PLAYER</p><h2>Ready to play</h2><p class="lede">Your game data is ready. Launch when you’re ready; the self-hosted player opens in a new tab.</p></section><section class="history-panel launch-panel"><div class="section-title"><span>01</span><h3>Game data</h3></div><label for="launch-iwad">SELECT GAME DATA</label><select id="launch-iwad">${availableIWADs.map(([file,label]) => `<option value="${file}" ${file === selected ? 'selected' : ''}>${label} · ${file}</option>`).join('')}</select><p class="form-note launch-note">Harmony is available as a base IWAD. Hexen: Deathkings loads alongside hexen.wad. Add-on WADs stay in the server’s mounted available-wads folder, outside the Docker image.</p><div class="preload-box"><h4>PRELOAD MODS · LOAD ORDER</h4><p class="form-note">Mods load in this order. Add them from the library below, then reorder or remove them here.</p><ol id="preload-order" class="preload-order">${mods.length ? mods.map((mod,index) => `<li><span>${escapeHTML(mod.split('/').pop() || mod)}</span><div><button type="button" data-mod-move="${index}" data-direction="up" aria-label="Move ${escapeHTML(mod.split('/').pop() || mod)} up" ${index === 0 ? 'disabled' : ''}>↑</button><button type="button" data-mod-move="${index}" data-direction="down" aria-label="Move ${escapeHTML(mod.split('/').pop() || mod)} down" ${index === mods.length-1 ? 'disabled' : ''}>↓</button><button type="button" data-mod-remove="${index}" aria-label="Remove ${escapeHTML(mod.split('/').pop() || mod)}">Remove</button></div></li>`).join('') : '<li class="preload-empty">No mods selected.</li>'}</ol></div><a class="build launch-button" id="launch-game" href="${playerHref(selected, mods)}" target="_blank" rel="noopener"><span>Launch UZDoom</span><span>↗</span></a></section><section class="history-panel included-wads-panel"><div class="section-title"><span>02</span><h3>Included WADs</h3></div><p class="form-note launch-note">Available add-ons are read from the mounted available-wads folder. Drop in WAD/PK3 files and update its catalog.json; no image rebuild is needed.</p><div id="included-wads"><p class="loading-options">Loading available add-ons…</p></div></section><footer><span>SELF-HOSTED UZDOOM · LOCAL IWAD STORAGE</span><a href="#/">BACK TO BUILDER</a></footer></main>`;
    const select = this.querySelector<HTMLSelectElement>('#launch-iwad')!;
    const link = this.querySelector<HTMLAnchorElement>('#launch-game')!;
    select.addEventListener('change', () => {
      link.href = playerHref(select.value, mods);
      location.hash = launcherHash(select.value, mods);
    });
    this.querySelector('#preload-order')?.addEventListener('click', event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!button) return;
      const remove = button.dataset.modRemove;
      const move = button.dataset.modMove;
      const next = [...mods];
      if (remove !== undefined) next.splice(Number(remove),1);
      if (move !== undefined) {
        const index = Number(move);
        const target = button.dataset.direction === 'up' ? index-1 : index+1;
        if (target >= 0 && target < next.length) [next[index], next[target]] = [next[target], next[index]];
      }
      location.hash = launcherHash(select.value, next);
    });
    void this.loadIncludedWads();
  }

  private async loadIncludedWads() {
    const host = this.querySelector<HTMLElement>('#included-wads');
    if (!host) return;
    const routeParams = new URLSearchParams(location.hash.split('?')[1] ?? '');
    const selected = routeParams.get('iwad') ?? 'doom2.wad';
    const mods = routeParams.getAll('modurl');
    try {
      const response = await fetch('/play/private/available-wads/catalog.json');
      if (!response.ok) throw new Error(`available-wads catalog returned HTTP ${response.status}`);
      const entries:IncludedWad[] = await response.json();
      if (!Array.isArray(entries)) throw new Error('available-wads catalog must be a JSON array');
      host.innerHTML = entries.map(entry => {
        if (!entry || typeof entry.title !== 'string' || typeof entry.description !== 'string' || !Array.isArray(entry.files) || !['doom.wad','doom2.wad','heretic.wad','hexen.wad'].includes(entry.iwad)) throw new Error('Invalid add-on entry in available-wads/catalog.json');
        const safeFiles = entry.files.filter(file => typeof file === 'string' && /^[A-Za-z0-9_. -]+\.(wad|pk3)$/i.test(file));
        if (!safeFiles.length) throw new Error(`No valid WAD/PK3 files listed for ${entry.title}`);
        const modURLs = safeFiles.map(wadPath);
        const alreadyAdded = modURLs.every(url => mods.includes(url));
        return `<article class="included-wad"><div><h4>${escapeHTML(entry.title)}</h4><p>${escapeHTML(entry.description)}</p><small>${safeFiles.map(escapeHTML).join(' + ')}</small></div><button type="button" class="wad-play" data-add-mods="${escapeHTML(modURLs.join('|'))}" data-iwad="${escapeHTML(entry.iwad)}">${alreadyAdded ? 'Add again' : 'Add to preload'}</button>${safeFiles.map(file => `<a class="wad-download" href="${wadPath(file)}" download>Download ${escapeHTML(file)}</a>`).join('')}</article>`;
      }).join('') || '<p class="empty-wads">No add-ons are listed yet.</p>';
      host.addEventListener('click', event => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-add-mods]');
        if (!button) return;
        const next = [...mods, ...button.dataset.addMods!.split('|')];
        location.hash = launcherHash(button.dataset.iwad || selected, next);
      }, { once:true });
    } catch (error) {
      this.showApiError(host, 'Could not load available WADs', error);
    }
  }

  private renderHome() {
    this.innerHTML = `<main class="shell"><header><a class="brand home-link" href="#/"><span class="sigil">O</span><span><p class="eyebrow">OBSIDIAN LEVEL MAKER</p><h1>Level Forge</h1></span></a><nav class="top-links"><a class="online" href="#/launch">PLAY DOOM</a><a class="online" href="#/options">OPTIONS</a><span class="online"><i></i> GENERATOR READY</span></nav></header><section class="intro"><p class="eyebrow">PROCEDURAL WORLD BUILDER</p><h2>Build a world.<br><em>Make it yours.</em></h2><p class="lede">Choose from Obsidian's complete option reference and forge a playable WAD.</p></section><section class="workspace"><form id="build-form"><div class="section-title"><span>01</span><h3>Build settings</h3></div><label>SEED <span class="optional">OPTIONAL</span><input name="seed" maxlength="80" placeholder="Random seed" autocomplete="off"></label><div id="option-groups"><p class="loading-options">Loading all available Obsidian settings…</p></div><button class="build" type="submit"><span>Generate WAD</span><span>↗</span></button><p class="form-note">Your latest settings save on this device and with each run.</p></form><aside><div class="section-title"><span>02</span><h3>Recent runs</h3><a class="live" href="#/runs">VIEW ALL RUNS →</a></div><div id="jobs" class="jobs"><div class="empty"><span>✳</span><p>No runs yet</p><small>Your generated worlds will appear here.</small></div></div><div class="queue-footer"><span class="pulse"></span> AUTO-REFRESHING</div></aside></section><footer><span>OBSIDIAN · PROCEDURAL WORLD GENERATOR</span><span>WAD OUTPUT · DOOM ENGINE</span></footer></main>`;
    const form = this.querySelector<HTMLFormElement>('#build-form')!;
    form.addEventListener('submit', event => void this.submit(event as SubmitEvent));
    form.addEventListener('input', () => this.saveSettings(form));
    form.addEventListener('change', () => this.saveSettings(form));
    void this.loadOptions();
  }

  private renderHistory() {
    const query = new URLSearchParams(location.hash.split('?')[1] ?? '');
    this.page = Math.max(1, Number(query.get('page')) || 1);
    this.innerHTML = `<main class="shell history-shell"><header><a class="brand home-link" href="#/"><span class="sigil">O</span><span><p class="eyebrow">OBSIDIAN LEVEL MAKER</p><h1>Level Forge</h1></span></a><nav class="top-links"><a class="online" href="#/launch">PLAY DOOM</a><a class="online" href="#/options">OPTIONS</a><a class="online" href="#/">← NEW RUN</a></nav></header><section class="history-intro"><p class="eyebrow">RUN ARCHIVE</p><h2>Past runs</h2><p class="lede">Browse generated worlds and reuse any run's settings.</p></section><section class="history-panel"><div class="section-title"><span>02</span><h3>All runs</h3><span class="live">PAGE ${this.page}</span></div><div id="jobs" class="jobs"><div class="empty"><span>✳</span><p>Loading runs…</p></div></div><nav class="pagination" aria-label="Run history pages"><button type="button" data-page="previous" ${this.page <= 1 ? 'disabled' : ''}>← Previous</button><span>Page ${this.page}</span><button type="button" data-page="next">Next →</button></nav></section><footer><span>OBSIDIAN · PROCEDURAL WORLD GENERATOR</span><a href="#/">BACK TO BUILDER</a></footer></main>`;
    this.querySelector<HTMLButtonElement>('[data-page="previous"]')?.addEventListener('click', () => this.goToPage(this.page - 1));
    this.querySelector<HTMLButtonElement>('[data-page="next"]')?.addEventListener('click', () => this.goToPage(this.page + 1));
  }

  private goToPage(page:number) {
    if (page < 1) return;
    location.hash = page === 1 ? '#/runs' : `#/runs?page=${page}`;
  }

  private async loadOptions() {
    try {
      const response = await fetch('/api/options');
      if (!response.ok) throw new Error('Option reference unavailable');
      this.reference = await response.json() as OptionReference;
      const groups = this.querySelector<HTMLElement>('#option-groups');
      if (!groups) return;
      groups.innerHTML = Object.entries(this.reference).map(([name, options]) => `<details class="option-group" ${name === 'main_build_settings' ? 'open' : ''}><summary>${escapeHTML(name.replaceAll('_', ' '))}<span>${Object.keys(options).length} OPTIONS</span></summary><div class="option-fields">${Object.entries(options).map(([key, definition]) => {
        if (name === 'main_build_settings' && key === 'game' && Array.isArray(definition.values)) {
          definition = { ...definition, values: definition.values.filter(value => !['wolf', 'spear', 'nukem'].includes(String(value))) };
        }
        return optionFieldHTML(name, key, definition);
      }).join('')}</div></details>`).join('');
      const settings = this.loadSettings();
      if (settings) this.applySettings(settings, false);
    } catch (error) {
      console.error('Failed to load Obsidian option reference', error);
      const groups = this.querySelector<HTMLElement>('#option-groups');
      if (groups) groups.innerHTML = `<p class="option-error">${escapeHTML(error instanceof Error ? error.message : 'Could not load options')}</p>`;
    }
  }

  private async submit(event:SubmitEvent) {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const payload = jobPayload(new FormData(form));
    this.saveSettings(form);
    const button = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    button.disabled = true;
    button.innerHTML = '<span>Adding to queue…</span><span>…</span>';
    try {
      const response = await fetch('/api/jobs', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
      if (!response.ok) throw new Error(await response.text());
      await this.refresh();
    } catch (error) {
      console.error('Failed to queue Obsidian build', error);
      alert(error instanceof Error ? error.message : 'Could not queue build');
    } finally {
      button.disabled = false;
      button.innerHTML = '<span>Generate WAD</span><span>↗</span>';
    }
  }

  private async refresh() {
    if (this.runId()) {
      await this.refreshRunDetail();
      return;
    }
    const host = this.querySelector<HTMLElement>('#jobs');
    if (!host) return;
    try {
      const limit = this.isHistory() ? historyPageSize + 1 : recentLimit;
      const offset = this.isHistory() ? (this.page - 1) * historyPageSize : 0;
      const response = await fetch(`/api/jobs?limit=${limit}&offset=${offset}`);
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Runs API returned ${response.status}${body ? `: ${body}` : ''}`);
      }
      const returned = await response.json() as Job[];
      const hasNext = this.isHistory() && returned.length > historyPageSize;
      const jobs = this.isHistory() ? returned.slice(0, historyPageSize) : returned;
      this.renderJobs(host, jobs);
      if (this.isHistory()) {
        const next = this.querySelector<HTMLButtonElement>('[data-page="next"]');
        if (next) next.disabled = !hasNext;
      }
    } catch (error) {
      this.showApiError(host, 'Failed to load runs from /api/jobs', error);
    }
  }

  private async refreshRunDetail() {
    const id = this.runId();
    const host = this.querySelector<HTMLElement>('#run-detail');
    if (!id || !host) return;
    try {
      const response = await fetch(`/api/jobs/${encodeURIComponent(id)}`);
      if (response.status === 404) {
        host.innerHTML = '<p class="option-error">This run was not found. It may have been deleted.</p>';
        return;
      }
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Run API returned ${response.status}${body ? `: ${body}` : ''}`);
      }
      const job = await response.json() as Job;
      let card = host.querySelector<HTMLDetailsElement>('.job[data-job-id]');
      const snapshot = JSON.stringify(job);
      if (!card) {
        card = this.createJobCard(job);
        card.open = true;
        host.replaceChildren(card);
        this.updateJobCard(card, job);
        this.jobSnapshots.set(job.id, snapshot);
      } else if (this.jobSnapshots.get(job.id) !== snapshot) {
        this.updateJobCard(card, job);
        this.jobSnapshots.set(job.id, snapshot);
      }
      if (job.status === 'running' || ((job.status === 'failed' || job.status === 'completed') && card.dataset.logLoaded !== 'true')) {
        const logs = await fetch(`/api/jobs/${encodeURIComponent(job.id)}/logs`);
        if (!logs.ok) throw new Error(`Run log API returned ${logs.status}`);
        this.appendLog(job.id, await logs.text());
        card.dataset.logLoaded = 'true';
      }
    } catch (error) {
      this.showApiError(host, `Failed to load run ${id}`, error);
    }
  }

  private renderJobs(host:HTMLElement, jobs:Job[]) {
    if (!jobs.length) {
      if (!host.querySelector('.empty')) {
        host.innerHTML = '<div class="empty"><span>✳</span><p>No runs yet</p><small>Your generated worlds will appear here.</small></div>';
        this.jobSnapshots.clear();
        this.logContents.clear();
      }
      return;
    }
    host.querySelector('.empty')?.remove();
    const cards = new Map(Array.from(host.querySelectorAll<HTMLElement>('.job[data-job-id]')).map(card => [card.dataset.jobId!, card]));
    const logsToFetch = jobs.map(async (job, index) => {
      const existing = cards.get(job.id);
      const shouldFetch = job.status === 'running' || ((job.status === 'failed' || (job.status === 'completed' && index < recentLimit)) && existing?.dataset.logLoaded !== 'true');
      if (!shouldFetch) return;
      try {
        const response = await fetch(`/api/jobs/${encodeURIComponent(job.id)}/logs`);
        if (!response.ok) throw new Error(`Run log API returned ${response.status}`);
        const log = await response.text();
        this.appendLog(job.id, log);
        cards.get(job.id)!.dataset.logLoaded = 'true';
        cards.get(job.id)!.querySelector('.job-api-error')?.remove();
      } catch (error) {
        console.error(`Failed to load log for run ${job.id}`, error);
        const card = cards.get(job.id);
        const content = card?.querySelector<HTMLElement>('.job-content');
        if (content) {
          let message = content.querySelector<HTMLElement>('.job-api-error');
          if (!message) {
            message = document.createElement('div');
            message.className = 'api-error job-api-error';
            message.setAttribute('role', 'alert');
            content.prepend(message);
          }
          message.innerHTML = `<strong>Could not load run log</strong><p>${escapeHTML(error instanceof Error ? error.message : String(error))}</p>`;
        }
      }
    });

    jobs.forEach((job, index) => {
      let card = cards.get(job.id);
      if (!card) {
        card = this.createJobCard(job);
        cards.set(job.id, card);
        this.updateJobCard(card, job);
        this.jobSnapshots.set(job.id, JSON.stringify(job));
      } else {
        const snapshot = JSON.stringify(job);
        if (this.jobSnapshots.get(job.id) !== snapshot) {
          this.updateJobCard(card, job);
          this.jobSnapshots.set(job.id, snapshot);
        }
      }
      const current = host.children[index];
      if (current !== card) host.insertBefore(card, current ?? null);
    });
    const visibleIds = new Set(jobs.map(job => job.id));
    for (const [id, card] of cards) if (!visibleIds.has(id)) {
      card.remove();
      this.jobSnapshots.delete(id);
      this.logContents.delete(id);
    }
    void Promise.all(logsToFetch);
  }

  private createJobCard(job:Job) {
    const card = document.createElement('details');
    card.className = 'job';
    card.dataset.jobId = job.id;
    card.innerHTML = `<summary class="job-top"><span class="job-icon"></span><div class="job-info"><strong></strong><small></small></div><span class="status"></span><span class="job-chevron" aria-hidden="true">⌄</span></summary><div class="job-content"><div class="progress"><i></i></div><div class="job-actions"><a class="download">Download WAD <span>↓</span></a><a class="play-test" target="_blank" rel="noopener">Play in UZDoom <span>↗</span></a></div><div class="run-actions"><a class="run-page">Open run details ↗</a><button class="reuse-settings" type="button">Reuse settings</button><button class="delete-run" type="button">Delete failed run</button></div><p class="error"></p><details class="run-settings"><summary>Settings used</summary><pre></pre></details><details class="job-logs"><summary></summary><a class="full-log" target="_blank" rel="noopener">Open full log <span>↗</span></a><pre></pre></details></div>`;
    return card;
  }

  private showApiError(host:HTMLElement, context:string, error:unknown) {
    console.error(context, error);
    const message = error instanceof Error ? error.message : String(error);
    host.innerHTML = `<div class="api-error" role="alert"><strong>${escapeHTML(context)}</strong><p>${escapeHTML(message)}</p><small>Check the server connection and retry.</small></div>`;
  }

  private updateJobCard(card:HTMLElement, job:Job) {
    card.querySelector<HTMLElement>('.job-icon')!.textContent = job.status === 'completed' ? '✓' : job.status === 'failed' ? '!' : '◌';
    card.querySelector<HTMLElement>('.job-info strong')!.textContent = `OBSIDIAN-${job.id.slice(-6).toUpperCase()}`;
    card.querySelector<HTMLElement>('.job-info small')!.textContent = new Date(job.createdAt).toLocaleString();
    const status = card.querySelector<HTMLElement>('.status')!;
    status.className = `status ${job.status}`;
    status.textContent = job.status;
    card.querySelector<HTMLElement>('.progress')!.hidden = job.status !== 'running';
    const download = card.querySelector<HTMLAnchorElement>('.download')!;
    download.hidden = job.status !== 'completed' || !job.file;
    if (job.file) download.href = job.file;
    const play = card.querySelector<HTMLAnchorElement>('.play-test')!;
    const iwad = job.settings?.game ? previewIWADs[job.settings.game] : undefined;
    play.hidden = job.status !== 'completed' || !job.file || !iwad;
    if (iwad) {
      play.href = launchHref(iwad, [`/api/jobs/${encodeURIComponent(job.id)}/download`]);
    }
    const error = card.querySelector<HTMLElement>('.error')!;
    error.hidden = job.status !== 'failed';
    error.textContent = job.error || 'Build failed';
    const reuse = card.querySelector<HTMLButtonElement>('.reuse-settings')!;
    reuse.hidden = !job.settings;
    reuse.onclick = job.settings ? () => this.reuseSettings(job.settings!) : null;
    const details = card.querySelector<HTMLDetailsElement>('.job-logs')!;
    details.hidden = job.status === 'queued' || (job.status === 'completed' && card.dataset.hasLog !== 'true');
    details.open = job.status === 'running' || job.status === 'failed';
    details.querySelector('summary')!.textContent = job.status === 'running' ? 'Live generator log' : 'Generator log';
    details.querySelector<HTMLAnchorElement>('.full-log')!.href = `/api/jobs/${encodeURIComponent(job.id)}/log`;
    const runPage = card.querySelector<HTMLAnchorElement>('.run-page')!;
    runPage.href = `#/runs/${encodeURIComponent(job.id)}`;
    const remove = card.querySelector<HTMLButtonElement>('.delete-run')!;
    remove.hidden = job.status !== 'failed';
    remove.onclick = job.status === 'failed' ? () => void this.deleteFailedRun(job, card, remove) : null;
    const settings = card.querySelector<HTMLDetailsElement>('.run-settings')!;
    settings.hidden = !job.settings;
    settings.querySelector('pre')!.textContent = job.settings ? JSON.stringify(job.settings, null, 2) : '';
    if ((job.status === 'running' || job.status === 'failed') && !this.logContents.has(job.id)) {
      details.querySelector('pre')!.textContent = job.status === 'running' ? 'Waiting for generator output…' : (job.error || 'No log output recorded');
    }
  }

  private appendLog(id:string, next:string) {
    if (!next) return;
    const card = Array.from(this.querySelectorAll<HTMLElement>('.job[data-job-id]')).find(item => item.dataset.jobId === id);
    if (!card) return;
    const pre = card.querySelector<HTMLElement>('.job-logs pre')!;
    const previous = this.logContents.get(id) ?? '';
    if (next === previous) return;
    if (!previous) pre.textContent = '';
    if (next.startsWith(previous)) pre.append(document.createTextNode(next.slice(previous.length)));
    else pre.textContent = next;
    const lines = pre.textContent!.replace(/\n$/, '').split(/\r?\n/);
    if (lines.length > 20) pre.textContent = lines.slice(-20).join('\n');
    this.logContents.set(id, next);
    card.dataset.hasLog = 'true';
    card.querySelector<HTMLDetailsElement>('.job-logs')!.hidden = false;
    pre.scrollTop = pre.scrollHeight;
  }

  private async deleteFailedRun(job:Job, card:HTMLElement, button:HTMLButtonElement) {
    if (!window.confirm(`Delete failed run OBSIDIAN-${job.id.slice(-6).toUpperCase()} and its log?`)) return;
    button.disabled = true;
    try {
      const response = await fetch(`/api/jobs/${encodeURIComponent(job.id)}`, { method:'DELETE' });
      if (!response.ok) throw new Error(await response.text());
      this.jobSnapshots.delete(job.id);
      this.logContents.delete(job.id);
      if (this.runId() === job.id) location.hash = '#/runs';
      else {
        card.remove();
        await this.refresh();
      }
    } catch (error) {
      console.error(`Failed to delete run ${job.id}`, error);
      window.alert(error instanceof Error ? error.message : 'Could not delete failed run');
      button.disabled = false;
    }
  }

  private reuseSettings(settings:JobSettings) {
    try { localStorage.setItem(lastSettingsKey, JSON.stringify(settings)); } catch (error) {
      console.error('Could not save reused settings to local storage', error);
    }
    if (this.isHistory()) location.hash = '#/';
    else this.applySettings(settings, true);
  }

  private saveSettings(form:HTMLFormElement) {
    try { localStorage.setItem(lastSettingsKey, JSON.stringify(jobPayload(new FormData(form)))); } catch (error) {
      console.error('Could not save build settings to local storage', error);
      const note = form.querySelector<HTMLElement>('.form-note');
      if (note) note.textContent = 'Could not save settings in this browser.';
    }
  }

  private loadSettings():JobSettings|undefined {
    try {
      const raw = localStorage.getItem(lastSettingsKey);
      if (!raw) return;
      const value = JSON.parse(raw) as JobSettings;
      if (typeof value.game === 'string' && typeof value.options === 'object' && value.options !== null) return value;
      console.error('Saved build settings have an invalid shape; ignoring them');
    } catch (error) {
      console.error('Could not read saved build settings from local storage', error);
    }
    return;
  }

  private applySettings(settings:JobSettings, scroll:boolean) {
    const form = this.querySelector<HTMLFormElement>('#build-form');
    if (!form) return;
    form.reset();
    const values:Record<string,string> = { 'core.game':settings.game, 'core.port':settings.port, 'core.theme':settings.theme, 'core.length':settings.length, seed:settings.seed ?? '' };
    for (const [name, value] of Object.entries(values)) {
      const field = form.elements.namedItem(name);
      if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement) field.value = value;
    }
    for (const [key, value] of Object.entries(settings.options ?? {})) {
      const field = form.elements.namedItem(`option.${key}`);
      if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement) field.value = value;
    }
    this.saveSettings(form);
    if (scroll) form.scrollIntoView({ behavior:'smooth', block:'start' });
  }
}

customElements.define('obsidian-app', ObsidianApp);
