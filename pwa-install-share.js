(function () {
  'use strict';

  let installPrompt = null;

  function emitMessage(message, type) {
    window.dispatchEvent(new CustomEvent('ideakdc:pwa-message', { detail: { message, type: type || '' } }));
  }

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  function isIos() {
    return /iphone|ipad|ipod/i.test(window.navigator.userAgent || '');
  }

  async function install() {
    if (isStandalone()) {
      emitMessage('IdeaKDC is already saved on this device.', 'success');
      return { installed: true };
    }
    if (installPrompt) {
      installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice?.outcome === 'accepted') installPrompt = null;
      return { installed: choice?.outcome === 'accepted' };
    }
    const message = isIos()
      ? 'Safari Share menu खोलें, फिर “Add to Home Screen” चुनें।'
      : 'Browser menu खोलें और “Install app” या “Add to Home screen” चुनें।';
    emitMessage(message);
    return { installed: false, instructions: true };
  }

  function safeShareUrl(details) {
    const url = new URL('/', window.location.origin);
    const kind = String(details?.kind || 'page');
    if (details?.courseId) url.searchParams.set('courseId', String(details.courseId));
    if (details?.lessonId) url.searchParams.set('lessonId', String(details.lessonId));
    if (details?.liveSessionId) url.searchParams.set('liveSessionId', String(details.liveSessionId));
    if (kind === 'live') url.searchParams.set('view', 'live');
    return url.toString();
  }

  async function share(details) {
    const title = String(details?.title || 'IdeaKDC Learning');
    const kind = String(details?.kind || 'lesson');
    const label = kind === 'live' ? 'live class' : kind === 'course' ? 'course' : 'lesson';
    const data = {
      title,
      text: `${title} - IdeaKDC ${label}`,
      url: safeShareUrl(details)
    };
    try {
      if (navigator.share) {
        await navigator.share(data);
        return { shared: true, url: data.url };
      }
      await navigator.clipboard.writeText(data.url);
      emitMessage('Share link copied.', 'success');
      return { shared: true, copied: true, url: data.url };
    } catch (error) {
      if (error?.name === 'AbortError') return { shared: false, cancelled: true };
      try {
        const input = document.createElement('textarea');
        input.value = data.url;
        input.setAttribute('readonly', '');
        input.style.position = 'fixed';
        input.style.opacity = '0';
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        input.remove();
        emitMessage('Share link copied.', 'success');
        return { shared: true, copied: true, url: data.url };
      } catch (_) {
        emitMessage('Share link could not be copied.', 'error');
        return { shared: false, error: true, url: data.url };
      }
    }
  }

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installPrompt = event;
    document.querySelectorAll('[data-pwa-install]').forEach(button => button.classList.add('is-ready'));
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    emitMessage('IdeaKDC saved to your home screen.', 'success');
  });
  window.addEventListener('DOMContentLoaded', () => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/service-worker.js').catch(error => {
        console.warn('[IdeaKDC PWA] service worker registration skipped.', error?.message || error);
      });
    }
  });

  window.IdeaKDCPwa = Object.freeze({ install, share, safeShareUrl, isStandalone });
})();
