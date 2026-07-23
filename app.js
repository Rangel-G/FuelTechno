// Seleção de Elementos de Interface Doméstica (Bancada Estática)
const chkManualMode = document.getElementById('chk-auto');
const wsStatusText = document.getElementById('ws-status');
const viewport = document.getElementById('content-viewport');

const sliders = {
    rpm: document.getElementById('param-rpm'),
    speed: document.getElementById('param-speed'),
    map: document.getElementById('param-map'),
    ect: document.getElementById('param-ect'),
    fpress: document.getElementById('param-fpress'),
    fuel: document.getElementById('param-fuel')
};

const labels = {
    rpm: document.getElementById('lbl-rpm'),
    speed: document.getElementById('lbl-speed'),
    map: document.getElementById('lbl-map'),
    ect: document.getElementById('lbl-ect'),
    fpress: document.getElementById('lbl-fpress'),
    fuel: document.getElementById('lbl-fuel')
};



const uiComponents = {};

function initializeUiComponents(root = document) {
    root.querySelectorAll('[data-ui-component]').forEach(el => {
        const key = el.dataset.uiComponent;
        if (key) uiComponents[key] = el;
    });
}

function setUiComponentVisible(name, visible) {
    const el = uiComponents[name];
    if (!el) return;
    el.style.display = visible ? '' : 'none';
}

function toggleUiComponentsForMap(mapName) {
    const isSport = mapName === 'Sport';
    setUiComponentVisible('rpm-ramp', !isSport);
    setUiComponentVisible('rpm-scale', !isSport);
    setUiComponentVisible('rpm-control-group', !isSport);
}

initializeUiComponents();

const MAP_SLUGS = {
    'Diário': 'diario',
    'Rua': 'rua',
    'Pista': 'pista',
    'Drift': 'drift',
    'Sport': 'sport',
};

let _lastGlow = null;
let currentActiveMapName = 'Diário';
let tractionControlActive = true;
let socket = null;
let currentRedlineRpm = 3000;
let ledAutoMode = true;
let ledManualColorHex = '#ff0000';
// só fica "true" depois que o usuário aperta "Ligar Conexão" e o
// backend confirma que abriu a porta com sucesso.
let obdConnected = false;
let gearConfig = JSON.parse(localStorage.getItem('ft_config_gear') || 'null')
    || { ratios: [3.58, 1.93, 1.41, 1.11, 0.88], diff: 4.25, perimeter: 1.83 };

function generateUUID() {
    if (crypto.randomUUID) return crypto.randomUUID();
    // fallback p/ contexto inseguro (http://IP): usa getRandomValues
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40; // versão 4
    b[8] = (b[8] & 0x3f) | 0x80; // variante
    const h = [...b].map(x => x.toString(16).padStart(2, '0'));
    return `${h.slice(0, 4).join('')}-${h.slice(4, 6).join('')}-${h.slice(6, 8).join('')}-${h.slice(8, 10).join('')}-${h.slice(10, 16).join('')}`;
}



let _pendingFtdiSerial = null;

function refreshFtdiList() {
    sendLedCommand({ cmd: 'list_ftdi_devices' });
}

function preencherListaFtdi(devices) {
    const select = document.getElementById('cfg-obd-ftdi-device');
    if (!select) return;

    select.innerHTML = '<option value="">-- Nenhum adaptador encontrado --</option>';
    (devices || []).forEach(dev => {
        const opt = document.createElement('option');
        opt.value = dev.serial_number;
        opt.textContent = `${dev.description || 'FTDI'} (S/N ${dev.serial_number})`;
        select.appendChild(opt);
    });

    // Restaura a seleção salva, só se o adaptador ainda estiver conectado
    if (_pendingFtdiSerial && [...select.options].some(o => o.value === _pendingFtdiSerial)) {
        select.value = _pendingFtdiSerial;
    }
}

const deviceId = localStorage.getItem('ft_device_id') || (() => {
    const id = generateUUID();
    localStorage.setItem('ft_device_id', id);
    return id;
})();

chkManualMode.onchange = () => toggleInputsState();

function toggleInputsState() {
    const isManual = chkManualMode.checked;
    Object.values(sliders).forEach(slider => slider && (slider.disabled = !isManual));
}

// ==========================================
// ROTEAMENTO DE PÁGINAS (NOVO SISTEMA)
// ==========================================

async function carregarPagina(nomePagina) {
    let arquivoParaCarregar = `pages/${nomePagina}.html`;

    if (nomePagina === 'painel') {
        const mapaSlug = MAP_SLUGS[currentActiveMapName] || 'diario';
        arquivoParaCarregar = `pages/painel-${mapaSlug}.html`;
    }

    try {
        const resposta = await fetch(arquivoParaCarregar, { cache: 'no-store' });
        const html = await resposta.text();
        viewport.innerHTML = html;
        inicializarElementosDinamicos(nomePagina);
        if (nomePagina.startsWith('painel')) {
            toggleUiComponentsForMap(currentActiveMapName);
        }
    } catch (e) {
        console.error("Erro ao carregar:", e);
    }
}

// ==========================================
// EVENTOS DA BARRA DE NAVEGAÇÃO INFERIOR
// ==========================================
document.querySelectorAll('.bottom-nav .nav-btn').forEach(botao => {
    botao.addEventListener('click', (e) => {
        // Remove active de todos e põe no clicado
        document.querySelectorAll('.bottom-nav .nav-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');

        // Puxa a nova tela
        const paginaAlvo = e.target.getAttribute('data-page');

        // Se clicar no botão "Painel", chama a função que força o layout do mapa ativo
        if (paginaAlvo === 'painel') {
            selectActiveMap(currentActiveMapName);
        } else {
            // Se for outra página (Mapas, Datalogger, Ajustes), carrega normalmente
            carregarPagina(paginaAlvo);
        }
    });
});

