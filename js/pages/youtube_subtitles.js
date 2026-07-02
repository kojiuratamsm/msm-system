App.Pages.youtube_subtitles = async function() {
    let allScripts = await Store.getYTScripts();

    const html = `
        <div class="card" style="margin-bottom: 24px; padding: 24px; background: var(--bg-secondary);">
            <div style="border-bottom: 1px solid var(--border-light); padding-bottom: 16px; margin-bottom: 24px;">
                <h3 style="font-size: 1.2rem; margin: 0; color: var(--primary-dark);"><i class="ph ph-gear"></i> API設定</h3>
                <p style="color: var(--text-secondary); font-size: 0.9rem; margin-top: 8px;">
                    テロップを自動生成するために必要なOpenAIのAPIキーを入力してください。<br>
                    ※このキーはお使いのブラウザにのみ保存され、安全に管理されます。
                </p>
            </div>
            
            <div class="form-group" style="max-width: 600px;">
                <label>OpenAI APIキー (sk-proj-...)</label>
                <div style="display: flex; gap: 8px;">
                    <input type="password" id="openai-api-key" class="input-field" placeholder="sk-..." value="">
                    <button class="btn-primary" onclick="saveApiKey()">保存</button>
                </div>
            </div>
        </div>

        <div class="card" style="padding: 24px;">
            <div style="border-bottom: 1px solid var(--border-light); padding-bottom: 16px; margin-bottom: 24px;">
                <h3 style="font-size: 1.2rem; margin: 0; color: var(--primary-dark);"><i class="ph ph-subtitles"></i> 高精度テロップ自動生成ツール</h3>
                <p style="color: var(--text-secondary); font-size: 0.9rem; margin-top: 8px;">
                    音声ファイル（mp3/m4a等）と、台本データを選択して「テロップ生成開始」ボタンを押してください。<br>
                    AIが台本通りに補正したPremiere Pro用テロップデータ（.srtファイル）を自動作成します。
                </p>
            </div>

            <div class="grid grid-2" style="gap: 24px;">
                <div style="background: var(--bg-tertiary); padding: 20px; border-radius: 8px; border: 1px solid var(--border-light);">
                    <h4 style="margin-bottom: 16px; color: var(--text-primary);">1. 音声ファイルのアップロード</h4>
                    <p style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 12px;">Premiere Pro等から書き出した音声ファイル（mp3, m4a, wav）を選択してください。※最大25MB</p>
                    <input type="file" id="audio-file" accept="audio/*" class="input-field" style="padding: 10px; background: #fff;">
                </div>

                <div style="background: var(--bg-tertiary); padding: 20px; border-radius: 8px; border: 1px solid var(--border-light);">
                    <h4 style="margin-bottom: 16px; color: var(--text-primary);">2. 台本の選択</h4>
                    <p style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 12px;">保存されている台本を選択すると、AIがこの台本を「正解」として文字起こしを補正します。</p>
                    <select id="script-select" class="input-field" style="margin-bottom: 12px;" onchange="loadScriptText(this.value)">
                        <option value="">-- 台本を選択してください --</option>
                        ${allScripts.map(s => `<option value="${s.id}">${s.title || '(無題)'}</option>`).join('')}
                    </select>
                    
                    <p style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 4px;">または、手動で台本テキストを入力（修正）できます。</p>
                    <textarea id="script-content" class="input-field" style="height: 150px; font-size: 0.9rem; background: #fff;" placeholder="ここに台本の文章が入ります..."></textarea>
                </div>
            </div>

            <div style="margin-top: 32px; text-align: center;">
                <button id="btn-generate" class="btn-primary" style="font-size: 1.1rem; padding: 12px 32px; width: 100%; max-width: 400px; display: inline-flex; justify-content: center; align-items: center; gap: 8px;" onclick="generateSubtitles()">
                    <i class="ph ph-magic-wand"></i> テロップ生成開始
                </button>
            </div>
            
            <div id="progress-container" style="display: none; margin-top: 24px; padding: 20px; background: var(--bg-tertiary); border-radius: 8px; text-align: center;">
                <i class="ph ph-spinner ph-spin" style="font-size: 2rem; color: var(--primary); margin-bottom: 12px;"></i>
                <div id="progress-text" style="font-weight: bold; color: var(--text-primary);">AIが音声を解析しています... (1/2)</div>
                <p style="font-size: 0.85rem; color: var(--text-secondary); margin-top: 8px;">※数分かかる場合があります。この画面を閉じないでお待ちください。</p>
            </div>
            
            <div id="result-container" style="display: none; margin-top: 24px; padding: 24px; background: rgba(55, 178, 77, 0.1); border: 1px solid var(--success); border-radius: 8px; text-align: center;">
                <i class="ph ph-check-circle" style="font-size: 3rem; color: var(--success); margin-bottom: 16px;"></i>
                <h3 style="color: var(--success-dark); margin-bottom: 16px;">テロップ生成が完了しました！</h3>
                <p style="margin-bottom: 20px; font-size: 0.9rem;">ダウンロードした <b>.srt</b> ファイルをPremiere Proのタイムラインにドラッグ＆ドロップしてください。</p>
                <button id="btn-download" class="btn-primary" style="background: var(--success); display: inline-flex; align-items: center; gap: 8px; padding: 12px 24px; font-size: 1.1rem;">
                    <i class="ph ph-download-simple"></i> テロップファイル (.srt) をダウンロード
                </button>
            </div>
        </div>
    `;

    App.mount(html, () => {
        // Load API key from localStorage
        const savedKey = localStorage.getItem('openai_api_key');
        if (savedKey) {
            document.getElementById('openai-api-key').value = savedKey;
        }

        window.saveApiKey = () => {
            const key = document.getElementById('openai-api-key').value.trim();
            if (!key) {
                alert('APIキーを入力してください。');
                return;
            }
            localStorage.setItem('openai_api_key', key);
            alert('APIキーをブラウザに保存しました！');
        };

        window.loadScriptText = (id) => {
            const s = allScripts.find(x => x.id == id);
            if (!s || !s.fields) {
                document.getElementById('script-content').value = '';
                return;
            }
            
            let fullText = '';
            for(let i=1; i<=22; i++) {
                if (s.fields[`f${i}`]) {
                    fullText += s.fields[`f${i}`] + '\n\n';
                }
            }
            document.getElementById('script-content').value = fullText.trim();
        };

        window.generateSubtitles = async () => {
            const apiKey = localStorage.getItem('openai_api_key');
            if (!apiKey) {
                alert('まずは画面上部の「API設定」でOpenAIのAPIキーを保存してください。');
                return;
            }

            const fileInput = document.getElementById('audio-file');
            if (!fileInput.files || fileInput.files.length === 0) {
                alert('音声ファイルを選択してください。');
                return;
            }

            const file = fileInput.files[0];
            if (file.size > 25 * 1024 * 1024) {
                alert('ファイルサイズが25MBを超えています。Premiere Proで音声のビットレートを下げて書き出し直してください。');
                return;
            }

            const scriptContent = document.getElementById('script-content').value.trim();
            if (!scriptContent) {
                if (!confirm('台本テキストが空です。AIの補正なしで文字起こしのみを実行しますか？')) {
                    return;
                }
            }

            // UIを処理中に変更
            const btn = document.getElementById('btn-generate');
            const progress = document.getElementById('progress-container');
            const result = document.getElementById('result-container');
            const progressText = document.getElementById('progress-text');
            
            btn.disabled = true;
            btn.style.opacity = '0.5';
            progress.style.display = 'block';
            result.style.display = 'none';

            try {
                // Step 1: Whisper API で文字起こし (SRT形式で取得)
                progressText.textContent = 'AIが音声を解析しています... (1/2)';
                
                const formData = new FormData();
                formData.append('file', file);
                formData.append('model', 'whisper-1');
                formData.append('response_format', 'srt');
                if (scriptContent) {
                    // Whisperのpromptは直前の文脈や用語指定に使える (244トークン程度まで)
                    // 台本の最初の部分を渡すことで専門用語の認識精度を上げる
                    formData.append('prompt', scriptContent.substring(0, 500));
                }

                const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${apiKey}`
                    },
                    body: formData
                });

                if (!whisperRes.ok) {
                    const err = await whisperRes.json();
                    throw new Error(err.error?.message || 'Whisper API の呼び出しに失敗しました');
                }

                const srtText = await whisperRes.text();

                // 台本がない場合はそのまま出力して終了
                let finalSrtText = srtText;

                // Step 2: GPT-4 で校正
                if (scriptContent) {
                    progressText.textContent = '台本と照らし合わせてAIがテロップを補正しています... (2/2)';
                    
                    const systemPrompt = `
あなたはプロの動画編集テロップ作成者です。
以下に「音声認識AIが出力したSRTデータ」と「正解の台本テキスト」を渡します。

【タスク】
音声認識AIが出力したSRTデータのテキスト部分を、正解の台本テキストを参照しながら、誤字脱字や聞き間違いを修正してください。

【厳守するルール】
1. タイムスタンプ（00:00:00,000 --> 00:00:00,000）の構造や個数は**絶対に**そのまま維持してください。
2. SRTの連番（1, 2, 3...）もそのまま維持してください。
3. あなたの返答は、修正後のSRT形式のプレーンテキストのみとしてください。マークダウンのコードブロック(\`\`\`srt など)や挨拶、説明は一切含めないでください。
`;
                    const userPrompt = `
【正解の台本テキスト】
${scriptContent}

【音声認識AIが出力したSRTデータ】
${srtText}
`;

                    const gptRes = await fetch('https://api.openai.com/v1/chat/completions', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${apiKey}`
                        },
                        body: JSON.stringify({
                            model: "gpt-4o",
                            messages: [
                                { role: "system", content: systemPrompt },
                                { role: "user", content: userPrompt }
                            ],
                            temperature: 0.1
                        })
                    });

                    if (!gptRes.ok) {
                        const err = await gptRes.json();
                        throw new Error(err.error?.message || 'GPT-4 API の呼び出しに失敗しました');
                    }

                    const gptData = await gptRes.json();
                    let correctedText = gptData.choices[0].message.content.trim();
                    
                    // SRTデータのクレンジング関数
                    const cleanSrt = (text) => {
                        let clean = text.trim();
                        // マークダウンコードブロックの除去
                        clean = clean.replace(/^```[a-zA-Z0-9]*\n/, '');
                        clean = clean.replace(/\n```$/, '');
                        clean = clean.trim();

                        // 最初の字幕番号「1」の前の不要な導入文をカットする
                        // 例: "1\n00:00:00,000 --> ..." のパターンを探す
                        const match = clean.match(/(?:^|\n)(1)\s*\n\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[,.]\d{3}/);
                        if (match) {
                            const startIndex = clean.indexOf(match[1]);
                            if (startIndex !== -1) {
                                clean = clean.substring(startIndex);
                            }
                        }
                        
                        // 改行コードをWindows/Mac両対応の CRLF(\r\n) に統一
                        clean = clean.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
                        return clean;
                    };

                    finalSrtText = cleanSrt(correctedText);
                } else {
                    // 台本がない（Whisperの生データ）場合も念のため改行コードを統一
                    finalSrtText = finalSrtText.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
                }

                // 完了表示とダウンロード準備
                progress.style.display = 'none';
                result.style.display = 'block';

                const downloadBtn = document.getElementById('btn-download');
                downloadBtn.onclick = () => {
                    // Premiere Proでの文字化けや読み込みエラーを防ぐため、
                    // BOM付きUTF-8 (\ufeff) を付与してBlobを作成します
                    const blob = new Blob(["\ufeff", finalSrtText], { type: 'text/srt;charset=utf-8' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `subtitle_${new Date().getTime()}.srt`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                };

            } catch (error) {
                console.error(error);
                alert('エラーが発生しました: ' + error.message);
                progress.style.display = 'none';
            } finally {
                btn.disabled = false;
                btn.style.opacity = '1';
            }
        };
    });
};
