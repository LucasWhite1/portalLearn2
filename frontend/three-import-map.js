(() => {
  const isLocalHost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  const usesSeparateLocalFrontend = window.location.protocol === 'file:'
    || (isLocalHost && /^55\d{2}$/.test(window.location.port));
  const vendorOrigin = usesSeparateLocalFrontend
    ? `http://${window.location.hostname || 'localhost'}:4000`
    : '';

  window.__THREE_VENDOR_ORIGIN__ = vendorOrigin;

  const importMap = document.createElement('script');
  importMap.type = 'importmap';
  importMap.textContent = JSON.stringify({
    imports: {
      three: `${vendorOrigin}/vendor/three/build/three.module.js`,
      'three/addons/': `${vendorOrigin}/vendor/three/examples/jsm/`
    }
  });
  document.head.appendChild(importMap);
})();