// Associa os cliques de elementos que são injetados dinamicamente
function inicializarElementosDinamicos(pagina) {
    // 1. Lógica do Painel
    if (pagina.startsWith('painel')) {
        const painelGrid = document.getElementById('page-painel');
        if (painelGrid) {
            painelGrid.classList.forEach(cls => cls.startsWith('layout-') && painelGrid.classList.remove(cls));
            const slug = MAP_SLUGS[currentActiveMapName] || 'diario';
            painelGrid.classList.add(`layout-${slug}`);
        }
    }

    // 2. Lógica dos Mapas
    if (pagina === 'mapas') {
        document.querySelectorAll('.map-select-box').forEach(box => {
            const title = box.querySelector('.map-title').innerText;

            // Marca como ativo se o título contiver o nome do mapa atual
            box.classList.toggle('map-active', title.toUpperCase().includes(currentActiveMapName.toUpperCase()));

            // Define o clique
            box.onclick = () => {
                const novoMapa = Object.keys(MAP_SLUGS).find(m => title.includes(m)) || 'Diário';
                selectActiveMap(novoMapa);
            };
        });
    }

    // 3. Lógica da tela de Ajustes (controles de configuração)
    if (pagina === 'datalogger') {
        DynoLogger.attach();
    }

    if (pagina === 'ajustes') {


        function inicializarConfigGear() {
            const ratiosInput = document.getElementById('cfg-gear-ratios');
            const diffInput = document.getElementById('cfg-gear-diff');
            const perimInput = document.getElementById('cfg-gear-perim');
            const btnSave = document.getElementById('btn-save-gear');
            const badge = document.getElementById('gear-status-badge');
            if (!ratiosInput || !btnSave) return;

            ratiosInput.value = gearConfig.ratios.join(',');
            diffInput.value = gearConfig.diff;
            perimInput.value = gearConfig.perimeter;
            if (badge) badge.innerText = `${gearConfig.ratios.length} marchas`;

            btnSave.onclick = () => {
                const ratios = ratiosInput.value.split(',').map(v => parseFloat(v.trim())).filter(v => !isNaN(v) && v > 0);
                if (ratios.length === 0) return;
                gearConfig = { ratios, diff: parseFloat(diffInput.value) || gearConfig.diff, perimeter: parseFloat(perimInput.value) || gearConfig.perimeter };
                cgearConfig = { ratios, diff: parseFloat(diffInput.value) || gearConfig.diff, perimeter: parseFloat(perimInput.value) || gearConfig.perimeter };
                localStorage.setItem('ft_config_gear', JSON.stringify(gearConfig));
                CloudSync.push('gear_config', gearConfig);
                sendLedCommand({ cmd: 'update_config', section: 'gear', device_id: deviceId, ...gearConfig });
                if (badge) badge.innerText = `${ratios.length} marchas`;
                btnSave.classList.add('saved');
                btnSave.innerHTML = '<span class="save-icon">✓</span> Salvo!';
                setTimeout(() => { btnSave.classList.remove('saved'); btnSave.innerHTML = '<span class="save-icon">✓</span> Salvar Rel. Marcha'; }, 2000);
            };
        }

        inicializarConfigOBD();
        inicializarConfigLED();
        inicializarControlesLed();
        inicializarControlesObd();
        inicializarConfigGear();
    }
}

// ==========================================
// SINCRONISMO NA NUVEM (Firebase Auth anônima + Firestore)
// ==========================================
const CloudSync = (() => {
    const SECTION_MAP = { obd: 'obd_config', led: 'led_config', gear: 'gear_config' };
    let db = null;
    let uid = null;
    let ready = false; // true assim que uid + persistência offline estiverem prontos

    function init() {
        if (typeof firebase === 'undefined' || !window.FT_FIREBASE_CONFIG) {
            console.warn('[CloudSync] SDK ou config ausentes — sincronismo desativado.');
            return Promise.resolve(false);
        }

        firebase.initializeApp(window.FT_FIREBASE_CONFIG);
        db = firebase.firestore();

        // Persistência offline: cache local do Firestore em IndexedDB.
        // Essencial rodando dentro do carro — sem isso, sem 4G o app
        // não le nem escreve config nenhuma.
        return db.enablePersistence({ synchronizeTabs: true })
            .catch(err => {
                // 'failed-precondition' = outra aba já abriu com persistência;
                // 'unimplemented' = navegador sem suporte (ex: WebView antigo).
                // Em ambos os casos seguimos sem cache local, só sem offline.
                console.warn('[CloudSync] Persistencia offline indisponivel:', err.code);
            })
            .then(() => authenticate());
    }

    function authenticate() {
        return new Promise((resolve) => {
            firebase.auth().onAuthStateChanged(async (user) => {
                if (user) {
                    uid = user.uid;
                    ready = true;
                    await migrateFromLocalStorageIfNeeded();
                    resolve(true);
                } else {
                    firebase.auth().signInAnonymously().catch(err => {
                        console.warn('[CloudSync] Falha na autenticacao anonima:', err);
                        resolve(false);
                    });
                }
            });
        });
    }

    function isReady() {
        return ready && uid !== null;
    }

    function getUid() {
        return uid;
    }

    const SECTION_KEYS = {
        led_config: 'ft_config_led',
        gear_config: 'ft_config_gear',
    };
    const BOOTSTRAP_FLAG = 'ft_cloud_bootstrapped';

    function _docRef(section) {
        return db.collection('users').doc(uid).collection('configs').doc(section);
    }

    function _readObdLocal() {
        const byType = JSON.parse(localStorage.getItem('ft_config_obd_by_type') || '{}');
        const lastType = localStorage.getItem('ft_config_obd_last_type') || '';
        return { by_type: byType, last_type: lastType };
    }

    function _writeObdLocal(data) {
        if (!data) return;
        if (data.by_type) localStorage.setItem('ft_config_obd_by_type', JSON.stringify(data.by_type));
        if (data.last_type) localStorage.setItem('ft_config_obd_last_type', data.last_type);
    }

    async function push(section, data) {
        if (!isReady()) return;
        try {
            await _docRef(section).set(data, { merge: true });
        } catch (err) {
            console.warn(`[CloudSync] Falha ao gravar ${section}:`, err);
        }
    }

    async function pullAll() {
        for (const section of ['obd_config', 'led_config', 'gear_config']) {
            try {
                const snap = await _docRef(section).get();
                if (!snap.exists) continue;
                const data = snap.data();
                if (section === 'obd_config') _writeObdLocal(data);
                else localStorage.setItem(SECTION_KEYS[section], JSON.stringify(data));
            } catch (err) {
                console.warn(`[CloudSync] Falha ao ler ${section}:`, err);
            }
        }
    }

    async function migrateFromLocalStorageIfNeeded() {
        if (localStorage.getItem(BOOTSTRAP_FLAG) === uid) {
            // Já migrado nesta conta anônima — apenas puxa o que houver de mais recente.
            await pullAll();
            return;
        }

        const ledLocal = JSON.parse(localStorage.getItem('ft_config_led') || 'null');
        const gearLocal = JSON.parse(localStorage.getItem('ft_config_gear') || 'null');
        const obdLocal = _readObdLocal();

        if (ledLocal) await push('led_config', ledLocal);
        if (gearLocal) await push('gear_config', gearLocal);
        if (obdLocal.by_type && Object.keys(obdLocal.by_type).length) await push('obd_config', obdLocal);

        // Marca por uid: se a auth anônima expirar e vier um uid novo,
        // migra de novo em vez de assumir silenciosamente que já foi feito.
        localStorage.setItem(BOOTSTRAP_FLAG, uid);
    }

    return { init, isReady, getUid, push, pullAll, SECTION_MAP };
})();


