// Tiny helpers shared by the RidePass web pages (no framework, works on low-end Android browsers).
const ICONS = {
  logo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h2l2-6 4 12 3-9 2 3h3"/></svg>',
  mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v4M8 21h8"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>',
  logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36L21 8M21 3v5h-5"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>',
  alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/></svg>',
  key: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.8-9.8M17 6l3 3M15 8l2 2"/></svg>',
  ticket: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9a3 3 0 0 0 0 6v3a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3a3 3 0 0 1 0-6V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2z"/><path d="M13 5v2M13 17v2M13 11v2"/></svg>',
  inbox: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>',
  phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>',
  wallet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12V8H6a2 2 0 0 1 0-4h12v4"/><path d="M4 6v12a2 2 0 0 0 2 2h14v-4"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/></svg>',
  hash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/></svg>',
  cpu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/></svg>',
};

window.RP = {
  icon: (name) => ICONS[name] || '',
  async api(path, { method = 'GET', body, headers = {}, raw } = {}) {
    const h = { ...headers };
    if (body !== undefined && !raw) h['Content-Type'] = 'application/json';
    const res = await fetch(path, { method, headers: h, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined) });
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('json') ? await res.json() : await res.text();
    if (!res.ok) throw Object.assign(new Error((data && data.error) || res.statusText), { status: res.status });
    return data;
  },
  naira: (n) => '₦' + Math.round(Number(n) || 0).toLocaleString('en-NG'),
  esc: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  initials: (s) => String(s || '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase(),
  time: (iso) => { const d = iso ? new Date(iso) : new Date(); return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); },
  store: {
    get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch {} },
  },
  /** Show a short message at the bottom of the screen. */
  toast(text) {
    let t = document.getElementById('rp-toast');
    if (!t) { t = document.createElement('div'); t.id = 'rp-toast'; t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = text; t.classList.add('show');
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2600);
  },
  /** Run an async action with a spinner on the button; returns the action's result. */
  async busy(btn, fn) {
    if (btn.classList.contains('loading')) return;
    btn.classList.add('loading'); btn.disabled = true;
    try { return await fn(); } finally { btn.classList.remove('loading'); btn.disabled = false; }
  },
  /** Set a status line: kind = '' | 'ok' | 'bad' | 'warn'. Empty text hides it. */
  note(el, text, kind = '') { el.className = 'notice' + (kind ? ' ' + kind : ''); el.textContent = text || ''; },
  /** Press-to-record voice notes (MediaRecorder → webm/opus or mp4 on iOS). */
  recorder() {
    let rec, chunks = [], stream, ctx, timer;
    return {
      startedAt: 0,
      level: 0,     // current input level 0..1
      peak: 0,      // loudest level during this recording
      async start() {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg'].find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
        rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
        chunks = [];
        rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
        rec.start();
        this.startedAt = Date.now(); this.level = 0; this.peak = 0;
        // Level meter, so a muted or wrong microphone is obvious before anything is sent.
        try {
          ctx = new (window.AudioContext || window.webkitAudioContext)();
          const an = ctx.createAnalyser(); an.fftSize = 1024;
          ctx.createMediaStreamSource(stream).connect(an);
          const buf = new Float32Array(an.fftSize);
          timer = setInterval(() => {
            an.getFloatTimeDomainData(buf);
            let p = 0; for (const v of buf) p = Math.max(p, Math.abs(v));
            this.level = p; this.peak = Math.max(this.peak, p);
          }, 60);
        } catch { this.peak = 1; } // no Web Audio: don't block sending
      },
      stop() {
        clearInterval(timer); ctx?.close().catch(() => {}); ctx = null;
        return new Promise((resolve) => {
          if (!rec || rec.state === 'inactive') { stream?.getTracks().forEach((t) => t.stop()); return resolve(null); }
          rec.onstop = () => { stream.getTracks().forEach((t) => t.stop()); resolve(new Blob(chunks, { type: rec.mimeType || 'audio/webm' })); };
          rec.stop();
        });
      },
    };
  },
  /**
   * Wire a hold-to-record button. onBlob(blob, seconds) is called for notes ≥ 0.7 s.
   * Uses pointer events so touch + mouse never double-fire, and tolerates release before the mic is ready.
   */
  holdToRecord(btn, statusEl, onBlob, idleText) {
    const recorder = RP.recorder();
    let state = 'idle', released = false, clock;
    const setStatus = (text, live, level) => {
      statusEl.textContent = text; statusEl.classList.toggle('live', !!live);
      if (level != null) {
        const m = document.createElement('span'); m.className = 'lvl';
        m.innerHTML = `<i style="width:${Math.min(100, Math.round(level * 160))}%"></i>`;
        statusEl.appendChild(m);
      }
    };
    const finish = async () => {
      clearInterval(clock); btn.classList.remove('on'); state = 'idle';
      const blob = await recorder.stop();
      const secs = (Date.now() - recorder.startedAt) / 1000;
      setStatus(idleText);
      if (!blob || secs < 0.7) { if (blob) RP.toast('Hold the button while you speak'); return; }
      if (recorder.peak < 0.02) {
        setStatus('We could not hear you. Check your microphone is on, not muted, and is the one selected in your browser.');
        statusEl.classList.add('warn');
        return;
      }
      statusEl.classList.remove('warn');
      onBlob(blob, Math.max(1, Math.round(secs)));
    };
    btn.addEventListener('pointerdown', async (e) => {
      e.preventDefault(); if (state !== 'idle') return;
      state = 'starting'; released = false;
      try { btn.setPointerCapture?.(e.pointerId); } catch {}
      try { await recorder.start(); } catch { state = 'idle'; setStatus('Microphone permission is needed to record.', false); return; }
      state = 'recording'; btn.classList.add('on');
      statusEl.classList.remove('warn');
      const tick = () => setStatus('Recording… ' + Math.floor((Date.now() - recorder.startedAt) / 1000) + 's · release to send', true, recorder.level);
      tick(); clock = setInterval(tick, 250);
      if (released) finish();
    });
    const up = (e) => { e.preventDefault(); if (state === 'starting') released = true; else if (state === 'recording') finish(); };
    for (const ev of ['pointerup', 'pointercancel']) btn.addEventListener(ev, up);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
    setStatus(idleText);
  },
  /** Render a chat message (bot → left) with reply buttons. */
  bubble(container, msg, dir, onButton) {
    container.querySelector('.msg.typing')?.remove();
    const div = document.createElement('div');
    div.className = 'msg ' + dir;
    div.innerHTML = RP.esc(msg.text).replace(/\*(.+?)\*/g, '<b>$1</b>').replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
    if (msg.buttons && msg.buttons.length && onButton) {
      const b = document.createElement('div');
      b.className = 'btns';
      for (const btn of msg.buttons) {
        const el = document.createElement('button');
        el.textContent = btn.title;
        el.onclick = () => { b.querySelectorAll('button').forEach((x) => (x.disabled = true)); el.classList.add('picked'); onButton(btn); };
        b.appendChild(el);
      }
      div.appendChild(b);
    }
    const t = document.createElement('span');
    t.className = 't'; t.textContent = RP.time(msg.at);
    div.appendChild(t);
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  },
  /** Three-dot "RidePass is thinking" bubble; removed automatically by the next bubble(). */
  typing(container) {
    if (container.querySelector('.msg.typing')) return;
    const d = document.createElement('div'); d.className = 'msg in typing'; d.innerHTML = '<i></i><i></i><i></i>';
    container.appendChild(d); container.scrollTop = container.scrollHeight;
    clearTimeout(container._typing); container._typing = setTimeout(() => d.remove(), 20000);
  },
};
