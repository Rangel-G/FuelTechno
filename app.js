// Seleção de Elementos de Interface Doméstica (Bancada Estática)
const chkManualMode = document.getElementById('chk-auto');
const wsStatusText = document.getElementById('ws-status');
const viewport = document.getElementById('content-viewport');

const sliders = {
    rpm: document.getElementById('param-rpm'),
    speed: document.getElementById('param-speed'),
    map: document.getElementById('param-map'),
    ect: document.getElementById('param-ect'),
    fpress: document.getElementById('param-fpress')
};

const labels = {
    rpm: document.getElementById('lbl-rpm'),
    speed: document.getElementById('lbl-speed'),
    map: document.getElementById('lbl-map'),
    ect: document.getElementById('lbl-ect'),
    fpress: document.getElementById('lbl-fpress')
};

let currentActiveMapName = 'Diário';
let tractionControlActive = true;
let socket = null;
const SCREEN_ALERT_RPM = 4000;

// Estado local (espelha o que foi mandado pro bridge) dos controles de LED
let ledAutoMode = true;
let ledManualColorHex = '#ff0000';

// Estado local da conexão OBD-II (porta serial). Agora é manual:
// só fica "true" depois que o usuário aperta "Ligar Conexão" e o
// backend confirma que abriu a porta com sucesso.
let obdConnected = false;

chkManualMode.onchange = () => toggleInputsState();

function toggleInputsState() {
    const isManual = chkManualMode.checked;
    Object.values(sliders).forEach(slider => slider.disabled = !isManual);
}

// ==========================================
// ROTEAMENTO DE PÁGINAS (NOVO SISTEMA)
// ==========================================

async function carregarPagina(nomePagina) {
    let arquivoParaCarregar = `pages/${nomePagina}.html`;

    // Se for painel, ele busca o arquivo específico do mapa
    if (nomePagina === 'painel') {
        const mapaSlug = currentActiveMapName.toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, "");
        arquivoParaCarregar = `pages/painel-${mapaSlug}.html`;
    }

    try {
        const resposta = await fetch(arquivoParaCarregar);
        const html = await resposta.text();
        viewport.innerHTML = html;
        inicializarElementosDinamicos(nomePagina);
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
    if (pagina === 'painel') {
        const painelGrid = document.getElementById('page-painel');
        if (painelGrid) {
            // Remove qualquer classe que comece com 'layout-'
            painelGrid.classList.forEach(cls => cls.startsWith('layout-') && painelGrid.classList.remove(cls));

            // Adiciona a classe baseada no nome (ex: 'Diário' -> 'diario')
            const slug = currentActiveMapName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, "");
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
                // Encontra qual é o nome do mapa baseado nas palavras-chave
                const novoMapa = ['Rua', 'Pista', 'Drift'].find(m => title.includes(m)) || 'Diário';
                selectActiveMap(novoMapa);
            };
        });
    }

    // 3. Lógica da tela de Ajustes (controles de configuração)
    if (pagina === 'ajustes') {
        inicializarConfigOBD();
        inicializarConfigLED();
        inicializarControlesLed();
        inicializarControlesObd();
    }
}

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
    'serial-com':    { label: 'Porta Serial',       placeholder: 'COM4',                  baudVisible: true },
    'serial-rfcomm': { label: 'Dispositivo Bluetooth', placeholder: '/dev/rfcomm0',        baudVisible: true },
    'serial-usb':    { label: 'Dispositivo USB',     placeholder: '/dev/ttyUSB0',          baudVisible: true },
    'wifi':          { label: 'Endereço IP:Porta',   placeholder: '192.168.0.10:35000',    baudVisible: false },
};