// ==========================================
// SUAVIZAÇÃO VISUAL (rAF + lerp exponencial)
// ==========================================
function renderSmoothed(ch) {
    if (ch.rpm) {
        const r = ch.rpm.cur;
        setNeedleAngle('needle-speed', 52.917, 52.917, -170 + (r / 8000) * 222);
        const fill = document.getElementById('rpm-svg-fill');
        if (fill) fill.setAttribute('width', (r / 8000) * 1000);
        safeSetText('overlay-rpm-val', Math.round(r));
    }
    if (ch.ect) {
        const t = ch.ect.cur;
        setNeedleAngle('needle-rpm', 25.797, 25.797, -170 + (t / 120) * 210);
        safeSetText('val-temp-value', Math.round(t));
    }
}

const VisualSmoother = (() => {
    const TAU_MS = 90;   // constante de tempo: menor = mais seco/responsivo
    const EPS = 0.05;    // limiar de convergência
    const channels = Object.create(null);
    let rafId = null, lastT = 0;

    function tick(now) {
        const dt = Math.min(now - lastT, 100); // clamp p/ aba em background
        lastT = now;
        const alpha = 1 - Math.exp(-dt / TAU_MS); // independente de framerate
        let moving = false;
        for (const k in channels) {
            const c = channels[k];
            const d = c.target - c.cur;
            if (Math.abs(d) < EPS) { c.cur = c.target; continue; }
            c.cur += d * alpha;
            moving = true;
        }
        renderSmoothed(channels);
        rafId = moving ? requestAnimationFrame(tick) : null; // para sozinho quando estabiliza
    }

    function set(key, value, min, max) {
        if (typeof value !== 'number' || Number.isNaN(value)) return;
        const v = Math.min(Math.max(value, min), max);
        const c = channels[key] || (channels[key] = { cur: v, target: v });
        c.target = v;
        if (rafId === null) { lastT = performance.now(); rafId = requestAnimationFrame(tick); }
    }

    return { set };
})();

// ==========================================
// TOGGLE DOS PAINÉIS EXPANSÍVEIS
// ==========================================

function toggleConfigPanel(panelId) {
    const panel = document.getElementById(panelId);
    if (!panel) return;

    const isOpening = !panel.classList.contains('panel-open');

    // Comportamento "acordeão": ao abrir um painel, fecha os outros.
    // Evita que OBD e LED fiquem abertos ao mesmo tempo, o que
    // sobrecarrega a tela pequena e corta os campos de baixo.
    if (isOpening) {
        document.querySelectorAll('.config-panel.panel-open').forEach(p => {
            if (p.id !== panelId) p.classList.remove('panel-open');
        });
    }

    panel.classList.toggle('panel-open');
}

// ==========================================
// CONFIGURAÇÃO OBD-II
// ==========================================

// Mapa de placeholders por tipo de conexão
const OBD_TYPE_HINTS = {
    'bluetooth': { label: 'Porta COM (Bluetooth)', placeholder: 'COM4', baudVisible: true },
    'usb': { label: 'Porta COM (USB)', placeholder: 'COM7', baudVisible: true },
    'ftdi-d2xx': { label: 'Adaptador FTDI (D2XX)', placeholder: '', baudVisible: true },
};

