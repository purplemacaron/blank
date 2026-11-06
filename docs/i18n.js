(function () {
  'use strict';

  var STORAGE_KEY = 'blank-site-lang';
  var LANGUAGES = [
    { code: 'ko', name: '한국어', short: 'KO' },
    { code: 'en', name: 'English', short: 'EN' },
    { code: 'ja', name: '日本語', short: 'JA' },
    { code: 'zh', name: '简体中文', short: '中文' }
  ];
  var current = 'ko';
  var records = null;
  var originals = {};

  var DICT = {
    ko: {
      'download.chooseOs': '다운로드 선택',
      'download.platforms': 'Windows · macOS · Linux',
      'download.forOs': '{os}용 다운로드',
      'download.getBlank': 'blank 받기',
      'download.forOsShort': '{os}용',
      'download.viewRelease': '릴리스 보기',
      'download.releaseMissing': '최신 릴리스에 {os} 빌드가 없습니다',
      'download.onGithub': 'GitHub에서',
      'download.inReleases': '설치 파일은 GitHub에 있습니다',
      'download.unavailable': '다운로드할 수 없음',
      'download.notConfigured': '다운로드가 설정되지 않았습니다',
      'download.pagesSetup': 'Pages 워크플로를 설정하세요',
      'download.localPreview': '로컬 미리보기',
      'download.installer': '설치 파일 받기',
      'download.disk': '디스크 이미지 받기',
      'download.appimage': 'AppImage 받기',
      'download.guide': '설치 안내',
      'download.macAltIntel': 'Intel Mac 빌드',
      'download.macAltArm': 'Apple silicon 빌드',
      'guide.checking': '최신 릴리스 확인 중…',
      'guide.downloadNote': 'GitHub Releases에서 직접 내려받습니다.',
      'download.missing': '릴리스 보기',
      'download.noBuild': '최신 릴리스에 빌드가 없습니다',
      'download.repoHint': '저장소를 연결하면 다운로드를 사용할 수 있습니다',
      'release.latest': 'v{v} · 최신 릴리스',
      'release.none': '아직 릴리스가 없습니다',
      'error.releaseMissing': '릴리스를 찾을 수 없습니다',
      'error.releaseFetch': 'GitHub Releases에 연결하지 못했습니다',
      'asset.installer': '설치 파일',
      'asset.disk': '디스크 이미지',
      'asset.appimage': 'AppImage',
      'os.thisDevice': '이 기기'
    },

    en: {
      'meta.title': `blank — When the conversation ends, the files stay`,
      'meta.description': `Models, tools, files and a terminal in one window. A local-first desktop agent that runs on this device, without an account.`,
      'meta.ogTitle': `blank — When the conversation ends, the files stay`,
      'meta.ogDescription': `Models, tools, files and a terminal in one window. Local-first, without an account.`,
      'meta.privacyTitle': `Privacy Policy — blank`,
      'meta.termsTitle': `Terms of Use — blank`,
      'meta.ogLocale': `en_US`,
      'brand.home': `blank home`,
      'nav.main': `Main menu`,
      'nav.features': `Features`,
      'nav.install': `Install`,
      'nav.download': `Download`,
      'menu.label': `Open menu`,
      'lang.label': `Language`,
      'skip': `Skip to content`,
      'hero.eyebrow': `Local desktop agent`,
      'hero.titleHtml': `When the conversation ends,<br /><span>the files stay.</span>`,
      'hero.lead': `Models, tools, files and a terminal in one window.`,
      'hero.free': `Free · MIT · No account`,
      'release.initial': `Latest release`,
      'stage.aria': `The blank app reading a file, updating numbers and handing over a new file card`,
      'stage.sideNew': `New session`,
      'stage.sideChat': `Chat`,
      'stage.sidePapers': `Papers`,
      'stage.sideCode': `Code`,
      'stage.sideTerminal': `Terminal`,
      'stage.sideLabel': `Sessions`,
      'stage.sessionQ3': `Q3 report`,
      'stage.now': `just now`,
      'stage.sessionRelease': `Release notes`,
      'stage.yesterday': `yesterday`,
      'stage.sideFoot': `MCP 3 · Messengers 2`,
      'stage.title': `Q3 report`,
      'stage.local': `Local`,
      'stage.user': `Update only the numbers on lines 12–14 of q3-report.md.`,
      'stage.checked': `2 files checked`,
      'stage.reply': `Numbers updated. The rest of the wording is unchanged.`,
      'stage.toolRead': `Read file`,
      'stage.toolReadFile': `q3-report.md`,
      'stage.toolEdit': `Edit file`,
      'stage.toolEditLines': `lines 12–14`,
      'stage.fileName': `Q3 operations report.md`,
      'stage.fileMeta': `382 B · Saved`,
      'stage.open': `Open`,
      'stage.composer': `What should blank do?`,
      'stage.plan': `Plan`,
      'stage.agent': `Agent`,
      'stage.stepRead': `Read file`,
      'stage.stepNumbers': `Update numbers`,
      'stage.stepWording': `Check wording`,
      'stage.stepDeliver': `Deliver file`,
      'features.eyebrow': `Features`,
      'features.title': `Run it, approve it, keep it.`,
      'feature1.title': `Tools that act`,
      'feature1.body': `File reads and edits, a terminal and a browser.`,
      'feature2.title': `Approve what matters`,
      'feature2.body': `Only important actions ask first.`,
      'feature3.title': `Stored locally`,
      'feature3.bodyHtml': `Keys and sessions live in <code>~/.blank</code>.`,
      'install.eyebrow': `Install`,
      'install.title': `Get the build for this device.`,
      'install.thisDevice': `This device`,
      'install.winMeta': `Installer · Windows 10 or later`,
      'install.macMeta': `Disk image · Apple silicon`,
      'install.linuxMeta': `AppImage · x64`,
      'install.winAction': `Download installer`,
      'install.macAction': `Download disk image`,
      'install.linuxAction': `Download AppImage`,
      'install.macAlt': `Intel Mac build`,
      'install.noteHtml': `All builds and changes live in <a id="releases-link" href="#install">GitHub Releases</a>.`,
      'install.signHtml': `Windows releases use free code signing from <a href="terms.html#code-signing">SignPath.io</a>, with a certificate issued by SignPath Foundation.`,
      'install.dataHtml': `Data <code>~/.blank</code>`,
      'meta.guideTitle': `Install blank — blank`,
      'meta.guideDescription': `Download blank for Windows, macOS or Linux, with the exact SmartScreen steps for the unsigned Windows build.`,
      'guide.eyebrow': `Install guide`,
      'guide.title': `Install blank`,
      'guide.lead': `Download, run and start on this device. Windows asks once through SmartScreen because the build is not signed yet.`,
      'guide.tabsLabel': `Platform`,
      'guide.winMeta': `Windows 10 or later · x64 · installer`,
      'guide.downloadWin': `Download installer`,
      'guide.checking': `Checking the latest release…`,
      'guide.downloadNote': `Downloads come directly from GitHub Releases.`,
      'guide.win1Title': `Run the installer`,
      'guide.win1Body': `Open the setup file from your Downloads folder. If Windows asks whether to allow changes, choose Yes.`,
      'guide.win2Title': `Pass SmartScreen once`,
      'guide.win2Body': `If “Windows protected your PC” appears, click More info, then Run anyway. Windows shows this because the installer is not code-signed yet.`,
      'guide.smartDialogTitle': `Windows protected your PC`,
      'guide.smartDialogBody': `Microsoft Defender SmartScreen prevented an unrecognized app from starting.`,
      'guide.smartDontRun': `Don’t run`,
      'guide.smartMore': `More info`,
      'guide.smartRun': `Run anyway`,
      'guide.win3Title': `Finish and open blank`,
      'guide.win3Body': `Keep the default install location, finish setup, then open blank from the Start menu. Close any older blank window first.`,
      'guide.smartTitle': `Why this warning appears`,
      'guide.signBody': `The current Windows installer is not code-signed yet. It will switch to a signed build once SignPath Foundation finishes its review. Do not turn off SmartScreen or add exclusions; download only from this page or the GitHub release. <a href="terms.html#code-signing">Code signing policy</a>`,
      'guide.macMeta': `macOS 11 or later · Apple silicon or Intel`,
      'guide.downloadMac': `Download disk image`,
      'guide.mac1Title': `Download the disk image`,
      'guide.mac1Body': `Choose Apple silicon or Intel for your Mac. The build that matches this device is selected first.`,
      'guide.mac2Title': `Move blank to Applications`,
      'guide.mac2Body': `Open the .dmg and drag blank into the Applications folder.`,
      'guide.mac3Title': `Open it the first time`,
      'guide.mac3Body': `Open blank from Applications. If macOS says it cannot verify the app, right-click or Control-click blank, choose Open, then Open again.`,
      'guide.macNoteTitle': `Not notarized yet`,
      'guide.macNoteBody': `macOS builds are not notarized. If the app still will not open, allow it in System Settings → Privacy & Security. Data stays in <code>~/.blank</code>.`,
      'guide.linuxMeta': `Linux · x64 · AppImage`,
      'guide.downloadLinux': `Download AppImage`,
      'guide.linux1Title': `Download the AppImage`,
      'guide.linux1Body': `The AppImage is a single file and does not need a separate installer.`,
      'guide.linux2Title': `Make it executable`,
      'guide.linux2Body': `In a terminal, run <code>chmod +x</code> on the downloaded file.`,
      'guide.linux3Title': `Run blank`,
      'guide.linux3Body': `Run the AppImage from a terminal, or double-click it if your file manager allows. Automatic updates need the AppImage to be launched directly.`,
      'guide.linuxNoteTitle': `Updates and data`,
      'guide.linuxNoteBody': `Updates come from GitHub releases and need the AppImage to stay in place. Extracted builds cannot update themselves.`,
      'guide.deviceLabel': `This device`,
      'guide.detected': `Detected`,
      'guide.deviceNote': `The matching build is shown first. Choose another tab for a different platform.`,
      'guide.showSteps': `Show the steps →`,
      'guide.releaseLabel': `Latest release`,
      'guide.notes': `Release notes`,
      'guide.allReleases': `All releases`,
      'guide.dataLabel': `Data`,
      'guide.dataNote': `Keys and sessions stay on this device.`,
      'guide.alreadyTitle': `Installed, but still asked to install?`,
      'guide.alreadyBody': `Open Settings → About and check the version that is running. If it is older than the latest release, an old copy from a temporary folder is probably still open. Quit every blank window, then open the installed blank from the Start menu or Applications. The installer replaces the installed copy; it cannot update the window that launched it.`,
      'guide.backHome': `Back to home`,
      'closing.title': `Start from a blank page.`,
      'footer.product': `Product`,
      'footer.features': `Features`,
      'footer.install': `Install`,
      'footer.releases': `Releases`,
      'footer.resources': `Resources`,
      'footer.github': `GitHub`,
      'footer.privacy': `Privacy`,
      'footer.terms': `Terms`,
      'footer.signing': `Code signing policy`,
      'footer.source': `Source code`,
      'footer.documents': `Docs`,
      'footer.hosted': `Hosted on GitHub Pages.`,
      'footer.localFirst': `Local-first · No account`,

      'download.chooseOs': `Choose your download`,
      'download.platforms': `Windows · macOS · Linux`,
      'download.forOs': `Download for {os}`,
      'download.getBlank': `Get blank`,
      'download.forOsShort': `for {os}`,
      'download.viewRelease': `View releases`,
      'download.releaseMissing': `No {os} build in the latest release`,
      'download.onGithub': `On GitHub`,
      'download.inReleases': `Installers are on GitHub`,
      'download.unavailable': `Downloads unavailable`,
      'download.notConfigured': `Downloads are not configured`,
      'download.pagesSetup': `Set up the Pages workflow`,
      'download.localPreview': `Local preview`,
      'download.installer': `Download installer`,
      'download.disk': `Download disk image`,
      'download.appimage': `Download AppImage`,
      'download.guide': `Install guide`,
      'download.macAltIntel': `Intel Mac build`,
      'download.macAltArm': `Apple silicon build`,
      'download.missing': `View releases`,
      'download.noBuild': `No build in the latest release`,
      'download.repoHint': `Connect the repository to enable downloads`,
      'release.latest': `v{v} · Latest release`,
      'release.none': `No releases yet`,
      'error.releaseMissing': `No release found`,
      'error.releaseFetch': `Could not reach GitHub Releases`,
      'asset.installer': `Installer`,
      'asset.disk': `Disk image`,
      'asset.appimage': `AppImage`,
      'os.thisDevice': `This device`,

      'legal.privacy.title': `Privacy Policy`,
      'legal.privacy.description': `blank's privacy policy. Local-first, no accounts, no analytics cookies.`,
      'legal.terms.title': `Terms of Use`,
      'legal.terms.description': `blank's terms of use. MIT license, provided as is, your responsibility.`,
      'legal.updated': `Effective November 5, 2026`,
      'legal.note': `This translation is provided for convenience. If there is any discrepancy, the Korean original prevails.`,
      'legal.privacy.html': `<h2>1. Scope</h2>
<p>This policy applies to the blank desktop app and its official website (<code>purplemacaron.github.io/blank</code>). blank does not operate an account server or a user database.</p>
<h2>2. What we do not collect</h2>
<p>blank does not ask for account details such as your name, email address or phone number. The official site has no advertising identifiers, analytics tools or tracking cookies.</p>
<h2>3. Information stored on your device</h2>
<p>When you use the app, the following information is stored by default in the <code>~/.blank</code> folder on your computer.</p>
<ul>
<li>Settings and provider keys: <code>config.json</code></li>
<li>Chat sessions, memory, skills and checkpoints</li>
<li>Generated media and Paper documents</li>
<li>Run logs and automation history</li>
</ul>
<p>After a key is saved, its full value is masked and is not shown again. You can change the data location with the <code>BLANK_HOME</code> environment variable; deleting the folder also deletes that data.</p>
<h2>4. Information sent to external services</h2>
<p>blank itself does not send your conversations to its own servers. However, prompts, attachments and tool results needed for a task may be sent to model providers, search APIs, MCP servers, media engines and SSH targets that you choose or configure. That information is governed by each provider's privacy policy and retention practices.</p>
<p>Installers are provided through GitHub Releases and the site through GitHub Pages. GitHub may process ordinary server logs such as IP address, browser information and request time. See GitHub's privacy policy for details.</p>
<h2>5. Local storage on the site</h2>
<p>The official site temporarily stores the latest release information in <code>sessionStorage</code> for up to 10 minutes. This lets the download button appear quickly; the value disappears when the tab closes and is not sent to a server.</p>
<h2>6. Retention and deletion</h2>
<p>Local data remains on your device until you delete it. You can open the app's data folder and delete sessions, media and settings individually. Uninstalling the app does not automatically delete the <code>~/.blank</code> folder.</p>
<h2>7. Children and adolescents</h2>
<p>blank does not create accounts or collect personal information such as names, email addresses, phone numbers or dates of birth. Because there is no procedure for entering personal information, users under 14 can use the app and site without separate parental consent. Conversations and settings in the app are stored on the user's device.</p>
<p>The terms of use and age policies of the model, search and MCP providers you connect are set by those providers. When a minor uses blank, we recommend that a guardian review the settings and scope of use together.</p>
<h2>8. External links</h2>
<p>The site and app may contain links to GitHub, model providers and other external services. This policy does not apply to how external sites handle information.</p>
<h2>9. Changes to this policy</h2>
<p>We may update this policy when features or laws change. Important changes will be posted on this page with an effective date.</p>
<h2>10. Contact</h2>
<p>For questions about privacy, please use <a href="https://github.com/purplemacaron/blank/issues" target="_blank" rel="noreferrer">GitHub Issues</a>.</p>
<div class="inline-actions"><a class="btn btn-ghost" href="terms.html">View Terms</a><a class="btn btn-ghost" href="index.html">Back to home</a></div>`,
      'legal.terms.html': `<h2>1. Scope</h2>
<p>These terms apply to downloading and using the blank desktop app and official site. Installing the app or using the site means you agree to these terms.</p>
<h2>2. License</h2>
<p>blank's source code is released under the MIT License. These terms do not limit the rights granted by the MIT License; if they conflict, the MIT License prevails.</p>
<h2>3. Your responsibilities</h2>
<p>You are responsible for the provider keys, accounts, workspaces, commands and content you configure or create.</p>
<ul>
<li>You must comply with the terms of model providers, search APIs, MCP servers, media engines and SSH targets.</li>
<li>Do not use blank for illegal access, infringement of rights or running malicious code.</li>
<li>Back up important files yourself.</li>
</ul>
<h2>4. No warranty</h2>
<p>blank is provided “as is.” We make no warranty of merchantability, fitness for a particular purpose, non-infringement, freedom from errors, or the accuracy or validity of model output. Review what the agent produces before relying on it.</p>
<h2>5. Limitation of liability</h2>
<p>To the extent permitted by applicable law, the creators of blank are not liable for data loss, interruption of work, third-party service costs, or indirect, special or punitive damages arising from use of the app. This clause does not exclude liability that cannot be excluded by law.</p>
<h2>6. Changes to the service</h2>
<p>blank may add, change or discontinue features or distribution without prior notice. The official site and releases are provided through GitHub, and blank does not guarantee GitHub's availability.</p>
<h2>7. Governing law</h2>
<p>These terms are interpreted under the laws of the Republic of Korea. Disputes will be resolved in the courts with jurisdiction under applicable law.</p>
<h2 id="code-signing">8. Code signing policy</h2>
<p>Free code signing provided by <a href="https://signpath.io/" target="_blank" rel="noreferrer">SignPath.io</a>, certificate by <a href="https://signpath.org/" target="_blank" rel="noreferrer">SignPath Foundation</a>.</p>
<p>Windows release installers are built by this repository's GitHub Actions workflow and signed after manual approval. The signature links the installer to the public source repository.</p>
<ul>
<li>Committers and reviewers: <a href="https://github.com/purplemacaron" target="_blank" rel="noreferrer">@purplemacaron</a></li>
<li>Approvers: <a href="https://github.com/purplemacaron" target="_blank" rel="noreferrer">@purplemacaron</a></li>
</ul>
<p>Only artifacts built from this repository are signed. Third-party components bundled with blank are not signed by this certificate.</p>
<p>Privacy policy: <a href="privacy.html">Privacy Policy</a>. blank does not transfer information to other networked systems unless you request it or configure a provider.</p>
<h2>9. Contact</h2>
<p>For questions about these terms, please use <a href="https://github.com/purplemacaron/blank/issues" target="_blank" rel="noreferrer">GitHub Issues</a>.</p>
<div class="inline-actions"><a class="btn btn-ghost" href="privacy.html">View Privacy</a><a class="btn btn-ghost" href="index.html">Back to home</a></div>`
    },

    ja: {
      'meta.title': `blank — 会話のあと、ファイルが残る`,
      'meta.description': `モデル、ツール、ファイル、ターミナルをひとつの画面に。アカウント不要で、この端末だけで動くローカルファーストのデスクトップエージェント。`,
      'meta.ogTitle': `blank — 会話のあと、ファイルが残る`,
      'meta.ogDescription': `モデル、ツール、ファイル、ターミナルをひとつの画面に。ローカルファースト、アカウント不要。`,
      'meta.privacyTitle': `プライバシーポリシー — blank`,
      'meta.termsTitle': `利用規約 — blank`,
      'meta.ogLocale': `ja_JP`,
      'brand.home': `blank ホーム`,
      'nav.main': `メインメニュー`,
      'nav.features': `機能`,
      'nav.install': `インストール`,
      'nav.download': `ダウンロード`,
      'menu.label': `メニューを開く`,
      'lang.label': `言語`,
      'skip': `本文へスキップ`,
      'hero.eyebrow': `ローカルデスクトップエージェント`,
      'hero.titleHtml': `会話のあと、<br /><span>ファイルが残る。</span>`,
      'hero.lead': `モデルとツール、ファイルとターミナルをひとつの画面に。`,
      'hero.free': `無料 · MIT · アカウント不要`,
      'release.initial': `最新リリース`,
      'stage.aria': `ファイルを読み、数値を更新して、新しいファイルカードを渡す blank の画面`,
      'stage.sideNew': `新しいセッション`,
      'stage.sideChat': `チャット`,
      'stage.sidePapers': `ペーパー`,
      'stage.sideCode': `コード`,
      'stage.sideTerminal': `ターミナル`,
      'stage.sideLabel': `セッション`,
      'stage.sessionQ3': `第3四半期レポート`,
      'stage.now': `たった今`,
      'stage.sessionRelease': `リリースノート`,
      'stage.yesterday': `昨日`,
      'stage.sideFoot': `MCP 3 · メッセンジャー 2`,
      'stage.title': `第3四半期レポート`,
      'stage.local': `ローカル`,
      'stage.user': `q3-report.md の12〜14行目、数字だけ更新して。`,
      'stage.checked': `ファイル2件を確認`,
      'stage.reply': `数値を更新しました。ほかの文章はそのままです。`,
      'stage.toolRead': `ファイルを読む`,
      'stage.toolReadFile': `q3-report.md`,
      'stage.toolEdit': `ファイルを編集`,
      'stage.toolEditLines': `12〜14行`,
      'stage.fileName': `第3四半期 運用レポート.md`,
      'stage.fileMeta': `382 B · 保存済み`,
      'stage.open': `開く`,
      'stage.composer': `blank に任せること…`,
      'stage.plan': `計画`,
      'stage.agent': `エージェント`,
      'stage.stepRead': `ファイルを読む`,
      'stage.stepNumbers': `数値を更新`,
      'stage.stepWording': `文章を確認`,
      'stage.stepDeliver': `ファイルに渡す`,
      'features.eyebrow': `機能`,
      'features.title': `実行して、確認して、残す。`,
      'feature1.title': `ツールを実行`,
      'feature1.body': `ファイルの読み書き、ターミナル、ブラウザ。`,
      'feature2.title': `確認してから実行`,
      'feature2.body': `重要な操作だけ承認を求めます。`,
      'feature3.title': `ローカルに保存`,
      'feature3.bodyHtml': `キーとセッションは <code>~/.blank</code> に。`,
      'install.eyebrow': `インストール`,
      'install.title': `この端末に合うものを。`,
      'install.thisDevice': `この端末`,
      'install.winMeta': `インストーラー · Windows 10 以降`,
      'install.macMeta': `ディスクイメージ · Apple silicon`,
      'install.linuxMeta': `AppImage · x64`,
      'install.winAction': `インストーラーをダウンロード`,
      'install.macAction': `ディスクイメージをダウンロード`,
      'install.linuxAction': `AppImage をダウンロード`,
      'install.macAlt': `Intel Mac ビルド`,
      'install.noteHtml': `すべてのビルドと変更履歴は <a id="releases-link" href="#install">GitHub Releases</a> にあります。`,
      'install.signHtml': `Windows リリースは <a href="terms.html#code-signing">SignPath.io</a> の無料コード署名を使用し、証明書は SignPath Foundation が発行します。`,
      'install.dataHtml': `データ <code>~/.blank</code>`,
      'meta.guideTitle': `blank のインストール — blank`,
      'meta.guideDescription': `Windows、macOS、Linux 版 blank のダウンロードとインストール手順。未署名の Windows ビルドで表示される SmartScreen の手順も掲載しています。`,
      'guide.eyebrow': `インストールガイド`,
      'guide.title': `blank をインストール`,
      'guide.lead': `ダウンロードして実行し、この端末で始めましょう。Windows ビルドはまだ署名されていないため、SmartScreen の確認が一度表示されます。`,
      'guide.tabsLabel': `プラットフォーム`,
      'guide.winMeta': `Windows 10 以降 · x64 · インストーラー`,
      'guide.downloadWin': `インストーラーをダウンロード`,
      'guide.checking': `最新リリースを確認中…`,
      'guide.downloadNote': `GitHub Releases から直接ダウンロードします。`,
      'guide.win1Title': `インストーラーを実行`,
      'guide.win1Body': `ダウンロードフォルダーからセットアップファイルを開きます。変更を許可するか聞かれたら「はい」を選びます。`,
      'guide.win2Title': `SmartScreen を一度だけ通す`,
      'guide.win2Body': `「Windows によって PC が保護されました」と表示されたら、「詳細情報」をクリックし、続けて「実行」をクリックします。インストーラーがまだコード署名されていないため、一度だけ表示されます。`,
      'guide.smartDialogTitle': `Windows によって PC が保護されました`,
      'guide.smartDialogBody': `Microsoft Defender SmartScreen により、認識されないアプリの起動が阻止されました。`,
      'guide.smartDontRun': `実行しない`,
      'guide.smartMore': `詳細情報`,
      'guide.smartRun': `実行`,
      'guide.win3Title': `完了して blank を開く`,
      'guide.win3Body': `既定のインストール先のままセットアップを完了し、スタートメニューから blank を開きます。古い blank のウィンドウが開いていれば先に閉じます。`,
      'guide.smartTitle': `この警告が表示される理由`,
      'guide.signBody': `現在の Windows インストーラーはまだコード署名されていません。SignPath Foundation の審査が完了すると署名済みビルドに切り替わります。SmartScreen を無効にしたり除外に追加したりしないでください。このページか GitHub のリリースからのみダウンロードしてください。<a href="terms.html#code-signing">コード署名ポリシー</a>`,
      'guide.macMeta': `macOS 11 以降 · Apple silicon または Intel`,
      'guide.downloadMac': `ディスクイメージをダウンロード`,
      'guide.mac1Title': `ディスクイメージをダウンロード`,
      'guide.mac1Body': `Mac に合わせて Apple silicon か Intel を選びます。この端末に合うビルドが最初から選ばれています。`,
      'guide.mac2Title': `blank を Applications に移動`,
      'guide.mac2Body': `.dmg を開き、blank を Applications フォルダーにドラッグします。`,
      'guide.mac3Title': `初回だけ開く`,
      'guide.mac3Body': `Applications から blank を開きます。macOS が確認できないと表示したら、blank を右クリックまたは Control クリックして「開く」を選び、もう一度「開く」を押します。`,
      'guide.macNoteTitle': `公証前のビルド`,
      'guide.macNoteBody': `macOS ビルドはまだ公証されていません。それでも開けない場合は、システム設定 → プライバシーとセキュリティで許可してください。データは <code>~/.blank</code> に残ります。`,
      'guide.linuxMeta': `Linux · x64 · AppImage`,
      'guide.downloadLinux': `AppImage をダウンロード`,
      'guide.linux1Title': `AppImage をダウンロード`,
      'guide.linux1Body': `AppImage は単一ファイルで、別途インストーラーは必要ありません。`,
      'guide.linux2Title': `実行権限を付ける`,
      'guide.linux2Body': `ターミナルで、ダウンロードしたファイルに <code>chmod +x</code> を実行します。`,
      'guide.linux3Title': `blank を実行`,
      'guide.linux3Body': `ターミナルから AppImage を実行するか、ファイルマネージャーが許可する場合はダブルクリックします。自動更新は AppImage を直接起動した場合に動作します。`,
      'guide.linuxNoteTitle': `更新とデータ`,
      'guide.linuxNoteBody': `更新は GitHub リリースから提供され、AppImage をそのままの場所に置いておく必要があります。展開したビルドは自己更新できません。`,
      'guide.deviceLabel': `この端末`,
      'guide.detected': `検出済み`,
      'guide.deviceNote': `この端末に合うビルドを先に表示しています。別のプラットフォームは上のタブで選べます。`,
      'guide.showSteps': `手順を見る →`,
      'guide.releaseLabel': `最新リリース`,
      'guide.notes': `リリースノート`,
      'guide.allReleases': `すべてのリリース`,
      'guide.dataLabel': `データ`,
      'guide.dataNote': `キーとセッションはこの端末に残ります。`,
      'guide.alreadyTitle': `インストール済みなのに、まだインストールを求められる？`,
      'guide.alreadyBody': `設定 → About で実行中のバージョンを確認してください。最新リリースより古い場合、一時フォルダーの古いコピーが開いている可能性があります。blank のウィンドウをすべて終了し、スタートメニューまたは Applications からインストール済みの blank を開きます。インストーラーはインストール済みのコピーだけを置き換え、インストールを実行した元のウィンドウは更新しません。`,
      'guide.backHome': `ホームへ`,
      'closing.title': `空白の画面から始めましょう。`,
      'footer.product': `製品`,
      'footer.features': `機能`,
      'footer.install': `インストール`,
      'footer.releases': `リリース`,
      'footer.resources': `リソース`,
      'footer.github': `GitHub`,
      'footer.privacy': `プライバシーポリシー`,
      'footer.terms': `利用規約`,
      'footer.signing': `コード署名ポリシー`,
      'footer.source': `ソースコード`,
      'footer.documents': `ドキュメント`,
      'footer.hosted': `GitHub Pages でホストされています。`,
      'footer.localFirst': `ローカル優先 · アカウント不要`,

      'download.chooseOs': `ダウンロードを選ぶ`,
      'download.platforms': `Windows · macOS · Linux`,
      'download.forOs': `{os} 用ダウンロード`,
      'download.getBlank': `blank を入手`,
      'download.forOsShort': `{os} 用`,
      'download.viewRelease': `リリースを見る`,
      'download.releaseMissing': `最新リリースに {os} ビルドがありません`,
      'download.onGithub': `GitHub で`,
      'download.inReleases': `インストーラーは GitHub にあります`,
      'download.unavailable': `ダウンロードできません`,
      'download.notConfigured': `ダウンロードが設定されていません`,
      'download.pagesSetup': `Pages ワークフローを設定してください`,
      'download.localPreview': `ローカルプレビュー`,
      'download.installer': `インストーラーをダウンロード`,
      'download.disk': `ディスクイメージをダウンロード`,
      'download.appimage': `AppImage をダウンロード`,
      'download.guide': `インストールガイド`,
      'download.macAltIntel': `Intel Mac ビルド`,
      'download.macAltArm': `Apple silicon ビルド`,
      'download.missing': `リリースを見る`,
      'download.noBuild': `最新リリースにビルドがありません`,
      'download.repoHint': `リポジトリを接続するとダウンロードできます`,
      'release.latest': `v{v} · 最新リリース`,
      'release.none': `リリースはまだありません`,
      'error.releaseMissing': `リリースが見つかりません`,
      'error.releaseFetch': `GitHub Releases に接続できませんでした`,
      'asset.installer': `インストーラー`,
      'asset.disk': `ディスクイメージ`,
      'asset.appimage': `AppImage`,
      'os.thisDevice': `この端末`,

      'legal.privacy.title': `プライバシーポリシー`,
      'legal.privacy.description': `blank のプライバシーポリシー。ローカルファースト、アカウントなし、分析 Cookie なし。`,
      'legal.terms.title': `利用規約`,
      'legal.terms.description': `blank の利用規約。MIT ライセンス、現状有姿、ユーザーの責任。`,
      'legal.updated': `施行日 2026年11月5日`,
      'legal.note': `この翻訳は参考用です。相違がある場合は韓国語の原文が優先します。`,
      'legal.privacy.html': `<h2>1. 適用範囲</h2>
<p>このポリシーは blank デスクトップアプリと公式サイト（<code>purplemacaron.github.io/blank</code>）に適用されます。blank はアカウントサーバーやユーザーデータベースを運営していません。</p>
<h2>2. 収集しない情報</h2>
<p>blank は氏名、メールアドレス、電話番号などのアカウント情報を求めません。公式サイトには広告識別子、分析ツール、追跡 Cookie はありません。</p>
<h2>3. 端末に保存される情報</h2>
<p>アプリを使用すると、次の情報が既定でコンピューターの <code>~/.blank</code> フォルダーに保存されます。</p>
<ul>
<li>設定とプロバイダーキー: <code>config.json</code></li>
<li>チャットセッション、メモリ、スキル、チェックポイント</li>
<li>生成したメディアと Paper ドキュメント</li>
<li>実行ログと自動化の履歴</li>
</ul>
<p>キーは保存後に全体がマスクされ、再表示されません。<code>BLANK_HOME</code> 環境変数でデータの場所を変更できます。フォルダーを削除すると、そのデータも削除されます。</p>
<h2>4. 外部に送信される情報</h2>
<p>blank 自体は会話を独自のサーバーに送信しません。ただし、選択または設定したモデルプロバイダー、検索 API、MCP サーバー、メディアエンジン、SSH 接続先には、タスクに必要なプロンプト、添付ファイル、ツール結果が送信されることがあります。これらの情報は各提供者のプライバシーポリシーと保存方針に従います。</p>
<p>インストーラーは GitHub Releases、サイトは GitHub Pages で提供されます。GitHub は IP アドレス、ブラウザー情報、リクエスト時刻などの一般的なサーバーログを処理することがあります。詳しくは GitHub のプライバシーポリシーをご確認ください。</p>
<h2>5. サイトのローカルストレージ</h2>
<p>公式サイトは最新リリース情報を最大10分間 <code>sessionStorage</code> に一時保存します。これはダウンロードボタンをすばやく表示するためで、タブを閉じると消え、サーバーには送信されません。</p>
<h2>6. 保存と削除</h2>
<p>ローカルデータは、ユーザーが削除するまで端末に残ります。アプリのデータフォルダーを開き、セッション、メディア、設定を個別に削除できます。アプリをアンインストールしても <code>~/.blank</code> フォルダーは自動的に削除されません。</p>
<h2>7. 子どもと青少年</h2>
<p>blank はアカウントを作成せず、氏名、メールアドレス、電話番号、生年月日などの個人情報を収集しません。個人情報を入力する手続きがないため、14歳未満のユーザーも保護者の同意なしでアプリとサイトを利用できます。アプリの会話と設定はユーザーの端末に保存されます。</p>
<p>接続したモデル、検索、MCP プロバイダーの利用条件と年齢ポリシーは各提供者に従います。未成年者が使用する場合は、保護者が設定と利用範囲を一緒に確認することをおすすめします。</p>
<h2>8. 外部リンク</h2>
<p>サイトとアプリには、GitHub、モデルプロバイダー、その他の外部サービスへのリンクが含まれる場合があります。外部サイトの情報の取り扱いにこのポリシーは適用されません。</p>
<h2>9. ポリシーの変更</h2>
<p>機能や法令の変更に応じてこのポリシーを更新することがあります。重要な変更は施行日とともにこのページに掲載します。</p>
<h2>10. お問い合わせ</h2>
<p>プライバシーに関するご質問は <a href="https://github.com/purplemacaron/blank/issues" target="_blank" rel="noreferrer">GitHub Issues</a> までお寄せください。</p>
<div class="inline-actions"><a class="btn btn-ghost" href="terms.html">利用規約を見る</a><a class="btn btn-ghost" href="index.html">ホームへ</a></div>`,
      'legal.terms.html': `<h2>1. 適用</h2>
<p>本規約は blank デスクトップアプリと公式サイトのダウンロードおよび利用に適用されます。アプリをインストールするかサイトを利用すると、本規約に同意したものとみなされます。</p>
<h2>2. ライセンス</h2>
<p>blank のソースコードは MIT License で公開されています。本規約は MIT License が与える権利を制限せず、矛盾する場合は MIT License が優先します。</p>
<h2>3. ユーザーの責任</h2>
<p>ユーザーは、自分が設定したプロバイダーキー、アカウント、ワークスペース、実行したコマンドと生成したコンテンツについて責任を負います。</p>
<ul>
<li>モデルプロバイダー、検索 API、MCP サーバー、メディアエンジン、SSH 接続先の利用規約を守る必要があります。</li>
<li>違法なアクセス、権利侵害、マルウェアの実行に blank を使用してはなりません。</li>
<li>重要なファイルはご自身でバックアップしてください。</li>
</ul>
<h2>4. 保証なし</h2>
<p>blank は「現状有姿」で提供されます。商品性、特定目的への適合性、非侵害性、エラーの不存在、モデル出力の正確性や有効性を保証しません。エージェントが生成した結果は使用前に確認してください。</p>
<h2>5. 責任の制限</h2>
<p>関連法が許す範囲で、blank の制作者はアプリの使用によるデータの損失、業務の中断、第三者サービスの費用、間接・特別・懲罰的損害について責任を負いません。この条項は、法律上排除できない責任を排除するものではありません。</p>
<h2>6. サービスの変更</h2>
<p>blank は事前の通知なく機能を追加、変更、または配布を中止することがあります。公式サイトとリリースは GitHub を通じて提供され、GitHub の可用性は blank が保証しません。</p>
<h2>7. 準拠法</h2>
<p>本規約は大韓民国の法律に従って解釈されます。紛争が生じた場合は、関連法が定める管轄裁判所で解決します。</p>
<h2 id="code-signing">8. コード署名ポリシー (Code signing policy)</h2>
<p>Free code signing provided by <a href="https://signpath.io/" target="_blank" rel="noreferrer">SignPath.io</a>, certificate by <a href="https://signpath.org/" target="_blank" rel="noreferrer">SignPath Foundation</a>.</p>
<p>Windows リリースのインストーラーは、このリポジトリの GitHub Actions ワークフローでビルドされ、手動承認後に署名されます。署名はインストーラーと公開ソースリポジトリを結び付けます。</p>
<ul>
<li>コミッターとレビュアー: <a href="https://github.com/purplemacaron" target="_blank" rel="noreferrer">@purplemacaron</a></li>
<li>承認者: <a href="https://github.com/purplemacaron" target="_blank" rel="noreferrer">@purplemacaron</a></li>
</ul>
<p>このリポジトリからビルドされた成果物のみに署名します。blank に同梱されるサードパーティ製コンポーネントは、この証明書では署名されません。</p>
<p>プライバシーポリシー: <a href="privacy.html">プライバシーポリシー</a>。blank は、ユーザーが要求するかプロバイダーを設定しない限り、他のネットワークシステムに情報を送信しません。</p>
<h2>9. お問い合わせ</h2>
<p>本規約に関するご質問は <a href="https://github.com/purplemacaron/blank/issues" target="_blank" rel="noreferrer">GitHub Issues</a> までお寄せください。</p>
<div class="inline-actions"><a class="btn btn-ghost" href="privacy.html">プライバシーポリシーを見る</a><a class="btn btn-ghost" href="index.html">ホームへ</a></div>`
    },

    zh: {
      'meta.title': `blank — 对话结束后，文件还在`,
      'meta.description': `模型、工具、文件和终端，都在一个窗口里。无需账号，在这台设备上运行的本地优先桌面智能体。`,
      'meta.ogTitle': `blank — 对话结束后，文件还在`,
      'meta.ogDescription': `模型、工具、文件和终端，都在一个窗口里。本地优先，无需账号。`,
      'meta.privacyTitle': `隐私政策 — blank`,
      'meta.termsTitle': `使用条款 — blank`,
      'meta.ogLocale': `zh_CN`,
      'brand.home': `blank 首页`,
      'nav.main': `主导航`,
      'nav.features': `功能`,
      'nav.install': `安装`,
      'nav.download': `下载`,
      'menu.label': `打开菜单`,
      'lang.label': `语言`,
      'skip': `跳到正文`,
      'hero.eyebrow': `本地桌面智能体`,
      'hero.titleHtml': `对话结束后，<br /><span>文件还在。</span>`,
      'hero.lead': `模型、工具、文件和终端，都在一个窗口里。`,
      'hero.free': `免费 · MIT · 无需账号`,
      'release.initial': `最新版本`,
      'stage.aria': `读取文件、更新数字并交付新文件卡片的 blank 界面`,
      'stage.sideNew': `新会话`,
      'stage.sideChat': `聊天`,
      'stage.sidePapers': `文稿`,
      'stage.sideCode': `代码`,
      'stage.sideTerminal': `终端`,
      'stage.sideLabel': `会话`,
      'stage.sessionQ3': `第三季度报告`,
      'stage.now': `刚刚`,
      'stage.sessionRelease': `发布说明`,
      'stage.yesterday': `昨天`,
      'stage.sideFoot': `MCP 3 · 消息应用 2`,
      'stage.title': `第三季度报告`,
      'stage.local': `本地`,
      'stage.user': `只更新 q3-report.md 第 12–14 行的数字。`,
      'stage.checked': `已检查 2 个文件`,
      'stage.reply': `数字已更新。其余文字保持不变。`,
      'stage.toolRead': `读取文件`,
      'stage.toolReadFile': `q3-report.md`,
      'stage.toolEdit': `编辑文件`,
      'stage.toolEditLines': `第 12–14 行`,
      'stage.fileName': `第三季度运营报告.md`,
      'stage.fileMeta': `382 B · 已保存`,
      'stage.open': `打开`,
      'stage.composer': `交给 blank 的事…`,
      'stage.plan': `计划`,
      'stage.agent': `智能体`,
      'stage.stepRead': `读取文件`,
      'stage.stepNumbers': `更新数字`,
      'stage.stepWording': `检查文字`,
      'stage.stepDeliver': `交付文件`,
      'features.eyebrow': `功能`,
      'features.title': `执行、确认、留下。`,
      'feature1.title': `执行工具`,
      'feature1.body': `读写文件、终端、浏览器。`,
      'feature2.title': `重要操作先确认`,
      'feature2.body': `只有重要操作才请求批准。`,
      'feature3.title': `保存在本地`,
      'feature3.bodyHtml': `密钥和会话保存在 <code>~/.blank</code>。`,
      'install.eyebrow': `安装`,
      'install.title': `获取适合这台设备的版本。`,
      'install.thisDevice': `此设备`,
      'install.winMeta': `安装包 · Windows 10 或更高版本`,
      'install.macMeta': `磁盘映像 · Apple silicon`,
      'install.linuxMeta': `AppImage · x64`,
      'install.winAction': `下载安装包`,
      'install.macAction': `下载磁盘映像`,
      'install.linuxAction': `下载 AppImage`,
      'install.macAlt': `Intel Mac 版本`,
      'install.noteHtml': `所有版本和更新记录都在 <a id="releases-link" href="#install">GitHub Releases</a>。`,
      'install.signHtml': `Windows 版本使用 <a href="terms.html#code-signing">SignPath.io</a> 的免费代码签名，证书由 SignPath Foundation 颁发。`,
      'install.dataHtml': `数据 <code>~/.blank</code>`,
      'meta.guideTitle': `安装 blank — blank`,
      'meta.guideDescription': `下载 Windows、macOS 或 Linux 版 blank，并查看未签名 Windows 版本的 SmartScreen 处理步骤。`,
      'guide.eyebrow': `安装指南`,
      'guide.title': `安装 blank`,
      'guide.lead': `下载、运行，在这台设备上开始。Windows 版本尚未签名，因此 SmartScreen 会询问一次。`,
      'guide.tabsLabel': `平台`,
      'guide.winMeta': `Windows 10 或更高版本 · x64 · 安装包`,
      'guide.downloadWin': `下载安装包`,
      'guide.checking': `正在检查最新版本…`,
      'guide.downloadNote': `直接从 GitHub Releases 下载。`,
      'guide.win1Title': `运行安装程序`,
      'guide.win1Body': `从下载文件夹打开安装文件。如果 Windows 询问是否允许更改，请选择“是”。`,
      'guide.win2Title': `通过一次 SmartScreen`,
      'guide.win2Body': `如果出现“Windows 已保护你的电脑”，请点击“更多信息”，然后点击“仍要运行”。安装包尚未代码签名，因此 Windows 会询问一次。`,
      'guide.smartDialogTitle': `Windows 已保护你的电脑`,
      'guide.smartDialogBody': `Microsoft Defender SmartScreen 阻止了无法识别的应用启动。`,
      'guide.smartDontRun': `不运行`,
      'guide.smartMore': `更多信息`,
      'guide.smartRun': `仍要运行`,
      'guide.win3Title': `完成并打开 blank`,
      'guide.win3Body': `保留默认安装位置，完成安装，然后从开始菜单打开 blank。请先关闭所有旧的 blank 窗口。`,
      'guide.smartTitle': `为什么会出现此警告`,
      'guide.signBody': `当前的 Windows 安装包尚未代码签名。SignPath Foundation 审核完成后会切换为已签名版本。请勿关闭 SmartScreen 或添加排除项；请仅从本页面或 GitHub 发行版下载。<a href="terms.html#code-signing">代码签名政策</a>`,
      'guide.macMeta': `macOS 11 或更高版本 · Apple silicon 或 Intel`,
      'guide.downloadMac': `下载磁盘映像`,
      'guide.mac1Title': `下载磁盘映像`,
      'guide.mac1Body': `根据你的 Mac 选择 Apple silicon 或 Intel。页面会默认选中适合此设备的版本。`,
      'guide.mac2Title': `将 blank 移到“应用程序”`,
      'guide.mac2Body': `打开 .dmg，将 blank 拖到“应用程序”文件夹。`,
      'guide.mac3Title': `首次打开`,
      'guide.mac3Body': `从“应用程序”打开 blank。如果 macOS 提示无法验证应用，请右键或按住 Control 点击 blank，选择“打开”，再点一次“打开”。`,
      'guide.macNoteTitle': `尚未公证`,
      'guide.macNoteBody': `macOS 版本尚未公证。如果仍无法打开，请在“系统设置”→“隐私与安全性”中允许。数据保留在 <code>~/.blank</code>。`,
      'guide.linuxMeta': `Linux · x64 · AppImage`,
      'guide.downloadLinux': `下载 AppImage`,
      'guide.linux1Title': `下载 AppImage`,
      'guide.linux1Body': `AppImage 是单个文件，无需单独的安装程序。`,
      'guide.linux2Title': `赋予执行权限`,
      'guide.linux2Body': `在终端中对下载的文件运行 <code>chmod +x</code>。`,
      'guide.linux3Title': `运行 blank`,
      'guide.linux3Body': `从终端运行 AppImage，或在文件管理器允许时双击。自动更新需要直接启动 AppImage。`,
      'guide.linuxNoteTitle': `更新与数据`,
      'guide.linuxNoteBody': `更新来自 GitHub 发行版，需要保留 AppImage 文件。解压后的版本无法自行更新。`,
      'guide.deviceLabel': `此设备`,
      'guide.detected': `已检测`,
      'guide.deviceNote': `已优先显示匹配的版本。可在上方标签切换其他平台。`,
      'guide.showSteps': `查看步骤 →`,
      'guide.releaseLabel': `最新版本`,
      'guide.notes': `发行说明`,
      'guide.allReleases': `所有版本`,
      'guide.dataLabel': `数据`,
      'guide.dataNote': `密钥和会话保存在此设备上。`,
      'guide.alreadyTitle': `已经安装，却仍提示安装？`,
      'guide.alreadyBody': `打开 Settings → About 查看正在运行的版本。如果低于最新版本，可能仍开着临时文件夹中的旧副本。请退出所有 blank 窗口，然后从开始菜单或“应用程序”打开已安装的 blank。安装程序只替换已安装的副本，无法更新启动它的旧窗口。`,
      'guide.backHome': `返回首页`,
      'closing.title': `从空白页面开始。`,
      'footer.product': `产品`,
      'footer.features': `功能`,
      'footer.install': `安装`,
      'footer.releases': `发行版`,
      'footer.resources': `资源`,
      'footer.github': `GitHub`,
      'footer.privacy': `隐私政策`,
      'footer.terms': `使用条款`,
      'footer.signing': `代码签名政策`,
      'footer.source': `源代码`,
      'footer.documents': `文档`,
      'footer.hosted': `由 GitHub Pages 托管。`,
      'footer.localFirst': `本地优先 · 无需账号`,

      'download.chooseOs': `选择下载`,
      'download.platforms': `Windows · macOS · Linux`,
      'download.forOs': `下载 {os} 版`,
      'download.getBlank': `获取 blank`,
      'download.forOsShort': `{os} 版`,
      'download.viewRelease': `查看发行版`,
      'download.releaseMissing': `最新版本中没有 {os} 版本`,
      'download.onGithub': `在 GitHub 上`,
      'download.inReleases': `安装包位于 GitHub`,
      'download.unavailable': `无法下载`,
      'download.notConfigured': `下载未配置`,
      'download.pagesSetup': `请设置 Pages 工作流`,
      'download.localPreview': `本地预览`,
      'download.installer': `下载安装包`,
      'download.disk': `下载磁盘映像`,
      'download.appimage': `下载 AppImage`,
      'download.guide': `安装指南`,
      'download.macAltIntel': `Intel Mac 版本`,
      'download.macAltArm': `Apple silicon 版本`,
      'download.missing': `查看发行版`,
      'download.noBuild': `最新版本中没有可用版本`,
      'download.repoHint': `连接仓库后即可下载`,
      'release.latest': `v{v} · 最新版本`,
      'release.none': `尚无发行版`,
      'error.releaseMissing': `未找到发行版`,
      'error.releaseFetch': `无法连接 GitHub Releases`,
      'asset.installer': `安装包`,
      'asset.disk': `磁盘映像`,
      'asset.appimage': `AppImage`,
      'os.thisDevice': `此设备`,

      'legal.privacy.title': `隐私政策`,
      'legal.privacy.description': `blank 的隐私政策。本地优先、无账号、无分析 Cookie。`,
      'legal.terms.title': `使用条款`,
      'legal.terms.description': `blank 的使用条款。MIT 许可、按现状提供、用户责任。`,
      'legal.updated': `生效日期 2026年11月5日`,
      'legal.note': `本译文仅供参考。如有出入，以韩文原文为准。`,
      'legal.privacy.html': `<h2>1. 适用范围</h2>
<p>本政策适用于 blank 桌面应用和官方网站（<code>purplemacaron.github.io/blank</code>）。blank 不运营账号服务器或用户数据库。</p>
<h2>2. 不收集的信息</h2>
<p>blank 不会要求姓名、电子邮箱、电话号码等账号信息。官方网站没有广告标识符、分析工具或跟踪 Cookie。</p>
<h2>3. 保存在设备上的信息</h2>
<p>使用应用时，以下信息默认保存在您电脑上的 <code>~/.blank</code> 文件夹中。</p>
<ul>
<li>设置和提供商密钥：<code>config.json</code></li>
<li>聊天会话、记忆、技能和检查点</li>
<li>生成的媒体和 Paper 文稿</li>
<li>运行日志和自动化记录</li>
</ul>
<p>密钥保存后会被掩码处理，不会再次显示完整值。您可以通过 <code>BLANK_HOME</code> 环境变量更改数据位置；删除该文件夹也会删除相应数据。</p>
<h2>4. 发送到外部的信息</h2>
<p>blank 本身不会把对话发送到自己的服务器。但任务所需的提示词、附件和工具结果可能会发送到您选择或配置的模型提供商、搜索 API、MCP 服务器、媒体引擎和 SSH 目标。这些信息受各提供商隐私政策和保存规则约束。</p>
<p>安装包通过 GitHub Releases 提供，网站通过 GitHub Pages 提供。GitHub 可能处理 IP 地址、浏览器信息和请求时间等常规服务器日志。详情请参阅 GitHub 的隐私政策。</p>
<h2>5. 网站的本地存储</h2>
<p>官方网站会将最新版本信息临时保存在 <code>sessionStorage</code> 中，最长 10 分钟。这样做是为了快速显示下载按钮；关闭标签页后即消失，不会发送到服务器。</p>
<h2>6. 保存与删除</h2>
<p>本地数据会一直保留在您的设备上，直到您删除它。您可以打开应用的数据文件夹，分别删除会话、媒体和设置。卸载应用不会自动删除 <code>~/.blank</code> 文件夹。</p>
<h2>7. 儿童与青少年</h2>
<p>blank 不创建账号，也不收集姓名、电子邮箱、电话号码或出生日期等个人信息。由于没有输入个人信息的流程，未满 14 岁的用户无需另行取得监护人同意即可使用应用和网站。应用中的对话和设置保存在用户设备上。</p>
<p>您连接的模型、搜索和 MCP 提供商的条款与年龄政策由各提供商制定。未成年人使用时，建议监护人共同确认设置和使用范围。</p>
<h2>8. 外部链接</h2>
<p>网站和应用可能包含指向 GitHub、模型提供商及其他外部服务的链接。本政策不适用于外部网站的信息处理方式。</p>
<h2>9. 政策变更</h2>
<p>当功能或法律发生变化时，我们可能会更新本政策。重要变更会连同生效日期发布在本页面。</p>
<h2>10. 联系方式</h2>
<p>如对隐私有疑问，请通过 <a href="https://github.com/purplemacaron/blank/issues" target="_blank" rel="noreferrer">GitHub Issues</a> 联系我们。</p>
<div class="inline-actions"><a class="btn btn-ghost" href="terms.html">查看使用条款</a><a class="btn btn-ghost" href="index.html">返回首页</a></div>`,
      'legal.terms.html': `<h2>1. 适用</h2>
<p>本条款适用于下载和使用 blank 桌面应用及官方网站。安装应用或使用网站即表示您同意本条款。</p>
<h2>2. 许可</h2>
<p>blank 的源代码以 MIT License 公开。本条款不限制 MIT License 授予的权利；如有冲突，以 MIT License 为准。</p>
<h2>3. 用户责任</h2>
<p>您对自己配置的提供商密钥、账号、工作区、执行的命令和生成的内容负责。</p>
<ul>
<li>您必须遵守模型提供商、搜索 API、MCP 服务器、媒体引擎和 SSH 目标的使用条款。</li>
<li>不得将 blank 用于非法访问、侵犯权利或运行恶意代码。</li>
<li>请自行备份重要文件。</li>
</ul>
<h2>4. 不作保证</h2>
<p>blank 按“现状”提供。我们不保证适销性、特定用途适用性、不侵权、无错误，也不保证模型输出的准确性或有效性。使用智能体生成的结果前请自行检查。</p>
<h2>5. 责任限制</h2>
<p>在适用法律允许的范围内，blank 的创作者不对因使用应用导致的数据丢失、工作中断、第三方服务费用或间接、特殊、惩罚性损害承担责任。本条不排除法律上不可排除的责任。</p>
<h2>6. 服务变更</h2>
<p>blank 可能在不事先通知的情况下增加、更改功能或停止分发。官方网站和发行版通过 GitHub 提供，blank 不保证 GitHub 的可用性。</p>
<h2>7. 适用法律</h2>
<p>本条款根据大韩民国法律解释。发生争议时，由相关法律规定的有管辖权法院解决。</p>
<h2 id="code-signing">8. 代码签名政策 (Code signing policy)</h2>
<p>Free code signing provided by <a href="https://signpath.io/" target="_blank" rel="noreferrer">SignPath.io</a>, certificate by <a href="https://signpath.org/" target="_blank" rel="noreferrer">SignPath Foundation</a>.</p>
<p>Windows 发行版安装程序由此仓库的 GitHub Actions 工作流构建，并在人工批准后签名。签名将安装程序与公开源代码仓库关联起来。</p>
<ul>
<li>提交者与审核者：<a href="https://github.com/purplemacaron" target="_blank" rel="noreferrer">@purplemacaron</a></li>
<li>批准者：<a href="https://github.com/purplemacaron" target="_blank" rel="noreferrer">@purplemacaron</a></li>
</ul>
<p>仅对此仓库构建的产物签名。blank 捆绑的第三方组件不使用此证书签名。</p>
<p>隐私政策：<a href="privacy.html">隐私政策</a>。除非您请求或配置了提供商，否则 blank 不会向其他网络系统传输信息。</p>
<h2>9. 联系方式</h2>
<p>如对本条款有疑问，请通过 <a href="https://github.com/purplemacaron/blank/issues" target="_blank" rel="noreferrer">GitHub Issues</a> 联系我们。</p>
<div class="inline-actions"><a class="btn btn-ghost" href="privacy.html">查看隐私政策</a><a class="btn btn-ghost" href="index.html">返回首页</a></div>`
    }
  };

  function normalize(value) {
    var code = String(value || '').toLowerCase();
    if (code.indexOf('ko') === 0) return 'ko';
    if (code.indexOf('ja') === 0) return 'ja';
    if (code.indexOf('zh') === 0) return 'zh';
    if (code.indexOf('en') === 0) return 'en';
    return '';
  }

  function initialLanguage() {
    var query = '';
    try { query = new URLSearchParams(location.search).get('lang') || ''; } catch (error) { /* older browser */ }
    var fromQuery = normalize(query);
    if (fromQuery) return fromQuery;
    try {
      var saved = normalize(localStorage.getItem(STORAGE_KEY));
      if (saved) return saved;
    } catch (error) { /* private mode */ }
    return normalize(navigator.language) || 'en';
  }

  function translate(key, vars) {
    var table = DICT[current] || DICT.en;
    var value = Object.prototype.hasOwnProperty.call(table, key) ? table[key] : DICT.en[key];
    if (value == null) value = key;
    if (vars) {
      Object.keys(vars).forEach(function (name) {
        value = value.split('{' + name + '}').join(String(vars[name]));
      });
    }
    return value;
  }

  function collect() {
    if (records) return;
    records = [];
    document.querySelectorAll('[data-i18n], [data-i18n-html], [data-i18n-attr], [data-legal-doc]').forEach(function (el) {
      if (el.hasAttribute('data-i18n')) {
        records.push({ el: el, type: 'text', key: el.getAttribute('data-i18n'), value: el.textContent });
      }
      if (el.hasAttribute('data-i18n-html')) {
        records.push({ el: el, type: 'html', key: el.getAttribute('data-i18n-html'), value: el.innerHTML });
      }
      if (el.hasAttribute('data-i18n-attr')) {
        el.getAttribute('data-i18n-attr').split(',').forEach(function (entry) {
          var parts = entry.split(':');
          var attr = String(parts.shift() || '').trim();
          var key = parts.join(':').trim();
          if (!attr || !key) return;
          records.push({ el: el, type: 'attr', attr: attr, key: key, value: el.getAttribute(attr) });
        });
      }
      if (el.hasAttribute('data-legal-doc')) {
        var doc = el.getAttribute('data-legal-doc');
        if (!originals[doc]) originals[doc] = el.innerHTML;
        records.push({ el: el, type: 'legal', doc: doc });
      }
    });
  }

  function applyRecords() {
    records.forEach(function (record) {
      var value;
      if (record.type === 'legal') {
        value = current === 'ko' ? originals[record.doc] : translate('legal.' + record.doc + '.html');
      } else if (current === 'ko') {
        value = record.value;
      } else {
        value = translate(record.key);
      }
      if (value == null) return;
      if (record.type === 'text') {
        if (record.el.textContent !== value) record.el.textContent = value;
      } else if (record.type === 'html') {
        if (record.el.innerHTML !== value) record.el.innerHTML = value;
      } else if (record.type === 'attr') {
        if (record.el.getAttribute(record.attr) !== value) record.el.setAttribute(record.attr, value);
      } else if (record.type === 'legal') {
        if (record.el.innerHTML !== value) record.el.innerHTML = value;
      }
    });
    document.querySelectorAll('[data-i18n-note]').forEach(function (el) {
      el.hidden = current === 'ko';
    });
  }

  function syncPicker() {
    var meta = LANGUAGES.find(function (item) { return item.code === current; }) || LANGUAGES[0];
    document.querySelectorAll('[data-lang-code]').forEach(function (el) { el.textContent = meta.short; });
    document.querySelectorAll('[data-lang-option]').forEach(function (button) {
      var selected = button.getAttribute('data-lang-option') === current;
      button.setAttribute('aria-selected', selected ? 'true' : 'false');
    });
    document.querySelectorAll('[data-lang-btn]').forEach(function (button) {
      button.setAttribute('aria-expanded', 'false');
    });
    document.querySelectorAll('[data-lang-menu]').forEach(function (menu) { menu.hidden = true; });
  }

  function apply(code, options) {
    var next = normalize(code) || 'ko';
    current = next;
    try { localStorage.setItem(STORAGE_KEY, next); } catch (error) { /* private mode */ }
    if (!options || !options.initial) {
      try {
        var url = new URL(location.href);
        if (next === 'ko') url.searchParams.delete('lang');
        else url.searchParams.set('lang', next);
        history.replaceState(null, '', url.pathname + url.search + url.hash);
      } catch (error) { /* file URLs */ }
    }
    collect();
    document.documentElement.lang = next === 'zh' ? 'zh-CN' : next;
    document.documentElement.setAttribute('data-lang', next);
    applyRecords();
    syncPicker();
    document.dispatchEvent(new CustomEvent('blank:langchange', { detail: { lang: next } }));
  }

  function closeMenus() {
    document.querySelectorAll('[data-lang-menu]').forEach(function (menu) { menu.hidden = true; });
    document.querySelectorAll('[data-lang-btn]').forEach(function (button) { button.setAttribute('aria-expanded', 'false'); });
  }

  document.addEventListener('click', function (event) {
    var button = event.target.closest('[data-lang-btn]');
    if (button) {
      var picker = button.closest('[data-lang-picker]');
      var menu = picker && picker.querySelector('[data-lang-menu]');
      if (!menu) return;
      var open = menu.hidden;
      closeMenus();
      menu.hidden = !open;
      button.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) {
        var active = menu.querySelector('[aria-selected="true"]');
        if (active) active.focus();
      }
      return;
    }
    var option = event.target.closest('[data-lang-option]');
    if (option) {
      apply(option.getAttribute('data-lang-option'));
      var btn = document.querySelector('[data-lang-btn]');
      if (btn) btn.focus();
      return;
    }
    if (!event.target.closest('[data-lang-picker]')) closeMenus();
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
      closeMenus();
      var btn = document.querySelector('[data-lang-btn]');
      if (btn) btn.focus();
    }
  });

  window.BLANK_SITE_I18N = {
    t: translate,
    apply: apply,
    get lang() { return current; },
    languages: LANGUAGES
  };

  apply(initialLanguage(), { initial: true });
})();
