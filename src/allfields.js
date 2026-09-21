
        // ═══════════════════════════════════════════════════════════════════════
        // « TOUS LES CHAMPS » — extension additive (AF)
        // ---------------------------------------------------------------------
        // Objectif : afficher, filtrer et éditer TOUTES les colonnes de la table
        // Tasks, quel que soit leur nombre et leur type, sans qu'aucune colonne
        // n'ait besoin d'être connue à l'avance par le widget.
        //
        // Principe : rien du widget d'origine n'est réécrit. Le module s'installe
        // en enveloppant (wrapping) quatre fonctions — renderPanel, renderTaskList,
        // loadAllData, useDemoMode — et en ajoutant son propre DOM après coup.
        // Si une étape échoue (droits, métadonnées illisibles, version de Grist
        // différente), le widget d'origine continue de fonctionner à l'identique.
        // ═══════════════════════════════════════════════════════════════════════
        const AF = (function () {
            const TABLE = 'Tasks';
            const LS_KEY = 'tfGanttAllFields:v1';
            // Colonnes internes Grist, jamais proposées à l'édition.
            const SYSTEM_COLS = new Set(['manualSort']);
            // Champs déjà présents dans le haut du panneau : signalés comme tels,
            // mais affichés quand même (le contrat, c'est « tous les champs »).
            const NATIVE_COLS = new Set(['titre', 'description', 'type', 'priorite', 'statut', 'progression',
                'dateDebut', 'dateEcheance', 'projet', 'assignees', 'dependDe', 'tags',
                'estimationH', 'tempsPasse', 'couleur', 'subtasks', 'parentTask', 'charges', 'dateCloture']);

            let schema = [];        // [{colId,label,type,isFormula,formula,widgetOptions,visibleCol}]
            let byId = {};          // colId -> col
            let refTables = {};     // tableId -> {rows, labelCol}
            let attachBase = null;  // {baseUrl, token} pour les pièces jointes
            let ready = false;
            let demo = false;
            let ttBase = 0;
            let lastSig = null, lastDiscover = 0;
            let prefs = { cols: [], hideEmpty: false, hideNative: false, q: '', collapsed: false };

            // ── préférences (locales au navigateur, jamais écrites dans le document)
            function loadPrefs() { try { Object.assign(prefs, JSON.parse(localStorage.getItem(LS_KEY) || '{}')); } catch (e) { } }
            function savePrefs() { try { const p = Object.assign({}, prefs); delete p.q; localStorage.setItem(LS_KEY, JSON.stringify(p)); } catch (e) { } }

            // ── utilitaires de typage Grist
            const esc = (v) => escapeHtml(v == null ? '' : String(v));
            function parseJSON(s) { try { return s ? (JSON.parse(s) || {}) : {}; } catch (e) { return {}; } }
            function isList(v) { return Array.isArray(v) && v[0] === 'L'; }
            function items(v) { return isList(v) ? v.slice(1) : []; }
            function isErr(v) { return Array.isArray(v) && (v[0] === 'E' || v[0] === 'P'); }
            function isRefVal(v) { return Array.isArray(v) && (v[0] === 'R' || v[0] === 'r'); }
            function isDateVal(v) { return Array.isArray(v) && (v[0] === 'd' || v[0] === 'D'); }
            function baseType(t) { return String(t || 'Any').split(':')[0]; }
            function target(t) { const p = String(t || '').split(':'); return p.length > 1 ? p[1] : null; }
            function choicesOf(col) { const o = col.widgetOptions || {}; return Array.isArray(o.choices) ? o.choices : []; }
            function choiceColor(col, v) { const o = (col.widgetOptions || {}).choiceOptions || {}; return (o[v] && o[v].fillColor) || '#e2e8f0'; }

            function kind(col) {
                if (col.isFormula) return 'ro';
                switch (baseType(col.type)) {
                    case 'Bool': return 'bool';
                    case 'Numeric': case 'Int': return 'num';
                    case 'Date': return 'date';
                    case 'DateTime': return 'datetime';
                    case 'Choice': return 'choice';
                    case 'ChoiceList': return 'choicelist';
                    case 'Ref': return 'ref';
                    case 'RefList': return 'reflist';
                    case 'Attachments': return 'attach';
                    case 'Text': return 'text';
                    case 'Any': return 'ro';
                    default: return 'json';   // type inconnu : édition JSON brute, jamais de blocage
                }
            }

            // ═══ 1. DÉCOUVERTE DES COLONNES ═══════════════════════════════════
            // Source principale : métadonnées Grist (_grist_Tables / _grist_Tables_column),
            // qui donnent le libellé, le type exact, les choix, les formules et l'ordre.
            // Repli : les clés des enregistrements eux-mêmes, avec type déduit des valeurs.
            async function discover() {
                let cols = [];
                try {
                    const tables = TF.columnarToRows(await grist.docApi.fetchTable('_grist_Tables'));
                    const t = tables.find(x => x.tableId === TABLE);
                    if (t) {
                        const all = TF.columnarToRows(await grist.docApi.fetchTable('_grist_Tables_column'));
                        const byRow = {}; all.forEach(c => { byRow[c.id] = c; });
                        cols = all
                            .filter(c => c.parentId === t.id && c.colId && !SYSTEM_COLS.has(c.colId) && !String(c.colId).startsWith('gristHelper_'))
                            .sort((a, b) => (a.parentPos || 0) - (b.parentPos || 0))
                            .map(c => ({
                                colId: c.colId,
                                label: c.label || c.colId,
                                type: c.type || 'Any',
                                isFormula: !!(c.isFormula && c.formula),
                                formula: c.formula || '',
                                widgetOptions: parseJSON(c.widgetOptions),
                                visibleCol: (byRow[c.visibleCol] || {}).colId || null,
                                source: 'meta'
                            }));
                    }
                } catch (e) { /* métadonnées illisibles : on tombera sur le repli */ }

                if (!cols.length) cols = inferFromRecords();
                schema = cols;
                byId = {}; schema.forEach(c => { byId[c.colId] = c; });

                // Tables référencées : chargées une fois pour les libellés et les listes.
                const targets = new Set();
                schema.forEach(c => { const b = baseType(c.type); if (b === 'Ref' || b === 'RefList') { const tg = target(c.type); if (tg) targets.add(tg); } });
                for (const tg of targets) await loadRefTable(tg);
                ready = true;
            }

            // Repli sans métadonnées : on lit ce que les enregistrements contiennent.
            function inferFromRecords() {
                const known = {};
                try { (TASKFLOW_SCHEMA[TABLE] || []).forEach(c => { known[c.id] = c.type; }); } catch (e) { }
                const seen = [];
                const push = (k) => { if (k !== 'id' && !SYSTEM_COLS.has(k) && seen.indexOf(k) === -1) seen.push(k); };
                (tasks || []).slice(0, 200).forEach(t => Object.keys(t || {}).forEach(push));
                try { TASK_COLS.forEach(push); } catch (e) { }
                return seen.map(k => {
                    let type = known[k] || 'Any';
                    if (!known[k]) {
                        const v = (tasks || []).map(t => t && t[k]).find(x => x !== null && x !== undefined && x !== '');
                        if (typeof v === 'boolean') type = 'Bool';
                        else if (typeof v === 'number') type = 'Numeric';
                        else if (isList(v)) type = 'ChoiceList';
                        else if (typeof v === 'string') type = 'Text';
                    }
                    return { colId: k, label: k, type: type, isFormula: false, formula: '', widgetOptions: {}, visibleCol: null, source: 'data' };
                });
            }

            async function loadRefTable(tid) {
                if (refTables[tid]) return refTables[tid];
                let rows = [];
                try { rows = convert(await grist.docApi.fetchTable(tid)) || []; } catch (e) { rows = []; }
                refTables[tid] = { rows: rows, labelCol: pickLabelCol(rows) };
                return refTables[tid];
            }

            function pickLabelCol(rows) {
                if (!rows.length) return null;
                const keys = Object.keys(rows[0]).filter(k => k !== 'id');
                const pref = ['nom', 'titre', 'name', 'title', 'label', 'libelle', 'libellé', 'intitule', 'email'];
                for (const p of pref) { const hit = keys.find(k => k.toLowerCase() === p); if (hit) return hit; }
                return keys.find(k => typeof rows[0][k] === 'string') || keys[0] || null;
            }

            function refLabel(tid, id) {
                if (!id) return '';
                const rt = refTables[tid];
                if (!rt) return '#' + id;
                const rec = rt.rows.find(r => r.id === id);
                if (!rec) return '#' + id;
                const v = rt.labelCol ? rec[rt.labelCol] : null;
                return (v === null || v === undefined || v === '') ? ('#' + id) : String(v);
            }
            // Libellé d'une référence en tenant compte de la colonne « SHOW COLUMN » de Grist.
            function refLabelFor(col, id) {
                const tid = target(col.type); if (!tid || !id) return '';
                const rt = refTables[tid];
                if (rt && col.visibleCol && rt.rows.length) {
                    const rec = rt.rows.find(r => r.id === id);
                    if (rec && rec[col.visibleCol] !== undefined && rec[col.visibleCol] !== null && rec[col.visibleCol] !== '') return String(rec[col.visibleCol]);
                }
                return refLabel(tid, id);
            }

            // ═══ 2. AFFICHAGE TEXTE D'UNE VALEUR (puces, info-bulle, CSV) ═════
            function plain(col, v) {
                if (v === null || v === undefined || v === '') return '';
                if (isErr(v)) return '⚠ ' + (v[1] || 'erreur');
                const b = baseType(col.type);
                if (b === 'Ref') return refLabelFor(col, v);
                if (b === 'RefList') return items(v).map(id => refLabelFor(col, id)).join(', ');
                if (b === 'Attachments') return items(v).length + ' pièce(s) jointe(s)';
                if (b === 'Date') { const d = gristToDate(v); return d ? formatDate(d) : String(v); }
                if (b === 'DateTime') { const d = gristToDate(v); return d ? d.toLocaleString('fr-FR') : String(v); }
                if (b === 'Bool' || typeof v === 'boolean') return v ? 'Oui' : 'Non';
                if (isDateVal(v)) { const d = gristToDate(v[1]); return d ? formatDate(d) : String(v[1]); }
                if (isRefVal(v)) return refLabel(v[1], v[2]);
                if (isList(v)) return items(v).map(x => (x && typeof x === 'object') ? JSON.stringify(x) : String(x)).join(', ');
                if (typeof v === 'object') return JSON.stringify(v);
                return String(v);
            }

            // ═══ 3. ÉDITEURS PAR TYPE ═════════════════════════════════════════
            function toLocalInput(d) {
                if (!d) return '';
                const p = (n) => String(n).padStart(2, '0');
                return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
            }
            function dateInputToGrist(s) { // Date Grist = minuit UTC, en secondes
                if (!s) return null;
                const [y, m, d] = s.split('-').map(Number);
                return Math.floor(Date.UTC(y, m - 1, d) / 1000);
            }

            function editorHtml(col, rec) {
                const v = rec ? rec[col.colId] : null;
                const k = kind(col);
                const locked = TF.isReadOnly() || col.isFormula || k === 'attach';
                const a = 'data-af-edit="' + esc(col.colId) + '"' + (locked ? ' disabled' : '');

                if (isErr(v) && k !== 'ro') return '<div class="af-ro af-err">⚠ ' + esc(plain(col, v)) + '</div>';

                switch (k) {
                    case 'bool':
                        return '<label class="af-switch"><input type="checkbox" ' + a + (v === true ? ' checked' : '') + '><span>' + (v === true ? 'Oui' : 'Non') + '</span></label>';

                    case 'num':
                        return '<input class="af-in" type="number" step="any" ' + a + ' value="' + (v === null || v === undefined || v === '' ? '' : esc(v)) + '">';

                    case 'date':
                        return '<input class="af-in" type="date" ' + a + ' value="' + esc(v ? formatDateISO(gristToDate(v)) : '') + '">';

                    case 'datetime':
                        return '<input class="af-in" type="datetime-local" ' + a + ' value="' + esc(v ? toLocalInput(gristToDate(v)) : '') + '">';

                    case 'choice': {
                        const ch = choicesOf(col).slice();
                        if (v && ch.indexOf(v) === -1) ch.push(v);
                        const opts = ['<option value="">— vide —</option>'].concat(
                            ch.map(c => '<option value="' + esc(c) + '"' + (c === v ? ' selected' : '') + '>' + esc(c) + '</option>')).join('');
                        const dot = v ? '<span class="af-chip" style="background:' + esc(choiceColor(col, v)) + ';color:#1e293b">' + esc(v) + '</span>' : '';
                        return (dot ? '<div class="af-chips">' + dot + '</div>' : '') + '<select class="af-in" ' + a + '>' + opts + '</select>';
                    }

                    case 'choicelist': {
                        const cur = items(v).map(String);
                        const ch = choicesOf(col).slice();
                        cur.forEach(c => { if (ch.indexOf(c) === -1) ch.push(c); });
                        const chips = cur.length ? '<div class="af-chips">' + cur.map(c =>
                            '<span class="af-chip" style="background:' + esc(choiceColor(col, c)) + ';color:#1e293b">' + esc(c) +
                            (locked ? '' : '<span class="x" data-af-unset="' + esc(col.colId) + '" data-val="' + esc(c) + '">×</span>') + '</span>').join('') + '</div>' : '';
                        if (locked) return chips || '<div class="af-ro empty">—</div>';
                        const menu = ch.length
                            ? ch.map(c => '<label class="af-opt"><input type="checkbox" data-af-multi="' + esc(col.colId) + '" data-val="' + esc(c) + '"' + (cur.indexOf(c) >= 0 ? ' checked' : '') + '>' + esc(c) + '</label>').join('')
                            : '<div class="af-note">Aucun choix défini sur la colonne.</div>';
                        return chips + '<div class="af-pick"><button class="af-pick-btn" data-af-pick="1">+ Choisir…</button><div class="af-pick-menu">' + menu +
                            '<div class="af-opt"><input class="af-in" style="padding:4px 7px" placeholder="Ajouter une valeur libre…" data-af-add="' + esc(col.colId) + '"></div></div></div>';
                    }

                    case 'ref': {
                        const tid = target(col.type); const rt = refTables[tid] || { rows: [] };
                        const rows = rt.rows.slice(0, 1000);
                        const opts = ['<option value="">— vide —</option>'].concat(rows.map(r =>
                            '<option value="' + r.id + '"' + (r.id === v ? ' selected' : '') + '>' + esc(refLabelFor(col, r.id)) + '</option>'));
                        if (v && !rows.find(r => r.id === v)) opts.push('<option value="' + v + '" selected>#' + v + '</option>');
                        return '<select class="af-in" ' + a + '>' + opts.join('') + '</select>' +
                            (rt.rows.length > 1000 ? '<div class="af-note">Table ' + esc(tid) + ' tronquée à 1000 lignes.</div>' : '');
                    }

                    case 'reflist': {
                        const tid = target(col.type); const rt = refTables[tid] || { rows: [] };
                        const cur = items(v).map(Number);
                        const chips = cur.length ? '<div class="af-chips">' + cur.map(id =>
                            '<span class="af-chip">' + esc(refLabelFor(col, id) || ('#' + id)) +
                            (locked ? '' : '<span class="x" data-af-unset="' + esc(col.colId) + '" data-val="' + id + '">×</span>') + '</span>').join('') + '</div>' : '';
                        if (locked) return chips || '<div class="af-ro empty">—</div>';
                        const menu = rt.rows.slice(0, 1000).map(r =>
                            '<label class="af-opt"><input type="checkbox" data-af-multi="' + esc(col.colId) + '" data-val="' + r.id + '"' + (cur.indexOf(r.id) >= 0 ? ' checked' : '') + '>' + esc(refLabelFor(col, r.id)) + '</label>').join('')
                            || '<div class="af-note">Table ' + esc(tid) + ' vide ou illisible.</div>';
                        return chips + '<div class="af-pick"><button class="af-pick-btn" data-af-pick="1">+ Lier…</button><div class="af-pick-menu">' + menu + '</div></div>';
                    }

                    case 'attach': {
                        const ids = items(v);
                        if (!ids.length) return '<div class="af-ro empty">Aucune pièce jointe</div>';
                        const links = ids.map(id => attachBase
                            ? '<a class="af-link" target="_blank" rel="noopener" href="' + esc(attachBase.baseUrl + '/attachments/' + id + '/download?auth=' + attachBase.token) + '">Pièce jointe #' + id + '</a>'
                            : 'Pièce jointe #' + id).join('<br>');
                        return '<div class="af-ro">' + links + '</div>';
                    }

                    case 'text': {
                        const s = v === null || v === undefined ? '' : String(v);
                        const long = s.length > 60 || s.indexOf('\n') >= 0 || (col.widgetOptions || {}).widget === 'Markdown';
                        if (!locked && long) return '<textarea class="af-in" ' + a + '>' + esc(s) + '</textarea>';
                        if (locked) return s ? '<div class="af-ro">' + esc(s) + '</div>' : '<div class="af-ro empty">—</div>';
                        return '<input class="af-in" type="text" ' + a + ' value="' + esc(s) + '">' +
                            (/^https?:\/\//.test(s) ? '<div class="af-note"><a class="af-link" target="_blank" rel="noopener" href="' + esc(s) + '">Ouvrir le lien ↗</a></div>' : '');
                    }

                    case 'ro': {
                        const txt = plain(col, v);
                        return '<div class="af-ro' + (txt ? '' : ' empty') + '">' + (txt ? esc(txt) : '—') + '</div>' +
                            (col.isFormula ? '<div class="af-note">Colonne formule — lecture seule : <code>' + esc(col.formula) + '</code></div>' : '');
                    }

                    default: { // type non reconnu : on n'empêche jamais l'affichage ni l'édition
                        const raw = v === null || v === undefined ? '' : JSON.stringify(v);
                        if (locked) return '<div class="af-ro">' + esc(raw || '—') + '</div>';
                        return '<textarea class="af-in" ' + a + ' data-af-json="1" spellcheck="false">' + esc(raw) + '</textarea>' +
                            '<div class="af-note">Type « ' + esc(col.type) + ' » : édition en JSON brut.</div>';
                    }
                }
            }

            // ═══ 4. ÉCRITURE ══════════════════════════════════════════════════
            function readEditor(col, el) {
                const k = kind(col);
                if (el.dataset.afJson) { const t = el.value.trim(); return t === '' ? null : JSON.parse(t); }
                switch (k) {
                    case 'bool': return !!el.checked;
                    case 'num': return el.value === '' ? null : Number(el.value);
                    case 'date': return dateInputToGrist(el.value);
                    case 'datetime': return el.value ? Math.floor(new Date(el.value).getTime() / 1000) : null;
                    case 'ref': return el.value ? Number(el.value) : 0;
                    default: return el.value === '' ? null : el.value;
                }
            }

            async function setValue(colId, value) {
                const id = panelState && panelState.taskId;
                if (!id) return;
                const local = () => {
                    const t = tasks.find(x => x.id === id); if (t) t[colId] = value;
                    if (panelState.editData) panelState.editData[colId] = value;
                };
                if (!gristReady) { local(); showSaveIndicator(); renderSection(); render(); return; }   // mode démo
                if (TF.isReadOnly()) { showToast('Lecture seule : modification non autorisée', 'error'); return; }
                try {
                    await grist.docApi.applyUserActions([['UpdateRecord', TABLE, id, { [colId]: value }]]);
                    local(); showSaveIndicator(); renderSection();
                    if (prefs.cols.indexOf(colId) >= 0) render();
                } catch (e) {
                    console.error('[AF] écriture', colId, e);
                    showToast('Écriture refusée : ' + (e && e.message ? e.message : e), 'error');
                }
            }

            function currentList(colId) {
                const t = tasks.find(x => x.id === (panelState && panelState.taskId));
                const v = t ? t[colId] : null;
                return items(v);
            }
            function writeList(col, values) {
                const uniq = [];
                values.forEach(v => { if (uniq.indexOf(v) === -1) uniq.push(v); });
                setValue(col.colId, uniq.length ? ['L'].concat(uniq) : null);
            }

            // ═══ 5. SECTION DU PANNEAU ════════════════════════════════════════
            function visibleFields() {
                const q = (prefs.q || '').trim().toLowerCase();
                const rec = tasks.find(x => x.id === (panelState && panelState.taskId)) || {};
                return schema.filter(c => {
                    if (q && (c.label + ' ' + c.colId + ' ' + c.type).toLowerCase().indexOf(q) === -1) return false;
                    if (prefs.hideNative && NATIVE_COLS.has(c.colId)) return false;
                    if (prefs.hideEmpty && !plain(c, rec[c.colId])) return false;
                    return true;
                });
            }

            function sectionHtml() {
                const rec = tasks.find(x => x.id === (panelState && panelState.taskId));
                const list = visibleFields();
                const head =
                    '<div class="af-head">' +
                    '<span class="af-title" data-af-collapse="1"><span class="af-caret">▼</span>Tous les champs <span class="af-count">' + schema.length + '</span></span>' +
                    '<div class="af-tools">' +
                    '<input class="af-search" placeholder="Filtrer…" value="' + esc(prefs.q) + '" data-af-q="1">' +
                    '<button class="af-mini' + (prefs.hideEmpty ? ' on' : '') + '" data-af-empty="1">Masquer les vides</button>' +
                    '<button class="af-mini' + (prefs.hideNative ? ' on' : '') + '" data-af-native="1" title="N\'afficher que les colonnes absentes du panneau standard">Champs en plus</button>' +
                    '<button class="af-mini" data-af-reload="1" title="Relire les colonnes (après ajout d\'une colonne dans Grist)">↻</button>' +
                    '<button class="af-mini" data-af-csv="1" title="Exporter les tâches visibles avec toutes leurs colonnes">⤓ CSV</button>' +
                    '</div></div>';

                if (!rec) return '<div class="af-section' + (prefs.collapsed ? ' af-collapsed' : '') + '" id="afSection">' + head +
                    '<div class="af-body"><div class="af-hint">Les autres champs seront éditables une fois la tâche créée.</div></div></div>';

                const body = list.length ? list.map(c => {
                    const star = prefs.cols.indexOf(c.colId) >= 0;
                    return '<div class="af-field" data-af-field="' + esc(c.colId) + '">' +
                        '<div class="af-flabel">' +
                        '<span class="af-fname">' + esc(c.label) + '</span>' +
                        '<span class="af-ftype">' + esc(c.type) + '</span>' +
                        (c.label !== c.colId ? '<span class="af-fcol">' + esc(c.colId) + '</span>' : '') +
                        (c.isFormula ? '<span class="af-fx" title="' + esc(c.formula) + '">ƒ</span>' : '') +
                        (NATIVE_COLS.has(c.colId) ? '<span class="af-fcol" title="Ce champ dispose aussi d\'un éditeur dédié plus haut dans le panneau">· aussi ci-dessus</span>' : '') +
                        '<span class="af-star' + (star ? ' on' : '') + '" data-af-star="' + esc(c.colId) + '" title="Afficher ce champ dans la liste de gauche et l\'info-bulle">★</span>' +
                        '</div>' +
                        '<div class="af-input">' + editorHtml(c, rec) + '</div>' +
                        '</div>';
                }).join('') : '<div class="af-hint">Aucun champ ne correspond à ce filtre.</div>';

                return '<div class="af-section' + (prefs.collapsed ? ' af-collapsed' : '') + '" id="afSection">' + head + '<div class="af-body">' + body + '</div></div>';
            }

            function renderSection() {
                const host = document.getElementById('panelContent');
                if (!host || !ready) return;
                const old = document.getElementById('afSection');
                if (old) old.remove();
                host.insertAdjacentHTML('beforeend', sectionHtml());
            }

            // ═══ 6. PUCES DANS LA LISTE + INFO-BULLE ══════════════════════════
            function shortLabel(s) { s = String(s || ''); return s.length > 12 ? s.slice(0, 11) + '…' : s; }

            function decorateList() {
                if (!ready || !prefs.cols.length || !schema.length) return;
                const index = new Map((tasks || []).map(t => [t.id, t]));
                document.querySelectorAll('#taskList .task-row').forEach(row => {
                    const t = index.get(Number(row.dataset.id)); if (!t) return;
                    const info = row.querySelector('.task-info');
                    if (!info || info.querySelector('.af-rowchips')) return;
                    const html = prefs.cols.map(cid => {
                        const c = byId[cid]; if (!c) return '';
                        const txt = plain(c, t[cid]); if (!txt) return '';
                        return '<span class="af-rowchip" title="' + esc(c.label + ' : ' + txt) + '"><i>' + esc(shortLabel(c.label)) + '</i>' + esc(txt.length > 24 ? txt.slice(0, 23) + '…' : txt) + '</span>';
                    }).join('');
                    if (html) info.insertAdjacentHTML('beforeend', '<div class="af-rowchips">' + html + '</div>');
                });
            }

            function syncTooltip() {
                try {
                    TOOLTIP_FIELDS.length = ttBase;
                    prefs.cols.forEach(cid => {
                        const c = byId[cid]; if (!c) return;
                        TOOLTIP_FIELDS.push({ key: cid, label: c.label, format: (t) => plain(c, t[cid]) || null });
                    });
                } catch (e) { }
            }

            // ═══ 7. SÉLECTEUR DE COLONNES (en-tête de la liste) ═══════════════
            function mountGear() {
                const head = document.querySelector('.task-list-header');
                if (!head || head.querySelector('.af-gear')) return;
                head.insertAdjacentHTML('beforeend',
                    '<button class="af-gear" data-af-gear="1" title="Choisir les champs affichés dans la liste">⚙ Champs</button>' +
                    '<div class="af-cols-pop" id="afColsPop"></div>');
            }

            function renderColsPop() {
                const pop = document.getElementById('afColsPop'); if (!pop) return;
                pop.innerHTML = '<h4>Champs affichés dans la liste</h4>' +
                    '<div class="af-note">Cochez n\'importe quelle colonne de <code>Tasks</code> : elle apparaît sous le nom de la tâche et dans l\'info-bulle du Gantt.</div>' +
                    (schema.length ? schema.map(c =>
                        '<label class="af-opt"><input type="checkbox" data-af-col="' + esc(c.colId) + '"' + (prefs.cols.indexOf(c.colId) >= 0 ? ' checked' : '') + '>' +
                        esc(c.label) + ' <span class="af-ftype">' + esc(c.type) + '</span></label>').join('')
                        : '<div class="af-note">Colonnes non encore chargées.</div>') +
                    (prefs.cols.length ? '<button class="af-mini" data-af-clearcols="1" style="margin-top:8px">Tout décocher</button>' : '');
            }

            // ═══ 8. EXPORT CSV (toutes les colonnes) ══════════════════════════
            function exportCsv() {
                const rows = (typeof currentVisible !== 'undefined' && currentVisible.length ? currentVisible.map(v => v.task) : tasks) || [];
                const cols = schema.length ? schema : inferFromRecords();
                const q = (s) => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';
                const lines = [['id'].concat(cols.map(c => c.label)).map(q).join(';')];
                rows.forEach(t => lines.push([t.id].concat(cols.map(c => plain(c, t[c.colId]))).map(q).join(';')));
                const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
                try {
                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(blob);
                    a.download = 'taches-tous-les-champs.csv';
                    document.body.appendChild(a); a.click();
                    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
                    showToast(rows.length + ' tâche(s) × ' + cols.length + ' colonne(s) exportées', 'success');
                } catch (e) { showToast('Export impossible dans cet environnement', 'error'); }
            }

            // ═══ 9. ÉVÉNEMENTS (délégation : aucun handler inline) ════════════
            function bind() {
                document.addEventListener('change', (ev) => {
                    const el = ev.target;
                    if (el.dataset && el.dataset.afEdit) {
                        const col = byId[el.dataset.afEdit]; if (!col) return;
                        let val; try { val = readEditor(col, el); }
                        catch (e) { showToast('Valeur JSON invalide', 'error'); return; }
                        setValue(col.colId, val);
                    } else if (el.dataset && el.dataset.afMulti) {
                        const col = byId[el.dataset.afMulti]; if (!col) return;
                        const isRef = baseType(col.type) === 'RefList';
                        const val = isRef ? Number(el.dataset.val) : el.dataset.val;
                        const cur = currentList(col.colId).map(x => isRef ? Number(x) : String(x));
                        writeList(col, el.checked ? cur.concat([val]) : cur.filter(x => x !== val));
                    } else if (el.dataset && el.dataset.afCol) {
                        const cid = el.dataset.afCol;
                        prefs.cols = el.checked ? prefs.cols.concat([cid]) : prefs.cols.filter(x => x !== cid);
                        savePrefs(); syncTooltip(); render(); renderColsPop();
                    }
                });

                document.addEventListener('keydown', (ev) => {
                    const el = ev.target;
                    if (ev.key === 'Enter' && el.dataset && el.dataset.afAdd) {
                        const col = byId[el.dataset.afAdd]; if (!col) return;
                        const v = el.value.trim(); if (!v) return;
                        writeList(col, currentList(col.colId).map(String).concat([v]));
                        ev.preventDefault();
                    }
                });

                document.addEventListener('input', (ev) => {
                    const el = ev.target;
                    if (el.dataset && el.dataset.afQ !== undefined && el.classList.contains('af-search')) {
                        prefs.q = el.value; savePrefs();
                        const pos = el.selectionStart;
                        renderSection();
                        const again = document.querySelector('#afSection .af-search');
                        if (again) { again.focus(); try { again.setSelectionRange(pos, pos); } catch (e) { } }
                    }
                });

                document.addEventListener('click', (ev) => {
                    const t = ev.target;
                    const pick = t.closest && t.closest('[data-af-pick]');
                    if (pick) { pick.parentElement.classList.toggle('open'); ev.stopPropagation(); return; }
                    if (!(t.closest && t.closest('.af-pick'))) document.querySelectorAll('.af-pick.open').forEach(p => p.classList.remove('open'));

                    if (t.dataset && t.dataset.afUnset) {
                        const col = byId[t.dataset.afUnset]; if (!col) return;
                        const isRef = baseType(col.type) === 'RefList';
                        const val = isRef ? Number(t.dataset.val) : t.dataset.val;
                        writeList(col, currentList(col.colId).map(x => isRef ? Number(x) : String(x)).filter(x => x !== val));
                        return;
                    }
                    if (t.dataset && t.dataset.afStar) {
                        const cid = t.dataset.afStar;
                        prefs.cols = prefs.cols.indexOf(cid) >= 0 ? prefs.cols.filter(x => x !== cid) : prefs.cols.concat([cid]);
                        savePrefs(); syncTooltip(); renderSection(); render(); renderColsPop();
                        return;
                    }
                    if (t.dataset && t.dataset.afEmpty !== undefined && t.classList.contains('af-mini') && t.dataset.afEmpty) {
                        prefs.hideEmpty = !prefs.hideEmpty; savePrefs(); renderSection(); return;
                    }
                    if (t.dataset && t.dataset.afReload) { refresh(true).then(() => showToast('Colonnes relues', 'success')); return; }
                    if (t.dataset && t.dataset.afNative) { prefs.hideNative = !prefs.hideNative; savePrefs(); renderSection(); return; }
                    if (t.dataset && t.dataset.afCsv) { exportCsv(); return; }
                    if (t.closest && t.closest('[data-af-collapse]')) { prefs.collapsed = !prefs.collapsed; savePrefs(); renderSection(); return; }
                    if (t.dataset && t.dataset.afClearcols) { prefs.cols = []; savePrefs(); syncTooltip(); render(); renderColsPop(); return; }

                    const gear = t.closest && t.closest('[data-af-gear]');
                    const pop = document.getElementById('afColsPop');
                    if (gear) { renderColsPop(); if (pop) pop.classList.toggle('open'); gear.classList.toggle('on', pop && pop.classList.contains('open')); ev.stopPropagation(); return; }
                    if (pop && pop.classList.contains('open') && !(t.closest && t.closest('#afColsPop'))) {
                        pop.classList.remove('open');
                        const g = document.querySelector('.af-gear'); if (g) g.classList.remove('on');
                    }
                });
            }

            // ═══ 10. DÉMO : colonnes supplémentaires de démonstration ═════════
            // Hors de Grist (page de démo GitHub Pages), on fabrique des colonnes
            // de tous types pour montrer ce que le widget sait faire.
            function demoAugment() {
                demo = true;
                const extra = [
                    { colId: 'client', label: 'Client', type: 'Text' },
                    { colId: 'budget', label: 'Budget (€)', type: 'Numeric' },
                    { colId: 'facturable', label: 'Facturable', type: 'Bool' },
                    { colId: 'risque', label: 'Niveau de risque', type: 'Choice', widgetOptions: { choices: ['Faible', 'Moyen', 'Élevé'], choiceOptions: { 'Faible': { fillColor: '#d1fae5' }, 'Moyen': { fillColor: '#fef3c7' }, 'Élevé': { fillColor: '#fee2e2' } } } },
                    { colId: 'compétences', label: 'Compétences', type: 'ChoiceList', widgetOptions: { choices: ['SQL', 'Python', 'UX', 'DevOps', 'Rédaction'] } },
                    { colId: 'référent', label: 'Référent', type: 'Ref:Team' },
                    { colId: 'dateRevue', label: 'Date de revue', type: 'Date' },
                    { colId: 'derniereMaj', label: 'Dernière modification', type: 'DateTime' },
                    { colId: 'lienSpec', label: 'Lien spécification', type: 'Text' },
                    { colId: 'notesTerrain', label: 'Notes de terrain', type: 'Text' },
                    { colId: 'resteAFaire', label: 'Reste à faire (h)', type: 'Any', isFormula: true, formula: '$estimationH - $tempsPasse' }
                ];
                const now = Math.floor(Date.now() / 1000);
                const clients = ['Métropole', 'Ministère', 'Coopérative', 'Syndicat mixte'];
                const skills = [['SQL', 'Python'], ['UX'], ['DevOps', 'SQL'], ['Rédaction']];
                (tasks || []).forEach((t, i) => {
                    t.client = clients[i % clients.length];
                    t.budget = 1500 + i * 850;
                    t.facturable = i % 3 !== 0;
                    t.risque = ['Faible', 'Moyen', 'Élevé'][i % 3];
                    t['compétences'] = ['L'].concat(skills[i % skills.length]);
                    t['référent'] = (i % 3) + 1;
                    t.dateRevue = t.dateEcheance || null;
                    t.derniereMaj = now - i * 7200;
                    t.lienSpec = 'https://example.org/specs/tache-' + t.id;
                    t.notesTerrain = i % 2 ? 'Relevé effectué sur site.\nDeux points bloquants à arbitrer avec le client avant la recette.' : '';
                    t.resteAFaire = (t.estimationH || 0) - (t.tempsPasse || 0);
                });
                schema = inferFromRecords().map(c => {
                    const e = extra.find(x => x.colId === c.colId);
                    return e ? Object.assign({ isFormula: false, formula: '', widgetOptions: {}, visibleCol: null, source: 'demo' }, e) : c;
                });
                byId = {}; schema.forEach(c => { byId[c.colId] = c; });
                // Libellés lisibles pour les colonnes standard (confort de la démo).
                const LIB = { titre: 'Titre', priorite: 'Priorité', projet: 'Projet', dateDebut: 'Date de début',
                    dateEcheance: 'Échéance', progression: 'Progression (%)', statut: 'Statut', type: 'Type',
                    assignees: 'Assignés', tags: 'Étiquettes', dependDe: 'Dépend de', estimationH: 'Estimation (h)',
                    tempsPasse: 'Temps passé (h)', parentTask: 'Tâche parente', description: 'Description', couleur: 'Couleur' };
                schema.forEach(c => { if (LIB[c.colId]) c.label = LIB[c.colId]; });
                byId = {}; schema.forEach(c => { byId[c.colId] = c; });
                refTables['Team'] = { rows: team || [], labelCol: 'nom' };
                refTables['Projects'] = { rows: projects || [], labelCol: 'nom' };
                refTables['Tasks'] = { rows: tasks || [], labelCol: 'titre' };
                ready = true;
                mountGear(); syncTooltip(); render();
            }

            // ═══ 11. INSTALLATION ═════════════════════════════════════════════
            // Les métadonnées ne sont relues que si la liste des colonnes a changé
            // ou si elles datent de plus de 30 s : onRecords peut se déclencher à
            // chaque frappe, inutile de refetcher le schéma à chaque fois.
            function syncRefsFromWidget() {
                if (refTables['Team']) refTables['Team'].rows = team || [];
                if (refTables['Projects']) refTables['Projects'].rows = projects || [];
                if (refTables['Tasks']) refTables['Tasks'].rows = tasks || [];
            }

            async function refresh(force) {
                try {
                    let sig = null;
                    try { sig = Array.from(TASK_COLS || []).sort().join(','); } catch (e) { }
                    if (force || !ready || sig !== lastSig || Date.now() - lastDiscover > 30000) {
                        await discover();
                        lastSig = sig; lastDiscover = Date.now();
                    } else {
                        syncRefsFromWidget();
                    }
                    if (!attachBase && schema.some(c => baseType(c.type) === 'Attachments')) {
                        try {
                            const tok = await grist.docApi.getAccessToken({ readOnly: true });
                            attachBase = { baseUrl: tok.baseUrl, token: tok.token };
                        } catch (e) { attachBase = null; }
                    }
                    mountGear(); syncTooltip(); decorateList(); renderSection();
                } catch (e) { console.error('[AF] découverte des colonnes', e); }
            }

            function install() {
                loadPrefs();
                try { ttBase = TOOLTIP_FIELDS.length; } catch (e) { ttBase = 0; }
                bind();

                const _renderPanel = window.renderPanel;
                window.renderPanel = function () { const r = _renderPanel.apply(this, arguments); try { renderSection(); } catch (e) { console.error('[AF]', e); } return r; };

                const _renderTaskList = window.renderTaskList;
                window.renderTaskList = function () { const r = _renderTaskList.apply(this, arguments); try { decorateList(); } catch (e) { console.error('[AF]', e); } return r; };

                const _loadAllData = window.loadAllData;
                window.loadAllData = async function () { const r = await _loadAllData.apply(this, arguments); try { await refresh(); } catch (e) { console.error('[AF]', e); } return r; };

                const _useDemoMode = window.useDemoMode;
                window.useDemoMode = function () { const r = _useDemoMode.apply(this, arguments); try { demoAugment(); } catch (e) { console.error('[AF]', e); } return r; };

                document.addEventListener('DOMContentLoaded', mountGear);
                mountGear();
            }

            return { install, refresh, schema: () => schema, prefs: () => prefs, plain, exportCsv };
        })();
        AF.install();