function inicializarConfigOBD() {
    const typeSelect = document.getElementById('cfg-obd-type');
    const addrInput = document.getElementById('cfg-obd-addr');
    const addrLabel = document.getElementById('cfg-obd-addr-label');
    const baudSelect = document.getElementById('cfg-obd-baud');
    const protoSelect = document.getElementById('cfg-obd-proto');
    const btnSave = document.getElementById('btn-save-obd');
    const badge = document.getElementById('obd-status-badge');
    const btnRefreshFtdi = document.getElementById('btn-refresh-ftdi');
    if (btnRefreshFtdi) btnRefreshFtdi.onclick = refreshFtdiList;

    if (!typeSelect || !addrInput || !btnSave) return;

    // Configuração salva POR TIPO (permite alternar Bluetooth/USB sem perder
    // a porta COM de cada um)
    const allSaved = JSON.parse(localStorage.getItem('ft_config_obd_by_type') || '{}');

    // Migração automática de configs antigas (versão com 4 tipos de conexão)
    const legacy = JSON.parse(localStorage.getItem('ft_config_obd') || '{}');
    if (legacy.connection_type && Object.keys(allSaved).length === 0) {
        const migratedType = legacy.connection_type.includes('usb') ? 'usb' : 'bluetooth';
        allSaved[migratedType] = legacy;
        localStorage.setItem('ft_config_obd_by_type', JSON.stringify(allSaved));
    }

    function loadTypeConfig(type) {
        const saved = allSaved[type] || {};
        addrInput.value = saved.serial_port || '';
        if (baudSelect) baudSelect.value = saved.baud_rate !== undefined ? String(saved.baud_rate) : baudSelect.value;
        if (protoSelect) protoSelect.value = saved.protocol !== undefined ? saved.protocol : protoSelect.value;
        if (badge) badge.innerText = saved.serial_port || saved.ftdi_serial || type.toUpperCase();
        _pendingFtdiSerial = saved.ftdi_serial || null;
    }

    function updatePlaceholder() {
        const hints = OBD_TYPE_HINTS[typeSelect.value] || OBD_TYPE_HINTS['bluetooth'];
        const isFtdi = typeSelect.value === 'ftdi-d2xx';

        addrInput.placeholder = hints.placeholder;
        if (addrLabel) addrLabel.innerText = hints.label;
        const baudField = baudSelect?.closest('.config-field');
        if (baudField) baudField.style.display = hints.baudVisible ? '' : 'none';

        // Porta serial manual não se aplica ao modo FTDI D2XX
        const addrField = addrInput.closest('.config-field');
        if (addrField) addrField.style.display = isFtdi ? 'none' : '';

        const ftdiWrapper = document.getElementById('cfg-obd-ftdi-wrapper');
        if (ftdiWrapper) ftdiWrapper.style.display = isFtdi ? '' : 'none';

        if (isFtdi) refreshFtdiList();
    }

    // Restaura o último tipo usado ou preserva a seleção do HTML quando não há config salva
    const lastType = localStorage.getItem('ft_config_obd_last_type') || typeSelect.value;
    typeSelect.value = lastType;
    updatePlaceholder();
    loadTypeConfig(lastType);

    typeSelect.onchange = () => {
        updatePlaceholder();
        loadTypeConfig(typeSelect.value);
        localStorage.setItem('ft_config_obd_last_type', typeSelect.value);
    };

    btnSave.onclick = () => {
        const type = typeSelect.value;
        const isFtdi = type === 'ftdi-d2xx';
        const ftdiSelect = document.getElementById('cfg-obd-ftdi-device');

        if (isFtdi && !ftdiSelect?.value) {
            if (badge) badge.innerText = 'SELECIONE UM ADAPTADOR';
            return; // não salva config incompleta silenciosamente
        }
        const config = {
            connection_type: type,
            serial_port: isFtdi ? '' : (addrInput.value || addrInput.placeholder),
            baud_rate: baudSelect ? parseInt(baudSelect.value) : 115200,
            protocol: protoSelect ? protoSelect.value : 'auto',
            ftdi_serial: isFtdi ? ftdiSelect.value : '',
        };
        allSaved[type] = config;
        localStorage.setItem('ft_config_obd_by_type', JSON.stringify(allSaved));
        localStorage.setItem('ft_config_obd_last_type', type);
        CloudSync.push('obd_config', { by_type: allSaved, last_type: type });

        if (badge) badge.innerText = config.serial_port || config.ftdi_serial;
        sendLedCommand({ cmd: 'update_config', section: 'obd', device_id: deviceId, ...config });

        btnSave.classList.add('saved');
        btnSave.innerHTML = '<span class="save-icon">✓</span> Salvo!';
        setTimeout(() => {
            btnSave.classList.remove('saved');
            btnSave.innerHTML = '<span class="save-icon">✓</span> Salvar Conexão';
        }, 2000);
    };
}

// ==========================================
// CONTROLE MANUAL DA CONEXÃO OBD-II (Ligar/Desligar)
// ==========================================

function inicializarControlesObd() {
    const btnConnect = document.getElementById('btn-obd-connect');
    const btnDisconnect = document.getElementById('btn-obd-disconnect');

    if (!btnConnect || !btnDisconnect) return;

    // Reflete o estado atual (caso o usuário já tenha ligado antes de abrir essa tela)
    atualizarUiConexaoObd();

    btnConnect.onclick = () => {
        btnConnect.disabled = true;
        btnConnect.innerText = 'Conectando...';
        sendLedCommand({ cmd: 'connect_obd' });
    };

    btnDisconnect.onclick = () => {
        sendLedCommand({ cmd: 'disconnect_obd' });
    };
}

function atualizarUiConexaoObd() {
    const btnConnect = document.getElementById('btn-obd-connect');
    const btnDisconnect = document.getElementById('btn-obd-disconnect');
    const badge = document.getElementById('obd-conn-badge');

    if (btnConnect) {
        btnConnect.disabled = obdConnected;
        btnConnect.innerText = obdConnected ? 'Conectado' : 'Ligar Conexão';
    }
    if (btnDisconnect) {
        btnDisconnect.disabled = !obdConnected;
    }
    if (badge) {
        badge.innerText = obdConnected ? 'CONECTADO' : 'DESCONECTADO';
        badge.classList.toggle('config-status-off', !obdConnected);
    }
}

// ==========================================
// CONFIGURAÇÃO DO DISPOSITIVO LED
// ==========================================

function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

