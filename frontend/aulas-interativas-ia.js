(function initializeUnlimitedSalesPage() {
  'use strict';

  const PLAN_ID = 'pro-unlimited';
  const PLAN_VALUE = 97.90;
  const WHATSAPP_PHONE = '5571993615509';
  const DEMO_BASE = 'module-viewer.html?embedded=1&demoTemplates=';
  const campaignKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid'];
  const params = new URLSearchParams(window.location.search);

  const getCampaignQuery = () => {
    const next = new URLSearchParams();
    campaignKeys.forEach((key) => {
      const value = params.get(key);
      if (value) next.set(key, value);
    });
    return next;
  };

  document.querySelectorAll('.tracked-checkout').forEach((link) => {
    const checkoutUrl = new URL(link.getAttribute('href'), window.location.href);
    getCampaignQuery().forEach((value, key) => checkoutUrl.searchParams.set(key, value));
    link.href = checkoutUrl.toString();
    link.addEventListener('click', () => {
      const location = link.dataset.ctaLocation || 'unknown';
      window.CriatyveMeta?.track('InitiateCheckout', {
        content_name: 'Criatyve Pro Ilimitado',
        content_category: 'SaaS para professores',
        content_ids: [PLAN_ID],
        value: PLAN_VALUE,
        currency: 'BRL',
        cta_location: location
      }, { onceKey: `unlimited-checkout:${location}` });
      window.CriatyveMeta?.trackCustom('UnlimitedOfferCheckoutClick', {
        plan: PLAN_ID,
        value: PLAN_VALUE,
        currency: 'BRL',
        cta_location: location
      });
    });
  });

  const demoViewport = document.getElementById('demoViewport');
  const demoLoading = document.getElementById('demoLoading');
  const demoRetry = document.getElementById('demoRetry');
  const activeDemoName = document.getElementById('activeDemoName');
  const MINIMUM_LOADING_INDICATOR_MS = 650;
  let activeTemplate = '1tutorial-completo-do-interactive-creator';
  const initialDemoFrame = demoViewport?.querySelector('.demo-frame');
  if (initialDemoFrame) initialDemoFrame.dataset.loadStartedAt = String(Date.now());

  const setDemoLoading = (isLoading, message = 'Preparando a aula interativa...', canRetry = false) => {
    if (!demoLoading) return;
    demoLoading.hidden = !isLoading;
    const title = demoLoading.querySelector('strong');
    if (title) title.textContent = message;
    if (demoRetry) demoRetry.hidden = !isLoading || !canRetry;
  };

  const getDemoUrl = (template, retryAttempt = 0) => {
    const cacheKey = retryAttempt > 0 ? `&retry=${Date.now()}` : '';
    return `${DEMO_BASE}${encodeURIComponent(template)}${cacheKey}`;
  };

  const reloadDemoFrame = (frame, template, demoName, retryAttempt = 0) => {
    frame.dataset.ready = 'false';
    frame.dataset.error = 'false';
    frame.dataset.retryAttempt = String(retryAttempt);
    frame.dataset.loadStartedAt = String(Date.now());
    frame.title = `${demoName} criado no Criatyve`;
    frame.src = getDemoUrl(template, retryAttempt);
  };

  const getOrCreateDemoFrame = (template, demoName) => {
    let frame = demoViewport?.querySelector(`.demo-frame[data-template="${template}"]`);
    if (frame) return frame;
    frame = document.createElement('iframe');
    frame.className = 'demo-frame';
    frame.dataset.template = template;
    frame.title = `${demoName} criado no Criatyve`;
    frame.loading = 'lazy';
    frame.allow = 'fullscreen';
    reloadDemoFrame(frame, template, demoName);
    demoViewport?.appendChild(frame);
    return frame;
  };

  const showDemo = (template, demoName) => {
    const frame = getOrCreateDemoFrame(template, demoName);
    activeTemplate = template;
    demoViewport?.querySelectorAll('.demo-frame').forEach((item) => {
      item.classList.toggle('active', item === frame);
    });
    const hasError = frame.dataset.error === 'true';
    setDemoLoading(frame.dataset.ready !== 'true', hasError
      ? 'Não foi possível abrir este exemplo.'
      : 'Preparando a aula interativa...', hasError);
  };

  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin || event.data?.source !== 'criatyve-module-viewer') return;
    const template = String(event.data.templateKey || '');
    const frame = demoViewport?.querySelector(`.demo-frame[data-template="${template}"]`);
    if (!frame) return;
    if (event.data.type === 'demo-ready') {
      frame.dataset.ready = 'true';
      frame.dataset.error = 'false';
      const elapsed = Date.now() - Number(frame.dataset.loadStartedAt || 0);
      const remaining = Math.max(0, MINIMUM_LOADING_INDICATOR_MS - elapsed);
      window.setTimeout(() => {
        if (template === activeTemplate) setDemoLoading(false);
      }, remaining);
    } else if (event.data.type === 'demo-error') {
      const retryAttempt = Number(frame.dataset.retryAttempt || 0);
      if (retryAttempt < 1) {
        reloadDemoFrame(frame, template, frame.title.replace(' criado no Criatyve', ''), retryAttempt + 1);
        if (template === activeTemplate) setDemoLoading(true, 'Reconectando ao exemplo...');
        return;
      }
      frame.dataset.error = 'true';
      if (template === activeTemplate) setDemoLoading(true, 'Não foi possível abrir este exemplo.', true);
    }
  });

  demoRetry?.addEventListener('click', () => {
    const frame = demoViewport?.querySelector(`.demo-frame[data-template="${activeTemplate}"]`);
    if (!frame) return;
    reloadDemoFrame(frame, activeTemplate, activeDemoName?.textContent || 'Exemplo interativo', 0);
    setDemoLoading(true, 'Preparando a aula interativa...');
  });

  document.querySelectorAll('.demo-tab').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.demo-tab').forEach((item) => {
        const isActive = item === button;
        item.classList.toggle('active', isActive);
        item.setAttribute('aria-selected', String(isActive));
      });
      const template = button.dataset.template;
      const demoName = button.dataset.demoName || 'Exemplo interativo';
      showDemo(template, demoName);
      activeDemoName.textContent = demoName;
      window.CriatyveMeta?.trackCustom('EmbeddedDemoSelect', {
        demo_name: demoName,
        template_key: template,
        plan: PLAN_ID
      });
    });
  });

  const demoShell = document.querySelector('.demo-frame-shell');
  if (demoShell && 'IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting && entry.intersectionRatio >= 0.35)) return;
      window.CriatyveMeta?.trackCustom('EmbeddedDemoView', {
        demo_name: activeDemoName?.textContent || 'Tutorial interativo',
        plan: PLAN_ID
      }, { onceKey: 'unlimited-embedded-demo-view' });
      observer.disconnect();
    }, { threshold: [0.35] });
    observer.observe(demoShell);
  }

  document.querySelector('.tracked-demo-link')?.addEventListener('click', () => {
    window.CriatyveMeta?.trackCustom('SalesPageDemoClick', { plan: PLAN_ID });
  });

  const whatsappLink = document.getElementById('whatsappLink');
  if (whatsappLink) {
    const message = 'Olá, vi a oferta do Criatyve Pro Ilimitado e quero tirar uma dúvida.';
    whatsappLink.href = `https://wa.me/${WHATSAPP_PHONE}?text=${encodeURIComponent(message)}`;
    whatsappLink.addEventListener('click', () => {
      window.CriatyveMeta?.track('Contact', {
        content_name: 'Criatyve Pro Ilimitado',
        contact_method: 'whatsapp',
        plan: PLAN_ID
      }, { onceKey: 'unlimited-whatsapp-contact' });
    });
  }

  const initCreatorDemoPlayer = () => {
    const player = document.querySelector('.preview-player[data-analytics-video]');
    const video = player?.querySelector('video');
    if (!player || !video) return;

    const videoId = player.dataset.analyticsVideo || 'creator-demo';
    const playButtons = player.querySelectorAll('[data-video-action="toggle-play"]');
    const playIcon = player.querySelector('.preview-control[data-video-action="toggle-play"] i');
    const bigPlayIcon = player.querySelector('.preview-big-play i');
    const muteButton = player.querySelector('[data-video-action="toggle-mute"]');
    const muteIcon = muteButton?.querySelector('i');
    const seek = player.querySelector('.preview-seek');
    const progress = player.querySelector('.preview-progress');
    const buffered = player.querySelector('.preview-buffered');
    const time = player.querySelector('.preview-time');
    const volume = player.querySelector('.preview-volume-range');
    const settingsButton = player.querySelector('[data-video-action="toggle-settings"]');
    const settingsMenu = player.querySelector('.preview-settings-menu');
    const rateButtons = player.querySelectorAll('[data-playback-rate]');
    const duration = () => Number.isFinite(video.duration) ? video.duration : 0;
    const formatTime = (value) => {
      const seconds = Math.max(0, Math.floor(Number(value) || 0));
      return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    };
    let started = false;
    let watchedSeconds = 0;
    let lastPosition = 0;
    let lastProgressSample = 0;
    let idleTimer = null;
    let seeking = false;
    let lastExitKey = '';
    const progressMilestones = new Set();

    const metadata = (extra = {}) => {
      const total = duration();
      const position = Math.min(total || Number.MAX_SAFE_INTEGER, Math.max(0, video.currentTime || 0));
      return {
        video_id: videoId,
        video_title: 'Demonstração do Criatyve',
        position_seconds: Math.round(position),
        duration_seconds: Math.round(total),
        watched_seconds: Math.round(watchedSeconds),
        percent_watched: total ? Math.min(100, Math.round((position / total) * 100)) : 0,
        playback_rate: Number(video.playbackRate || 1),
        ...extra
      };
    };
    const track = (eventName, extra = {}) => {
      const analytics = window.CriatyveAnalytics;
      if (typeof analytics?.trackVideo === 'function') return analytics.trackVideo(eventName, metadata(extra));
      return analytics?.track?.(eventName, metadata(extra));
    };
    const syncIcons = () => {
      const isPaused = video.paused || video.ended;
      playButtons.forEach((button) => button.setAttribute('aria-label', isPaused ? 'Reproduzir' : 'Pausar'));
      [playIcon, bigPlayIcon].forEach((icon) => {
        if (!icon) return;
        icon.className = isPaused ? 'bi bi-play-fill' : 'bi bi-pause-fill';
      });
      if (muteIcon) muteIcon.className = video.muted || video.volume === 0 ? 'bi bi-volume-mute-fill' : 'bi bi-volume-up-fill';
      if (muteButton) muteButton.setAttribute('aria-label', video.muted || video.volume === 0 ? 'Ativar som' : 'Silenciar');
      player.classList.toggle('is-playing', !isPaused);
    };
    const updateTimeline = () => {
      const total = duration();
      const position = Math.max(0, video.currentTime || 0);
      const ratio = total ? Math.min(1, position / total) : 0;
      if (seek && !seeking) seek.value = String(Math.round(ratio * 1000));
      if (progress) progress.style.width = `${ratio * 100}%`;
      if (time) time.textContent = `${formatTime(position)} / ${formatTime(total)}`;
      if (buffered && total && video.buffered.length) {
        buffered.style.width = `${Math.min(1, video.buffered.end(video.buffered.length - 1) / total) * 100}%`;
      }
    };
    const showControls = () => {
      player.classList.remove('is-idle');
      window.clearTimeout(idleTimer);
      if (!video.paused && !settingsMenu?.matches(':not([hidden])')) {
        idleTimer = window.setTimeout(() => player.classList.add('is-idle'), 2400);
      }
    };
    const addWatchDelta = () => {
      const position = video.currentTime || 0;
      const delta = position - lastPosition;
      if (!video.paused && delta > 0 && delta < 3.5) watchedSeconds += delta;
      lastPosition = position;
    };
    const trackExit = (reason) => {
      if (!started) return;
      addWatchDelta();
      const key = `${reason}:${Math.round(video.currentTime || 0)}:${Math.round(watchedSeconds)}`;
      if (key === lastExitKey) return;
      lastExitKey = key;
      track('video_exit', { exit_reason: reason });
      window.CriatyveAnalytics?.flush(true);
    };
    const toggleSettings = (force = null) => {
      if (!settingsMenu || !settingsButton) return;
      const next = force == null ? settingsMenu.hidden : Boolean(force);
      settingsMenu.hidden = !next;
      settingsButton.setAttribute('aria-expanded', String(next));
      if (next) player.classList.remove('is-idle');
    };
    const play = async () => {
      try {
        await video.play();
      } catch (error) {
        player.classList.remove('is-idle');
      }
    };

    playButtons.forEach((button) => button.addEventListener('click', () => (video.paused || video.ended ? play() : video.pause())));
    video.addEventListener('click', () => (video.paused || video.ended ? play() : video.pause()));
    player.addEventListener('pointermove', showControls, { passive: true });
    player.addEventListener('pointerleave', () => { if (!video.paused) idleTimer = window.setTimeout(() => player.classList.add('is-idle'), 600); }, { passive: true });
    player.addEventListener('focusin', showControls);
    video.addEventListener('loadedmetadata', () => { lastPosition = video.currentTime || 0; updateTimeline(); });
    video.addEventListener('play', () => {
      const wasStarted = started;
      started = true;
      lastPosition = video.currentTime || 0;
      track(wasStarted ? 'video_resume' : 'video_start');
      syncIcons();
      showControls();
    });
    video.addEventListener('playing', () => {
      syncIcons();
      showControls();
    });
    video.addEventListener('pause', () => {
      addWatchDelta();
      if (started && !video.ended) track('video_pause');
      syncIcons();
      player.classList.remove('is-idle');
      window.clearTimeout(idleTimer);
    });
    video.addEventListener('timeupdate', () => {
      addWatchDelta();
      updateTimeline();
      const total = duration();
      const percent = total ? (video.currentTime / total) * 100 : 0;
      [10, 25, 50, 75, 90].forEach((milestone) => {
        if (percent >= milestone && !progressMilestones.has(milestone)) {
          progressMilestones.add(milestone);
          track('video_progress', { milestone_percent: milestone });
        }
      });
      if (started && Date.now() - lastProgressSample > 20000) {
        lastProgressSample = Date.now();
        track('video_progress', { milestone_percent: Math.floor(percent / 5) * 5 });
      }
    });
    video.addEventListener('progress', updateTimeline);
    video.addEventListener('ended', () => {
      addWatchDelta();
      track('video_complete', { milestone_percent: 100 });
      syncIcons();
      player.classList.remove('is-idle');
    });
    seek?.addEventListener('input', () => {
      seeking = true;
      const total = duration();
      const target = total * (Number(seek.value) / 1000);
      if (progress) progress.style.width = `${(Number(seek.value) / 10)}%`;
      if (time) time.textContent = `${formatTime(target)} / ${formatTime(total)}`;
    });
    seek?.addEventListener('change', () => {
      const total = duration();
      const from = video.currentTime || 0;
      const to = total * (Number(seek.value) / 1000);
      video.currentTime = to;
      lastPosition = to;
      seeking = false;
      updateTimeline();
      track('video_seek', { from_seconds: Math.round(from), to_seconds: Math.round(to), seek_direction: to >= from ? 'forward' : 'backward' });
    });
    volume?.addEventListener('input', () => {
      video.volume = Number(volume.value);
      video.muted = video.volume === 0;
    });
    video.addEventListener('volumechange', () => {
      if (volume) volume.value = String(video.muted ? 0 : video.volume);
      syncIcons();
      if (started) track('video_volume_change', { volume_percent: Math.round((video.muted ? 0 : video.volume) * 100), muted: video.muted });
    });
    muteButton?.addEventListener('click', () => {
      video.muted = !video.muted;
      if (!video.muted && video.volume === 0) video.volume = .7;
    });
    player.querySelector('[data-video-action="rewind"]')?.addEventListener('click', () => {
      const from = video.currentTime || 0;
      video.currentTime = Math.max(0, from - 10);
      lastPosition = video.currentTime;
      track('video_seek', { from_seconds: Math.round(from), to_seconds: Math.round(video.currentTime), seek_direction: 'backward', seek_action: 'rewind_10' });
    });
    player.querySelector('[data-video-action="forward"]')?.addEventListener('click', () => {
      const from = video.currentTime || 0;
      video.currentTime = Math.min(duration(), from + 10);
      lastPosition = video.currentTime;
      track('video_seek', { from_seconds: Math.round(from), to_seconds: Math.round(video.currentTime), seek_direction: 'forward', seek_action: 'forward_10' });
    });
    settingsButton?.addEventListener('click', () => toggleSettings());
    rateButtons.forEach((button) => button.addEventListener('click', () => {
      const rate = Number(button.dataset.playbackRate);
      if (!Number.isFinite(rate)) return;
      video.playbackRate = rate;
      rateButtons.forEach((item) => item.classList.toggle('is-active', item === button));
      toggleSettings(false);
      track('video_speed_change', { playback_rate: rate });
    }));
    player.querySelector('[data-video-action="fullscreen"]')?.addEventListener('click', async () => {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await player.requestFullscreen();
        track('video_fullscreen', { fullscreen: Boolean(document.fullscreenElement) });
      } catch (error) {
        // Fullscreen is optional and can be restricted by the browser.
      }
    });
    player.querySelector('[data-video-action="pip"]')?.addEventListener('click', async () => {
      try {
        if (document.pictureInPictureElement) await document.exitPictureInPicture();
        else if (document.pictureInPictureEnabled) await video.requestPictureInPicture();
      } catch (error) {
        // Picture-in-picture is optional and can be unavailable in some browsers.
      }
    });
    document.addEventListener('click', (event) => { if (!event.target.closest('.preview-settings')) toggleSettings(false); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') trackExit('page_hidden'); });
    window.addEventListener('pagehide', () => trackExit('page_exit'));
    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver((entries) => {
        if (!entries.some((entry) => entry.isIntersecting && entry.intersectionRatio >= .65)) return;
        track('video_impression', { visible_ratio: 65 });
        observer.disconnect();
      }, { threshold: [.65] });
      observer.observe(player);
    } else {
      track('video_impression', { visible_ratio: 100 });
    }
    rateButtons.forEach((button) => button.classList.toggle('is-active', Number(button.dataset.playbackRate) === 1));
    syncIcons();
    updateTimeline();
  };

  initCreatorDemoPlayer();

  window.CriatyveMeta?.track('ViewContent', {
    content_name: 'Criatyve Pro Ilimitado',
    content_category: 'Landing Page SaaS para professores',
    content_ids: [PLAN_ID],
    value: PLAN_VALUE,
    currency: 'BRL'
  }, { onceKey: 'unlimited-sales-view-content' });
  window.CriatyveMeta?.trackCustom('UnlimitedSalesPageView', {
    plan: PLAN_ID,
    offer: 'unlimited_students',
    value: PLAN_VALUE,
    currency: 'BRL'
  }, { onceKey: 'unlimited-sales-page-view' });
})();
