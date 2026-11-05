(function () {
  'use strict';

  var cfg = Object.assign({ repo: '', version: '1.0.0' }, window.BLANK_SITE || {});
  var repo = String(cfg.repo || '').trim() || inferRepo();
  var repoUrl = repo ? 'https://github.com/' + repo : '';
  var state = { release: null, assets: [], os: detectOS(), arch: 'x64', repo: repo, releasesUrl: repoUrl ? repoUrl + '/releases' : '', status: 'loading' };

  function t(key, vars) {
    var api = window.BLANK_SITE_I18N;
    if (api && typeof api.t === 'function') return api.t(key, vars);
    return '';
  }

  function inferRepo() {
    if (!/\.github\.io$/i.test(location.hostname)) return '';
    var user = location.hostname.split('.')[0];
    var first = location.pathname.split('/').filter(Boolean)[0] || '';
    if (!first || /\.html?$/i.test(first)) return '';
    return user + '/' + first;
  }

  function detectOS() {
    var ua = navigator.userAgent || '';
    if (/Android/i.test(ua)) return 'other';
    if (/Windows/i.test(ua)) return 'windows';
    if (/Macintosh|Mac OS X/i.test(ua)) return 'mac';
    if (/Linux|X11/i.test(ua)) return 'linux';
    return 'other';
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

  function formatBytes(bytes) {
    if (!bytes) return '';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function assetCaption(asset) {
    var kind = /\.dmg$/i.test(asset.name) ? t('asset.disk') : /\.appimage$/i.test(asset.name) ? t('asset.appimage') : t('asset.installer');
    return kind + (asset.size ? ' · ' + formatBytes(asset.size) : '');
  }

  function versionLabel(release) {
    return String(release && release.tag_name || cfg.version || '').replace(/^v/i, '');
  }

  function setVersion(release) {
    var el = document.getElementById('site-version');
    if (el) el.textContent = 'v' + versionLabel(release);
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
    var url = 'https://api.github.com/repos/' + repo + '/releases/latest';
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = setTimeout(function () { if (controller) controller.abort(); }, 9000);
    return fetch(url, {
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
    var preferArm = state.os !== 'mac' || state.arch === 'arm64';
    var mac = preferArm ? (macArm || macIntel) : (macIntel || macArm);
    var appImages = assets.filter(function (asset) { return /\.appimage$/i.test(asset.name); });
    var linux = appImages.find(function (asset) { return !/arm|aarch64/i.test(asset.name); }) || appImages[0] || null;
    return { windows: windows, mac: mac, macArm: macArm, macIntel: macIntel, linux: linux, all: assets };
  }

  function setRepoLinks() {
    var repoLinks = document.querySelectorAll('[data-repo-link]');
    Array.prototype.forEach.call(repoLinks, function (link) {
      if (repoUrl) {
        link.href = repoUrl;
        link.hidden = false;
        link.removeAttribute('aria-disabled');
      } else {
        link.hidden = true;
      }
    });
    var releases = document.querySelectorAll('#releases-link, #foot-releases');
    Array.prototype.forEach.call(releases, function (link) {
      if (state.releasesUrl) {
        link.href = state.releasesUrl;
        link.removeAttribute('aria-disabled');
      } else {
        link.href = '#install';
        link.setAttribute('aria-disabled', 'true');
      }
    });
    var releasesLink = document.getElementById('releases-link');
    if (releasesLink) {
      if (state.releasesUrl) { releasesLink.target = '_blank'; releasesLink.rel = 'noreferrer'; }
      else { releasesLink.removeAttribute('target'); }
    }
  }

  function setPill(text, tone) {
    var pill = document.getElementById('release-pill');
    var label = document.getElementById('release-pill-text');
    if (!pill || !label) return;
    label.textContent = text;
    pill.classList.remove('live', 'warn');
    if (tone) pill.classList.add(tone);
  }

  function setLinkLabel(link, label) {
    if (!link) return;
    var inner = link.querySelector('[data-os-label]');
    if (inner) inner.textContent = label;
    else link.textContent = label;
  }

  function disableLink(link, label) {
    if (!link) return;
    link.removeAttribute('href');
    link.setAttribute('aria-disabled', 'true');
    link.classList.add('is-disabled');
    if (label) {
      var inner = link.querySelector('.btn-label');
      if (inner) inner.textContent = label;
      else setLinkLabel(link, label);
    }
  }

  function enableLink(link, href, label) {
    if (!link) return;
    link.href = href;
    link.removeAttribute('aria-disabled');
    link.classList.remove('is-disabled');
    if (label) setLinkLabel(link, label);
  }

  function setRecommended() {
    var cards = document.querySelectorAll('[data-os-card]');
    Array.prototype.forEach.call(cards, function (card) {
      var wanted = card.getAttribute('data-os-card') === state.os;
      card.classList.toggle('is-recommended', wanted);
      var tag = card.querySelector('.recommended');
      if (tag) tag.hidden = !wanted;
    });
  }

  function osLabel(os) {
    return os === 'windows' ? 'Windows' : os === 'mac' ? 'macOS' : os === 'linux' ? 'Linux' : t('os.thisDevice');
  }

  function setPrimary(asset, href) {
    var primary = document.getElementById('primary-download');
    var closing = document.getElementById('closing-download');
    var label = osLabel(state.os);
    if (primary && asset) {
      enableLink(primary, href);
      var title = primary.querySelector('.btn-label');
      var sub = primary.querySelector('.btn-sub');
      if (title) title.textContent = t('download.forOs', { os: label });
      if (sub) sub.textContent = assetCaption(asset);
      primary.removeAttribute('target');
      primary.removeAttribute('rel');
    }
    if (closing && asset) {
      enableLink(closing, href);
      var closingTitle = closing.querySelector('.btn-label');
      var closingSub = closing.querySelector('.btn-sub');
      if (closingTitle) closingTitle.textContent = t('download.getBlank');
      if (closingSub) closingSub.textContent = t('download.forOsShort', { os: label });
      closing.removeAttribute('target');
      closing.removeAttribute('rel');
    }
  }

  function resetPrimary() {
    var primary = document.getElementById('primary-download');
    var closing = document.getElementById('closing-download');
    if (primary) {
      var label = primary.querySelector('.btn-label');
      var sub = primary.querySelector('.btn-sub');
      if (label) label.textContent = t('download.chooseOs');
      if (sub) sub.textContent = t('download.platforms');
    }
    if (closing) {
      var closingLabel = closing.querySelector('.btn-label');
      var closingSub = closing.querySelector('.btn-sub');
      if (closingLabel) closingLabel.textContent = t('download.chooseOs');
      if (closingSub) closingSub.textContent = t('download.platforms');
    }
  }

  function fillCards(assets) {
    var copy = {
      windows: { idle: t('download.installer'), missing: t('download.viewRelease') },
      mac: { idle: t('download.disk'), missing: t('download.viewRelease') },
      linux: { idle: t('download.appimage'), missing: t('download.viewRelease') }
    };
    ['windows', 'mac', 'linux'].forEach(function (os) {
      var asset = assets[os] || null;
      var link = document.querySelector('[data-download="' + os + '"]');
      var assetLabel = document.querySelector('[data-asset="' + os + '"]');
      if (asset) {
        enableLink(link, asset.browser_download_url);
        setLinkLabel(link, copy[os].idle);
        if (link) { link.removeAttribute('target'); link.removeAttribute('rel'); }
        if (assetLabel) assetLabel.textContent = assetCaption(asset);
      } else if (state.releasesUrl) {
        enableLink(link, state.releasesUrl);
        setLinkLabel(link, copy[os].missing);
        if (link) { link.target = '_blank'; link.rel = 'noreferrer'; }
        if (assetLabel) assetLabel.textContent = t('download.noBuild');
      } else {
        disableLink(link);
        setLinkLabel(link, t('download.unavailable'));
        if (assetLabel) assetLabel.textContent = t('download.repoHint');
      }
    });

    var alt = document.querySelector('[data-download="mac-alt"]');
    if (alt) {
      var other = assets.mac === assets.macArm ? assets.macIntel : assets.macArm;
      if (assets.mac && other && other !== assets.mac) {
        alt.hidden = false;
        alt.href = other.browser_download_url;
        alt.textContent = other === assets.macArm ? t('download.macAltArm') : t('download.macAltIntel');
      } else {
        alt.hidden = true;
        alt.removeAttribute('href');
      }
    }
  }

  function renderRelease(release) {
    state.release = release;
    state.status = 'ready';
    setVersion(release);
    setPill(release ? t('release.latest', { v: versionLabel(release) }) : t('release.none'), release ? 'live' : 'warn');
    state.assets = release ? pickAssets(release) : { windows: null, mac: null, macIntel: null, linux: null, all: [] };
    var recommendedAsset = state.assets[state.os] || null;
    if (recommendedAsset) {
      setPrimary(recommendedAsset, recommendedAsset.browser_download_url);
    } else if (release && state.releasesUrl) {
      var primary = document.getElementById('primary-download');
      var closing = document.getElementById('closing-download');
      var label = osLabel(state.os);
      if (primary) {
        enableLink(primary, state.releasesUrl);
        primary.querySelector('.btn-label').textContent = t('download.viewRelease');
        primary.querySelector('.btn-sub').textContent = t('download.releaseMissing', { os: label });
      }
      if (closing) {
        enableLink(closing, state.releasesUrl);
        closing.querySelector('.btn-label').textContent = t('download.viewRelease');
        closing.querySelector('.btn-sub').textContent = t('download.onGithub');
      }
    } else {
      resetPrimary();
    }
    fillCards(state.assets);
  }

  function setUnavailable(reasonKey) {
    state.release = null;
    state.status = reasonKey;
    state.assets = { windows: null, mac: null, macIntel: null, linux: null, all: [] };
    setPill(t(reasonKey), 'warn');
    resetPrimary();
    var primary = document.getElementById('primary-download');
    var closing = document.getElementById('closing-download');
    if (state.releasesUrl) {
      enableLink(primary, state.releasesUrl, null);
      enableLink(closing, state.releasesUrl, null);
      if (primary) {
        primary.querySelector('.btn-label').textContent = t('download.viewRelease');
        primary.querySelector('.btn-sub').textContent = t('download.inReleases');
      }
      if (closing) {
        closing.querySelector('.btn-label').textContent = t('download.viewRelease');
        closing.querySelector('.btn-sub').textContent = t('download.onGithub');
      }
    } else {
      disableLink(primary, t('download.unavailable'));
      disableLink(closing, t('download.unavailable'));
      if (primary) primary.querySelector('.btn-sub').textContent = t(reasonKey);
      if (closing) closing.querySelector('.btn-sub').textContent = t(reasonKey);
    }
    fillCards({ windows: null, mac: null, macIntel: null, linux: null });
  }

  function renderNoRepo() {
    state.release = null;
    state.status = 'norepo';
    state.assets = { windows: null, mac: null, macIntel: null, linux: null, all: [] };
    setPill(t('download.notConfigured'), 'warn');
    resetPrimary();
    var primary = document.getElementById('primary-download');
    var closing = document.getElementById('closing-download');
    disableLink(primary, t('download.notConfigured'));
    disableLink(closing, t('download.unavailable'));
    if (primary && primary.querySelector('.btn-sub')) primary.querySelector('.btn-sub').textContent = t('download.pagesSetup');
    if (closing && closing.querySelector('.btn-sub')) closing.querySelector('.btn-sub').textContent = t('download.localPreview');
    fillCards({ windows: null, mac: null, macIntel: null, linux: null });
  }

  function setupPlatformJumps() {
    var links = document.querySelectorAll('[data-platform-jump]');
    Array.prototype.forEach.call(links, function (link) {
      link.addEventListener('click', function (event) {
        var os = link.getAttribute('data-platform-jump');
        var card = document.querySelector('[data-os-card="' + os + '"]');
        if (!card) return;
        event.preventDefault();
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card.classList.add('flash');
        setTimeout(function () { card.classList.remove('flash'); }, 1600);
      });
    });
  }

  function setupMenu() {
    var button = document.querySelector('[data-menu]');
    var panel = document.querySelector('[data-mobile-nav]');
    if (!button || !panel) return;
    function close() {
      panel.hidden = true;
      button.setAttribute('aria-expanded', 'false');
    }
    button.addEventListener('click', function () {
      var open = panel.hidden;
      panel.hidden = !open;
      button.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    panel.addEventListener('click', function (event) {
      if (event.target.closest('a')) close();
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') close();
    });
  }

  function refreshLanguage() {
    setRepoLinks();
    if (state.status === 'ready' && state.release) renderRelease(state.release);
    else if (state.status === 'norepo') renderNoRepo();
    else if (state.status === 'error.releaseMissing' || state.status === 'error.releaseFetch') setUnavailable(state.status);
  }

  function boot() {
    var year = document.getElementById('year');
    if (year) year.textContent = String(new Date().getFullYear());
    setVersion(null);
    setRepoLinks();
    setRecommended();
    setupPlatformJumps();
    setupMenu();
    document.addEventListener('blank:langchange', refreshLanguage);

    if (!repo) {
      renderNoRepo();
      return;
    }

    detectArch().then(function (arch) {
      state.arch = arch;
      return loadRelease();
    }).then(function (release) {
      if (!release) { setUnavailable('error.releaseMissing'); return; }
      renderRelease(release);
    }).catch(function () {
      setUnavailable('error.releaseFetch');
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
