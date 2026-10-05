// js/pages/photo_convert.js
// 写真変換: HEIC/HEIF(iPhoneの写真)を JPEG に変換して保存するページ。
//
// ・変換はすべてブラウザの中で行う(写真はサーバーやSupabaseに送らない)。
// ・変換ライブラリ: heic-to v1.6.5(内部は libheif 1.23.5 / LGPL-3.0)https://github.com/hoppergee/heic-to
//   → js/vendor/heic-to.js に同梱(このページを開いたときだけ読み込む。約3MB)
// ・ZIPにまとめる: JSZip v3.10.1(MIT)→ js/vendor/jszip.min.js
// ・保存先フォルダの指定: File System Access API の window.showDirectoryPicker()
//   https://developer.mozilla.org/docs/Web/API/Window/showDirectoryPicker
//   Chrome / Edge は対応。Safari / Firefox は未対応のため、その場合は「ダウンロード」フォルダに保存する。
// ・選んだフォルダはブラウザ(IndexedDB)に覚えておき、次回も同じフォルダに保存できる。
// ・JPEGにすると、撮影日時・位置情報などの写真の情報(Exif)は引き継がれない。
(function () {
    const VENDOR = {
        heic: 'js/vendor/heic-to.js',
        zip: 'js/vendor/jszip.min.js'
    };
    const QUALITY_OPTIONS = [
        { value: '0.92', label: '高画質(おすすめ)' },
        { value: '0.85', label: '標準(少し軽い)' },
        { value: '0.75', label: '軽量(容量を小さく)' }
    ];
    const SIZE_OPTIONS = [
        { value: '0', label: '元のサイズのまま' },
        { value: '3000', label: '長い辺 3000px まで' },
        { value: '2000', label: '長い辺 2000px まで' },
        { value: '1200', label: '長い辺 1200px まで(ブログ・SNS向け)' }
    ];
    const HEIC_BRANDS = ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1'];
    const supportsFolder = typeof window.showDirectoryPicker === 'function' && window.isSecureContext;

    // ページを移動しても選んだ設定は残す
    const S = window.PhotoConvertState = window.PhotoConvertState || {
        items: [],            // { id, file, name, status, outName, blob, url, error, isHeic, w, h }
        mode: supportsFolder ? 'folder' : 'download',
        dirHandle: null,
        dirLoaded: false,
        zip: true,
        quality: '0.92',
        maxSize: '0',
        busy: false
    };

    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    const fmtSize = (n) => n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`;

    // ---------- 外部ファイルの読み込み(1回だけ) ----------
    const loading = {};
    function loadVendor(key, globalName) {
        if (window[globalName]) return Promise.resolve(window[globalName]);
        if (!loading[key]) {
            loading[key] = new Promise((resolve, reject) => {
                const s = document.createElement('script');
                s.src = VENDOR[key];
                s.onload = () => window[globalName] ? resolve(window[globalName]) : reject(new Error(`${globalName} が読み込めませんでした`));
                s.onerror = () => { delete loading[key]; reject(new Error(`${VENDOR[key]} が読み込めませんでした(アップロード漏れの可能性があります)`)); };
                document.head.appendChild(s);
            });
        }
        return loading[key];
    }

    // ---------- 保存先フォルダを覚えておく(IndexedDB) ----------
    const DB_NAME = 'msm-photo-convert', STORE = 'kv';
    function idb(mode, fn) {
        return new Promise((resolve, reject) => {
            const open = indexedDB.open(DB_NAME, 1);
            open.onupgradeneeded = () => open.result.createObjectStore(STORE);
            open.onerror = () => reject(open.error);
            open.onsuccess = () => {
                const tx = open.result.transaction(STORE, mode);
                const req = fn(tx.objectStore(STORE));
                tx.oncomplete = () => { open.result.close(); resolve(req && req.result); };
                tx.onerror = () => { open.result.close(); reject(tx.error); };
            };
        });
    }
    const saveDirHandle = (h) => idb('readwrite', st => h ? st.put(h, 'dir') : st.delete('dir')).catch(() => {});
    const loadDirHandle = () => idb('readonly', st => st.get('dir')).catch(() => null);

    async function ensurePermission(handle) {
        if (!handle) return false;
        if (typeof handle.queryPermission !== 'function') return true;
        const opts = { mode: 'readwrite' };
        if (await handle.queryPermission(opts) === 'granted') return true;
        if (typeof handle.requestPermission === 'function' && await handle.requestPermission(opts) === 'granted') return true;
        return false;
    }

    // ---------- HEICかどうか(ファイルの先頭12バイトで判定) ----------
    async function detectHeic(file) {
        try {
            const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
            const txt = String.fromCharCode(...head.slice(4, 12));
            if (txt.slice(0, 4) !== 'ftyp') return false;
            return HEIC_BRANDS.includes(txt.slice(4, 8).replace(/\0/g, ' ').trim());
        } catch (e) {
            return /\.(heic|heif)$/i.test(file.name);
        }
    }

    // ---------- 変換 ----------
    function baseName(name) { return name.replace(/\.[^.]+$/, '') || 'photo'; }

    async function resizeIfNeeded(jpegBlob, maxSize, quality) {
        const max = parseInt(maxSize, 10);
        const bmp = await createImageBitmap(jpegBlob);
        const w = bmp.width, h = bmp.height;
        if (!max || Math.max(w, h) <= max) { bmp.close && bmp.close(); return { blob: jpegBlob, w, h }; }
        const r = max / Math.max(w, h);
        const cw = Math.round(w * r), ch = Math.round(h * r);
        const canvas = document.createElement('canvas');
        canvas.width = cw; canvas.height = ch;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(bmp, 0, 0, cw, ch);
        bmp.close && bmp.close();
        const blob = await new Promise((res, rej) => canvas.toBlob(b => b ? res(b) : rej(new Error('縮小に失敗しました')), 'image/jpeg', parseFloat(quality)));
        canvas.width = canvas.height = 1;
        return { blob, w: cw, h: ch };
    }

    async function uniqueNameInDir(dir, name, used) {
        const base = name.replace(/\.jpg$/i, '');
        for (let i = 0; i < 1000; i++) {
            const cand = i === 0 ? `${base}.jpg` : `${base} (${i}).jpg`;
            if (used.has(cand.toLowerCase())) continue;
            if (dir) {
                try { await dir.getFileHandle(cand); continue; } catch (e) { /* 無い = 使える */ }
            }
            used.add(cand.toLowerCase());
            return cand;
        }
        return `${base}-${Date.now()}.jpg`;
    }

    function triggerDownload(blob, name) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = name; a.style.display = 'none';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
    }

    // ---------- 画面 ----------
    App.Pages.photo_convert = async function () {
        if (supportsFolder && !S.dirLoaded) {
            S.dirLoaded = true;
            S.dirHandle = await loadDirHandle();
        }

        const html = `
        <div class="pc-wrap">
            <div class="card pc-card">
                <div class="pc-step"><span>1</span>写真を選ぶ</div>
                <label class="pc-drop" id="pc-drop">
                    <input type="file" id="pc-input" accept=".heic,.heif,image/heic,image/heif" multiple hidden>
                    <i class="ph ph-image-square"></i>
                    <div class="pc-drop-main">ここに HEIC の写真をドラッグ&ドロップ</div>
                    <div class="pc-drop-sub">または <u>クリックして選ぶ</u>(複数まとめてOK)</div>
                </label>
                <div id="pc-list-wrap"></div>
            </div>

            <div class="card pc-card">
                <div class="pc-step"><span>2</span>保存先を決める</div>
                <div class="pc-radio ${supportsFolder ? '' : 'is-disabled'}" data-mode="folder">
                    <input type="radio" name="pc-mode" value="folder" ${S.mode === 'folder' ? 'checked' : ''} ${supportsFolder ? '' : 'disabled'}>
                    <div>
                        <div class="pc-radio-title">フォルダを指定して保存 <span class="pc-tag">おすすめ</span></div>
                        ${supportsFolder ? `
                        <div class="pc-folder-row">
                            <span class="pc-folder" id="pc-folder-name">${S.dirHandle ? `<i class="ph ph-folder-open"></i> ${esc(S.dirHandle.name)}` : '<span style="color:var(--text-secondary);">まだ選んでいません</span>'}</span>
                            <button type="button" class="btn-secondary btn-sm" id="pc-pick-folder"><i class="ph ph-folder-simple-plus"></i> ${S.dirHandle ? '保存先を変更' : '保存先フォルダを選ぶ'}</button>
                        </div>
                        <div class="pc-note">選んだフォルダは次回も使われます。新しいフォルダは、選ぶ画面の「新規フォルダ」で作れます。</div>
                        ` : `
                        <div class="pc-note">お使いのブラウザ(Safari など)はフォルダの指定に対応していません。<b>Google Chrome</b> または <b>Microsoft Edge</b> で開くと使えます。</div>
                        `}
                    </div>
                </div>
                <div class="pc-radio" data-mode="download">
                    <input type="radio" name="pc-mode" value="download" ${S.mode === 'download' ? 'checked' : ''}>
                    <div>
                        <div class="pc-radio-title">ダウンロードとして保存</div>
                        <div class="pc-note">ブラウザの「ダウンロード」フォルダに保存されます。${supportsFolder ? '' : 'Safari の場合は「Safari → 設定 → 一般 → ファイルのダウンロード先」で保存先を変えられます(毎回たずねる設定にすると、保存のたびに場所を選べます)。'}</div>
                        <label class="pc-check"><input type="checkbox" id="pc-zip" ${S.zip ? 'checked' : ''}> 2枚以上のときは1つのZIPファイルにまとめる</label>
                    </div>
                </div>

                <div class="pc-options">
                    <div class="form-group">
                        <label>画質</label>
                        <select id="pc-quality">${QUALITY_OPTIONS.map(o => `<option value="${o.value}" ${S.quality === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}</select>
                    </div>
                    <div class="form-group">
                        <label>サイズ</label>
                        <select id="pc-size">${SIZE_OPTIONS.map(o => `<option value="${o.value}" ${S.maxSize === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}</select>
                    </div>
                </div>
            </div>

            <div class="card pc-card">
                <div class="pc-step"><span>3</span>変換して保存</div>
                <button type="button" class="btn-primary pc-go" id="pc-go"><i class="ph ph-arrows-clockwise"></i> JPEGに変換して保存</button>
                <div id="pc-progress" class="pc-progress"></div>
                <div class="pc-note" style="margin-top:12px;">※変換はこのパソコンの中だけで行います(写真がサーバーに送られることはありません)。<br>※JPEGにすると、撮影日時や位置情報などの写真の情報は引き継がれません。</div>
            </div>
        </div>

        <style>
            .pc-wrap { max-width: 920px; }
            .pc-card { margin-bottom: 20px; }
            .pc-step { display: flex; align-items: center; gap: 10px; font-weight: 700; font-size: 1.05rem; margin-bottom: 16px; }
            .pc-step span { display: inline-flex; width: 26px; height: 26px; border-radius: 50%; background: var(--primary, #111); color: #fff; align-items: center; justify-content: center; font-size: 0.85rem; }
            .pc-drop { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; padding: 36px 16px; border: 2px dashed var(--border-light, #ddd); border-radius: 14px; cursor: pointer; text-align: center; transition: .15s; background: var(--bg-tertiary, #f8f9fa); }
            .pc-drop:hover, .pc-drop.is-over { border-color: var(--info, #4285F4); background: #F0F6FF; }
            .pc-drop i { font-size: 2.4rem; color: var(--text-secondary); }
            .pc-drop-main { font-weight: 700; }
            .pc-drop-sub { font-size: 0.85rem; color: var(--text-secondary); }
            .pc-list-head { display: flex; justify-content: space-between; align-items: center; margin: 18px 0 8px; font-size: 0.9rem; font-weight: 600; flex-wrap: wrap; gap: 8px; }
            .pc-list { display: flex; flex-direction: column; gap: 6px; max-height: 360px; overflow-y: auto; }
            .pc-item { display: flex; align-items: center; gap: 12px; padding: 8px 10px; border: 1px solid var(--border-light, #eee); border-radius: 10px; font-size: 0.85rem; background: #fff; }
            .pc-thumb { width: 48px; height: 48px; border-radius: 8px; object-fit: cover; background: var(--bg-tertiary, #f1f3f5); flex: 0 0 48px; display: flex; align-items: center; justify-content: center; color: var(--text-secondary); }
            .pc-item-main { flex: 1; min-width: 0; }
            .pc-item-name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .pc-item-sub { font-size: 0.75rem; color: var(--text-secondary); }
            .pc-st { font-size: 0.75rem; font-weight: 700; padding: 3px 9px; border-radius: 999px; white-space: nowrap; }
            .pc-st-wait { background: #F1F3F5; color: #666; }
            .pc-st-run { background: #E7F1FF; color: #1C64D8; }
            .pc-st-done { background: #E6F7EC; color: #1E7E34; }
            .pc-st-err, .pc-st-skip { background: #FFF0F0; color: #C92A2A; }
            .pc-item a.pc-dl { font-size: 0.75rem; white-space: nowrap; color: var(--info); text-decoration: none; }
            .pc-radio { display: flex; gap: 12px; align-items: flex-start; padding: 14px; border: 1px solid var(--border-light, #e5e5e5); border-radius: 12px; margin-bottom: 10px; cursor: pointer; }
            .pc-radio > input { margin-top: 4px; width: 18px; height: 18px; flex: 0 0 auto; }
            .pc-radio.is-disabled { opacity: .75; cursor: default; }
            .pc-radio:has(input[name="pc-mode"]:checked) { border-color: var(--info, #4285F4); background: #F7FAFF; }
            .pc-radio-title { font-weight: 700; }
            .pc-tag { font-size: 0.7rem; background: #E6F7EC; color: #1E7E34; padding: 2px 8px; border-radius: 999px; margin-left: 6px; }
            .pc-folder-row { display: flex; align-items: center; gap: 12px; margin-top: 10px; flex-wrap: wrap; }
            .pc-folder { font-weight: 700; display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; background: var(--bg-tertiary, #f1f3f5); border-radius: 8px; }
            .pc-note { font-size: 0.8rem; color: var(--text-secondary); line-height: 1.7; margin-top: 6px; }
            .pc-check { display: flex; align-items: center; gap: 8px; font-size: 0.85rem; margin-top: 8px; cursor: pointer; }
            .pc-check input { width: 16px; height: 16px; }
            .pc-options { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 16px; }
            .pc-go { padding: 14px 28px; font-size: 1rem; }
            .pc-go:disabled { opacity: .5; cursor: not-allowed; }
            .pc-progress { margin-top: 14px; font-size: 0.9rem; font-weight: 600; }
            .pc-progress.ok { color: #1E7E34; }
            .pc-progress.err { color: #C92A2A; }
            @media (max-width: 768px) { .pc-options { grid-template-columns: 1fr; } }
        </style>`;

        App.mount(html, () => {
            renderList();

            const input = document.getElementById('pc-input');
            input.addEventListener('change', () => { addFiles(input.files); input.value = ''; });

            const drop = document.getElementById('pc-drop');
            ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('is-over'); }));
            ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('is-over'); }));
            drop.addEventListener('drop', e => { if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files); });

            document.querySelectorAll('input[name="pc-mode"]').forEach(r => r.addEventListener('change', () => { S.mode = r.value; }));
            // 枠のどこを押しても選べるようにする(ボタン・チェックボックスを押したときは除く)
            document.querySelectorAll('.pc-radio').forEach(box => box.addEventListener('click', (e) => {
                if (e.target.closest('button, .pc-check, input')) return;
                const r = box.querySelector('input[name="pc-mode"]');
                if (r && !r.disabled) { r.checked = true; S.mode = r.value; }
            }));
            const zip = document.getElementById('pc-zip');
            zip.addEventListener('change', () => { S.zip = zip.checked; });
            document.getElementById('pc-quality').addEventListener('change', e => { S.quality = e.target.value; });
            document.getElementById('pc-size').addEventListener('change', e => { S.maxSize = e.target.value; });

            const pick = document.getElementById('pc-pick-folder');
            if (pick) pick.addEventListener('click', async (e) => {
                e.preventDefault();
                try {
                    const opts = { id: 'msm-photo-convert', mode: 'readwrite' };
                    if (!S.dirHandle) opts.startIn = 'pictures';
                    const h = await window.showDirectoryPicker(opts);
                    S.dirHandle = h;
                    S.mode = 'folder';
                    await saveDirHandle(h);
                    App.navigate('photo_convert');
                } catch (err) {
                    if (err && err.name === 'AbortError') return;   // キャンセル
                    alert('フォルダを選べませんでした。\n' + (err && err.message ? err.message : ''));
                }
            });

            document.getElementById('pc-go').addEventListener('click', convertAll);
            // ライブラリは先に読み込み始めておく(約3MB)
            loadVendor('heic', 'HeicTo').catch(() => {});
        });
    };

    async function addFiles(fileList) {
        const files = Array.from(fileList || []);
        for (const file of files) {
            const isHeic = await detectHeic(file);
            S.items.push({
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                file, name: file.name, isHeic,
                status: isHeic ? 'wait' : 'skip',
                error: isHeic ? '' : 'HEICの写真ではないため変換しません'
            });
        }
        renderList();
    }

    window.pcRemoveItem = (id) => {
        if (S.busy) return;
        const i = S.items.findIndex(x => x.id === id);
        if (i >= 0) { if (S.items[i].url) URL.revokeObjectURL(S.items[i].url); S.items.splice(i, 1); }
        renderList();
    };
    window.pcClearAll = () => {
        if (S.busy) return;
        S.items.forEach(x => x.url && URL.revokeObjectURL(x.url));
        S.items = [];
        const p = document.getElementById('pc-progress'); if (p) { p.textContent = ''; p.className = 'pc-progress'; }
        renderList();
    };
    window.pcDownloadOne = (id) => {
        const it = S.items.find(x => x.id === id);
        if (it && it.blob) triggerDownload(it.blob, it.outName);
    };

    function renderList() {
        const wrap = document.getElementById('pc-list-wrap');
        if (!wrap) return;
        if (!S.items.length) { wrap.innerHTML = ''; return; }
        const n = S.items.filter(x => x.isHeic).length;
        const done = S.items.filter(x => x.status === 'done').length;
        const label = { wait: '変換前', run: '変換中…', done: '保存済み', err: 'エラー', skip: '対象外' };
        wrap.innerHTML = `
            <div class="pc-list-head">
                <span>選んだ写真: ${S.items.length}枚(変換する写真 ${n}枚${done ? ` / 完了 ${done}枚` : ''})</span>
                <button type="button" class="btn-secondary btn-sm" onclick="pcClearAll()" ${S.busy ? 'disabled' : ''}><i class="ph ph-x"></i> すべて取り消す</button>
            </div>
            <div class="pc-list">
                ${S.items.map(it => `
                <div class="pc-item" data-id="${it.id}" data-status="${it.status}">
                    ${it.url ? `<img class="pc-thumb" src="${it.url}" alt="">` : `<div class="pc-thumb"><i class="ph ph-image"></i></div>`}
                    <div class="pc-item-main">
                        <div class="pc-item-name">${esc(it.name)}${it.outName ? ` → ${esc(it.outName)}` : ''}</div>
                        <div class="pc-item-sub">${fmtSize(it.file.size)}${it.blob ? ` → ${fmtSize(it.blob.size)}(${it.w}×${it.h})` : ''}${it.error ? ` / <span style="color:#C92A2A;">${esc(it.error)}</span>` : ''}</div>
                    </div>
                    <span class="pc-st pc-st-${it.status}">${label[it.status]}</span>
                    ${it.blob ? `<a href="#" class="pc-dl" onclick="pcDownloadOne('${it.id}'); return false;">ダウンロード</a>` : ''}
                    ${S.busy ? '' : `<button type="button" class="btn-icon" title="取り消す" onclick="pcRemoveItem('${it.id}')"><i class="ph ph-trash"></i></button>`}
                </div>`).join('')}
            </div>`;
    }

    function setProgress(text, cls = '') {
        const p = document.getElementById('pc-progress');
        if (p) { p.textContent = text; p.className = 'pc-progress ' + cls; }
    }

    async function convertAll() {
        if (S.busy) return;
        const targets = S.items.filter(x => x.isHeic && x.status !== 'done');
        if (!targets.length) {
            alert(S.items.some(x => x.isHeic) ? '選んだ写真はすべて変換済みです。' : 'HEICの写真を選んでください。');
            return;
        }

        // 保存先の確認(フォルダの許可は、ボタンを押した直後に確認する必要がある)
        let dir = null;
        if (S.mode === 'folder') {
            if (!supportsFolder) { alert('このブラウザではフォルダを指定できません。「ダウンロードとして保存」を選んでください。'); return; }
            if (!S.dirHandle) { alert('先に「保存先フォルダを選ぶ」で保存先を決めてください。'); return; }
            let ok = false;
            try { ok = await ensurePermission(S.dirHandle); } catch (e) { ok = false; }
            if (!ok) { alert('保存先フォルダへの書き込みが許可されませんでした。もう一度「保存先を変更」からフォルダを選んでください。'); return; }
            dir = S.dirHandle;
        }

        S.busy = true;
        const btn = document.getElementById('pc-go');
        if (btn) btn.disabled = true;
        let HeicTo;
        try {
            setProgress('変換の準備中…(初回は少し時間がかかります)');
            HeicTo = await loadVendor('heic', 'HeicTo');
        } catch (e) {
            S.busy = false; if (btn) btn.disabled = false;
            setProgress('変換の準備に失敗しました: ' + e.message, 'err');
            return;
        }

        const useZip = S.mode === 'download' && S.zip && targets.length >= 2;
        const used = new Set();
        const zipFiles = [];
        let ok = 0, ng = 0;
        renderList();

        for (let i = 0; i < targets.length; i++) {
            const it = targets[i];
            it.status = 'run'; it.error = '';
            setProgress(`変換中… ${i + 1} / ${targets.length} 枚目`);
            renderList();
            try {
                const jpeg = await HeicTo({ blob: it.file, type: 'image/jpeg', quality: parseFloat(S.quality) });
                const r = await resizeIfNeeded(jpeg, S.maxSize, S.quality);
                it.blob = r.blob; it.w = r.w; it.h = r.h;
                it.outName = await uniqueNameInDir(dir, baseName(it.name), used);
                if (dir) {
                    const fh = await dir.getFileHandle(it.outName, { create: true });
                    const w = await fh.createWritable();
                    await w.write(it.blob);
                    await w.close();
                } else if (useZip) {
                    zipFiles.push(it);
                } else {
                    triggerDownload(it.blob, it.outName);
                    await new Promise(r2 => setTimeout(r2, 350));   // 連続ダウンロードの取りこぼし防止
                }
                if (it.url) URL.revokeObjectURL(it.url);
                it.url = URL.createObjectURL(it.blob);
                it.status = 'done'; ok++;
            } catch (err) {
                console.error('HEIC変換エラー', it.name, err);
                it.status = 'err'; ng++;
                it.error = '変換できませんでした' + (err && err.message ? `(${err.message})` : (typeof err === 'string' ? `(${err})` : ''));
            }
            renderList();
        }

        if (useZip && zipFiles.length) {
            try {
                setProgress('ZIPにまとめています…');
                const JSZip = await loadVendor('zip', 'JSZip');
                const z = new JSZip();
                zipFiles.forEach(it => z.file(it.outName, it.blob, { binary: true }));
                const zipBlob = await z.generateAsync({ type: 'blob', compression: 'STORE' });
                const d = new Date();
                const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
                triggerDownload(zipBlob, `写真変換_${stamp}.zip`);
            } catch (err) {
                console.error(err);
                ng += zipFiles.length; ok -= zipFiles.length;
                zipFiles.forEach(it => { it.status = 'err'; it.error = 'ZIPにまとめられませんでした。「もう一度保存」で1枚ずつ保存できます'; });
            }
        }

        S.busy = false;
        if (btn) btn.disabled = false;
        renderList();
        const where = dir ? `「${dir.name}」フォルダに保存しました` : (useZip ? 'ZIPファイルでダウンロードしました' : 'ダウンロードフォルダに保存しました');
        setProgress(ng ? `${ok}枚を${where}。${ng}枚は変換できませんでした。` : `${ok}枚すべて${where}。`, ng ? 'err' : 'ok');
    }
})();
