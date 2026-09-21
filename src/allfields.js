
        // ═══════════════════════════════════════════════════════════════════════
        // « TOUS LES CHAMPS » — extension additive (AF)
        // ---------------------------------------------------------------------
        // Objectif : afficher et éditer TOUTES les colonnes de la table Tasks,
        // quel que soit leur nombre et leur type, sans qu'aucune colonne n'ait
        // besoin d'être connue à l'avance par le widget.
        //
        // Les colonnes que le panneau d'origine n'affiche pas sont insérées dans
        // sa liste de propriétés (.props-list), avec exactement le balisage des
        // champs natifs (.prop-row / .prop-label / .prop-value) et leurs contrôles
        // (.form-input, .form-select, .dates-inline, .multi-select, .tag-chip…).
        // À l'écran, rien ne distingue une colonne ajoutée dans Grist d'un champ
        // d'origine ; les champs déjà édités par le panneau ne sont pas dupliqués.
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
            // Champs que le panneau d'origine édite déjà : on ne les affiche pas une
            // seconde fois. Ils restent disponibles pour l'épinglage et l'export.
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
            let prefs = { cols: [], hideEmpty: false };

            // ── préférences (locales au navigateur, jamais écrites dans le document)
            function loadPrefs() { try { const p = JSON.parse(localStorage.getItem(LS_KEY) || '{}'); if (Array.isArray(p.cols)) prefs.cols = p.cols; prefs.hideEmpty = !!p.hideEmpty; } catch (e) { } }
            function savePrefs() { try { localStorage.setItem(LS_KEY, JSON.stringify(prefs)); } catch (e) { } }

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
            function choiceOpt(col, v) { const o = (col.widgetOptions || {}).choiceOptions || {}; return o[v] || {}; }
            function choiceColor(col, v) { return choiceOpt(col, v).fillColor || '#e2e8f0'; }

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
                const push = (k) => { if (k !== 'id' && !SYSTEM_COLS.has(k) && !String(k).startsWith('gristHelper_') && seen.indexOf(k) === -1) seen.push(k); };
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

            // ═══ 3. ÉDITEURS PAR TYPE — balisage natif du panneau ═════════════
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
            const hint = (t) => '<div class="af-hint">' + t + '</div>';
            // Même composant que « Assigner un membre » / « Dépendances » du panneau d'origine.
            function multiSelect(menu, btnLabel) {
                return '<div class="multi-select af-msel"><button type="button" class="addbtn" data-af-pick="1"><span style="font-size:1rem;line-height:1">+</span> ' + btnLabel + '</button>' +
                    '<div class="multi-select-dropdown">' + (menu || '<div class="multi-select-empty">Aucun choix</div>') + '</div></div>';
            }
            function option(colId, val, label, checked) {
                return '<label class="multi-select-option' + (checked ? ' selected' : '') + '"><input type="checkbox" data-af-multi="' + esc(colId) + '" data-val="' + esc(val) + '"' + (checked ? ' checked' : '') + '>' + esc(label) + '</label>';
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
                        return '<input class="form-input" type="number" step="any" ' + a + ' value="' + (v === null || v === undefined || v === '' ? '' : esc(v)) + '">';

                    case 'date':   // même habillage que la ligne « Dates » du panneau
                        return '<div class="dates-inline"><input type="date" ' + a + ' value="' + esc(v ? formatDateISO(gristToDate(v)) : '') + '"></div>';

                    case 'datetime':
                        return '<div class="dates-inline"><input type="datetime-local" ' + a + ' value="' + esc(v ? toLocalInput(gristToDate(v)) : '') + '"></div>';

                    case 'choice': {   // même habillage que la ligne « Projet » : pastille de couleur + liste
                        const ch = choicesOf(col).slice();
                        if (v && ch.indexOf(v) === -1) ch.push(v);
                        const opts = ['<option value="">—</option>'].concat(
                            ch.map(c => '<option value="' + esc(c) + '"' + (c === v ? ' selected' : '') + '>' + esc(c) + '</option>')).join('');
                        return '<div class="project-select-wrap"><span class="project-color-dot af-dot" style="background:' + esc(v ? choiceColor(col, v) : '#94a3b8') + '"></span>' +
                            '<select class="form-select" ' + a + '>' + opts + '</select></div>';
                    }

                    case 'choicelist': {   // puces comme les tags, menu comme les assignés
                        const cur = items(v).map(String);
                        const ch = choicesOf(col).slice();
                        cur.forEach(c => { if (ch.indexOf(c) === -1) ch.push(c); });
                        const chips = cur.map(c => {
                            const o = choiceOpt(col, c);
                            const st = o.fillColor ? ' style="background:' + esc(o.fillColor) + ';border-color:' + esc(o.fillColor) + ';color:' + esc(o.textColor || '#1e293b') + '"' : '';
                            return '<span class="tag-chip"' + st + '>' + esc(c) + (locked ? '' : '<span class="remove" data-af-unset="' + esc(col.colId) + '" data-val="' + esc(c) + '">×</span>') + '</span>';
                        }).join('');
                        const chipsHtml = chips ? '<div class="af-chips">' + chips + '</div>' : '';
                        if (locked) return chipsHtml || '<div class="af-ro empty">—</div>';
                        const menu = ch.map(c => option(col.colId, c, c, cur.indexOf(c) >= 0)).join('') +
                            '<div class="multi-select-option af-free"><input type="text" class="form-input" placeholder="Autre valeur… (Entrée)" data-af-add="' + esc(col.colId) + '"></div>';
                        return chipsHtml + multiSelect(menu, 'Ajouter');
                    }

                    case 'ref': {   // même liste déroulante que « Projet »
                        const tid = target(col.type); const rt = refTables[tid] || { rows: [] };
                        const rows = rt.rows.slice(0, 1000);
                        const opts = ['<option value="">—</option>'].concat(rows.map(r =>
                            '<option value="' + r.id + '"' + (r.id === v ? ' selected' : '') + '>' + esc(refLabelFor(col, r.id)) + '</option>'));
                        if (v && !rows.find(r => r.id === v)) opts.push('<option value="' + v + '" selected>#' + v + '</option>');
                        return '<select class="form-select" ' + a + '>' + opts.join('') + '</select>' +
                            (rt.rows.length > 1000 ? hint('Liste limitée aux 1000 premiers enregistrements de ' + esc(tid) + '.') : '');
                    }

                    case 'reflist': {   // puces + menu, comme « Assignés »
                        const tid = target(col.type); const rt = refTables[tid] || { rows: [] };
                        const cur = items(v).map(Number);
                        const chips = cur.map(id => '<span class="multi-select-chip">' + esc(refLabelFor(col, id) || ('#' + id)) +
                            (locked ? '' : '<span class="remove" data-af-unset="' + esc(col.colId) + '" data-val="' + id + '">×</span>') + '</span>').join('');
                        const chipsHtml = chips ? '<div class="af-chips">' + chips + '</div>' : '';
                        if (locked) return chipsHtml || '<div class="af-ro empty">—</div>';
                        const menu = rt.rows.slice(0, 1000).map(r => option(col.colId, r.id, refLabelFor(col, r.id), cur.indexOf(r.id) >= 0)).join('')
                            || '<div class="multi-select-empty">Table ' + esc(tid) + ' vide ou illisible</div>';
                        return chipsHtml + multiSelect(menu, 'Lier');
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
                        if (locked) return s ? '<div class="af-ro">' + esc(s) + '</div>' : '<div class="af-ro empty">—</div>';
                        if (long) return '<textarea class="form-textarea" ' + a + '>' + esc(s) + '</textarea>';
                        return '<input class="form-input" type="text" ' + a + ' value="' + esc(s) + '">' +
                            (/^https?:\/\//.test(s) ? hint('<a class="af-link" target="_blank" rel="noopener" href="' + esc(s) + '">Ouvrir le lien ↗</a>') : '');
                    }

                    case 'ro': {
                        const txt = plain(col, v);
                        return '<div class="af-ro' + (txt ? '' : ' empty') + '">' + (txt ? esc(txt) : '—') + '</div>';
                    }

                    default: { // type non reconnu : on n'empêche jamais l'affichage ni l'édition
                        const raw = v === null || v === undefined ? '' : JSON.stringify(v);
                        if (locked) return '<div class="af-ro">' + esc(raw || '—') + '</div>';
                        return '<textarea class="form-textarea" ' + a + ' data-af-json="1" spellcheck="false">' + esc(raw) + '</textarea>' +
                            hint('Type « ' + esc(col.type) + ' » : édition en JSON brut.');
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
                // Mode démo (hors de Grist) : l'amont laisse gristReady à true après le repli,
                // on s'appuie donc sur notre propre indicateur — les modifications restent locales.
                if (demo || !gristReady) { local(); showSaveIndicator(); renderRows(); render(); return; }
                if (TF.isReadOnly()) { showToast('Lecture seule : modification non autorisée', 'error'); return; }
                try {
                    await grist.docApi.applyUserActions([['UpdateRecord', TABLE, id, { [colId]: value }]]);
                    local(); showSaveIndicator(); renderRows();
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

            // ═══ 5. LIGNES DU PANNEAU ═════════════════════════════════════════
            // Les colonnes non natives deviennent des .prop-row à la suite des
            // propriétés d'origine (Statut, Priorité, Dates, Projet…).
            function extraFields() {
                return schema.filter(c => !NATIVE_COLS.has(c.colId) && !SYSTEM_COLS.has(c.colId));
            }

            // Icône de libellé par type, dans le même trait que celles de l'amont
            // (l'amont choisit les siennes par mots-clés du libellé ; data-dec="1"
            // lui signale que la ligne est déjà décorée).
            const PIC = {
                text: '<path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/>',
                num: '<line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/>',
                bool: '<polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
                date: '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
                datetime: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
                choice: '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>',
                choicelist: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
                ref: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
                attach: '<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
                ro: '<path d="M18 4H6l6 8-6 8h12"/>',
                json: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>'
            };
            PIC.reflist = PIC.ref;
            function pic(col) {
                const d = PIC[kind(col)] || PIC.text;
                return '<svg class="tf-pic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + d + '</svg>';
            }

            function rowHtml(col, rec) {
                const star = prefs.cols.indexOf(col.colId) >= 0;
                return '<div class="prop-row af-row" data-af-field="' + esc(col.colId) + '">' +
                    '<span class="prop-label" data-dec="1">' + pic(col) + esc(col.label) +
                    (col.isFormula ? '<span class="af-fx" title="Colonne formule, calculée par Grist : ' + esc(col.formula) + '">ƒ</span>' : '') +
                    '<span class="af-star' + (star ? ' on' : '') + '" data-af-star="' + esc(col.colId) + '" title="' + (star ? 'Ne plus afficher' : 'Afficher') + ' ce champ dans la liste de gauche et l\'info-bulle du Gantt">★</span>' +
                    '</span>' +
                    '<div class="prop-value">' + editorHtml(col, rec) + '</div></div>';
            }

            function renderRows() {
                const host = document.getElementById('panelContent');
                if (!host || !ready) return;
                host.querySelectorAll('.af-row').forEach(el => el.remove());
                const fields = extraFields();
                if (!fields.length) return;
                let list = host.querySelector('.props-list');
                if (!list) { list = document.createElement('div'); list.className = 'props-list'; host.appendChild(list); }   // repli si l'amont change de structure
                if (panelState && panelState.isNew) {
                    list.insertAdjacentHTML('beforeend', '<div class="prop-row af-row"><span class="prop-label" data-dec="1">Autres champs</span>' +
                        '<div class="prop-value af-hint">' + fields.length + ' colonne(s) supplémentaire(s) de <code>Tasks</code>, modifiables une fois la tâche créée.</div></div>');
                    return;
                }
                const rec = tasks.find(x => x.id === (panelState && panelState.taskId));
                if (!rec) return;
                const shown = prefs.hideEmpty ? fields.filter(c => plain(c, rec[c.colId]) !== '') : fields;
                list.insertAdjacentHTML('beforeend', shown.map(c => rowHtml(c, rec)).join(''));
            }

            // ═══ 6. CHAMPS ÉPINGLÉS DANS LA LISTE + INFO-BULLE ════════════════
            // Les rangées de la liste ont une hauteur fixe (alignée sur le Gantt) :
            // les valeurs épinglées prennent la place restante sur la ligne des
            // dates, sur une seule ligne tronquée ; le détail complet est en title.
            function shortLabel(s) { s = String(s || ''); return s.length > 14 ? s.slice(0, 13) + '…' : s; }

            function decorateList() {
                if (!ready || !prefs.cols.length || !schema.length) return;
                const index = new Map((tasks || []).map(t => [t.id, t]));
                document.querySelectorAll('#taskList .task-row').forEach(row => {
                    const t = index.get(Number(row.dataset.id)); if (!t) return;
                    const host = row.querySelector('.task-meta') || row.querySelector('.task-info');
                    if (!host || host.querySelector('.af-rowchips')) return;
                    const parts = [], full = [];
                    prefs.cols.forEach(cid => {
                        const c = byId[cid]; if (!c) return;
                        const txt = plain(c, t[cid]); if (!txt) return;
                        full.push(c.label + ' : ' + txt);
                        parts.push('<span class="af-rowchip"><i>' + esc(shortLabel(c.label)) + '</i>' + esc(txt) + '</span>');
                    });
                    if (parts.length) host.insertAdjacentHTML('beforeend', '<span class="af-rowchips" title="' + esc(full.join('\n')) + '">' + parts.join('') + '</span>');
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

            // ═══ 7. MENU « ⚙ CHAMPS » (en-tête de la liste) ═══════════════════
            // Épinglage des colonnes dans la liste, option « masquer les vides »,
            // relecture du schéma et export CSV.
            function mountGear() {
                const head = document.querySelector('.task-list-header');
                if (!head || head.querySelector('.af-gear')) return;
                head.insertAdjacentHTML('beforeend',
                    '<button class="af-gear" data-af-gear="1" title="Champs affichés dans la liste, options du panneau, export">⚙ Champs</button>' +
                    '<div class="af-cols-pop" id="afColsPop"></div>');
            }

            function renderColsPop() {
                const pop = document.getElementById('afColsPop'); if (!pop) return;
                pop.innerHTML = '<h4>Champs affichés dans la liste</h4>' +
                    '<div class="af-note">Cochez une colonne de <code>Tasks</code> : elle apparaît sous le nom de la tâche et dans l\'info-bulle du Gantt.</div>' +
                    (schema.length ? schema.map(c =>
                        '<label class="af-opt"><input type="checkbox" data-af-col="' + esc(c.colId) + '"' + (prefs.cols.indexOf(c.colId) >= 0 ? ' checked' : '') + '>' +
                        esc(c.label) + ' <span class="af-ftype">' + esc(c.type) + '</span></label>').join('')
                        : '<div class="af-note">Colonnes non encore chargées.</div>') +
                    (prefs.cols.length ? '<button class="af-mini" data-af-clearcols="1" style="margin-top:8px">Tout décocher</button>' : '') +
                    '<div class="af-sep"></div><h4>Panneau de détail</h4>' +
                    '<label class="af-opt"><input type="checkbox" data-af-hideempty="1"' + (prefs.hideEmpty ? ' checked' : '') + '>Masquer les champs vides</label>' +
                    '<div class="af-actions">' +
                    '<button class="af-mini" data-af-reload="1" title="Relire les colonnes après en avoir ajouté une dans Grist">↻ Relire les colonnes</button>' +
                    '<button class="af-mini" data-af-csv="1" title="Exporter les tâches visibles avec toutes leurs colonnes">⤓ Export CSV</button>' +
                    '</div>';
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
                    if (!el.dataset) return;
                    if (el.dataset.afEdit) {
                        const col = byId[el.dataset.afEdit]; if (!col) return;
                        let val; try { val = readEditor(col, el); }
                        catch (e) { showToast('Valeur JSON invalide', 'error'); return; }
                        setValue(col.colId, val);
                    } else if (el.dataset.afMulti) {
                        const col = byId[el.dataset.afMulti]; if (!col) return;
                        const isRef = baseType(col.type) === 'RefList';
                        const val = isRef ? Number(el.dataset.val) : el.dataset.val;
                        const cur = currentList(col.colId).map(x => isRef ? Number(x) : String(x));
                        writeList(col, el.checked ? cur.concat([val]) : cur.filter(x => x !== val));
                    } else if (el.dataset.afCol) {
                        const cid = el.dataset.afCol;
                        prefs.cols = el.checked ? prefs.cols.concat([cid]) : prefs.cols.filter(x => x !== cid);
                        savePrefs(); syncTooltip(); render(); renderRows(); renderColsPop();
                    } else if (el.dataset.afHideempty) {
                        prefs.hideEmpty = !!el.checked; savePrefs(); renderRows();
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

                document.addEventListener('click', (ev) => {
                    const t = ev.target;
                    if (!t || !t.closest) return;

                    // Menu « + Ajouter / + Lier » : même mécanique que toggleMultiSelect() de l'amont,
                    // dont le gestionnaire global referme déjà les menus au clic extérieur.
                    const pick = t.closest('[data-af-pick]');
                    if (pick) {
                        const ms = pick.closest('.multi-select');
                        document.querySelectorAll('.multi-select.open').forEach(s => { if (s !== ms) s.classList.remove('open'); });
                        if (ms) ms.classList.toggle('open');
                        return;
                    }
                    if (t.dataset.afUnset) {
                        const col = byId[t.dataset.afUnset]; if (!col) return;
                        const isRef = baseType(col.type) === 'RefList';
                        const val = isRef ? Number(t.dataset.val) : t.dataset.val;
                        writeList(col, currentList(col.colId).map(x => isRef ? Number(x) : String(x)).filter(x => x !== val));
                        return;
                    }
                    if (t.dataset.afStar) {
                        const cid = t.dataset.afStar;
                        prefs.cols = prefs.cols.indexOf(cid) >= 0 ? prefs.cols.filter(x => x !== cid) : prefs.cols.concat([cid]);
                        savePrefs(); syncTooltip(); renderRows(); render(); renderColsPop();
                        return;
                    }
                    if (t.dataset.afReload) { refresh(true).then(() => showToast('Colonnes relues', 'success')); return; }
                    if (t.dataset.afCsv) { exportCsv(); return; }
                    if (t.dataset.afClearcols) { prefs.cols = []; savePrefs(); syncTooltip(); render(); renderRows(); renderColsPop(); return; }

                    const gear = t.closest('[data-af-gear]');
                    const pop = document.getElementById('afColsPop');
                    if (gear) { renderColsPop(); if (pop) pop.classList.toggle('open'); gear.classList.toggle('on', pop && pop.classList.contains('open')); ev.stopPropagation(); return; }
                    if (pop && pop.classList.contains('open') && !t.closest('#afColsPop')) {
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
                // Libellés lisibles pour les colonnes standard (menu ⚙ et puces de la liste).
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
                    mountGear(); syncTooltip(); decorateList(); renderRows();
                } catch (e) { console.error('[AF] découverte des colonnes', e); }
            }

            function install() {
                loadPrefs();
                try { ttBase = TOOLTIP_FIELDS.length; } catch (e) { ttBase = 0; }
                bind();

                const _renderPanel = window.renderPanel;
                window.renderPanel = function () { const r = _renderPanel.apply(this, arguments); try { renderRows(); } catch (e) { console.error('[AF]', e); } return r; };

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
