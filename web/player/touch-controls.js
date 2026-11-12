// Touch-only virtual controls for the bundled UZDoom browser player.
(function (root) {
  'use strict';

  const SETTINGS_KEY = 'obsidian-web:global-options:v1';
  const LEGACY_SETTINGS_KEY = 'obsidian-web:player-preview:v1';
  const DEFAULTS = { size: 1, opacity: 0.58 };

  function hasCoarsePointer(windowRef) {
    return Boolean(windowRef.matchMedia?.('(pointer: coarse)').matches);
  }

  function readOptions(windowRef) {
    try {
      return JSON.parse(windowRef.localStorage.getItem(SETTINGS_KEY) || 'null') || {};
    } catch (_) {
      return {};
    }
  }

  function controlsEnabled(windowRef) {
    const mode = readOptions(windowRef).touchControls;
    if (mode === 'on') return true;
    if (mode === 'off') return false;
    return hasCoarsePointer(windowRef);
  }

  function readSettings(windowRef) {
    try {
      const saved = readOptions(windowRef);
      const legacy = JSON.parse(windowRef.localStorage.getItem(LEGACY_SETTINGS_KEY) || 'null') || {};
      return {
        size: Number.isFinite(saved.size) ? Math.min(1.35, Math.max(0.75, saved.size))
          : Number.isFinite(legacy.size) ? Math.min(1.35, Math.max(0.75, legacy.size)) : DEFAULTS.size,
        opacity: Number.isFinite(saved.opacity) ? Math.min(0.9, Math.max(0.25, saved.opacity))
          : Number.isFinite(legacy.opacity) ? Math.min(0.9, Math.max(0.25, legacy.opacity)) : DEFAULTS.opacity,
      };
    } catch (_) {
      return { ...DEFAULTS };
    }
  }

  function install({ windowRef = root.window, documentRef = root.document, canvas } = {}) {
    if (!windowRef || !documentRef || !controlsEnabled(windowRef) || !canvas) return null;

    const settings = readSettings(windowRef);
    const iwad = new URLSearchParams(windowRef.location?.search || '').get('iwad');
    const hasInventory = iwad === 'heretic.wad' || iwad === 'hexen.wad';
    const heldKeys = new Set();
    const element = documentRef.createElement('div');
    element.className = 'obsidian-touch-controls';
    element.setAttribute('aria-label', 'Touch game controls');
    element.innerHTML = `
      <button class="touch-settings-toggle" type="button" aria-label="Touch control settings" aria-expanded="false">⚙</button>
      <section class="touch-settings" hidden aria-label="Touch control settings">
        <label>Stick size <input data-setting="size" type="range" min="0.75" max="1.35" step="0.05"></label>
        <label>Control opacity <input data-setting="opacity" type="range" min="0.25" max="0.9" step="0.05"></label>
      </section>
      <div class="touch-stick touch-left" role="application" aria-label="Move stick"><span class="touch-thumb"></span></div>
      <div class="touch-stick touch-right" role="application" aria-label="Turn and look stick"><span class="touch-thumb"></span></div>
      <div class="touch-actions">
        <button type="button" data-key="ControlLeft" aria-label="Fire">FIRE</button>
        <button type="button" data-key="Space" aria-label="Use">USE</button>
        <button type="button" data-key="ShiftLeft" aria-label="Run">RUN</button>
      </div>
      <div class="touch-inventory" role="group" ${hasInventory ? '' : 'hidden'} aria-label="Inventory controls">
        <button type="button" data-key="BracketLeft" aria-label="Previous inventory item">ITEM ◀</button>
        <button type="button" data-key="Enter" aria-label="Use inventory item">USE ITEM</button>
        <button type="button" data-key="BracketRight" aria-label="Next inventory item">ITEM ▶</button>
      </div>`;
    const style = documentRef.createElement('style');
    style.textContent = `
      .obsidian-touch-controls{--touch-scale:${settings.size};--touch-opacity:${settings.opacity};position:fixed;inset:0;z-index:2147483000;pointer-events:none;opacity:0;visibility:hidden;transition:opacity .15s ease;font:600 11px system-ui,sans-serif;color:white;user-select:none;-webkit-user-select:none}
      .obsidian-touch-controls.active{opacity:1;visibility:visible}
      .obsidian-touch-controls *{box-sizing:border-box}
      .touch-stick{position:absolute;bottom:max(22px,env(safe-area-inset-bottom));width:calc(136px * var(--touch-scale));height:calc(136px * var(--touch-scale));border-radius:50%;background:rgba(15,20,25,var(--touch-opacity));border:2px solid rgba(255,255,255,.46);box-shadow:0 3px 14px #0008;touch-action:none;pointer-events:auto;display:grid;place-items:center}
      .touch-left{left:max(20px,env(safe-area-inset-left))}.touch-right{right:max(20px,env(safe-area-inset-right))}
      .touch-stick:before{content:'';position:absolute;width:38%;height:38%;border:1px solid #ffffff4f;border-radius:50%}
      .touch-thumb{position:absolute;width:42%;height:42%;border-radius:50%;background:#d7e4c6b8;border:1px solid #fff9;box-shadow:0 2px 6px #0008;transform:translate(0,0)}
      .touch-actions{position:absolute;right:max(24px,env(safe-area-inset-right));bottom:calc(max(22px,env(safe-area-inset-bottom)) + 152px * var(--touch-scale));display:flex;gap:9px;pointer-events:auto}
      .touch-inventory{position:absolute;right:max(24px,env(safe-area-inset-right));bottom:calc(max(22px,env(safe-area-inset-bottom)) + 216px * var(--touch-scale));display:flex;gap:6px;pointer-events:auto}
      .touch-actions button,.touch-settings-toggle{border:1px solid #ffffff8c;background:rgba(15,20,25,var(--touch-opacity));color:#fff;border-radius:999px;touch-action:none;pointer-events:auto;box-shadow:0 2px 8px #0008;font:700 10px system-ui,sans-serif}
      .touch-actions button{width:54px;height:54px}.touch-actions button:first-child{width:62px;height:62px;margin-top:-13px;background:rgba(116,47,36,var(--touch-opacity))}
      .touch-inventory button{min-width:48px;height:38px;padding:0 9px;border:1px solid #ffffff8c;border-radius:20px;background:rgba(15,20,25,var(--touch-opacity));color:#fff;touch-action:none;pointer-events:auto;box-shadow:0 2px 8px #0008;font:700 9px system-ui,sans-serif}
      .touch-settings-toggle{position:absolute;right:max(18px,env(safe-area-inset-right));top:max(18px,env(safe-area-inset-top));width:38px;height:38px;font-size:19px}
      .touch-settings{position:absolute;right:max(18px,env(safe-area-inset-right));top:64px;width:210px;padding:12px;border:1px solid #ffffff60;border-radius:9px;background:#101419ed;pointer-events:auto}
      .touch-settings label{display:grid;gap:7px;margin:0 0 10px;font-size:11px}.touch-settings label:last-child{margin:0}.touch-settings input{width:100%;accent-color:#aaca79}
      @media (orientation:landscape) and (max-height:500px){.touch-stick{width:calc(112px * var(--touch-scale));height:calc(112px * var(--touch-scale));bottom:max(12px,env(safe-area-inset-bottom))}.touch-actions{bottom:calc(max(12px,env(safe-area-inset-bottom)) + 124px * var(--touch-scale))}.touch-inventory{bottom:calc(max(12px,env(safe-area-inset-bottom)) + 184px * var(--touch-scale))}}
    `;
    documentRef.head.appendChild(style);
    documentRef.body.appendChild(element);

    function sendKey(code, down) {
      if (down === heldKeys.has(code)) return;
      if (down) heldKeys.add(code); else heldKeys.delete(code);
      const key = code.startsWith('Key') ? code.slice(3).toLowerCase()
        : code.startsWith('Arrow') ? code.slice(5)
          : code === 'ControlLeft' ? 'Control' : code === 'ShiftLeft' ? 'Shift'
            : code === 'Space' ? ' ' : code === 'PageUp' ? 'PageUp'
              : code === 'BracketLeft' ? '[' : code === 'BracketRight' ? ']'
                : code === 'Enter' ? 'Enter' : 'PageDown';
      canvas.dispatchEvent(new windowRef.KeyboardEvent(down ? 'keydown' : 'keyup', {
        key, code, bubbles: true, cancelable: true,
      }));
    }

    function releaseAll() {
      for (const code of [...heldKeys]) sendKey(code, false);
    }

    const keyForAxis = (value, negative, positive) =>
      Math.abs(value) < 0.34 ? [] : [value < 0 ? negative : positive];

    function wireStick(stick, mapping) {
      let pointerId = null;
      const thumb = stick.querySelector('.touch-thumb');
      let active = [];
      function update(event) {
        const bounds = stick.getBoundingClientRect();
        const radius = Math.min(bounds.width, bounds.height) * 0.36;
        const dx = (event.clientX - (bounds.left + bounds.width / 2)) / radius;
        const dy = (event.clientY - (bounds.top + bounds.height / 2)) / radius;
        const length = Math.max(1, Math.hypot(dx, dy));
        const x = dx / length;
        const y = dy / length;
        thumb.style.transform = `translate(${x * radius * 0.75}px,${y * radius * 0.75}px)`;
        const next = [...keyForAxis(x, mapping.left, mapping.right), ...keyForAxis(y, mapping.up, mapping.down)];
        for (const key of active) if (!next.includes(key)) sendKey(key, false);
        for (const key of next) if (!active.includes(key)) sendKey(key, true);
        active = next;
      }
      stick.addEventListener('pointerdown', (event) => {
        event.preventDefault(); event.stopPropagation();
        pointerId = event.pointerId;
        try { stick.setPointerCapture(pointerId); } catch (_) { /* Synthetic events and older browsers. */ }
        update(event);
      });
      stick.addEventListener('pointermove', (event) => {
        if (event.pointerId !== pointerId) return;
        event.preventDefault(); event.stopPropagation(); update(event);
      });
      const end = (event) => {
        if (pointerId === null || event.pointerId !== pointerId) return;
        event.preventDefault(); event.stopPropagation();
        pointerId = null;
        try { stick.releasePointerCapture(event.pointerId); } catch (_) { /* No active capture. */ }
        for (const key of active) sendKey(key, false);
        active = [];
        thumb.style.transform = 'translate(0,0)';
      };
      stick.addEventListener('pointerup', end);
      stick.addEventListener('pointercancel', end);
    }

    wireStick(element.querySelector('.touch-left'), {
      up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD',
    });
    wireStick(element.querySelector('.touch-right'), {
      up: 'PageUp', down: 'PageDown', left: 'ArrowLeft', right: 'ArrowRight',
    });
    element.querySelectorAll('.touch-actions button, .touch-inventory button').forEach((button) => {
      const code = button.dataset.key;
      const down = (event) => { event.preventDefault(); event.stopPropagation(); sendKey(code, true); };
      const up = (event) => { event.preventDefault(); event.stopPropagation(); sendKey(code, false); };
      button.addEventListener('pointerdown', down);
      button.addEventListener('pointerup', up);
      button.addEventListener('pointercancel', up);
      button.addEventListener('lostpointercapture', up);
    });

    const settingsButton = element.querySelector('.touch-settings-toggle');
    const settingsPanel = element.querySelector('.touch-settings');
    settingsButton.addEventListener('click', () => {
      settingsPanel.hidden = !settingsPanel.hidden;
      settingsButton.setAttribute('aria-expanded', String(!settingsPanel.hidden));
    });
    element.querySelectorAll('[data-setting]').forEach((input) => {
      input.value = String(settings[input.dataset.setting]);
      input.addEventListener('input', () => {
        settings[input.dataset.setting] = Number(input.value);
        element.style.setProperty('--touch-scale', String(settings.size));
        element.style.setProperty('--touch-opacity', String(settings.opacity));
        try {
          const options = readOptions(windowRef);
          windowRef.localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...options, ...settings }));
        } catch (_) { /* Storage can be disabled. */ }
      });
    });
    windowRef.addEventListener('blur', releaseAll);
    documentRef.addEventListener('visibilitychange', () => {
      if (documentRef.hidden) releaseAll();
    });

    return {
      element,
      show() { element.classList.add('active'); },
      hide() { element.classList.remove('active'); releaseAll(); },
      dispose() { releaseAll(); element.remove(); style.remove(); },
    };
  }

  root.ObsidianTouchControls = { hasCoarsePointer, controlsEnabled, install, settingsKey: SETTINGS_KEY };
})(globalThis);
