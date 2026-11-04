(function () {
  'use strict';

  var cfg = Object.assign({ repo: '', version: '1.0.0' }, window.BLANK_SITE || {});
  var repo = String(cfg.repo || '').trim() || inferRepo();
  var repoUrl = repo ? 'https://github.com/' + repo : '';
  var state = { release: null, assets: [], os: detectOS(), arch: 'x64', repo: repo, releasesUrl: repoUrl ? repoUrl + '/releases' : '' };

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
    var kind = /\.dmg$/i.test(asset.name) ? '디스크 이미지' : /\.appimage$/i.test(asset.name) ? 'AppImage' : '설치 파일';
    return kind + (asset.size ? ' · ' + formatBytes(asset.size) : '');
  }

  function versionLabel(release) {
    return String(release && release.tag_name || cfg.version || '').replace(/^v/i, '');
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

  function disableLink(link, label) {
    if (!link) return;
    link.removeAttribute('href');
    link.setAttribute('aria-disabled', 'true');
    link.classList.add('is-disabled');
    if (label) {
      var inner = link.querySelector('.btn-label');
      if (inner) inner.textContent = label;
      else link.textContent = label;
    }
  }

  function enableLink(link, href, label) {
    if (!link) return;
    link.href = href;
    link.removeAttribute('aria-disabled');
    link.classList.remove('is-disabled');
    if (label) link.textContent = label;
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
    return os === 'windows' ? 'Windows' : os === 'mac' ? 'macOS' : os === 'linux' ? 'Linux' : '이 기기';
  }

  function setPrimary(asset, href) {
    var primary = document.getElementById('primary-download');
    var closing = document.getElementById('closing-download');
    var label = osLabel(state.os);
    if (primary && asset) {
      enableLink(primary, href);
      var title = primary.querySelector('.btn-label');
      var sub = primary.querySelector('.btn-sub');
      if (title) title.textContent = label + '용 다운로드';
      if (sub) sub.textContent = assetCaption(asset);
      primary.removeAttribute('target');
      primary.removeAttribute('rel');
    }
    if (closing && asset) {
      enableLink(closing, href);
      var closingTitle = closing.querySelector('.btn-label');
      var closingSub = closing.querySelector('.btn-sub');
      if (closingTitle) closingTitle.textContent = 'Blank 받기';
      if (closingSub) closingSub.textContent = label + '용';
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
      if (label) label.textContent = '다운로드 선택';
      if (sub) sub.textContent = 'Windows · macOS · Linux';
    }
    if (closing) {
      var closingLabel = closing.querySelector('.btn-label');
      var closingSub = closing.querySelector('.btn-sub');
      if (closingLabel) closingLabel.textContent = '다운로드 선택';
      if (closingSub) closingSub.textContent = 'Windows · macOS · Linux';
    }
  }

  function fillCards(assets) {
    var copy = {
      windows: { idle: '설치 파일 받기', missing: '릴리스 보기' },
      mac: { idle: '디스크 이미지 받기', missing: '릴리스 보기' },
      linux: { idle: 'AppImage 받기', missing: '릴리스 보기' }
    };
    ['windows', 'mac', 'linux'].forEach(function (os) {
      var asset = assets[os] || null;
      var link = document.querySelector('[data-download="' + os + '"]');
      var assetLabel = document.querySelector('[data-asset="' + os + '"]');
      if (asset) {
        enableLink(link, asset.browser_download_url, copy[os].idle);
        if (link) { link.removeAttribute('target'); link.removeAttribute('rel'); }
        if (assetLabel) assetLabel.textContent = assetCaption(asset);
      } else if (state.releasesUrl) {
        enableLink(link, state.releasesUrl, copy[os].missing);
        if (link) { link.target = '_blank'; link.rel = 'noreferrer'; }
        if (assetLabel) assetLabel.textContent = '최신 릴리스에 빌드가 없습니다';
      } else {
        disableLink(link, '빌드 없음');
        if (assetLabel) assetLabel.textContent = '저장소를 연결하면 다운로드를 사용할 수 있습니다';
      }
    });

    var alt = document.querySelector('[data-download="mac-alt"]');
    if (alt) {
      var other = assets.mac === assets.macArm ? assets.macIntel : assets.macArm;
      if (assets.mac && other && other !== assets.mac) {
        alt.hidden = false;
        alt.href = other.browser_download_url;
        alt.textContent = other === assets.macArm ? 'Apple silicon 빌드' : 'Intel Mac 빌드';
      } else {
        alt.hidden = true;
        alt.removeAttribute('href');
      }
    }
  }

  function renderRelease(release) {
    state.release = release;
    setPill(release ? '최신 릴리스' : '아직 릴리스가 없습니다', release ? 'live' : 'warn');
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
        primary.querySelector('.btn-label').textContent = '릴리스 보기';
        primary.querySelector('.btn-sub').textContent = '최신 릴리스에 ' + label + ' 빌드가 없습니다';
      }
      if (closing) {
        enableLink(closing, state.releasesUrl);
        closing.querySelector('.btn-label').textContent = '릴리스 보기';
        closing.querySelector('.btn-sub').textContent = 'GitHub에서';
      }
    } else {
      resetPrimary();
    }
    fillCards(state.assets);
  }

  function setUnavailable(message) {
    setPill(message, 'warn');
    resetPrimary();
    var primary = document.getElementById('primary-download');
    var closing = document.getElementById('closing-download');
    if (state.releasesUrl) {
      enableLink(primary, state.releasesUrl, null);
      enableLink(closing, state.releasesUrl, null);
      if (primary) {
        primary.querySelector('.btn-label').textContent = '릴리스 보기';
        primary.querySelector('.btn-sub').textContent = '설치 파일은 GitHub에 있습니다';
      }
      if (closing) {
        closing.querySelector('.btn-label').textContent = '릴리스 보기';
        closing.querySelector('.btn-sub').textContent = 'GitHub에서';
      }
    } else {
      disableLink(primary, '다운로드할 수 없음');
      disableLink(closing, '다운로드할 수 없음');
      if (primary) primary.querySelector('.btn-sub').textContent = message;
      if (closing) closing.querySelector('.btn-sub').textContent = message;
    }
    fillCards({ windows: null, mac: null, macIntel: null, linux: null });
  }

  function setupGallery() {
    var tabs = Array.prototype.slice.call(document.querySelectorAll('.gallery-tab'));
    var image = document.getElementById('gallery-image');
    var caption = document.getElementById('gallery-caption');
    if (!tabs.length || !image) return;
    var captions = {
      '미디어': '채팅 속 미디어 만들기 · 자산 라이브러리 · 엔진 상태',
      '프로바이더': '키 · 로테이션 · 모델 선택',
      '채팅': '플랜 레일 · 스트리밍 도구 · 승인'
    };
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        tabs.forEach(function (other) {
          other.classList.toggle('active', other === tab);
          other.setAttribute('aria-selected', other === tab ? 'true' : 'false');
        });
        image.classList.remove('swap');
        void image.offsetWidth;
        image.src = tab.getAttribute('data-shot');
        image.alt = tab.getAttribute('data-shot-alt') || '';
        image.classList.add('swap');
        if (caption) caption.textContent = captions[tab.textContent.trim()] || '';
      });
    });
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

  function boot() {
    var year = document.getElementById('year');
    if (year) year.textContent = String(new Date().getFullYear());
    setRepoLinks();
    setRecommended();
    setupGallery();
    setupPlatformJumps();
    setupMenu();

    if (!repo) {
      setPill('다운로드가 설정되지 않았습니다', 'warn');
      resetPrimary();
      var primary = document.getElementById('primary-download');
      var closing = document.getElementById('closing-download');
      disableLink(primary, '다운로드가 설정되지 않았습니다');
      disableLink(closing, '다운로드할 수 없음');
      if (primary && primary.querySelector('.btn-sub')) primary.querySelector('.btn-sub').textContent = 'Pages 워크플로를 설정하세요';
      if (closing && closing.querySelector('.btn-sub')) closing.querySelector('.btn-sub').textContent = '로컬 미리보기';
      fillCards({ windows: null, mac: null, macIntel: null, linux: null });
      return;
    }

    detectArch().then(function (arch) {
      state.arch = arch;
      return loadRelease();
    }).then(function (release) {
      if (!release) { setUnavailable('릴리스를 찾을 수 없습니다'); return; }
      renderRelease(release);
    }).catch(function () {
      setUnavailable('GitHub Releases에 연결하지 못했습니다');
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