function inicializarConfigLED() {
    const deviceId = localStorage.getItem('ft_device_id') || (() => {
        const id = crypto.randomUUID();
        localStorage.setItem('ft_device_id', id);
        return id;
    })();

    const nameInput = document.getElementById('cfg-led-name');
    const uuidInput = document.getElementById('cfg-led-uuid');
    const redlineInput = document.getElementById('cfg-led-redline');
    const blinkInput = document.getElementById('cfg-led-blink');
    const colorNormal = document.getElementById('cfg-led-color-normal');
    const colorRedline = document.getElementById('cfg-led-color-redline');
    const lblNormal = document.getElementById('lbl-color-normal');
    const lblRedline = document.getElementById('lbl-color-redline');
    const btnSave = document.getElementById('btn-save-led');
    const badge = document.getElementById('led-status-badge');

    if (!nameInput || !btnSave) return;

    // Carrega configuração salva
    const saved = JSON.parse(localStorage.getItem('ft_config_led') || '{}');

    if (saved.device_name) nameInput.value = saved.device_name;
    if (saved.char_uuid) uuidInput.value = saved.char_uuid;
    if (saved.redline_rpm) redlineInput.value = saved.redline_rpm;
    if (saved.blink_interval_ms) blinkInput.value = saved.blink_interval_ms;
    if (saved.color_normal && colorNormal) {
        colorNormal.value = rgbToHex(...saved.color_normal);
    }
    if (saved.color_redline && colorRedline) {
        colorRedline.value = rgbToHex(...saved.color_redline);
    }

    // Atualiza badge
    if (badge && saved.device_name) {
        badge.innerText = saved.device_name.substring(0, 10);
    }

    // Atualiza label de cor conforme seleção
    function updateColorLabels() {
        if (lblNormal && colorNormal) lblNormal.innerText = colorNormal.value;
        if (lblRedline && colorRedline) lblRedline.innerText = colorRedline.value;
    }
    if (colorNormal) colorNormal.oninput = updateColorLabels;
    if (colorRedline) colorRedline.oninput = updateColorLabels;
    updateColorLabels();

    // Salvar
    btnSave.onclick = () => {
        const normalRgb = hexToRgb(colorNormal?.value || '#0084ff');
        const redlineRgb = hexToRgb(colorRedline?.value || '#ff0000');

        const config = {
            device_name: nameInput.value || nameInput.placeholder,
            char_uuid: uuidInput?.value || uuidInput?.placeholder || '0000ffe1-0000-1000-8000-00805f9b34fb',
            redline_rpm: parseInt(redlineInput?.value || '3000'),
            blink_interval_ms: parseInt(blinkInput?.value || '70'),
            color_normal: [normalRgb.r, normalRgb.g, normalRgb.b],
            color_redline: [redlineRgb.r, redlineRgb.g, redlineRgb.b],
        };
        currentRedlineRpm = config.redline_rpm;
        safeSetText('gauge-max-rpm', currentRedlineRpm);
        localStorage.setItem('ft_config_led', JSON.stringify(config));
        CloudSync.push('led_config', config);

        // Atualiza badge
        if (badge) badge.innerText = config.device_name.substring(0, 10);

        // Envia pro backend
        sendLedCommand({ cmd: 'update_config', section: 'led', device_id: deviceId, ...config });

        // Feedback visual
        btnSave.classList.add('saved');
        btnSave.innerHTML = '<span class="save-icon">✓</span> Salvo!';
        setTimeout(() => {
            btnSave.classList.remove('saved');
            btnSave.innerHTML = '<span class="save-icon">✓</span> Salvar LED';
        }, 2000);
    };
}

// ==========================================
// CONTROLE DA FITA DE LED (Power/Color inline)
// ==========================================

function sendLedCommand(payload) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(payload));
    }
}

function hexToRgb(hex) {
    const clean = hex.replace('#', '');
    return {
        r: parseInt(clean.substring(0, 2), 16),
        g: parseInt(clean.substring(2, 4), 16),
        b: parseInt(clean.substring(4, 6), 16),
    };
}

function inicializarControlesLed() {
    const chkAuto = document.getElementById('chk-led-auto');
    const btnOn = document.getElementById('btn-led-on');
    const btnOff = document.getElementById('btn-led-off');

    if (!chkAuto || !btnOn || !btnOff) return;

    // Restaura o estado lembrado localmente (não persiste após F5, só entre trocas de aba)
    chkAuto.checked = ledAutoMode;

    chkAuto.onchange = () => {
        ledAutoMode = chkAuto.checked;
        sendLedCommand({ cmd: 'led_auto', auto: ledAutoMode });
    };

    btnOn.onclick = () => sendLedCommand({ cmd: 'led_power', on: true });
    btnOff.onclick = () => sendLedCommand({ cmd: 'led_power', on: false });
}

function toggleTractionControl() {
    tractionControlActive = !tractionControlActive;
    const tcBox = document.getElementById('box-tc');
    const tcTxt = document.getElementById('tc-status-text');
    if (!tcBox || !tcTxt) return; // Evita erro se mudar de tela no meio

    if (tractionControlActive) {
        tcBox.className = "channel-box tc-active";
        tcTxt.innerText = "ATIVO";
    } else {
        tcBox.className = "channel-box tc-disabled";
        tcTxt.innerText = "INATIVO";
    }
}

function toggleRpmSliderForMap(mapName) {
    toggleUiComponentsForMap(mapName);
}

// Adicione esta função globalmente (pode colocar logo abaixo da função toggleTractionControl)
function selectActiveMap(mapName) {
    currentActiveMapName = mapName;
    updateTopMapLabel();
    document.getElementById('ecu-screen')?.classList.toggle('sport-mode', mapName === 'Sport');

    // Feedback visual nos cards de seleção
    const mapBoxes = document.querySelectorAll('.map-select-box');
    mapBoxes.forEach(box => {
        box.classList.remove('map-active');
        const title = box.querySelector('.map-title')?.innerText;
        if (title && title.includes(mapName)) {
            box.classList.add('map-active');
        }
    });

    // Determina qual ficheiro HTML carregar com base no mapa selecionado
    let paginaAlvo = 'painel-' + (MAP_SLUGS[mapName] || 'diario');

    // Carrega a página correta e aplica as classes de layout após a injeção do HTML
    carregarPagina(paginaAlvo).then(() => {
        const painelGrid = document.getElementById('page-painel');
        if (painelGrid) {
            const slug = MAP_SLUGS[mapName] || 'diario';
            painelGrid.classList.add(`layout-${slug}`);
        }
        toggleRpmSliderForMap(mapName);
    });

    // Atualiza o menu inferior para acender o botão "Painel"
    document.querySelectorAll('.bottom-nav .nav-btn').forEach(b => {
        b.classList.remove('active');
        if (b.getAttribute('data-page') === 'painel') {
            b.classList.add('active');
        }
    });
}

