// js/pages/qr_code.js
// QRコード作成: URLや文章を入力すると QRコードを作り、PNG / JPEG でダウンロードできるページ。
//
// ・作成はすべてブラウザの中で行う(入力した内容をサーバーに送らない)。
// ・QRコードの作成: qrcode-generator v2.0.4(Kazuhiko Arase / MIT)→ js/vendor/qrcode.js に同梱
//   https://github.com/kazuhikoarase/qrcode-generator
//   日本語も読めるように、文字は UTF-8 で入れる(qrcode.stringToBytesFuncs['UTF-8'])。
// ・誤り訂正レベル L/M/Q/H = 約7%/15%/25%/30% の汚れ・欠けまで読み取れる(デンソーウェーブ https://www.qrcode.com/about/error_correction.html)。
// ・まわりの余白(クワイエットゾーン)は 4セル以上が必要(https://www.qrcode.com/howto/code.html)。標準は4セル。
// ・画像は「1セル = 整数ピクセル」で描いて、ぼやけないようにする。指定サイズに足りない分は余白で調整する。
(function () {
    const VENDOR_SRC = 'js/vendor/qrcode.js';
    const SIZE_OPTIONS = [
        { value: '300', label: '小 300px(メール・チャット)' },
        { value: '600', label: '中 600px(Web・SNS)' },
        { value: '1000', label: '大 1000px(印刷・おすすめ)' },
        { value: '2000', label: '特大 2000px(ポスター)' }
    ];
    const ECL_OPTIONS = [
        { value: 'L', label: 'L 約7%(文字が多いとき)' },
        { value: 'M', label: 'M 約15%(標準・おすすめ)' },
        { value: 'Q', label: 'Q 約25%(汚れに強い)' },
        { value: 'H', label: 'H 約30%(いちばん強い)' }
    ];
    const MARGIN_OPTIONS = [
        { value: '4', label: '標準(4マス・おすすめ)' },
        { value: '6', label: '広め(6マス)' }
    ];

    // ページを移動しても入力内容は残す
    const S = window.QrCodeState = window.QrCodeState || {
        text: '', fileName: '', size: '1000', ecl: 'M', margin: '4', fg: '#000000', bg: '#ffffff'
    };

    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

    let loadingLib = null;
    function loadLib() {
        if (window.qrcode && window.qrcode.stringToBytesFuncs) return Promise.resolve(window.qrcode);
        if (!loadingLib) {
            loadingLib = new Promise((resolve, reject) => {
                const s = document.createElement('script');
                s.src = VENDOR_SRC;
                s.onload = () => window.qrcode ? resolve(window.qrcode) : reject(new Error('QRコードの部品が読み込めませんでした'));
                s.onerror = () => { loadingLib = null; reject(new Error(`${VENDOR_SRC} が読み込めませんでした(アップロード漏れの可能性があります)`)); };
                document.head.appendChild(s);
            });
        }
        return loadingLib;
    }

    // ---------- 色のチェック(読み取りにくい色の組み合わせを知らせる) ----------
    function luminance(hex) {
        const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
        if (!m) return 0;
        const n = parseInt(m[1], 16);
        const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => {
            v /= 255;
            return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
    }
    function colorWarning(fg, bg) {
        const lf = luminance(fg), lb = luminance(bg);
        if (lf >= lb) return 'QRコードの色が背景より明るくなっています。読み取れないスマホが多いので、「濃い色のQRコード+明るい背景」にしてください。';
        const ratio = (lb + 0.05) / (lf + 0.05);
        if (ratio < 4) return 'QRコードと背景の色の差が小さいため、読み取りにくい可能性があります。もっと濃い色・明るい背景にするのがおすすめです。';
        return '';
    }

    // ---------- QRコードを作る ----------
    // 戻り値: { canvas, moduleCount, version, actualSize } または { error }
    function buildQr(qrcode, text, opts) {
        qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
        let qr;
        try {
            qr = qrcode(0, opts.ecl);       // 0 = 入る大きさ(バージョン)を自動で選ぶ
            qr.addData(text, 'Byte');
            qr.make();
        } catch (e) {
            return { error: '文字が多すぎてQRコードに入りません。文字を減らすか、誤り訂正レベルを「L」にしてください。' };
        }
        const n = qr.getModuleCount();
        const margin = parseInt(opts.margin, 10) || 4;
        const target = parseInt(opts.size, 10) || 1000;
        const cells = n + margin * 2;
        const cell = Math.floor(target / cells);
        if (cell < 2) return { error: `文字が多いため、このサイズでは細かすぎて読み取れません。サイズを大きくするか、文字を減らしてください。` };
        const drawn = cell * cells;
        const offset = Math.floor((target - drawn) / 2);   // 端数は余白に回す
        const canvas = document.createElement('canvas');
        canvas.width = target; canvas.height = target;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = opts.bg;
        ctx.fillRect(0, 0, target, target);
        ctx.fillStyle = opts.fg;
        for (let r = 0; r < n; r++) {
            for (let c = 0; c < n; c++) {
                if (qr.isDark(r, c)) ctx.fillRect(offset + (c + margin) * cell, offset + (r + margin) * cell, cell, cell);
            }
        }
        return { canvas, moduleCount: n, version: (n - 17) / 4, actualSize: target };
    }

    function utf8Length(str) { return new TextEncoder().encode(str).length; }

    function defaultFileName(text) {
        const t = (text || '').trim();
        try {
            const u = new URL(t);
            if (/^https?:$/.test(u.protocol)) return `QRコード_${u.hostname.replace(/^www\./, '')}`;
        } catch (e) { /* URLではない */ }
        return 'QRコード';
    }
    function safeFileName(name) {
        return (name || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '').trim().slice(0, 80) || 'QRコード';
    }

    function triggerDownload(blob, name) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = name; a.style.display = 'none';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
    }

    let current = null;   // 今プレビューしているQRコード

    // ---------- 画面 ----------
    App.Pages.qr_code = async function () {
        const html = `
        <div class="qr-wrap">
            <div class="card qr-card">
                <div class="qr-step"><span>1</span>QRコードにする内容を入力</div>
                <div class="form-group">
                    <label>URL・文章</label>
                    <textarea id="qr-text" rows="4" placeholder="例: https://www.example.com/&#10;URLのほか、文章・電話番号なども入れられます">${esc(S.text)}</textarea>
                    <div class="qr-count" id="qr-count"></div>
                </div>
                <div class="form-group">
                    <label>ファイル名</label>
                    <div class="qr-fname"><input type="text" id="qr-fname" value="${esc(S.fileName)}" placeholder="${esc(defaultFileName(S.text))}"><span>.png / .jpg</span></div>
                </div>

                <div class="qr-step" style="margin-top:8px;"><span>2</span>見た目を決める</div>
                <div class="qr-grid">
                    <div class="form-group">
                        <label>画像のサイズ</label>
                        <select id="qr-size">${SIZE_OPTIONS.map(o => `<option value="${o.value}" ${S.size === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}</select>
                    </div>
                    <div class="form-group">
                        <label>汚れへの強さ(誤り訂正レベル)</label>
                        <select id="qr-ecl">${ECL_OPTIONS.map(o => `<option value="${o.value}" ${S.ecl === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}</select>
                    </div>
                    <div class="form-group">
                        <label>まわりの余白</label>
                        <select id="qr-margin">${MARGIN_OPTIONS.map(o => `<option value="${o.value}" ${S.margin === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}</select>
                    </div>
                    <div class="form-group">
                        <label>色</label>
                        <div class="qr-colors">
                            <label class="qr-color"><input type="color" id="qr-fg" value="${esc(S.fg)}"> QRコード</label>
                            <label class="qr-color"><input type="color" id="qr-bg" value="${esc(S.bg)}"> 背景</label>
                            <button type="button" class="btn-secondary btn-sm" id="qr-color-reset">白黒に戻す</button>
                        </div>
                    </div>
                </div>
                <div id="qr-color-warn" class="qr-warn" style="display:none;"></div>
            </div>

            <div class="card qr-card qr-preview-card">
                <div class="qr-step"><span>3</span>ダウンロード</div>
                <div class="qr-preview" id="qr-preview">
                    <div class="qr-empty"><i class="ph ph-qr-code"></i><div>内容を入力すると、ここにQRコードが表示されます</div></div>
                </div>
                <div class="qr-info" id="qr-info"></div>
                <div class="qr-btns">
                    <button type="button" class="btn-primary" id="qr-dl-png" disabled><i class="ph ph-download-simple"></i> PNGでダウンロード</button>
                    <button type="button" class="btn-primary" id="qr-dl-jpg" disabled><i class="ph ph-download-simple"></i> JPEGでダウンロード</button>
                </div>
                <button type="button" class="btn-secondary btn-sm qr-copy" id="qr-copy" disabled><i class="ph ph-copy"></i> 画像をコピー(チャットなどに貼り付け用)</button>
                <div class="qr-note">
                    ・PNG は文字や線がくっきり保存されるので、QRコードには PNG がおすすめです。<br>
                    ・印刷や配布の前に、必ずスマホのカメラで読み取れるか確認してください。<br>
                    ・入力した内容はこのパソコンの中だけで処理され、サーバーには送られません。
                </div>
            </div>
        </div>

        <style>
            .qr-wrap { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); gap: 20px; align-items: start; max-width: 1180px; }
            .qr-card { margin-bottom: 0; }
            .qr-step { display: flex; align-items: center; gap: 10px; font-weight: 700; font-size: 1.05rem; margin-bottom: 14px; }
            .qr-step span { display: inline-flex; width: 26px; height: 26px; border-radius: 50%; background: var(--primary, #111); color: #fff; align-items: center; justify-content: center; font-size: 0.85rem; }
            #qr-text { width: 100%; resize: vertical; font-size: 0.95rem; line-height: 1.6; }
            .qr-count { font-size: 0.75rem; color: var(--text-secondary); margin-top: 4px; text-align: right; }
            .qr-fname { display: flex; align-items: center; gap: 8px; }
            .qr-fname input { flex: 1; }
            .qr-fname span { font-size: 0.8rem; color: var(--text-secondary); white-space: nowrap; }
            .qr-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 16px; }
            .qr-colors { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; min-height: 42px; }
            .qr-color { display: inline-flex !important; align-items: center; gap: 6px; font-size: 0.85rem; margin: 0 !important; cursor: pointer; }
            .qr-color input[type=color] { width: 38px !important; height: 30px; padding: 0; border: 1px solid var(--border-light, #ddd); border-radius: 6px; background: none; cursor: pointer; }
            .qr-warn { font-size: 0.8rem; color: #C25E00; background: #FFF4E5; border: 1px solid #FFD8A8; border-radius: 8px; padding: 8px 12px; line-height: 1.6; }
            .qr-preview-card { position: sticky; top: 16px; }
            .qr-preview { display: flex; align-items: center; justify-content: center; aspect-ratio: 1 / 1; max-width: 360px; margin: 0 auto; border: 1px solid var(--border-light, #eee); border-radius: 12px; background: repeating-conic-gradient(#f3f4f6 0% 25%, #fff 0% 50%) 50% / 20px 20px; overflow: hidden; }
            .qr-preview canvas { width: 100%; height: 100%; image-rendering: pixelated; display: block; }
            .qr-empty { text-align: center; color: var(--text-secondary); font-size: 0.85rem; padding: 24px; line-height: 1.6; }
            .qr-empty i { font-size: 3rem; display: block; margin-bottom: 8px; opacity: .5; }
            .qr-empty.is-error { color: #C92A2A; }
            .qr-info { text-align: center; font-size: 0.78rem; color: var(--text-secondary); margin: 10px 0 14px; min-height: 1.2em; }
            .qr-btns { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
            .qr-btns button { padding: 12px 10px; }
            .qr-btns button:disabled, .qr-copy:disabled { opacity: .45; cursor: not-allowed; }
            .qr-copy { width: 100%; margin-top: 10px; }
            .qr-note { font-size: 0.78rem; color: var(--text-secondary); line-height: 1.8; margin-top: 14px; }
            @media (max-width: 960px) { .qr-wrap { grid-template-columns: 1fr; } .qr-preview-card { position: static; } }
            @media (max-width: 600px) { .qr-grid { grid-template-columns: 1fr; } }
        </style>`;

        App.mount(html, async () => {
            const ids = ['qr-text', 'qr-fname', 'qr-size', 'qr-ecl', 'qr-margin', 'qr-fg', 'qr-bg'];
            ids.forEach(id => {
                const el = document.getElementById(id);
                el.addEventListener('input', update);
                el.addEventListener('change', update);
            });
            document.getElementById('qr-color-reset').addEventListener('click', () => {
                document.getElementById('qr-fg').value = '#000000';
                document.getElementById('qr-bg').value = '#ffffff';
                update();
            });
            document.getElementById('qr-dl-png').addEventListener('click', () => download('png'));
            document.getElementById('qr-dl-jpg').addEventListener('click', () => download('jpg'));
            document.getElementById('qr-copy').addEventListener('click', copyImage);
            try {
                await loadLib();
            } catch (e) {
                showEmpty(e.message, true);
                return;
            }
            update();
            document.getElementById('qr-text').focus();
        });
    };

    function showEmpty(msg, isError) {
        const pv = document.getElementById('qr-preview');
        if (pv) pv.innerHTML = `<div class="qr-empty ${isError ? 'is-error' : ''}"><i class="ph ${isError ? 'ph-warning-circle' : 'ph-qr-code'}"></i><div>${esc(msg)}</div></div>`;
        const info = document.getElementById('qr-info'); if (info) info.textContent = '';
        setButtons(false);
    }
    function setButtons(on) {
        ['qr-dl-png', 'qr-dl-jpg', 'qr-copy'].forEach(id => { const b = document.getElementById(id); if (b) b.disabled = !on; });
    }

    function update() {
        const $ = (id) => document.getElementById(id);
        if (!$('qr-text')) return;
        S.text = $('qr-text').value;
        S.fileName = $('qr-fname').value;
        S.size = $('qr-size').value;
        S.ecl = $('qr-ecl').value;
        S.margin = $('qr-margin').value;
        S.fg = $('qr-fg').value;
        S.bg = $('qr-bg').value;
        $('qr-fname').placeholder = defaultFileName(S.text);

        const bytes = utf8Length(S.text);
        $('qr-count').textContent = S.text ? `${S.text.length}文字` : '';

        const warn = colorWarning(S.fg, S.bg);
        $('qr-color-warn').style.display = warn ? '' : 'none';
        $('qr-color-warn').textContent = warn ? '⚠ ' + warn : '';

        current = null;
        if (!S.text.trim()) { showEmpty('内容を入力すると、ここにQRコードが表示されます'); return; }
        if (!window.qrcode) { showEmpty('準備中…'); return; }

        const r = buildQr(window.qrcode, S.text, S);
        if (r.error) { showEmpty(r.error, true); return; }
        current = r;
        const pv = $('qr-preview');
        pv.innerHTML = '';
        pv.appendChild(r.canvas);
        $('qr-info').textContent = `${r.actualSize}×${r.actualSize}px ・ ${r.moduleCount}×${r.moduleCount}マス(バージョン${r.version}) ・ ${bytes}バイト`;
        setButtons(true);
    }

    function currentFileName(ext) {
        const base = safeFileName((S.fileName || '').trim() || defaultFileName(S.text));
        return `${base.replace(/\.(png|jpe?g)$/i, '')}.${ext}`;
    }

    function toBlob(canvas, type) {
        return new Promise((res, rej) => canvas.toBlob(b => b ? res(b) : rej(new Error('画像を作れませんでした')), type, type === 'image/jpeg' ? 0.95 : undefined));
    }

    async function download(ext) {
        if (!current) return;
        try {
            const blob = await toBlob(current.canvas, ext === 'png' ? 'image/png' : 'image/jpeg');
            triggerDownload(blob, currentFileName(ext));
        } catch (e) {
            alert('ダウンロードできませんでした。\n' + e.message);
        }
    }

    async function copyImage() {
        if (!current) return;
        const btn = document.getElementById('qr-copy');
        try {
            if (!navigator.clipboard || typeof window.ClipboardItem !== 'function') throw new Error('このブラウザは画像のコピーに対応していません');
            // Safari 対策: Blob を作る Promise をそのまま渡す
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': toBlob(current.canvas, 'image/png') })]);
            if (btn) { const old = btn.innerHTML; btn.innerHTML = '<i class="ph ph-check"></i> コピーしました'; setTimeout(() => { btn.innerHTML = old; }, 1600); }
        } catch (e) {
            alert('画像をコピーできませんでした。PNGでダウンロードしてお使いください。\n' + (e && e.message ? e.message : ''));
        }
    }
})();
