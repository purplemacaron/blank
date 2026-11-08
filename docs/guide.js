(function () {
  'use strict';

  var cfg = Object.assign({ repo: '', version: '1.5.0' }, window.BLANK_SITE || {});
  var repo = String(cfg.repo || '').trim();
  var repoUrl = repo ? 'https://github.com/' + repo : '';
  var releasesUrl = repoUrl ? repoUrl + '/releases' : '';
  var latestUrl = repoUrl ? repoUrl + '/releases/latest' : '';
  var OSES = ['windows', 'mac', 'linux'];

  var state = {
    release: null,
    assets: null,
    os: 'windows',
    detected: detectOS(),
    arch: detectArchSync(),
    explicitArch: Boolean(queryArch()),
    status: 'loading',
    error: ''
  };
  state.os = queryOS() || (state.detected === 'other' ? 'windows' : state.detected);

  function t(key, vars) {
    var api = window.BLANK_SITE_I18N;
    if (api && typeof api.t === 'function') return api.t(key, vars);
    return '';
  }

  function queryOS() {
    var value = '';
    try { value = String(new URLSearchParams(location.search).get('os') || '').toLowerCase(); } catch (error) { /* older browser */ }
    if (value === 'windows' || value === 'win') return 'windows';
    if (value === 'mac' || value === 'macos' || value === 'darwin') return 'mac';
    if (value === 'linux') return 'linux';
    return '';
  }

  function queryArch() {
    var value = '';
    try { value = String(new URLSearchParams(location.search).get('arch') || '').toLowerCase(); } catch (error) { /* older browser */ }
    if (/(arm|aarch|silicon)/.test(value)) return 'arm64';
    if (/(x64|x86|intel)/.test(value)) return 'x64';
    return '';
  }

  function detectOS() {
    var ua = navigator.userAgent || '';
    if (/Android/i.test(ua)) return 'other';
    if (/Windows/i.test(ua)) return 'windows';
    if (/Macintosh|Mac OS X/i.test(ua)) return 'mac';
    if (/Linux|X11/i.test(ua)) return 'linux';
    return 'other';
  }

  function detectArchSync() {
    if (queryArch()) return queryArch();
    return /arm64|aarch64/i.test(navigator.userAgent) ? 'arm64' : 'x64';
  }

  function detectArch() {
    var uaData = navigator.userAgentData;
    if (uaData && typeof uaData.getHighEntropyValues === 'function') {
      return uaData.getHighEntropyValues(['architecture']).then(function (values) {
        var arch = String(values.architecture || '').toLowerCase();
        if (arch.indexOf('arm') >= 0) return 'arm64';
        if (arch) return 'x64';
        return /arm64|aarch64/i.test(navigator.userAgent) ? 'arm64' : 'x64';
      }).catch(function () {
        return /arm64|aarch64/i.test(navigator.userAgent) ? 'arm64' : 'x64';
      });
    }
    return Promise.resolve(/arm64|aarch64/i.test(navigator.userAgent) ? 'arm64' : 'x64');
  }

  function osLabel(os) {
    return os === 'windows' ? 'Windows' : os === 'mac' ? 'macOS' : os === 'linux' ? 'Linux' : t('os.thisDevice');
  }

  function versionLabel(release) {
    return String(release && release.tag_name || cfg.version || '').replace(/^v/i, '');
  }

  function formatBytes(bytes) {
    if (!bytes) return '';
    if (bytes < 1048576) return Math.max(1, Math.round(bytes / 1024)) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function isArm(name) {
    return /(arm64|aarch64|apple[-_ ]?silicon)/i.test(name);
  }

  function pickAssets(release) {
    var assets = (release && release.assets || []).filter(function (asset) {
      return asset && asset.browser_download_url && asset.name;
    });
    var windows = assets.find(function (asset) { return /\.exe$/i.test(asset.name) && /setup|install/i.test(asset.name); }) ||
      assets.find(function (asset) { return /\.exe$/i.test(asset.name); }) || null;
    var dmgs = assets.filter(function (asset) { return /\.dmg$/i.test(asset.name); });
    var macArm = dmgs.find(function (asset) { return isArm(asset.name); }) || null;
    var macIntel = dmgs.find(function (asset) { return !isArm(asset.name); }) || null;
    if (!macArm && !macIntel && dmgs.length === 1) macIntel = dmgs[0];
    var macArch = (state.explicitArch || state.detected === 'mac') ? state.arch : 'arm64';
    var mac = macArch === 'arm64' ? (macArm || macIntel) : (macIntel || macArm);
    var appImages = assets.filter(function (asset) { return /\.appimage$/i.test(asset.name); });
    var linux = appImages.find(function (asset) { return !/arm|aarch64/i.test(asset.name); }) || appImages[0] || null;
    return { windows: windows, mac: mac, macArm: macArm, macIntel: macIntel, linux: linux, all: assets };
  }

  function cachedRelease() {
    if (!repo) return null;
    try {
      var raw = sessionStorage.getItem('blank-release:' + repo);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || Date.now() - parsed.at > 10 * 60 * 1000) return null;
      return parsed.release;
    } catch (error) { return null; }
  }

  function cacheRelease(release) {
    if (!repo) return;
    try {
      sessionStorage.setItem('blank-release:' + repo, JSON.stringify({ at: Date.now(), release: release }));
    } catch (error) { /* private mode */ }
  }

  function loadRelease() {
    if (!repo) return Promise.resolve(null);
    var cached = cachedRelease();
    if (cached) return Promise.resolve(cached);
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = setTimeout(function () { if (controller) controller.abort(); }, 9000);
    return fetch('https://api.github.com/repos/' + repo + '/releases/latest', {
      headers: { Accept: 'application/vnd.github+json' },
      signal: controller ? controller.signal : undefined
    }).then(function (response) {
      if (response.status === 404) return null;
      if (!response.ok) throw new Error('GitHub returned ' + response.status);
      return response.json();
    }).then(function (release) {
      clearTimeout(timer);
      cacheRelease(release);
      return release;
    }).catch(function (error) {
      clearTimeout(timer);
      throw error;
    });
  }

  function currentAsset() {
    return state.assets ? state.assets[state.os] || null : null;
  }

  function setLink(link, href) {
    if (!link) return;
    if (href) {
      link.href = href;
      link.removeAttribute('aria-disabled');
      link.classList.remove('is-disabled');
    } else {
      link.removeAttribute('href');
      link.setAttribute('aria-disabled', 'true');
      link.classList.add('is-disabled');
    }
  }

  function releaseHref() {
    return latestUrl || releasesUrl || '';
  }

  function updateHeader() {
    var header = document.querySelector('[data-guide-header]');
    if (!header) return;
    var asset = currentAsset();
    if (asset) {
      header.href = asset.browser_download_url;
      header.removeAttribute('target');
      header.removeAttribute('rel');
    } else if (releaseHref()) {
      header.href = releaseHref();
      header.target = '_blank';
      header.rel = 'noreferrer';
    }
  }

  function renderDownloads() {
    var assetMap = state.assets || { windows: null, mac: null, macArm: null, macIntel: null, linux: null };
    OSES.forEach(function (os) {
      var asset = assetMap[os] || null;
      var button = document.querySelector('[data-guide-download="' + os + '"]');
      var file = document.querySelector('[data-guide-file="' + os + '"]');
      var status = document.querySelector('[data-guide-status="' + os + '"]');
      if (asset) {
        setLink(button, asset.browser_download_url);
        if (button) { button.removeAttribute('target'); button.removeAttribute('rel'); }
        if (file) file.textContent = asset.name + (asset.size ? ' · ' + formatBytes(asset.size) : '');
        if (status) status.textContent = t('guide.downloadNote');
      } else if (releaseHref()) {
        setLink(button, releaseHref());
        if (button) { button.target = '_blank'; button.rel = 'noreferrer'; }
        if (file) file.textContent = state.status === 'loading' ? t('guide.checking') : t('download.noBuild');
        if (status) status.textContent = t('download.inReleases');
      } else {
        setLink(button, null);
        if (file) file.textContent = t('download.notConfigured');
        if (status) status.textContent = t('download.repoHint');
      }
    });

    var alt = document.querySelector('[data-guide-alt]');
    if (alt) {
      var chosen = assetMap.mac;
      var other = chosen && chosen === assetMap.macArm ? assetMap.macIntel : assetMap.macArm;
      if (chosen && other && other !== chosen) {
        alt.hidden = false;
        alt.href = other.browser_download_url;
        alt.textContent = other === assetMap.macArm ? t('download.macAltArm') : t('download.macAltIntel');
        alt.removeAttribute('target');
        alt.removeAttribute('rel');
      } else {
        alt.hidden = true;
        alt.removeAttribute('href');
      }
    }
    updateHeader();
  }

  function renderVersion() {
    var label = 'v' + versionLabel(state.release);
    document.querySelectorAll('[data-guide-version], [data-guide-release]').forEach(function (el) {
      el.textContent = label;
    });
  }

  function updateDevice() {
    var device = document.querySelector('[data-guide-device]');
    var tag = document.querySelector('[data-guide-detected]');
    var known = state.detected !== 'other';
    if (device) device.textContent = known ? osLabel(state.detected) : t('os.thisDevice');
    if (tag) tag.hidden = !known;
  }

  function selectOS(os, options) {
    if (OSES.indexOf(os) < 0) return;
    state.os = os;
    document.querySelectorAll('[data-os-tab]').forEach(function (tab) {
      var active = tab.getAttribute('data-os-tab') === os;
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
      tab.tabIndex = active ? 0 : -1;
    });
    document.querySelectorAll('[data-guide-panel]').forEach(function (panel) {
      panel.hidden = panel.getAttribute('data-guide-panel') !== os;
    });
    if (options && options.sync) {
      try {
        var url = new URL(location.href);
        url.searchParams.set('os', os);
        if (state.explicitArch) url.searchParams.set('arch', state.arch);
        history.replaceState(null, '', url.pathname + url.search + url.hash);
      } catch (error) { /* file URLs */ }
    }
    renderDownloads();
  }

  function setupTabs() {
    var list = document.querySelector('.os-tabs');
    document.querySelectorAll('[data-os-tab]').forEach(function (tab) {
      tab.addEventListener('click', function () {
        selectOS(tab.getAttribute('data-os-tab'), { sync: true });
      });
    });
    if (!list) return;
    list.addEventListener('keydown', function (event) {
      if (!/^(ArrowLeft|ArrowRight|Home|End)$/.test(event.key)) return;
      var tabs = Array.prototype.slice.call(list.querySelectorAll('[data-os-tab]'));
      var index = tabs.indexOf(document.activeElement);
      if (index < 0) return;
      event.preventDefault();
      var next = event.key === 'Home' ? 0
        : event.key === 'End' ? tabs.length - 1
          : event.key === 'ArrowRight' ? (index + 1) % tabs.length
            : (index - 1 + tabs.length) % tabs.length;
      tabs[next].focus();
      selectOS(tabs[next].getAttribute('data-os-tab'), { sync: true });
    });
  }

  function setupLinks() {
    var notes = document.querySelector('[data-guide-notes]');
    if (notes && latestUrl) notes.href = latestUrl;
    var all = document.querySelector('[data-guide-all]');
    if (all && releasesUrl) all.href = releasesUrl;
    var jump = document.querySelector('[data-guide-jump]');
    if (jump) {
      jump.addEventListener('click', function () {
        selectOS(state.detected === 'other' ? state.os : state.detected, { sync: true });
        var tabs = document.querySelector('.os-tabs');
        if (!tabs) return;
        var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        tabs.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
        var active = tabs.querySelector('[aria-selected="true"]');
        if (active) active.focus({ preventScroll: true });
      });
    }
  }

  function refresh() {
    renderVersion();
    renderDownloads();
    updateDevice();
  }

  function boot() {
    var year = document.getElementById('year');
    if (year) year.textContent = String(new Date().getFullYear());
    setupTabs();
    setupLinks();
    selectOS(state.os);

    var arch = state.explicitArch ? Promise.resolve(state.arch) : detectArch();
    arch.then(function (value) {
      state.arch = value;
      return loadRelease();
    }).then(function (release) {
      state.release = release;
      state.status = release ? 'ready' : 'error';
      state.assets = release ? pickAssets(release) : null;
      refresh();
      selectOS(state.os);
    }).catch(function (error) {
      state.status = 'error';
      state.error = String(error && error.message || error || '');
      state.assets = null;
      refresh();
    });

    document.addEventListener('blank:langchange', refresh);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