function updateTopMapLabel() {
    const labelEl = document.getElementById('map-name');
    if (labelEl) labelEl.innerText = `MAPA: ${currentActiveMapName.toUpperCase()}`;
}

// ==========================================
// RENDERIZAÇÃO E LÓGICA DO MOTOR
// ==========================================

function calculateGear(currentRpm, currentSpeed) {
    if (currentSpeed < 4 || currentRpm < 1050) return 'N';
    const { diff: diferencial, ratios: marchas, perimeter: perimetroPneu } = gearConfig;

    let melhorMarcha = `${marchas.length}ª`;
    let menorDiferencaRpm = Infinity;

    for (let i = 0; i < marchas.length; i++) {
        let relacaoTotal = marchas[i] * diferencial;
        let rpmTeoricoEsperado = (currentSpeed * relacaoTotal * 1000) / (perimetroPneu * 60);
        let diferencaRpm = Math.abs(currentRpm - rpmTeoricoEsperado);
        if (diferencaRpm < menorDiferencaRpm) {
            menorDiferencaRpm = diferencaRpm;
            melhorMarcha = (i + 1) + 'ª';
        }
    }
    return melhorMarcha;
}

// Função segura para atualizar textos (Evita erro se a aba estiver fechada)
function safeSetText(id, text) {
    const el = document.getElementById(id);
    if (el) el.innerText = text;
}
function safeSetStyleWidth(id, widthValue) {
    const el = document.getElementById(id);
    if (el) el.style.width = widthValue;
}

function renderEcuUI(rpm, speed, map, ect, fpress, fpress_avail, load, battery, fuel, milOn, dtcCount, ledColor) {
    const gear = calculateGear(rpm, speed);

    const values = {
        'val-rpm': rpm,
        'val-speed': speed,
        'val-gear': gear,
        'val-map': map.toFixed(2),
        'val-turbo': map.toFixed(2),
        'val-ect': ect,
        'val-power': `${load}%`,
        'val-fpress': fpress_avail ? fpress.toFixed(2) : "N/D",
        'val-battery': (battery || 0).toFixed(1),
        'val-fuel': fuel
    };

    // Atualização dinâmica: se o ID existir na tela, ele recebe o valor
    Object.keys(values).forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerText = values[id];
    });

    // --- INDICADOR DE DIAGNÓSTICO (MIL / DTC) - Painel Diário ---
    const lblFault = document.getElementById('val-fault');
    if (lblFault) {
        if (milOn || dtcCount > 0) {
            lblFault.innerText = "FALHA";
            lblFault.style.color = "#ff3b30";
        } else {
            lblFault.innerText = "OK";
            lblFault.style.color = "#34c759";
        }
    }

    // --- LÓGICA EXCLUSIVA PARA O PAINEL DE DRIFT ---

    // 1. Gerenciamento do Pico de Giro (Max RPM)
    const lblRpmMax = document.getElementById('val-rpm-max');
    if (lblRpmMax) {
        let currentMax = parseInt(lblRpmMax.innerText) || 0;
        if (rpm > currentMax) {
            lblRpmMax.innerText = rpm;
        }
        // Reseta o pico se o carro desligar/resetar na bancada
        if (rpm === 0 && speed === 0) lblRpmMax.innerText = "0";
    }

    // 2. Cálculo do Indicador Delta de Patinagem (Wheel Spin)
    const lblWheelSpin = document.getElementById('val-wheel-spin');
    if (lblWheelSpin) {
        // Se o giro estiver alto mas a velocidade for baixa, indica roda patinando (Drift ativo)
        if (rpm > 3800 && speed < 45 && speed > 5) {
            lblWheelSpin.innerText = "CRÍTICO";
            lblWheelSpin.style.color = "#ff3b30"; // Vermelho
        } else if (rpm > 2500 && speed < 25 && speed > 2) {
            lblWheelSpin.innerText = "ALTO";
            lblWheelSpin.style.color = "#ff9500"; // Laranja
        } else {
            lblWheelSpin.innerText = "ESTÁVEL";
            lblWheelSpin.style.color = "#34c759"; // Verde
        }
    }

    // 2. Lógica Visual/Hardware (Barra RPM, Shift Light, Datalogger)
    updateVisuals(rpm, map, ect);

    // 2b. Gauges do painel Sport (SVG needles + indicador de cor do LED)
    updateGaugeVisuals(rpm, ect, map, ledColor)

    // 3. Sincronização com Bancada (Apenas se estiver no modo manual)
    syncManualControls(rpm, speed, map, ect, fpress, fpress_avail);
}

// --- Funções auxiliares para manter o código limpo ---

function updateVisuals(rpm, map, ect) {
    VisualSmoother.set('rpm', rpm, 0, 8000);
    VisualSmoother.set('ect', ect, 0, 120);

    const isOverLimit = rpm >= currentRedlineRpm;   // valor REAL, sem lag
    const screenEl = document.getElementById('ecu-screen');
    if (screenEl) screenEl.classList.toggle('screen-alert-active', isOverLimit);

    safeSetStyleWidth('log-bar-rpm', `${(rpm / 8000) * 100}%`);
    safeSetStyleWidth('log-bar-map', `${Math.max(0, Math.min(100, ((map + 1) / 4) * 100))}%`);
    safeSetStyleWidth('log-bar-ect', `${(ect / 120) * 100}%`);
    DynoLogger.sample(rpm);
}

function syncManualControls(rpm, speed, map, ect, fpress, fpress_avail) {
    if (!chkManualMode.checked) {
        sliders.rpm.value = rpm;
        sliders.speed.value = speed;
        sliders.map.value = map;
        // ... restante dos sliders
    }
}

