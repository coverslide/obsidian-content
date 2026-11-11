import CustomElement from '@coverslide/customelement';
import { escapeHTML, jobPayload, optionFieldHTML, type OptionReference } from './options';
import './style.css';
import './log-tail.css';

type JobSettings = { game:string; port:string; theme:string; length:string; seed:string; options:Record<string,string> };
type Job = { id:string; status:string; createdAt:string; error?:string; file?:string; settings?:JobSettings };
const lastSettingsKey = 'obsidian-web:last-settings:v1';
const recentLimit = 5;
const historyPageSize = 20;
const previewIWADs:Record<string,string> = {
  doom1:'doom.wad', ultdoom:'doom.wad', doom2:'doom2.wad',
  tnt:'tnt.wad', plutonia:'plutonia.wad', heretic:'heretic.wad',
  hexen:'hexen.wad', strife:'strife1.wad', hacx:'hacx.wad', chex3:'chex3.wad',
};

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

  private isHistory() { return location.hash.startsWith('#/runs'); }

  private renderRoute() {
    if (this.isHistory()) this.renderHistory();
    else this.renderHome();
    void this.refresh();
  }

  private renderHome() {
    this.innerHTML = `<main class="shell"><header><a class="brand home-link" href="#/"><span class="sigil">O</span><span><p class="eyebrow">OBSIDIAN LEVEL MAKER</p><h1>Level Forge</h1></span></a><span class="online"><i></i> GENERATOR READY</span></header><section class="intro"><p class="eyebrow">PROCEDURAL WORLD BUILDER</p><h2>Build a world.<br><em>Make it yours.</em></h2><p class="lede">Choose from Obsidian's complete option reference and forge a playable WAD.</p></section><section class="workspace"><form id="build-form"><div class="section-title"><span>01</span><h3>Build settings</h3></div><label>SEED <span class="optional">OPTIONAL</span><input name="seed" maxlength="80" placeholder="Random seed" autocomplete="off"></label><div id="option-groups"><p class="loading-options">Loading all available Obsidian settings…</p></div><button class="build" type="submit"><span>Generate WAD</span><span>↗</span></button><p class="form-note">Your latest settings save on this device and with each run.</p></form><aside><div class="section-title"><span>02</span><h3>Recent runs</h3><a class="live" href="#/runs">VIEW ALL RUNS →</a></div><div id="jobs" class="jobs"><div class="empty"><span>✳</span><p>No runs yet</p><small>Your generated worlds will appear here.</small></div></div><div class="queue-footer"><span class="pulse"></span> AUTO-REFRESHING</div></aside></section><footer><span>OBSIDIAN · PROCEDURAL WORLD GENERATOR</span><span>WAD OUTPUT · DOOM ENGINE</span></footer></main>`;
    const form = this.querySelector<HTMLFormElement>('#build-form')!;
    form.addEventListener('submit', event => void this.submit(event as SubmitEvent));
    form.addEventListener('input', () => this.saveSettings(form));
    form.addEventListener('change', () => this.saveSettings(form));
    void this.loadOptions();
  }

  private renderHistory() {
    const query = new URLSearchParams(location.hash.split('?')[1] ?? '');
    this.page = Math.max(1, Number(query.get('page')) || 1);
    this.innerHTML = `<main class="shell history-shell"><header><a class="brand home-link" href="#/"><span class="sigil">O</span><span><p class="eyebrow">OBSIDIAN LEVEL MAKER</p><h1>Level Forge</h1></span></a><a class="online" href="#/">← NEW RUN</a></header><section class="history-intro"><p class="eyebrow">RUN ARCHIVE</p><h2>Past runs</h2><p class="lede">Browse generated worlds and reuse any run's settings.</p></section><section class="history-panel"><div class="section-title"><span>02</span><h3>All runs</h3><span class="live">PAGE ${this.page}</span></div><div id="jobs" class="jobs"><div class="empty"><span>✳</span><p>Loading runs…</p></div></div><nav class="pagination" aria-label="Run history pages"><button type="button" data-page="previous" ${this.page <= 1 ? 'disabled' : ''}>← Previous</button><span>Page ${this.page}</span><button type="button" data-page="next">Next →</button></nav></section><footer><span>OBSIDIAN · PROCEDURAL WORLD GENERATOR</span><a href="#/">BACK TO BUILDER</a></footer></main>`;
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
      groups.innerHTML = Object.entries(this.reference).map(([name, options]) => `<details class="option-group" ${name === 'main_build_settings' ? 'open' : ''}><summary>${escapeHTML(name.replaceAll('_', ' '))}<span>${Object.keys(options).length} OPTIONS</span></summary><div class="option-fields">${Object.entries(options).map(([key, definition]) => optionFieldHTML(name, key, definition)).join('')}</div></details>`).join('');
      const settings = this.loadSettings();
      if (settings) this.applySettings(settings, false);
    } catch (error) {
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
      alert(error instanceof Error ? error.message : 'Could not queue build');
    } finally {
      button.disabled = false;
      button.innerHTML = '<span>Generate WAD</span><span>↗</span>';
    }
  }

  private async refresh() {
    const host = this.querySelector<HTMLElement>('#jobs');
    if (!host) return;
    try {
      const limit = this.isHistory() ? historyPageSize + 1 : recentLimit;
      const offset = this.isHistory() ? (this.page - 1) * historyPageSize : 0;
      const response = await fetch(`/api/jobs?limit=${limit}&offset=${offset}`);
      if (!response.ok) return;
      const returned = await response.json() as Job[];
      const hasNext = this.isHistory() && returned.length > historyPageSize;
      const jobs = this.isHistory() ? returned.slice(0, historyPageSize) : returned;
      this.renderJobs(host, jobs);
      if (this.isHistory()) {
        const next = this.querySelector<HTMLButtonElement>('[data-page="next"]');
        if (next) next.disabled = !hasNext;
      }
    } catch { /* The API may still be starting. */ }
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
        if (response.ok) {
          const log = await response.text();
          this.appendLog(job.id, log);
          cards.get(job.id)!.dataset.logLoaded = 'true';
        }
      } catch { /* Keep the most recent log text already displayed. */ }
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
    const card = document.createElement('article');
    card.className = 'job';
    card.dataset.jobId = job.id;
    card.innerHTML = `<div class="job-top"><span class="job-icon"></span><div class="job-info"><strong></strong><small></small></div><span class="status"></span></div><div class="progress"><i></i></div><div class="job-actions"><a class="download">Download WAD <span>↓</span></a><a class="play-test" target="_blank" rel="noopener">Play in UZDoom <span>↗</span></a></div><p class="error"></p><button class="reuse-settings" type="button">Reuse settings</button><details class="job-logs"><summary></summary><a class="full-log" target="_blank" rel="noopener">Open full log <span>↗</span></a><pre></pre></details>`;
    const details = card.querySelector<HTMLDetailsElement>('.job-logs')!;
    details.open = job.status === 'running' || job.status === 'failed';
    return card;
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
      const params = new URLSearchParams({ iwad, modurl: `/api/jobs/${encodeURIComponent(job.id)}/download`, warp: iwad === 'doom.wad' ? '1,1' : '1' });
      play.href = `/play/?${params.toString()}`;
    }
    const error = card.querySelector<HTMLElement>('.error')!;
    error.hidden = job.status !== 'failed';
    error.textContent = job.error || 'Build failed';
    const reuse = card.querySelector<HTMLButtonElement>('.reuse-settings')!;
    reuse.hidden = !job.settings;
    reuse.onclick = job.settings ? () => this.reuseSettings(job.settings!) : null;
    const details = card.querySelector<HTMLDetailsElement>('.job-logs')!;
    details.hidden = job.status === 'queued' || (job.status === 'completed' && card.dataset.hasLog !== 'true');
    details.querySelector('summary')!.textContent = job.status === 'running' ? 'Live generator log' : 'Generator log';
    details.querySelector<HTMLAnchorElement>('.full-log')!.href = `/api/jobs/${encodeURIComponent(job.id)}/log`;
    if ((job.status === 'running' || job.status === 'failed') && !this.logContents.has(job.id)) {
      details.querySelector('pre')!.textContent = job.status === 'running' ? 'Waiting for generator output…' : (job.error || 'No log output recorded');
    }
  }

  private appendLog(id:string, next:string) {
    if (!next) return;
    const card = Array.from(this.querySelectorAll<HTMLElement>('.job[data-job-id]')).find(item => item.dataset.jobId === id);
    if (!card) return;
    const pre = card.querySelector('pre')!;
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

  private reuseSettings(settings:JobSettings) {
    try { localStorage.setItem(lastSettingsKey, JSON.stringify(settings)); } catch { /* Storage can be unavailable. */ }
    if (this.isHistory()) location.hash = '#/';
    else this.applySettings(settings, true);
  }

  private saveSettings(form:HTMLFormElement) {
    try { localStorage.setItem(lastSettingsKey, JSON.stringify(jobPayload(new FormData(form)))); } catch { /* Storage can be unavailable. */ }
  }

  private loadSettings():JobSettings|undefined {
    try {
      const raw = localStorage.getItem(lastSettingsKey);
      if (!raw) return;
      const value = JSON.parse(raw) as JobSettings;
      if (typeof value.game === 'string' && typeof value.options === 'object' && value.options !== null) return value;
    } catch { /* Ignore malformed storage. */ }
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