function inicializarConfigOBD() {
    const typeSelect = document.getElementById('cfg-obd-type');
    const addrInput = document.getElementById('cfg-obd-addr');
    const addrLabel = document.getElementById('cfg-obd-addr-label');
    const baudSelect = document.getElementById('cfg-obd-baud');
    const protoSelect = document.getElementById('cfg-obd-proto');
    const btnSave = document.getElementById('btn-save-obd');
    const badge = document.getElementById('obd-status-badge');

    if (!typeSelect || !addrInput || !btnSave) return;

    // Carrega configuração salva (localStorage como fallback imediato)
    const saved = JSON.parse(localStorage.getItem('ft_config_obd') || '{}');

    if (saved.connection_type) typeSelect.value = saved.connection_type;
    if (saved.serial_port) addrInput.value = saved.serial_port;
    if (saved.baud_rate && baudSelect) baudSelect.value = String(saved.baud_rate);
    if (saved.protocol && protoSelect) protoSelect.value = saved.protocol;

    // Atualiza badge com o endereço salvo
    if (badge && saved.serial_port) badge.innerText = saved.serial_port;

    // Atualiza placeholder quando muda o tipo
    function updatePlaceholder() {
        const hints = OBD_TYPE_HINTS[typeSelect.value] || OBD_TYPE_HINTS['serial-com'];
        addrInput.placeholder = hints.placeholder;
        if (addrLabel) addrLabel.innerText = hints.label;
        // Esconde baud rate para WiFi
        const baudField = baudSelect?.closest('.config-field');
        if (baudField) baudField.style.display = hints.baudVisible ? '' : 'none';
    }
    typeSelect.onchange = updatePlaceholder;
    updatePlaceholder();

    // Salvar
    btnSave.onclick = () => {
        const config = {
            connection_type: typeSelect.value,
            serial_port: addrInput.value || addrInput.placeholder,
            baud_rate: baudSelect ? parseInt(baudSelect.value) : 38400,
            protocol: protoSelect ? protoSelect.value : 'auto',
        };
        localStorage.setItem('ft_config_obd', JSON.stringify(config));

        // Atualiza badge
        if (badge) badge.innerText = config.serial_port;

        // Envia pro backend via WebSocket
        sendLedCommand({ cmd: 'update_config', section: 'obd', ...config });

        // Feedback visual
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
    const nameInput = document.getElementById('cfg-led-name');
    const uuidInput = document.getElementById('cfg-led-uuid');
    const redlineInput = document.getElementById('cfg-led-redline');
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
        const normalRgb = hexToRgb(colorNormal?.value || '#0000ff');
        const redlineRgb = hexToRgb(colorRedline?.value || '#ff0000');

        const config = {
            device_name: nameInput.value || nameInput.placeholder,
            char_uuid: uuidInput?.value || uuidInput?.placeholder || '0000ffe1-0000-1000-8000-00805f9b34fb',
            redline_rpm: parseInt(redlineInput?.value || '3000'),
            color_normal: [normalRgb.r, normalRgb.g, normalRgb.b],
            color_redline: [redlineRgb.r, redlineRgb.g, redlineRgb.b],
        };
        localStorage.setItem('ft_config_led', JSON.stringify(config));

        // Atualiza badge
        if (badge) badge.innerText = config.device_name.substring(0, 10);

        // Envia pro backend
        sendLedCommand({ cmd: 'update_config', section: 'led', ...config });

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

// Adicione esta função globalmente (pode colocar logo abaixo da função toggleTractionControl)
function selectActiveMap(mapName) {
    currentActiveMapName = mapName;
    updateTopMapLabel();

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
    let paginaAlvo = 'painel'; // Padrão
    if (mapName === 'Diário') paginaAlvo = 'painel-diario';
    else if (mapName === 'Rua') paginaAlvo = 'painel-rua';
    else if (mapName === 'Pista') paginaAlvo = 'painel-pista';
    else if (mapName === 'Drift') paginaAlvo = 'painel-drift';

    // Carrega a página correta e aplica as classes de layout após a injeção do HTML
    carregarPagina(paginaAlvo).then(() => {
        const painelGrid = document.getElementById('page-painel');
        if (painelGrid) {
            const slug = mapName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, "");
            painelGrid.classList.add(`layout-${slug}`);
        }
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

function calculateZetecRocamGear(currentRpm, currentSpeed) {
    if (currentSpeed < 4 || currentRpm < 1050) return 'N';
    const diferencial = 4.25;
    const marchas = [3.58, 1.93, 1.41, 1.11, 0.88];
    const perimetroPneu = 1.83;

    let melhorMarcha = '5ª';
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

function renderEcuUI(rpm, speed, map, ect, fpress, fpress_avail, load, battery, milOn, dtcCount) {
    // 1. Preparação de Dados (Cálculos específicos)
    const gear = calculateZetecRocamGear(rpm, speed);

    // Mapeamento automático de valores simples (ID HTML -> Valor)
    const values = {
        'val-rpm': rpm, // Adicionado para garantir o mapeamento do RPM numérico nos novos painéis
        'val-speed': speed,
        'val-gear': gear,
        'val-map': map.toFixed(2),
        'val-ect': ect,
        'val-power': `${load}%`,
        'val-fpress': fpress_avail ? fpress.toFixed(2) : "N/D",
        'val-battery': (battery || 0).toFixed(1)
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

    // 3. Sincronização com Bancada (Apenas se estiver no modo manual)
    syncManualControls(rpm, speed, map, ect, fpress, fpress_avail);
}

// --- Funções auxiliares para manter o código limpo ---

function updateVisuals(rpm, map, ect) {
    // RPM digital (overlay numérico acima do conta-giros)
    safeSetText('overlay-rpm-val', rpm);

    // RPM Barra
    const svgFill = document.getElementById('rpm-svg-fill');
    if (svgFill) svgFill.setAttribute('width', Math.min(1, Math.max(0, rpm / 8000)) * 1000);

    // Shift Light e Alertas
    const isOverLimit = rpm >= 4000;
    const screenEl = document.getElementById('ecu-screen');
    if (screenEl) screenEl.classList.toggle('screen-alert-active', isOverLimit);

    // Datalogger (Barras)
    safeSetStyleWidth('log-bar-rpm', `${(rpm / 8000) * 100}%`);
    safeSetStyleWidth('log-bar-map', `${Math.max(0, Math.min(100, ((map + 1) / 4) * 100))}%`);
    safeSetStyleWidth('log-bar-ect', `${(ect / 120) * 100}%`);
}

function syncManualControls(rpm, speed, map, ect, fpress, fpress_avail) {
    if (!chkManualMode.checked) {
        sliders.rpm.value = rpm;
        sliders.speed.value = speed;
        sliders.map.value = map;
        // ... restante dos sliders
    }
}

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
            false,
            0
        );
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
            // 'current_config' e 'config_saved' já são tratados nos próprios
            // handlers de clique/carregamento da tela de Ajustes.
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

        renderEcuUI(data.rpm, data.speed, data.map, data.ect, data.fpress, data.fpress_avail, data.load, data.battery, data.mil_on, data.dtc_count);
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

// Executa assim que a página é aberta
window.addEventListener('DOMContentLoaded', () => {
    updateTopMapLabel();
    toggleInputsState();
    carregarPagina('painel'); // Carrega a primeira tela
    connectWebSocket();
    setInterval(runManualLoop, 30);
});