// dentro de runManualLoop (bancada manual):
function runManualLoop() {
    if (chkManualMode.checked) {
        let loadCalc = Math.round(((parseFloat(sliders.map.value) + 1) / 4) * 100);
        renderEcuUI(
            parseInt(sliders.rpm.value),
            parseInt(sliders.speed.value),
            parseFloat(sliders.map.value),
            parseInt(sliders.ect.value),
            parseFloat(sliders.fpress.value),
            true,
            Math.max(12, Math.min(100, loadCalc)),
            12.6,
            sliders.fuel ? parseInt(sliders.fuel.value) : 75,
            false,
            0,
            undefined
        );
    }
}

/*
    Novas funções para painel-Sport
*/

// Gira uma agulha em torno do centro do PRÓPRIO viewBox do SVG onde ela vive
// (o Acelerômetro e o Manômetro têm viewBoxes e centros diferentes entre si).
function setNeedleAngle(id, pivotX, pivotY, angleDeg) {
    const el = document.getElementById(id);
    if (!el) return;
    el.setAttribute('transform', `rotate(${angleDeg} ${pivotX} ${pivotY})`);
}

function updateGaugeVisuals(rpm, ect, turbo, ledColor) {
    // Manômetro grande (RPM): pivô 52.917, -170°..52°
    /*const rpmClamped = Math.min(Math.max(rpm, 0), 8000);
     const rpmAngle = -170 + (rpmClamped / 8000) * (52 - -170);
     setNeedleAngle('needle-speed', 52.917, 52.917, rpmAngle);
 
     // Accel pequeno (temperatura): pivô 25.797, -170°..40°
     const ectClamped = Math.min(Math.max(ect, 0), 120);
     const ectAngle = -170 + (ectClamped / 120) * (40 - -170);
     setNeedleAngle('needle-rpm', 25.797, 25.797, ectAngle);
 
     const elTemp = document.getElementById('val-temp-value');
     if (elTemp) elTemp.innerText = Math.round(ect);*/

    // Triângulo de shift-light: ligado ao RPM (redline)
    const triangle = document.getElementById('shift-light-triangle');
    if (triangle) triangle.classList.toggle('shift-light-triangle--active', rpm >= currentRedlineRpm);

    if (ledColor) {
        const glowRgb = `${ledColor[0]}, ${ledColor[1]}, ${ledColor[2]}`;
        if (glowRgb !== _lastGlow) {
            _lastGlow = glowRgb;
            document.documentElement.style.setProperty('--glow-rgb', glowRgb);
        }
        document.querySelectorAll('.gauge-led-indicator').forEach(dot => {
            dot.style.background = `rgb(${ledColor[0]}, ${ledColor[1]}, ${ledColor[2]})`;
            dot.style.boxShadow = `0 0 16px rgba(${ledColor[0]}, ${ledColor[1]}, ${ledColor[2]}, 0.8)`;
        });
    }
}



// ==========================================
// COMUNICAÇÃO WEBSOCKET E INICIALIZAÇÃO
// ==========================================

function connectWebSocket() {
    socket = new WebSocket("ws://localhost:8765");

    socket.onopen = () => {
        wsStatusText.innerText = "Bridge OBD-II Conectado";
        wsStatusText.className = "connection-status connected";
        document.getElementById('ecu-mode').innerText = "Sinal OBD-II: ONLINE";
        document.getElementById('ecu-mode').className = "status-left";
        sendLedCommand({ cmd: 'get_config', device_id: deviceId }); // sincroniza redline e demais configs, agora por UID
    };

    socket.onmessage = (event) => {
        const data = JSON.parse(event.data);

        // Mensagens de comando/controle (não são telemetria — ex: resultado
        // do botão "Ligar/Desligar Conexão", confirmação de config salva).
        if (data.cmd) {
            if (data.cmd === 'obd_connection_result') {
                obdConnected = !!data.connected;
                atualizarUiConexaoObd();
            }

            if (data.cmd === 'current_config' && data.led?.redline_rpm) {
                currentRedlineRpm = data.led.redline_rpm;
                safeSetText('gauge-max-rpm', currentRedlineRpm);
            }

            if (data.cmd === 'ftdi_devices_result') {
                preencherListaFtdi(data.devices);
            }
            return;
        }

        if (chkManualMode.checked) return; // Prioridade manual se selecionado

        if (typeof data.obd_connected === 'boolean' && data.obd_connected !== obdConnected) {
            obdConnected = data.obd_connected;
            atualizarUiConexaoObd();
        }

        if (data.error) {
            document.getElementById('ecu-mode').innerText = obdConnected
                ? "OBD-II: BUSCANDO ECU..."
                : "OBD-II: DESCONECTADO (toque em Ligar Conexão nos Ajustes)";
            document.getElementById('ecu-mode').className = "status-left searching";
        } else {
            document.getElementById('ecu-mode').innerText = "Sinal OBD-II: OK";
            document.getElementById('ecu-mode').className = "status-left";
        }

        renderEcuUI(data.rpm, data.speed, data.map, data.ect, data.fpress, data.fpress_avail, data.load, data.battery, data.fuel, data.mil_on, data.dtc_count, data.led_color);
    };

    socket.onclose = () => {
        wsStatusText.innerText = "Desconectado do Bridge";
        wsStatusText.className = "connection-status";
        document.getElementById('ecu-mode').innerText = "Sinal OBD-II: OFFLINE";
        document.getElementById('ecu-mode').className = "status-left searching";

        setTimeout(connectWebSocket, 3000);
    };

    socket.onerror = () => {
        socket.close();
    };
}

