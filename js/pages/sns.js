// js/pages/sns.js
// 「SNS関連」: サイドバーのYouTube関連5つと「Threads運用代行」を1つにまとめた入口のページ。
//   「YouTube」「Threads」をボタンで選び、各ページへのボタンを押すと、これまでと同じページ(同じ App.Pages.*)が開く。
//   各ページの中身・機能・権限は変更していない(ここは入口と現在地の表示だけ)。
(function () {
    // まとめたページの一覧(app.js の navigate からも参照: サイドバーの選択中表示・現在地の表示に使う)
    const SNS_PAGES = window.SNS_PAGES = {
        youtube: { group: 'youtube', label: 'YouTube管理(ロング)', icon: 'ph-youtube-logo', desc: '長尺動画の企画・台本・公式LINE' },
        youtube_short: { group: 'youtube', label: 'YouTube管理(ショート)', icon: 'ph-device-mobile', desc: 'ショート動画の企画・台本' },
        youtube_analytics: { group: 'youtube', label: 'YouTube分析データ', icon: 'ph-chart-line-up', desc: '再生数・表示回数・クリック率など' },
        youtube_subtitles: { group: 'youtube', label: 'YouTubeテロップ作成', icon: 'ph-subtitles', desc: '動画のテロップを作成' },
        short_upload: { group: 'youtube', label: 'ショート投稿予約', icon: 'ph-calendar-check', desc: 'ショート動画の投稿を予約' },
        threads: { group: 'threads', label: 'Threads運用代行', icon: 'ph-at', desc: 'Threadsの投稿・インサイト' }
    };
    const GROUPS = {
        youtube: { label: 'YouTube', icon: 'ph-youtube-logo', color: '#E03131' },
        threads: { label: 'Threads', icon: 'ph-at', color: '#212529' }
    };
    const ORDER = ['youtube', 'youtube_short', 'youtube_analytics', 'youtube_subtitles', 'short_upload', 'threads'];
    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

    // 上部の現在地と戻るボタン(app.js の navigate から呼ばれる)
    window.SnsBreadcrumb = function (target) {
        const info = SNS_PAGES[target];
        const el = document.getElementById('page-title');
        if (!info || !el) return;
        const g = GROUPS[info.group];
        el.innerHTML = `<span class="sns-crumb">
            <button type="button" class="sns-back" onclick="App.navigate('sns', '${info.group}')" title="${esc(g.label)}のメニューに戻る"><i class="ph ph-arrow-left"></i><span>戻る</span></button>
            <span class="sns-crumb-path"><a href="#" onclick="App.navigate('sns'); return false;">SNS関連</a><span class="sns-sep">＞</span><a href="#" onclick="App.navigate('sns', '${info.group}'); return false;">${esc(g.label)}</a><span class="sns-sep">＞</span><b>${esc(info.label)}</b></span>
        </span>`;
    };

    App.Pages.sns = async function (group) {
        const sel = GROUPS[group] ? group : null;
        const groupBtn = (k) => {
            const g = GROUPS[k];
            return `<button type="button" class="sns-group ${sel === k ? 'is-on' : ''}" data-group="${k}" onclick="App.navigate('sns', '${k}')" aria-pressed="${sel === k}">
                <i class="ph ${g.icon}" style="color:${sel === k ? '#fff' : g.color};"></i><span>${g.label}</span></button>`;
        };
        const pages = sel ? ORDER.filter(k => SNS_PAGES[k].group === sel) : [];
        const pageBtn = (k) => {
            const p = SNS_PAGES[k];
            return `<button type="button" class="sns-page" data-target="${k}" onclick="App.navigate('${k}')">
                <i class="ph ${p.icon}"></i><span class="sns-page-label">${esc(p.label)}</span><span class="sns-page-desc">${esc(p.desc)}</span>
                <i class="ph ph-caret-right sns-page-go"></i></button>`;
        };
        App.mount(`
            <div class="card sns-card">
                <div class="sns-step">どちらのSNSを使いますか？</div>
                <div class="sns-groups">${groupBtn('youtube')}${groupBtn('threads')}</div>
            </div>
            ${sel ? `<div class="card sns-card">
                <div class="sns-step">${esc(GROUPS[sel].label)}のメニュー</div>
                <div class="sns-pages">${pages.map(pageBtn).join('')}</div>
            </div>` : ''}`);
    };
})();
