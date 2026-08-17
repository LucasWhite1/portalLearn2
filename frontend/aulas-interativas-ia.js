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

  const demoFrame = document.getElementById('demoFrame');
  const activeDemoName = document.getElementById('activeDemoName');
  document.querySelectorAll('.demo-tab').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.demo-tab').forEach((item) => {
        const isActive = item === button;
        item.classList.toggle('active', isActive);
        item.setAttribute('aria-selected', String(isActive));
      });
      const template = button.dataset.template;
      const demoName = button.dataset.demoName || 'Exemplo interativo';
      demoFrame.src = `${DEMO_BASE}${encodeURIComponent(template)}`;
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