const DynoLogger = (() => {
    const BIN = 50;              // agrupa amostras a cada 50 RPM
    const RPM_FLOOR = 1800;      // ignora marcha lenta / ruído
    const RPM_MAX = 8000;
    const X_MIN = 1000, X_MAX = 7500;   // eixo RPM fixo (visual de dyno)

    let canvas = null, ctx = null, running = false;
    let last = null;             // { rpm, t }
    const bins = new Map();      // rpmBin -> { sum, n }  (média de dRPM/dt)

    function attach() {
        canvas = document.getElementById('dyno-canvas');
        if (!canvas) return;
        ctx = canvas.getContext('2d');
        const btn = document.getElementById('dyno-clear');
        if (btn) btn.onclick = reset;
        resize();
        running = true;
        draw();
    }

    function reset() {
        bins.clear();
        last = null;
        setPeaks(null, null);
        draw();
    }

    function resize() {
        if (!canvas || !ctx) return;
        const dpr = window.devicePixelRatio || 1;
        const w = canvas.clientWidth || 600;
        const h = canvas.clientHeight || 280;
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    // Alimentado pelo updateVisuals a cada mensagem do WebSocket
    function sample(rpm) {
        // auto-desliga quando a tela sai do DOM (troca de página)
        if (!canvas || !canvas.isConnected) { running = false; canvas = ctx = null; return; }
        if (!running || !ctx) return;

        const t = performance.now();
        if (rpm < RPM_FLOOR || rpm > RPM_MAX) { last = { rpm, t }; return; }

        // Só registra em ACELERAÇÃO (a puxada). Desaceleração é descartada.
        if (last && rpm > last.rpm) {
            const dt = (t - last.t) / 1000;
            if (dt > 0 && dt < 0.4) {
                const dwdt = (rpm - last.rpm) / dt;      // ∝ torque
                const bin = Math.round(rpm / BIN) * BIN;
                const b = bins.get(bin) || { sum: 0, n: 0 };
                b.sum += dwdt; b.n++;
                bins.set(bin, b);
            }
        }
        last = { rpm, t };
        draw();
    }

    // Suavização 3-pontos sobre a curva final
    function smooth(arr) {
        return arr.map((p, i) => {
            const a = arr[i - 1] || p, c = arr[i + 1] || p;
            return { rpm: p.rpm, v: (a.v + p.v + c.v) / 3 };
        });
    }

    function draw() {
        if (!ctx || !canvas) return;
        const W = canvas.clientWidth, H = canvas.clientHeight;
        const padL = 8, padR = 8, padT = 10, padB = 22;
        const x = r => padL + ((r - X_MIN) / (X_MAX - X_MIN)) * (W - padL - padR);
        const y = v => (H - padB) - v * (H - padT - padB);   // v em [0..1]

        ctx.clearRect(0, 0, W, H);

        // Grade + rótulos de RPM
        ctx.strokeStyle = '#1c2331'; ctx.fillStyle = '#5c6678';
        ctx.lineWidth = 1; ctx.font = '10px system-ui, sans-serif'; ctx.textAlign = 'center';
        for (let r = X_MIN; r <= X_MAX; r += 1000) {
            ctx.beginPath(); ctx.moveTo(x(r), padT); ctx.lineTo(x(r), H - padB); ctx.stroke();
            ctx.fillText(String(r), x(r), H - 7);
        }

        // Monta curvas
        let pts = [...bins.entries()]
            .map(([rpm, b]) => ({ rpm, tq: b.sum / b.n }))
            .sort((a, b) => a.rpm - b.rpm);

        if (pts.length < 3) {
            ctx.fillStyle = '#4a5468'; ctx.font = '13px system-ui, sans-serif';
            ctx.fillText('Aguardando puxada…', W / 2, H / 2);
            return;
        }

        // Potência (rel.) = torque × rpm
        let tqArr = pts.map(p => ({ rpm: p.rpm, v: p.tq }));
        let pwArr = pts.map(p => ({ rpm: p.rpm, v: p.tq * p.rpm }));
        tqArr = smooth(tqArr); pwArr = smooth(pwArr);

        const maxTq = Math.max(...tqArr.map(p => p.v)) || 1;
        const maxPw = Math.max(...pwArr.map(p => p.v)) || 1;
        const nTq = tqArr.map(p => ({ rpm: p.rpm, v: p.v / maxTq }));
        const nPw = pwArr.map(p => ({ rpm: p.rpm, v: p.v / maxPw }));

        const line = (arr, color) => {
            ctx.strokeStyle = color; ctx.lineWidth = 2.5;
            ctx.lineJoin = 'round'; ctx.beginPath();
            arr.forEach((p, i) => i ? ctx.lineTo(x(p.rpm), y(p.v)) : ctx.moveTo(x(p.rpm), y(p.v)));
            ctx.stroke();
        };
        line(nTq, '#3b82ff');   // torque = azul
        line(nPw, '#ff5a4d');   // potência = vermelho

        // Picos
        const peakTq = tqArr.reduce((m, p) => p.v > m.v ? p : m, tqArr[0]);
        const peakPw = pwArr.reduce((m, p) => p.v > m.v ? p : m, pwArr[0]);
        const dot = (r, color) => {
            const px = x(r);
            ctx.strokeStyle = color; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(px, padT); ctx.lineTo(px, H - padB); ctx.stroke();
            ctx.setLineDash([]);
        };
        dot(peakPw.rpm, 'rgba(255,90,77,0.5)');
        dot(peakTq.rpm, 'rgba(59,130,255,0.5)');
        setPeaks(peakTq.rpm, peakPw.rpm);
    }

    function setPeaks(tqRpm, pwRpm) {
        safeSetText('dyno-peak-tq', 'Torque pico: ' + (tqRpm ? `~${tqRpm} RPM` : '—'));
        safeSetText('dyno-peak-pw', 'Potência pico: ' + (pwRpm ? `~${pwRpm} RPM` : '—'));
    }

    return { attach, sample, reset };
})();

// Executa assim que a página é aberta
window.addEventListener('DOMContentLoaded', () => {
    updateTopMapLabel();
    toggleInputsState();
    carregarPagina('painel');
    connectWebSocket();
    CloudSync.init(); // NOVO
    setInterval(runManualLoop, 30);
});
