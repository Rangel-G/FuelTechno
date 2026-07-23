# 🚗 FuelTechno

> Uma plataforma de telemetria automotiva inspirada na FuelTech, desenvolvida para veículos com ECU original através da comunicação OBD-II.

![Python](https://img.shields.io/badge/Python-3.11+-blue?logo=python)
![JavaScript](https://img.shields.io/badge/JavaScript-ES6-yellow?logo=javascript)
![Bluetooth](https://img.shields.io/badge/Bluetooth-BLE-blue?logo=bluetooth)
![OBD-II](https://img.shields.io/badge/OBD--II-ELM327-red)
![Firebase](https://img.shields.io/badge/Cloud-Firestore-orange?logo=firebase)
![License](https://img.shields.io/badge/Status-Em%20Desenvolvimento-orange)

---

# 📖 Sobre

O **FuelTechno** é um projeto open source que busca reproduzir parte da experiência oferecida por uma ECU programável como a **FuelTech**, porém utilizando inicialmente a ECU original do veículo.

A aplicação permite visualizar informações do motor em tempo real através de um painel moderno, utilizando comunicação com adaptadores **OBD-II ELM327**, além de integrar dispositivos Bluetooth Low Energy, como fitas LED RGB sincronizadas com o funcionamento do veículo.

O objetivo do projeto é evoluir para uma plataforma completa de telemetria automotiva, oferecendo recursos de monitoramento, personalização e análise de dados.

---

# 🚙 Veículo de referência

O desenvolvimento é validado em um **Ford Ka 2009 1.0 FFV** (ECU IAW-4CFR, Magneti Marelli), protocolo **ISO 15765-4 CAN 11 bits / 500 kbaud**.

O projeto não é específico desse veículo: qualquer carro com OBD-II funciona, mas os PIDs disponíveis variam conforme a ECU. O app detecta automaticamente quais são suportados na conexão.

---

# ✨ Funcionalidades

Atualmente o projeto possui:

- ✅ Comunicação com adaptadores OBD-II (ELM327 / OBDLink EX)
- ✅ Detecção automática de protocolo (`ATSPx`) e timing adaptativo (`ATAT1`)
- ✅ Descoberta dos PIDs suportados pela ECU via bitmap (`0100`/`0120`/`0140`)
- ✅ Leitura de parâmetros do veículo em tempo real (~25 Hz)
- ✅ Interface inspirada na FuelTech, com múltiplos painéis
- ✅ Painel Sport com manômetros SVG e escala responsiva
- ✅ Suavização visual dos ponteiros e da barra de RPM (interpolação em `requestAnimationFrame`)
- ✅ Sistema de Mapas
- ✅ Bancada Manual para simulação dos sensores
- ✅ Comunicação Bluetooth Low Energy
- ✅ Controle de fita LED RGB
- ✅ Shift Light com loop dedicado (cadência de 10 ms, independente do polling OBD)
- ✅ Aplicativo único: janela nativa via `pywebview`, sem terminal
- ✅ Executável Windows (`FuelTechno.exe`) gerado com PyInstaller
- ✅ Sincronismo de configurações na nuvem (Cloud Firestore, com autenticação anônima por dispositivo)
- ✅ Configuração através de arquivo `.env` e da tela de Ajustes
- ✅ Arquitetura modular

---

# 🖥️ Interface

O sistema possui diferentes telas para facilitar a utilização.

- Dashboard Principal (barra de RPM + status da ECU)
- Painel Diário
- Painel Sport (manômetro de RPM + manômetro de temperatura)
- Seleção de Mapas
- Data Logger
- Configurações (conexão OBD, LED, marchas)

---

# 📂 Estrutura do Projeto

```text
FuelTechno/
│
├── main.py                  # ponto de entrada único (HTTP + bridge + janela)
├── bridge.py                # WebSocket, ELM327Bridge, loop do shift light
├── led_controller.py        # BLE da fita LED
├── config.py                # leitura do .env
├── FuelTechno.spec          # receita do PyInstaller
│
├── index.html
├── app.js
├── style.css
├── firebase-config.js       # config pública do Firebase (protegida pelas regras, não pelo sigilo)
├── vendor/                  # SDK do Firebase vendorizado (funciona offline)
├── partials/                # fragmentos reutilizáveis (ecu-frame.html)
├── pages/                   # telas carregadas dinamicamente
│
├── mobile/                  # projeto Capacitor (Android)
│   ├── src/public/
│   └── android/
│
├── .env.example
├── requirements.txt
├── BUILD.md
└── README.md
```

---

# 🚀 Instalação

## 1. Clone o repositório

```bash
git clone https://github.com/SEU-USUARIO/FuelTechno.git
```

Entre na pasta:

```bash
cd FuelTechno
```

---

## 2. Crie um ambiente virtual

### Windows

```bash
python -m venv .venv

.venv\Scripts\activate
```

### Linux / macOS

```bash
python3 -m venv .venv

source .venv/bin/activate
```

---

## 3. Instale as dependências

```bash
pip install -r requirements.txt
```

---

## 4. Configure o arquivo .env

Copie o arquivo de exemplo.

### Windows

```bash
copy .env.example .env
```

### Linux

```bash
cp .env.example .env
```

Depois configure conforme seu ambiente.

Exemplo:

```env
# --- Conexão OBD-II ---
# OBDLink EX em modo VCP: 115200
# Clones ELM327 Bluetooth: normalmente 38400
SERIAL_PORT=COM4
BAUD_RATE=115200

# --- Fita LED (BLE) ---
LED_DEVICE_NAME=LEDDMX-000101
LED_CHAR_UUID=0000ffe1-0000-1000-8000-00805f9b34fb
LED_REDLINE_RPM=3000
LED_BLINK_INTERVAL_MS=70

# --- Servidores locais ---
WS_HOST=127.0.0.1
WS_PORT=8765
HTTP_PORT=8000
```

> `BAUD_RATE=115200` vale para o OBDLink EX em modo VCP. Clones ELM327 Bluetooth normalmente usam 38400.

O sincronismo na nuvem (Firebase) não depende do `.env` — a configuração pública fica em `firebase-config.js` e a autenticação é anônima, feita automaticamente pelo app.

---

# ▶️ Executando

Um único comando sobe o servidor HTTP local, o bridge (WebSocket + OBD-II + LED) e a janela nativa:

```bash
python main.py
```

Depois, dentro do app: **Ajustes → Configurar Conexão → Ligar Conexão**.

Para gerar o executável Windows, veja **[BUILD.md](BUILD.md)**.

---

# 🔧 Tecnologias

O projeto utiliza:

- Python
- JavaScript
- HTML5
- CSS3
- WebSocket
- PySerial
- Bleak
- Bluetooth Low Energy
- OBD-II
- ELM327
- pywebview
- PyInstaller
- Cloud Firestore (client SDK + autenticação anônima)
- Capacitor (Android, em andamento)

---

# 📡 Comunicação

```text
        Adaptador OBD-II (ELM327 / OBDLink EX)
                 │  serial
          bridge.py (asyncio)
           │             │
   WebSocket :8765   Loop dedicado do Shift Light
           │             │
   Frontend (pywebview)  BLE → Fita LED RGB
           │
   Cloud Firestore (configs por dispositivo, via app.js)
```

A sincronização com a nuvem acontece direto do frontend: o app autentica de forma anônima, lê/grava suas configurações em `users/{uid}/configs/` e mantém um cache local em `localStorage` para funcionar sem internet.

---

# 📊 Recursos atuais

## Dashboard

- RPM
- Velocidade
- Temperatura
- MAP
- Pressão
- Indicadores
- Shift Light

## Painel Sport

- Manômetro de RPM e de temperatura em SVG
- Escala responsiva por container query
- Cor de destaque sincronizada com a fita LED

## Bancada Manual

Permite simular sensores sem conectar ao veículo. Ideal para desenvolvimento da interface.

---

# 🛣️ Roadmap

Planejado para as próximas versões:

- [x] Aplicativo único com janela nativa
- [x] Executável Windows
- [x] Sincronismo de configurações na nuvem
- [x] Painel Sport
- [ ] Data Logger completo
- [ ] Exportação CSV
- [ ] Replay da telemetria
- [ ] Alertas configuráveis
- [ ] Dashboard totalmente personalizável
- [ ] Temas
- [ ] Escrita de parâmetros via OBD-II (quando suportado)
- [ ] HUD
- [ ] Estatísticas de condução
- [ ] Aplicativo Android (Capacitor) — em andamento

---

# 🤝 Contribuindo

Contribuições são muito bem-vindas.

Caso encontre algum problema ou tenha sugestões:

1. Faça um Fork
2. Crie uma Branch
3. Realize suas alterações
4. Abra um Pull Request

---

# ⚠️ Aviso

Este projeto **não substitui uma ECU programável**.

Atualmente o foco está em:

- Monitoramento
- Telemetria
- Interface
- Comunicação OBD-II
- Integração Bluetooth

Qualquer funcionalidade de escrita dependerá do suporte da ECU original do veículo.

---

# 📜 Licença

Este projeto é distribuído sob a licença MIT.

---

# 👨‍💻 Autor

Desenvolvido por **João Vitor Rangel de Godoy**

Inspirado na tecnologia das ECUs programáveis FuelTech e desenvolvido com foco em aprendizado, telemetria automotiva e software open source.